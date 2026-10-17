// External login providers, configured by admins and stored in `oauth_providers` (any number, several of
// the same type). Two kinds: any OpenID Connect issuer (Google, Microsoft, Authentik, Keycloak…) through
// discovery, and GitHub (plain OAuth 2; github.com or a GitHub Enterprise base URL). Authorization code
// flow with PKCE, state and (OIDC) nonce. The server is only a client: it never issues tokens.
//
// Client secrets are stored sealed with SECRET_KEY and opened only when a login needs them. The
// provider metadata (discovery) is cached per provider and dropped when the provider changes.

import * as client from "openid-client";
import type { ProviderType } from "@awake/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";
import { open } from "../secrets.ts";

export interface ProviderRow {
  id: string;
  label: string;
  type: ProviderType;
  issuer: string | null;
  client_id: string;
  client_secret_enc: string;
  scopes: string;
  enabled: number;
  allow_signup: number;
  created_at: number;
  updated_at: number;
}

/** A provider ready to use: secret opened. */
export interface Provider {
  id: string;
  label: string;
  type: ProviderType;
  issuer: string | null;
  clientId: string;
  clientSecret: string;
  scopes: string;
  allowSignup: boolean;
  updatedAt: number;
}

export interface ExternalIdentity {
  /** Stable id at the provider (OIDC `sub`, GitHub numeric id). */
  subject: string;
  email: string | null;
  /** Suggestion for the username of a new account. */
  usernameHint: string | null;
}

export interface FlowSecrets {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export class OAuthProviders {
  private configurations = new Map<string, { updatedAt: number; pending: Promise<client.Configuration> }>();

  constructor(
    private db: Db,
    private config: Config,
  ) {}

  /** Enabled providers, for the login page. */
  listEnabled(): { id: string; label: string }[] {
    return this.db.prepare("SELECT id, label FROM oauth_providers WHERE enabled = 1 ORDER BY label, id").all() as { id: string; label: string }[];
  }

  label(id: string): string {
    const row = this.db.prepare("SELECT label FROM oauth_providers WHERE id = ?").get(id) as { label: string } | undefined;
    return row?.label ?? id;
  }

  /** An enabled provider with its secret, or PROVIDER_NOT_FOUND. */
  get(id: string): Provider {
    const row = this.db.prepare("SELECT * FROM oauth_providers WHERE id = ? AND enabled = 1").get(id) as ProviderRow | undefined;
    if (!row) throw new ApiError(404, "PROVIDER_NOT_FOUND");
    if (!this.config.secretKey) throw new ApiError(409, "SECRET_KEY_MISSING");
    let clientSecret: string;
    try {
      clientSecret = open(row.client_secret_enc, this.config.secretKey);
    } catch (err) {
      // SECRET_KEY changed since the secret was saved: an admin has to enter it again.
      log.error("oauth", "cannot decrypt the client secret (was SECRET_KEY changed?)", { provider: id, err });
      throw new ApiError(409, "SECRET_KEY_MISSING");
    }
    return {
      id: row.id,
      label: row.label,
      type: row.type,
      issuer: row.issuer,
      clientId: row.client_id,
      clientSecret,
      scopes: row.scopes,
      allowSignup: !!row.allow_signup,
      updatedAt: row.updated_at,
    };
  }

  redirectUri(id: string): string {
    return `${this.config.publicUrl}/api/auth/oauth/${id}/callback`;
  }

  /** Call after a provider is changed or deleted. */
  forget(id: string): void {
    this.configurations.delete(id);
  }

  /** Checks an issuer before saving it: OIDC discovery must succeed. Throws PROVIDER_UNREACHABLE. */
  async test(type: ProviderType, issuer: string | null): Promise<void> {
    if (type !== "oidc") return;
    try {
      if (!issuer) throw new Error("missing issuer");
      await client.discovery(new URL(issuer), "awake-check");
    } catch (err) {
      log.info("oauth", "provider check failed", { issuer, err });
      throw new ApiError(502, "PROVIDER_UNREACHABLE", "issuer");
    }
  }

  newSecrets(): FlowSecrets {
    return { state: client.randomState(), nonce: client.randomNonce(), codeVerifier: client.randomPKCECodeVerifier() };
  }

  async authorizationUrl(provider: Provider, secrets: FlowSecrets): Promise<URL> {
    const configuration = await this.configuration(provider);
    const params: Record<string, string> = {
      redirect_uri: this.redirectUri(provider.id),
      scope: provider.scopes,
      state: secrets.state,
      code_challenge: await client.calculatePKCECodeChallenge(secrets.codeVerifier),
      code_challenge_method: "S256",
    };
    if (provider.type === "oidc") params.nonce = secrets.nonce;
    return client.buildAuthorizationUrl(configuration, params);
  }

  /** Exchanges the code of the callback URL and returns who logged in. Throws on any failure. */
  async complete(provider: Provider, callbackUrl: URL, secrets: FlowSecrets): Promise<ExternalIdentity> {
    const configuration = await this.configuration(provider);
    if (provider.type === "github") {
      const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: secrets.codeVerifier,
        expectedState: secrets.state,
        idTokenExpected: false,
      });
      return githubIdentity(configuration, tokens.access_token, githubApi(provider.issuer));
    }

    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: secrets.codeVerifier,
      expectedState: secrets.state,
      expectedNonce: secrets.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("id token without sub");
    // Only a verified email is kept: it is informational, never used to match accounts.
    const email = typeof claims.email === "string" && claims.email_verified === true ? claims.email : null;
    const hint = [claims.preferred_username, claims.nickname, email, claims.name].find((v) => typeof v === "string" && v) as
      | string
      | undefined;
    return { subject: claims.sub, email, usernameHint: hint ?? null };
  }

  private configuration(provider: Provider): Promise<client.Configuration> {
    const cached = this.configurations.get(provider.id);
    if (cached && cached.updatedAt === provider.updatedAt) return cached.pending;

    const pending =
      provider.type === "github"
        ? Promise.resolve(new client.Configuration(githubServer(provider.issuer), provider.clientId, provider.clientSecret))
        : client.discovery(new URL(provider.issuer!), provider.clientId, provider.clientSecret);
    // A failed discovery (provider down) is retried on the next login instead of being cached.
    pending.catch((err) => {
      log.warn("oauth", "provider discovery failed", { provider: provider.id, err });
      if (this.configurations.get(provider.id)?.pending === pending) this.configurations.delete(provider.id);
    });
    this.configurations.set(provider.id, { updatedAt: provider.updatedAt, pending });
    return pending;
  }
}

/** github.com, or a GitHub Enterprise server at `base`. */
function githubServer(base: string | null) {
  const root = (base ?? "https://github.com").replace(/\/+$/, "");
  return { issuer: root, authorization_endpoint: `${root}/login/oauth/authorize`, token_endpoint: `${root}/login/oauth/access_token` };
}

function githubApi(base: string | null): string {
  return base ? `${base.replace(/\/+$/, "")}/api/v3` : "https://api.github.com";
}

async function githubIdentity(configuration: client.Configuration, accessToken: string, api: string): Promise<ExternalIdentity> {
  const headers = new Headers({ accept: "application/vnd.github+json", "user-agent": "awake" });
  const res = await client.fetchProtectedResource(configuration, accessToken, new URL(`${api}/user`), "GET", undefined, headers);
  if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`);
  const user = (await res.json()) as { id?: number; login?: string; email?: string | null };
  if (typeof user.id !== "number") throw new Error("GitHub /user without id");

  let email: string | null = null;
  const emailsRes = await client.fetchProtectedResource(configuration, accessToken, new URL(`${api}/user/emails`), "GET", undefined, headers);
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = emails.find((e) => e.primary && e.verified)?.email ?? null;
  }
  return { subject: String(user.id), email, usernameHint: user.login ?? null };
}

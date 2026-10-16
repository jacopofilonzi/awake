// External login providers: any OpenID Connect issuer (Google, Authentik, Keycloak, …) through
// discovery, plus GitHub (plain OAuth 2, no OIDC). Authorization code flow with PKCE, state and (OIDC)
// nonce. The server is only a client: it never issues tokens to other applications.

import * as client from "openid-client";
import type { Config, ProviderConfig } from "../config.ts";
import { ApiError } from "../errors.ts";
import { log } from "../log.ts";

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

const GITHUB = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
};

export class OAuthProviders {
  private configurations = new Map<string, Promise<client.Configuration>>();

  constructor(private config: Config) {}

  list(): { id: string; label: string }[] {
    return this.config.providers.map((p) => ({ id: p.id, label: p.label }));
  }

  label(id: string): string {
    return this.config.providers.find((p) => p.id === id)?.label ?? id;
  }

  get(id: string): ProviderConfig {
    const provider = this.config.providers.find((p) => p.id === id);
    if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND");
    return provider;
  }

  redirectUri(provider: ProviderConfig): string {
    return `${this.config.publicUrl}/api/auth/oauth/${provider.id}/callback`;
  }

  newSecrets(): FlowSecrets {
    return { state: client.randomState(), nonce: client.randomNonce(), codeVerifier: client.randomPKCECodeVerifier() };
  }

  async authorizationUrl(provider: ProviderConfig, secrets: FlowSecrets): Promise<URL> {
    const configuration = await this.configuration(provider);
    const params: Record<string, string> = {
      redirect_uri: this.redirectUri(provider),
      scope: provider.scopes,
      state: secrets.state,
      code_challenge: await client.calculatePKCECodeChallenge(secrets.codeVerifier),
      code_challenge_method: "S256",
    };
    if (provider.type === "oidc") params.nonce = secrets.nonce;
    return client.buildAuthorizationUrl(configuration, params);
  }

  /** Exchanges the code of the callback URL and returns who logged in. Throws on any failure. */
  async complete(provider: ProviderConfig, callbackUrl: URL, secrets: FlowSecrets): Promise<ExternalIdentity> {
    const configuration = await this.configuration(provider);
    if (provider.type === "github") {
      const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: secrets.codeVerifier,
        expectedState: secrets.state,
        idTokenExpected: false,
      });
      return githubIdentity(configuration, tokens.access_token);
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

  private configuration(provider: ProviderConfig): Promise<client.Configuration> {
    let pending = this.configurations.get(provider.id);
    if (!pending) {
      pending =
        provider.type === "github"
          ? Promise.resolve(new client.Configuration(GITHUB, provider.clientId, provider.clientSecret))
          : client.discovery(new URL(provider.issuer!), provider.clientId, provider.clientSecret);
      // A failed discovery (provider down) is retried on the next login instead of being cached.
      pending.catch((err) => {
        log.warn("oauth", "provider discovery failed", { provider: provider.id, err });
        this.configurations.delete(provider.id);
      });
      this.configurations.set(provider.id, pending);
    }
    return pending;
  }
}

async function githubIdentity(configuration: client.Configuration, accessToken: string): Promise<ExternalIdentity> {
  const headers = new Headers({ accept: "application/vnd.github+json", "user-agent": "awake" });
  const res = await client.fetchProtectedResource(configuration, accessToken, new URL("https://api.github.com/user"), "GET", undefined, headers);
  if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`);
  const user = (await res.json()) as { id?: number; login?: string; email?: string | null };
  if (typeof user.id !== "number") throw new Error("GitHub /user without id");

  let email: string | null = null;
  const emailsRes = await client.fetchProtectedResource(
    configuration,
    accessToken,
    new URL("https://api.github.com/user/emails"),
    "GET",
    undefined,
    headers,
  );
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = emails.find((e) => e.primary && e.verified)?.email ?? null;
  }
  return { subject: String(user.id), email, usernameHint: user.login ?? null };
}

// Secrets: random tokens, hashing and password storage.
//
// - Tokens (sessions, agent tokens, password links, OAuth state) are long and random, so a plain
//   SHA-256 is enough to store them: only the hash reaches the database.
// - Passwords are low-entropy and use scrypt, stored as `scrypt$<N>$<r>$<p>$<salt>$<hash>` (base64url),
//   so the cost can be raised later without invalidating existing hashes.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
// 128 * N * r bytes are needed; leave headroom over Node's 32 MB default.
const MAXMEM = 128 * 1024 * 1024;

export function randomToken(prefix = ""): string {
  return prefix + crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Readable random password for the bootstrap admin / admin-generated accounts (~119 bits). */
export function generatePassword(): string {
  // No look-alike characters (0/O, 1/l/I).
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.match(/.{5}/g)!.join("-");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** A hash to verify against when the user does not exist, so timing does not reveal usernames. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  return dummyHash;
}

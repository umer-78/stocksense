/** API keys for AI assistants (MCP). Only an scrypt hash of each key is stored. */
import { randomBytes, scrypt } from "node:crypto";

export const API_KEY_PREFIX = "flk_";

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

// Fixed salt so the hash can be looked up directly; each key is already
// 192 random bits, so a per-key salt would add nothing.
const HASH_SALT = "forelark-api-key-v1";

export function hashApiKey(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(key, HASH_SALT, 32, { N: 16384, r: 8, p: 1 }, (error, derived) =>
      error ? reject(error) : resolve(derived.toString("hex")),
    );
  });
}

/** Shown in the UI so a merchant can tell keys apart without seeing them. */
export function keyHint(key: string): string {
  return `${key.slice(0, API_KEY_PREFIX.length + 4)}…`;
}

/** The token from an `Authorization: Bearer <token>` header, if it looks like a Forelark key. */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] ?? null;
  return token && token.startsWith(API_KEY_PREFIX) && token.length <= 100 ? token : null;
}

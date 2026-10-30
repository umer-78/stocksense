/** API keys for AI assistants (MCP). Only a SHA-256 hash of each key is stored. */
import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "flk_";

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
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

/** API-key persistence for the AI-assistant (MCP) endpoint. One key per shop. */
import db from "../db.server";
import { generateApiKey, hashApiKey, keyHint } from "./api-keys";

export interface ApiKeyInfo {
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function getApiKeyInfo(shop: string): Promise<ApiKeyInfo | null> {
  const row = await db.apiKey.findUnique({ where: { shop } });
  return row
    ? { hint: row.hint, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null }
    : null;
}

/** Create a key (replacing any old one). The plain key is returned once and never stored. */
export async function createApiKey(shop: string): Promise<string> {
  const key = generateApiKey();
  const data = { keyHash: await hashApiKey(key), hint: keyHint(key), createdAt: new Date(), lastUsedAt: null };
  await db.apiKey.upsert({ where: { shop }, create: { shop, ...data }, update: data });
  return key;
}

export async function revokeApiKey(shop: string): Promise<void> {
  await db.apiKey.deleteMany({ where: { shop } });
}

/** The shop a key belongs to, or null. Records when the key was last used. */
export async function shopForApiKey(key: string): Promise<string | null> {
  const row = await db.apiKey.findUnique({ where: { keyHash: await hashApiKey(key) } });
  if (!row) {
    return null;
  }
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { shop: row.shop }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return row.shop;
}

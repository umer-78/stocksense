/**
 * AI-assistant endpoint (Model Context Protocol over HTTP, JSON responses).
 * Authenticated with a per-shop API key created on the "AI assistants" page.
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { bearerToken } from "../lib/api-keys";
import { shopForApiKey } from "../lib/api-keys.server";
import { canUseFeature } from "../lib/billing/plans";
import { handleMcpMessage } from "../lib/mcp";
import { mcpDataForShop } from "../lib/mcp.server";
import { cachedPlan } from "../lib/plan-cache.server";
import { clientAddress, createRateLimiter } from "../lib/rate-limit";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;
// Per address before the key is checked (each check is an scrypt hash), and
// per shop after; generous for an assistant, tight for a script guessing keys.
const byAddress = createRateLimiter({ limit: 120, windowMs: 60_000 });
const byShop = createRateLimiter({ limit: 240, windowMs: 60_000 });
const tooMany = (waitMs: number) =>
  rpcError(-32029, "Too many requests. Try again shortly.", 429, { "Retry-After": String(Math.ceil(waitMs / 1000)) });

const rpcError = (code: number, message: string, status: number, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers });

export const loader = () =>
  new Response("This endpoint accepts MCP requests over POST.", { status: 405, headers: { Allow: "POST" } });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const addressWait = byAddress.hit(clientAddress(request));
  if (addressWait) return tooMany(addressWait);
  const token = bearerToken(request.headers.get("authorization"));
  const shop = token ? await shopForApiKey(token) : null;
  if (!shop) {
    return rpcError(-32001, "Missing or invalid Forelark API key. Create one in Forelark under AI assistants.", 401, {
      "WWW-Authenticate": 'Bearer realm="forelark"',
    });
  }
  const shopWait = byShop.hit(shop);
  if (shopWait) return tooMany(shopWait);
  if (!canUseFeature(await cachedPlan(shop), "aiAccess")) {
    return rpcError(-32001, "AI assistant access needs the Forelark Pro plan.", 403);
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return rpcError(-32600, "Request too large", 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return rpcError(-32600, "Request too large", 413);
    }
    body = JSON.parse(text);
  } catch {
    return rpcError(-32700, "Parse error", 400);
  }

  const data = mcpDataForShop(shop);
  if (Array.isArray(body)) {
    // a batch over the limit is refused whole, rather than silently cut short
    if (body.length > MAX_BATCH) {
      return rpcError(-32600, `Batch too large (at most ${MAX_BATCH} messages)`, 413);
    }
    const responses = (await Promise.all(body.map((message) => handleMcpMessage(message, data)))).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }
  const response = await handleMcpMessage(body, data);
  return response ? json(response) : new Response(null, { status: 202 });
};

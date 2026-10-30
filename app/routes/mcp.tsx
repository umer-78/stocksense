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

const MAX_BODY_BYTES = 256 * 1024;

const rpcError = (code: number, message: string, status: number, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers });

export const loader = () =>
  new Response("This endpoint accepts MCP requests over POST.", { status: 405, headers: { Allow: "POST" } });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const token = bearerToken(request.headers.get("authorization"));
  const shop = token ? await shopForApiKey(token) : null;
  if (!shop) {
    return rpcError(-32001, "Missing or invalid Forelark API key. Create one in Forelark under AI assistants.", 401, {
      "WWW-Authenticate": 'Bearer realm="forelark"',
    });
  }
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
    const responses = (await Promise.all(body.slice(0, 20).map((message) => handleMcpMessage(message, data)))).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }
  const response = await handleMcpMessage(body, data);
  return response ? json(response) : new Response(null, { status: 202 });
};

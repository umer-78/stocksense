import { describe, expect, it } from "vitest";
import { bearerToken, generateApiKey, hashApiKey, keyHint } from "./api-keys";
import { handleMcpMessage, type McpData } from "./mcp";

const calls: unknown[] = [];
const data: McpData = {
  summary: async () => ({ critical: 2, low: 1, ok: 10 }),
  reorderList: async (a) => {
    calls.push(a);
    return { rows: [] };
  },
  variant: async ({ query }) => (query === "TR-09" ? { sku: "TR-09" } : null),
  purchaseOrders: async ({ status }) => ({ status, orders: [] }),
};

const rpc = (method: string, params: Record<string, unknown> = {}, id: number | undefined = 1) =>
  handleMcpMessage({ jsonrpc: "2.0", id, method, params }, data);

describe("MCP server", () => {
  it("negotiates the protocol version on initialize", async () => {
    const res = (await rpc("initialize", { protocolVersion: "2025-03-26" })) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(res.result.protocolVersion).toBe("2025-03-26");
    expect(res.result.serverInfo.name).toBe("forelark");
    const latest = (await rpc("initialize", { protocolVersion: "1999-01-01" })) as { result: { protocolVersion: string } };
    expect(latest.result.protocolVersion).toBe("2025-06-18");
  });

  it("returns nothing for notifications", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, data)).toBeNull();
  });

  it("lists read-only tools", async () => {
    const res = (await rpc("tools/list")) as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } };
    expect(res.result.tools.map((t) => t.name)).toEqual(["stock_summary", "reorder_list", "variant_forecast", "purchase_orders"]);
    expect(res.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("clamps tool arguments", async () => {
    await rpc("tools/call", { name: "reorder_list", arguments: { status: "weird", limit: 5000, search: "x" } });
    expect(calls.at(-1)).toEqual({ status: "needs_order", limit: 200, search: "x" });
  });

  it("returns tool errors in the result, and protocol errors for unknown tools", async () => {
    const missing = (await rpc("tools/call", { name: "variant_forecast", arguments: { query: "nope" } })) as { result: { isError: boolean } };
    expect(missing.result.isError).toBe(true);
    const found = (await rpc("tools/call", { name: "variant_forecast", arguments: { query: "TR-09" } })) as { result: { structuredContent: unknown } };
    expect(found.result.structuredContent).toEqual({ sku: "TR-09" });
    const unknown = (await rpc("tools/call", { name: "delete_everything" })) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
  });

  it("rejects malformed messages", async () => {
    expect(((await handleMcpMessage([], data)) as { error: { code: number } }).error.code).toBe(-32600);
    expect(((await rpc("resources/list")) as { error: { code: number } }).error.code).toBe(-32601);
  });
});

describe("API keys", () => {
  it("generates prefixed keys and stores only a hash", () => {
    const key = generateApiKey();
    expect(key.startsWith("flk_")).toBe(true);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toContain(key);
    expect(keyHint(key)).toBe(`${key.slice(0, 8)}…`);
  });

  it("reads bearer tokens", () => {
    expect(bearerToken("Bearer flk_abc")).toBe("flk_abc");
    expect(bearerToken("Bearer something-else")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

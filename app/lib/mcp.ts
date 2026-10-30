/**
 * A small, read-only Model Context Protocol (MCP) server, so AI assistants such
 * as Claude can answer "what should I reorder?" from a shop's Forelark data.
 *
 * Transport: Streamable HTTP with plain JSON responses (no sessions, no SSE).
 * This module is pure: data access is injected, so it is unit-testable.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "forelark", title: "Forelark inventory forecasting", version: "1.0.0" };

type Json = Record<string, unknown>;

export interface McpData {
  summary(): Promise<Json>;
  reorderList(args: { status: "critical" | "low" | "needs_order"; limit: number; search: string }): Promise<Json>;
  variant(args: { query: string }): Promise<Json | null>;
  purchaseOrders(args: { status: string }): Promise<Json>;
}

export const TOOLS = [
  {
    name: "stock_summary",
    title: "Stock summary",
    description:
      "Counts of variants that need reordering now, soon, or are healthy, plus units and cost to order and when the data was last refreshed from Shopify.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "reorder_list",
    title: "What to reorder",
    description:
      "Variants that need ordering, most urgent first, with available stock, units on the way, days until stockout, lead time and the suggested order quantity.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["needs_order", "critical", "low"],
          description: "critical = reorder now, low = reorder soon, needs_order = both (default).",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum rows (default 50)." },
        search: { type: "string", description: "Optional filter on product title or SKU." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "variant_forecast",
    title: "Forecast for one product",
    description:
      "The full forecast for one variant, found by SKU, product title or variant id, including the plain-English explanation of every number.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "SKU, product title, or Shopify variant id." } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "purchase_orders",
    title: "Purchase orders",
    description: "Purchase orders saved in Forelark, with supplier, status and lines.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "all", "draft", "sent", "partial", "received", "cancelled"],
          description: "open = sent or partly received (default).",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] as const;

function result(id: unknown, value: Json) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : value && typeof value === "object" ? { structuredContent: value } : {}),
  };
}

function args(params: Json): Json {
  const value = params.arguments;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

async function callTool(name: unknown, input: Json, data: McpData) {
  switch (name) {
    case "stock_summary":
      return toolText(await data.summary());
    case "reorder_list": {
      const status = input.status === "critical" || input.status === "low" ? input.status : "needs_order";
      const limitRaw = Math.floor(Number(input.limit ?? 50));
      const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
      const search = typeof input.search === "string" ? input.search.slice(0, 100) : "";
      return toolText(await data.reorderList({ status, limit, search }));
    }
    case "variant_forecast": {
      const query = typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
      if (!query) {
        return toolText("Give a SKU, product title or variant id to look up.", true);
      }
      const found = await data.variant({ query });
      return found ? toolText(found) : toolText(`No tracked variant matches "${query}".`, true);
    }
    case "purchase_orders": {
      const status = typeof input.status === "string" ? input.status : "open";
      return toolText(await data.purchaseOrders({ status }));
    }
    default:
      return null;
  }
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for
 * notifications (which get HTTP 202 with no body).
 */
export async function handleMcpMessage(message: unknown, data: McpData): Promise<Json | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return error(null, -32600, "Invalid request");
  }
  const msg = message as Json;
  const id = msg.id;
  const method = msg.method;
  const params = msg.params && typeof msg.params === "object" ? (msg.params as Json) : {};
  if (msg.jsonrpc !== "2.0" || typeof method !== "string") {
    return error(id, -32600, "Invalid request");
  }
  if (id === undefined) {
    return null; // notification, e.g. notifications/initialized
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested)
          ? (requested as string)
          : MCP_PROTOCOL_VERSIONS[0];
        return result(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Read-only access to this shop's Forelark forecasts. Start with stock_summary, then reorder_list. Every number comes from the shop's own Shopify sales and stock.",
        });
      }
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, { tools: TOOLS });
      case "tools/call": {
        const output = await callTool(params.name, args(params), data);
        return output ? result(id, output) : error(id, -32602, `Unknown tool: ${String(params.name)}`);
      }
      default:
        return error(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error("[forelark] MCP request failed", err);
    return error(id, -32603, "Internal error");
  }
}

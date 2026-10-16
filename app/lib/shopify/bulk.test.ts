import { describe, expect, it, vi } from "vitest";
import {
  BulkOperationBusyError,
  jsonlObjects,
  ordersBulkQuery,
  parseOrdersJsonl,
  parseVariantsJsonl,
  startBulkQuery,
  type GraphqlClient,
} from "./bulk";
import { inventoryAt, inventoryForLocation, parseGid, salesFor } from "./adapter";
import type { StoredSnapshot } from "./types";

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";
const LOC_A = "gid://shopify/Location/10";
const LOC_B = "gid://shopify/Location/20";

function level(parent: string, location: string, name: string, available: number, onHand = available) {
  return {
    __parentId: parent,
    location: { id: location, name },
    quantities: [
      { name: "available", quantity: available },
      { name: "committed", quantity: onHand - available },
      { name: "incoming", quantity: 4 },
      { name: "on_hand", quantity: onHand },
    ],
  };
}

const variantLines = [
  {
    id: V1,
    title: "UK 9",
    sku: "TR-9",
    price: "120.00",
    product: { id: "gid://shopify/Product/1", title: "Trail Runner", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z" },
    inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: true, unitCost: { amount: "48.5" } },
  },
  level(V1, LOC_A, "Warehouse", 6, 8),
  level("gid://shopify/InventoryItem/1", LOC_B, "Shop", 2),
  {
    id: V2,
    title: "Default Title",
    sku: "",
    price: null,
    product: { id: "gid://shopify/Product/2", title: "Gift card", status: "ACTIVE" },
    inventoryItem: { id: "gid://shopify/InventoryItem/2", tracked: false },
  },
  {
    id: "gid://shopify/ProductVariant/3",
    title: "Draft item",
    product: { id: "gid://shopify/Product/3", title: "Draft", status: "DRAFT" },
    inventoryItem: { id: "gid://shopify/InventoryItem/3", tracked: true },
  },
];

describe("parseVariantsJsonl", () => {
  it("builds variants with stock at every location, keyed by variant or inventory item", async () => {
    const variants = await parseVariantsJsonl(variantLines);
    expect(variants).toHaveLength(1);
    const [v] = variants;
    expect(v.sku).toBe("TR-9");
    expect(v.price).toBe(120);
    expect(v.unitCost).toBe(48.5);
    expect(v.productCreatedAt).toBe("2026-01-01T00:00:00Z");
    expect(v.levels).toEqual([
      { locationId: LOC_A, locationName: "Warehouse", onHand: 8, available: 6, committed: 2, incoming: 4 },
      { locationId: LOC_B, locationName: "Shop", onHand: 2, available: 2, committed: 0, incoming: 4 },
    ]);
  });

  it("skips untracked inventory and draft products, and handles levels before their variant", async () => {
    const reordered = [variantLines[1], variantLines[0]];
    const variants = await parseVariantsJsonl(reordered);
    expect(variants.map((v) => v.variantId)).toEqual([V1]);
    expect(variants[0].levels).toHaveLength(1);
  });
});

describe("parseOrdersJsonl", () => {
  const window = { start: "2026-09-01", end: "2026-09-30" };

  it("sums units per variant per day, using quantities after refunds", async () => {
    const sales = await parseOrdersJsonl(
      [
        { id: "gid://shopify/Order/1", createdAt: "2026-09-05T10:00:00Z", cancelledAt: null, test: false },
        { __parentId: "gid://shopify/Order/1", quantity: 3, currentQuantity: 2, variant: { id: V1 } },
        { __parentId: "gid://shopify/Order/1", quantity: 1, currentQuantity: 1, variant: null },
        { id: "gid://shopify/Order/2", createdAt: "2026-09-05T18:00:00Z", cancelledAt: null, test: false },
        { __parentId: "gid://shopify/Order/2", quantity: 4, currentQuantity: 4, variant: { id: V1 } },
        { id: "gid://shopify/Order/3", createdAt: "2026-09-07T09:00:00Z", cancelledAt: null, test: false },
        { __parentId: "gid://shopify/Order/3", quantity: 1, currentQuantity: 1, variant: { id: V2 } },
      ],
      window,
    );
    expect(sales[V1]).toEqual([["2026-09-05", 6]]);
    expect(sales[V2]).toEqual([["2026-09-07", 1]]);
  });

  it("drops cancelled and test orders, fully refunded lines and days outside the window", async () => {
    const sales = await parseOrdersJsonl(
      [
        { id: "gid://shopify/Order/1", createdAt: "2026-09-05T10:00:00Z", cancelledAt: "2026-09-06T00:00:00Z", test: false },
        { __parentId: "gid://shopify/Order/1", quantity: 5, currentQuantity: 5, variant: { id: V1 } },
        { id: "gid://shopify/Order/2", createdAt: "2026-09-05T10:00:00Z", cancelledAt: null, test: true },
        { __parentId: "gid://shopify/Order/2", quantity: 5, currentQuantity: 5, variant: { id: V1 } },
        { id: "gid://shopify/Order/3", createdAt: "2026-09-05T10:00:00Z", cancelledAt: null, test: false },
        { __parentId: "gid://shopify/Order/3", quantity: 5, currentQuantity: 0, variant: { id: V1 } },
        { id: "gid://shopify/Order/4", createdAt: "2026-10-01T10:00:00Z", cancelledAt: null, test: false },
        { __parentId: "gid://shopify/Order/4", quantity: 5, currentQuantity: 5, variant: { id: V1 } },
      ],
      window,
    );
    expect(sales).toEqual({});
  });

  it("resolves line items that arrive before their order", async () => {
    const sales = await parseOrdersJsonl(
      [
        { __parentId: "gid://shopify/Order/9", quantity: 2, currentQuantity: 2, variant: { id: V1 } },
        { id: "gid://shopify/Order/9", createdAt: "2026-09-10T00:00:00Z", cancelledAt: null, test: false },
      ],
      window,
    );
    expect(sales[V1]).toEqual([["2026-09-10", 2]]);
  });
});

describe("jsonlObjects", () => {
  it("streams objects across chunk boundaries", async () => {
    const body = '{"a":1}\n{"b":\n2}\n'.replace("\n2", "2");
    const chunks = [body.slice(0, 5), body.slice(5, 11), body.slice(11)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream)) as unknown as typeof fetch;
    const out: unknown[] = [];
    for await (const obj of jsonlObjects("https://example.test/file.jsonl", fetchImpl)) out.push(obj);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("throws on a failed download", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(async () => {
      const drained: unknown[] = [];
      for await (const obj of jsonlObjects("https://example.test/x", fetchImpl)) drained.push(obj);
    }).rejects.toThrow("HTTP 403");
  });
});

describe("startBulkQuery", () => {
  const client = (payload: unknown): GraphqlClient => ({ graphql: vi.fn(async () => new Response(JSON.stringify(payload))) });

  it("returns the operation id", async () => {
    const id = await startBulkQuery(
      client({ data: { bulkOperationRunQuery: { bulkOperation: { id: "gid://shopify/BulkOperation/1" }, userErrors: [] } } }),
      ordersBulkQuery("2026-09-01"),
    );
    expect(id).toBe("gid://shopify/BulkOperation/1");
  });

  it("raises a busy error when another export is running", async () => {
    await expect(
      startBulkQuery(
        client({ data: { bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ message: "A bulk query operation for this app and shop is already in progress: gid://shopify/BulkOperation/2." }] } } }),
        "{ x }",
      ),
    ).rejects.toBeInstanceOf(BulkOperationBusyError);
  });

  it("puts the sales window start into the orders query", () => {
    expect(ordersBulkQuery("2026-08-17")).toContain('created_at:>=2026-08-17');
  });
});

describe("snapshot adapter", () => {
  const snapshot: StoredSnapshot = {
    version: 1,
    fetchedAt: "2026-10-01T00:00:00Z",
    windowStart: "2026-08-02",
    windowEnd: "2026-09-30",
    lookbackDays: 60,
    locations: [],
    variants: [
      {
        variantId: V1,
        productId: "gid://shopify/Product/1",
        productTitle: "Trail Runner",
        productCreatedAt: null,
        variantTitle: "UK 9",
        sku: "TR-9",
        price: 120,
        unitCost: 48.5,
        levels: [
          { locationId: LOC_A, locationName: "Warehouse", onHand: 8, available: 6, committed: 2, incoming: 4 },
          { locationId: LOC_B, locationName: "Shop", onHand: 2, available: 2, committed: 0, incoming: 0 },
        ],
      },
    ],
    sales: { [V1]: [["2026-09-05", 6]] },
  };

  it("sums stock across locations when no location is chosen", () => {
    const all = inventoryAt(snapshot.variants[0], null)!;
    expect(all.onHand).toBe(10);
    expect(all.available).toBe(8);
    expect(all.incoming).toBe(4);
    expect(all.locationName).toBe("All locations");
  });

  it("uses one location's stock and skips variants not stocked there", () => {
    expect(inventoryAt(snapshot.variants[0], LOC_B)?.available).toBe(2);
    expect(inventoryForLocation(snapshot, "gid://shopify/Location/99")).toEqual([]);
  });

  it("returns sales records and parses GIDs", () => {
    expect(salesFor(snapshot, V1)).toEqual([{ date: "2026-09-05", quantity: 6 }]);
    expect(salesFor(snapshot, V2)).toEqual([]);
    expect(parseGid(V1)).toBe("1");
  });
});

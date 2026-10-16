import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphqlClient } from "./bulk";
import { clearSnapshotCache, effectiveLookbackDays, loadSnapshot, salesWindow, STALE_AFTER_MS } from "./snapshot.server";

type Row = Record<string, unknown> & { shop: string; updatedAt: Date };

const store = vi.hoisted(() => ({ rows: new Map<string, Row>(), clock: { now: new Date("2026-10-15T12:00:00Z") } }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") {
      return (cond as Record<string, unknown>[]).some((c) => matches(row, c));
    }
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; lt?: Date };
      if ("not" in c) return row[key] !== c.not;
      if (c.lt) return (row[key] as Date) < c.lt;
    }
    return row[key] === cond;
  });
}

vi.mock("../../db.server", () => {
  const touch = (row: Row, data: Record<string, unknown>) => Object.assign(row, data, { updatedAt: new Date(store.clock.now) });
  return {
    default: {
      shopSnapshot: {
        findUnique: async ({ where }: { where: { shop: string } }) => {
          const row = store.rows.get(where.shop);
          return row ? { ...row } : null;
        },
        upsert: async ({ where, create }: { where: { shop: string }; create: Record<string, unknown> }) => {
          if (!store.rows.has(where.shop)) {
            store.rows.set(where.shop, {
              status: "idle",
              stage: null,
              bulkOperationId: null,
              pendingVariants: null,
              data: null,
              error: null,
              startedAt: null,
              completedAt: null,
              lookbackDays: 60,
              ...create,
              shop: where.shop,
              updatedAt: new Date(store.clock.now),
            });
          }
          return store.rows.get(where.shop);
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const row of store.rows.values()) {
            if (matches(row, where)) {
              touch(row, data);
              count += 1;
            }
          }
          return { count };
        },
        update: async ({ where, data }: { where: { shop: string }; data: Record<string, unknown> }) => {
          const row = store.rows.get(where.shop)!;
          return touch(row, data);
        },
        deleteMany: async ({ where }: { where: { shop: string } }) => {
          store.rows.delete(where.shop);
          return { count: 1 };
        },
      },
    },
  };
});


const SHOP = "demo.myshopify.com";
const V1 = "gid://shopify/ProductVariant/1";

/** Fake Shopify: bulk operations finish when `finish()` is called. */
function fakeShopify() {
  let next = 1;
  const ops = new Map<string, { status: string; url: string | null; kind: "variants" | "orders" }>();
  const started: string[] = [];
  const client: GraphqlClient = {
    graphql: vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => {
      let data: unknown;
      if (query.includes("bulkOperationRunQuery")) {
        const kind = String(options?.variables?.query).includes("productVariants") ? "variants" : "orders";
        const id = `gid://shopify/BulkOperation/${next++}`;
        ops.set(id, { status: "RUNNING", url: null, kind });
        started.push(kind);
        data = { bulkOperationRunQuery: { bulkOperation: { id, status: "CREATED" }, userErrors: [] } };
      } else if (query.includes("BulkOperationStatus")) {
        const id = String(options?.variables?.id);
        const op = ops.get(id)!;
        data = { node: { id, status: op.status, errorCode: null, objectCount: "2", url: op.url, partialDataUrl: null } };
      } else if (query.includes("Locations")) {
        data = { locations: { edges: [{ node: { id: "gid://shopify/Location/1", name: "Warehouse" } }] } };
      }
      return new Response(JSON.stringify({ data }));
    }),
  };
  const files: Record<string, string> = {
    variants: [
      JSON.stringify({ id: V1, title: "UK 9", sku: "TR-9", price: "10", product: { id: "gid://shopify/Product/1", title: "Shoe", status: "ACTIVE" }, inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: true } }),
      JSON.stringify({ __parentId: V1, location: { id: "gid://shopify/Location/1", name: "Warehouse" }, quantities: [{ name: "available", quantity: 5 }, { name: "on_hand", quantity: 5 }] }),
    ].join("\n"),
    orders: [
      JSON.stringify({ id: "gid://shopify/Order/1", createdAt: "2026-10-10T10:00:00Z", cancelledAt: null, test: false }),
      JSON.stringify({ __parentId: "gid://shopify/Order/1", quantity: 3, currentQuantity: 3, variant: { id: V1 } }),
    ].join("\n"),
  };
  const fetchImpl = vi.fn(async (url: string) => new Response(files[url.replace("https://files.test/", "")])) as unknown as typeof fetch;
  const finish = (status = "COMPLETED") => {
    for (const op of ops.values()) {
      if (op.status === "RUNNING") {
        op.status = status;
        op.url = status === "COMPLETED" ? `https://files.test/${op.kind}` : null;
      }
    }
  };
  return { client, fetchImpl, finish, started };
}

function advanceClock(ms: number) {
  store.clock.now = new Date(store.clock.now.getTime() + ms);
}

describe("snapshot sync", () => {
  beforeEach(() => {
    store.rows.clear();
    store.clock.now = new Date("2026-10-15T12:00:00Z");
    clearSnapshotCache();
  });

  it("runs the catalog export, then the orders export, then stores the snapshot", async () => {
    const shopify = fakeShopify();
    const options = () => ({ lookbackDays: 60, now: store.clock.now, fetchImpl: shopify.fetchImpl });

    let state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state).toMatchObject({ snapshot: null, syncing: true, stage: "variants" });

    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.stage).toBe("variants");

    shopify.finish();
    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.stage).toBe("orders");
    expect(shopify.started).toEqual(["variants", "orders"]);

    shopify.finish();
    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.syncing).toBe(false);
    expect(state.snapshot?.variants.map((v) => v.sku)).toEqual(["TR-9"]);
    expect(state.snapshot?.sales[V1]).toEqual([["2026-10-10", 3]]);
    expect(state.snapshot?.windowEnd).toBe("2026-10-14");
    expect(state.snapshot?.locations).toHaveLength(1);
  });

  it("serves the stored snapshot without new exports while fresh, and refreshes when stale", async () => {
    const shopify = fakeShopify();
    const options = () => ({ lookbackDays: 60, now: store.clock.now, fetchImpl: shopify.fetchImpl });
    await loadSnapshot(shopify.client, SHOP, options());
    shopify.finish();
    await loadSnapshot(shopify.client, SHOP, options());
    shopify.finish();
    await loadSnapshot(shopify.client, SHOP, options());

    advanceClock(60_000);
    let state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.syncing).toBe(false);
    expect(shopify.started).toHaveLength(2);

    advanceClock(STALE_AFTER_MS);
    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.syncing).toBe(true);
    expect(state.snapshot?.variants).toHaveLength(1); // old data still shown
    expect(shopify.started).toHaveLength(3);
  });

  it("refreshes when the lookback setting changes", async () => {
    const shopify = fakeShopify();
    const run = (lookbackDays: number) => loadSnapshot(shopify.client, SHOP, { lookbackDays, now: store.clock.now, fetchImpl: shopify.fetchImpl });
    await run(60);
    shopify.finish();
    await run(60);
    shopify.finish();
    await run(60);
    const state = await run(30);
    expect(state.syncing).toBe(true);
  });

  it("does not start a second export when two loads race", async () => {
    const shopify = fakeShopify();
    const options = { lookbackDays: 60, now: store.clock.now, fetchImpl: shopify.fetchImpl };
    await Promise.all([loadSnapshot(shopify.client, SHOP, options), loadSnapshot(shopify.client, SHOP, options)]);
    expect(shopify.started).toEqual(["variants"]);
  });

  it("reports a failed export and retries after a pause", async () => {
    const shopify = fakeShopify();
    const options = () => ({ lookbackDays: 60, now: store.clock.now, fetchImpl: shopify.fetchImpl });
    await loadSnapshot(shopify.client, SHOP, options());
    shopify.finish("FAILED");
    let state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.error).toContain("failed");
    expect(state.syncing).toBe(false);

    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(shopify.started).toHaveLength(1);

    advanceClock(11 * 60_000);
    state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.syncing).toBe(true);
    expect(shopify.started).toHaveLength(2);
  });

  it("restarts a sync that stopped making progress", async () => {
    const shopify = fakeShopify();
    const options = () => ({ lookbackDays: 60, now: store.clock.now, fetchImpl: shopify.fetchImpl });
    await loadSnapshot(shopify.client, SHOP, options());
    store.rows.get(SHOP)!.stage = "processing-variants"; // a crashed worker
    advanceClock(21 * 60_000);
    const state = await loadSnapshot(shopify.client, SHOP, options());
    expect(state.stage).toBe("variants");
    expect(shopify.started).toHaveLength(2);
  });
});

describe("order window helpers", () => {
  it("caps lookback at 60 days without read_all_orders", () => {
    expect(effectiveLookbackDays(180, "read_orders,read_products")).toBe(60);
    expect(effectiveLookbackDays(180, "read_orders,read_all_orders")).toBe(180);
    expect(effectiveLookbackDays(30, "read_orders")).toBe(30);
    expect(effectiveLookbackDays(Number.NaN, null)).toBe(60);
  });

  it("ends the sales window yesterday so a partial day is never counted", () => {
    expect(salesWindow(new Date("2026-10-15T23:59:00Z"), 60)).toEqual({ start: "2026-08-16", end: "2026-10-14" });
  });
});

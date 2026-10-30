import { describe, expect, it } from "vitest";
import { buildDashboardRow, buildRows, classifyStatus, filterRows, forecastStatus, sortByUrgency, summarize, type DashboardRow } from "./dashboard";
import { DEFAULT_SETTINGS } from "./settings";
import type { StoredSnapshot, VariantInventory } from "./shopify/types";
import { dailyHistory } from "./forecast/test-helpers";

describe("classifyStatus", () => {
  it("is critical when stockout is sooner than the lead time", () => {
    expect(classifyStatus(3, 14)).toBe("critical");
    expect(classifyStatus(13.9, 14)).toBe("critical");
  });

  it("is low when stockout is within 2x the lead time", () => {
    expect(classifyStatus(20, 14)).toBe("low");
    expect(classifyStatus(27.9, 14)).toBe("low");
  });

  it("is ok beyond 2x the lead time", () => {
    expect(classifyStatus(28, 14)).toBe("ok");
    expect(classifyStatus(100, 14)).toBe("ok");
  });

  it("is ok when there is no stockout risk", () => {
    expect(classifyStatus(Number.POSITIVE_INFINITY, 14)).toBe("ok");
  });
});

function makeRow(variantId: string, daysToStockout: number, status: "critical" | "low" | "ok"): DashboardRow {
  const variant: VariantInventory = {
    variantId,
    productId: "gid://shopify/Product/1",
    productTitle: "Product",
    variantTitle: "Variant",
    sku: `SKU-${variantId}`,
    price: null,
    unitCost: null,
    onHand: 10,
    available: 10,
    committed: 0,
    incoming: 0,
    locationId: null,
    locationName: null,
  };
  return {
    variant,
    velocity: 1,
    forecastPerDay: 1,
    daysToStockout,
    suggestedOrderQty: 5,
    status,
    leadTime: 14,
    overridden: false,
    modelLabel: null,
    confidence: "medium",
    explanation: [],
    warnings: [],
  };
}

describe("forecastStatus", () => {
  it("only says critical when an order is actually needed", () => {
    expect(forecastStatus({ daysToStockout: 3, suggestedOrderQty: 10 }, 14)).toBe("critical");
    expect(forecastStatus({ daysToStockout: 3, suggestedOrderQty: 0 }, 14)).toBe("low");
    expect(forecastStatus({ daysToStockout: 100, suggestedOrderQty: 0 }, 14)).toBe("ok");
  });

  it("is critical when out of stock with nothing on order, even with no sales", () => {
    expect(forecastStatus({ daysToStockout: 0, suggestedOrderQty: 0, onHand: 0, incoming: 0 }, 14)).toBe("critical");
    expect(forecastStatus({ daysToStockout: 0, suggestedOrderQty: 0, onHand: 0, incoming: 5 }, 14)).toBe("low");
  });
});

describe("sortByUrgency", () => {
  it("puts critical items first, then low, then ok", () => {
    const rows = [
      makeRow("ok-1", 100, "ok"),
      makeRow("crit-1", 3, "critical"),
      makeRow("low-1", 20, "low"),
      makeRow("crit-2", 1, "critical"),
    ];
    const sorted = sortByUrgency(rows);
    expect(sorted.map((r) => r.variant.variantId)).toEqual(["crit-2", "crit-1", "low-1", "ok-1"]);
  });

  it("does not mutate the input array", () => {
    const rows = [makeRow("ok-1", 100, "ok"), makeRow("crit-1", 3, "critical")];
    sortByUrgency(rows);
    expect(rows[0].variant.variantId).toBe("ok-1");
  });
});

describe("filterRows", () => {
  const rows = [
    makeRow("a", 3, "critical"),
    makeRow("b", 20, "low"),
    makeRow("c", 100, "ok"),
  ];
  rows[0].variant.sku = "SKU-ALPHA";

  it("filters by status", () => {
    const result = filterRows(rows, { status: "critical", search: "" });
    expect(result).toHaveLength(1);
    expect(result[0].variant.variantId).toBe("a");
  });

  it("filters by search across SKU and titles", () => {
    expect(filterRows(rows, { status: "", search: "alpha" })).toHaveLength(1);
    expect(filterRows(rows, { status: "", search: "PRODUCT" })).toHaveLength(3);
    expect(filterRows(rows, { status: "", search: "nope" })).toHaveLength(0);
  });

  it("summarizes counts and order value", () => {
    const summary = summarize(rows);
    expect(summary).toMatchObject({ critical: 1, low: 1, ok: 1, unitsToOrder: 15 });
  });
});

describe("buildDashboardRow", () => {
  const variant: VariantInventory = {
    variantId: "gid://shopify/ProductVariant/1",
    productId: "gid://shopify/Product/1",
    productTitle: "T-Shirt",
    variantTitle: "Large",
    sku: "SKU-001",
    price: 19.99,
    unitCost: 8.5,
    onHand: 30,
    available: 25,
    committed: 5,
    incoming: 0,
    locationId: null,
    locationName: null,
  };

  it("produces an explainable row from variant + history + settings", () => {
    const row = buildDashboardRow(variant, dailyHistory(14, 8), DEFAULT_SETTINGS, { allowSeasonal: false });
    expect(row.velocity).toBe(8);
    expect(row.status).toBe("critical"); // 25 available / 8 = 3.1 days < 14-day lead time
    expect(row.suggestedOrderQty).toBe(238);
    expect(row.explanation.length).toBeGreaterThanOrEqual(5);
  });

  it("forecasts against sellable stock and counts incoming units", () => {
    const row = buildDashboardRow({ ...variant, incoming: 38 }, dailyHistory(14, 8), DEFAULT_SETTINGS, { allowSeasonal: false });
    expect(row.daysToStockout).toBeCloseTo(25 / 8, 6); // available, not on hand
    expect(row.suggestedOrderQty).toBe(200);
  });

  it("applies a per-variant lead time override", () => {
    const row = buildDashboardRow(variant, dailyHistory(14, 8), DEFAULT_SETTINGS, {
      allowSeasonal: false,
      override: { leadTime: 2, safetyStockPct: null, targetDays: null, source: "manual" },
    });
    expect(row.leadTime).toBe(2);
    expect(row.overridden).toBe(true);
    expect(row.status).toBe("low"); // 3.1 days: past the 2-day lead time, within 2 × 2 days
  });

  it("uses model selection when the snapshot gives a window end", () => {
    const row = buildDashboardRow(variant, dailyHistory(60, 8), DEFAULT_SETTINGS, {
      allowSeasonal: true,
      asOf: "2026-10-30",
    });
    expect(row.modelLabel).toBe("Simple average");
    expect(row.forecastPerDay).toBeCloseTo(8, 6);
  });
});

describe("buildRows", () => {
  const snapshot: StoredSnapshot = {
    version: 1,
    fetchedAt: "2026-10-31T00:00:00Z",
    windowStart: "2026-09-01",
    windowEnd: "2026-10-30",
    lookbackDays: 60,
    locations: [
      { id: "loc-a", name: "Warehouse" },
      { id: "loc-b", name: "Shop" },
    ],
    variants: ["1", "2"].map((n) => ({
      variantId: `gid://shopify/ProductVariant/${n}`,
      productId: `gid://shopify/Product/${n}`,
      productTitle: `Product ${n}`,
      productCreatedAt: null,
      variantTitle: "Default Title",
      sku: `SKU-${n}`,
      price: 10,
      unitCost: 4,
      levels:
        n === "1"
          ? [
              { locationId: "loc-a", locationName: "Warehouse", onHand: 5, available: 5, committed: 0, incoming: 0 },
              { locationId: "loc-b", locationName: "Shop", onHand: 100, available: 100, committed: 0, incoming: 0 },
            ]
          : [{ locationId: "loc-b", locationName: "Shop", onHand: 50, available: 50, committed: 0, incoming: 0 }],
    })),
    sales: {
      "gid://shopify/ProductVariant/1": dailyHistory(60, 2).map((r) => [String(r.date), r.quantity] as [string, number]),
    },
  };

  it("forecasts all locations combined, most urgent first", () => {
    const { rows, variantCount } = buildRows(snapshot, DEFAULT_SETTINGS, new Map(), { allowSeasonal: false, locationId: null });
    expect(variantCount).toBe(2);
    expect(rows.find((r) => r.variant.sku === "SKU-1")?.variant.available).toBe(105);
  });

  it("forecasts one location and leaves out variants not stocked there", () => {
    const { rows } = buildRows(snapshot, DEFAULT_SETTINGS, new Map(), { allowSeasonal: false, locationId: "loc-a" });
    expect(rows.map((r) => r.variant.sku)).toEqual(["SKU-1"]);
    expect(rows[0].status).toBe("critical"); // 5 units at 2/day < 14-day lead time
  });

  it("caps rows at the plan limit", () => {
    const { rows, variantCount } = buildRows(snapshot, DEFAULT_SETTINGS, new Map(), { allowSeasonal: false, locationId: null, limit: 1 });
    expect(rows).toHaveLength(1);
    expect(variantCount).toBe(2);
  });
});

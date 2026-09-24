import { describe, expect, it } from "vitest";
import { buildDashboardRow, classifyStatus, filterRows, sortByUrgency, type DashboardRow } from "./dashboard";
import { dailyHistory } from "./forecast/test-helpers";
import type { VariantInventory } from "./shopify/types";

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
    daysToStockout,
    suggestedOrderQty: 5,
    status,
    explanation: [],
    warnings: [],
  };
}

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
  rows[0].variant.locationId = "loc-1";
  rows[0].variant.sku = "SKU-ALPHA";

  it("filters by status", () => {
    const result = filterRows(rows, { locationId: "", status: "critical", search: "" });
    expect(result).toHaveLength(1);
    expect(result[0].variant.variantId).toBe("a");
  });

  it("filters by location", () => {
    const result = filterRows(rows, { locationId: "loc-1", status: "", search: "" });
    expect(result).toHaveLength(1);
    expect(result[0].variant.variantId).toBe("a");
  });

  it("filters by search across SKU and titles", () => {
    expect(filterRows(rows, { locationId: "", status: "", search: "alpha" })).toHaveLength(1);
    expect(filterRows(rows, { locationId: "", status: "", search: "PRODUCT" })).toHaveLength(3);
    expect(filterRows(rows, { locationId: "", status: "", search: "nope" })).toHaveLength(0);
  });
});

describe("buildDashboardRow", () => {
  it("produces an explainable row from variant + history + settings", () => {
    const variant: VariantInventory = {
      variantId: "gid://shopify/ProductVariant/1",
      productId: "gid://shopify/Product/1",
      productTitle: "T-Shirt",
      variantTitle: "Large",
      sku: "SKU-001",
      price: 19.99,
      unitCost: 8.5,
      onHand: 25,
      available: 20,
      committed: 5,
      incoming: 10,
      locationId: null,
      locationName: null,
    };
    const row = buildDashboardRow(
      variant,
      dailyHistory(14, 8),
      { defaultLeadTime: 14, safetyStockPct: 0.2, targetDays: 30, lookbackDays: 60, locationId: null },
      false,
    );
    expect(row.velocity).toBe(8);
    expect(row.status).toBe("critical"); // 25 / 8 = 3.1 days < 14-day lead time
    expect(row.suggestedOrderQty).toBe(238);
    expect(row.explanation.length).toBeGreaterThanOrEqual(5);
  });
});
import { describe, expect, it } from "vitest";
import { leadTimesBySku, matchLeadTimes, overrideFromImport } from "./apply";

const rows = [
  { kind: "variant", sku: "TR-9", leadTimeDays: 14 },
  { kind: "variant", sku: "tr-9 ", leadTimeDays: 21 }, // same SKU at another location
  { kind: "variant", sku: "CAP", leadTimeDays: null },
  { kind: "variant", sku: "", leadTimeDays: 5 },
  { kind: "po", sku: "TR-9", quantity: 3 },
  { kind: "variant", sku: "BAG", leadTimeDays: 7.6 },
];

describe("Stocky lead times", () => {
  it("collects lead times by normalized SKU, keeping the longest", () => {
    const map = leadTimesBySku(rows);
    expect([...map.entries()]).toEqual([
      ["tr-9", 21],
      ["bag", 8],
    ]);
    expect(leadTimesBySku("nope" as unknown as unknown[]).size).toBe(0);
  });

  it("matches catalog variants by SKU, ignoring case and spaces", () => {
    const matches = matchLeadTimes(leadTimesBySku(rows), [
      { variantId: "v1", sku: "TR-9" },
      { variantId: "v2", sku: " Bag" },
      { variantId: "v3", sku: "" },
      { variantId: "v4", sku: "CAP" },
    ]);
    expect(matches).toEqual([
      { variantId: "v1", sku: "TR-9", leadTime: 21 },
      { variantId: "v2", sku: " Bag", leadTime: 8 },
    ]);
  });

  it("never overwrites a lead time typed by hand, but keeps other fields", () => {
    const match = { variantId: "v1", sku: "TR-9", leadTime: 21 };
    expect(overrideFromImport(match, { leadTime: 10, safetyStockPct: null, targetDays: null, source: "manual" })).toBeNull();
    expect(overrideFromImport(match, { leadTime: null, safetyStockPct: 0.3, targetDays: 45, source: "manual" })).toEqual({
      leadTime: 21,
      safetyStockPct: 0.3,
      targetDays: 45,
    });
    expect(overrideFromImport(match, { leadTime: 7, safetyStockPct: null, targetDays: null, source: "stocky" })?.leadTime).toBe(21);
    expect(overrideFromImport(match, undefined)).toEqual({ leadTime: 21, safetyStockPct: null, targetDays: null });
  });
});

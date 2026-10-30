import { describe, expect, it } from "vitest";
import { ALERT_COOLDOWN_MS, flowPayload, numericId, shouldAlert } from "./alerts";

describe("shouldAlert", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("alerts for critical items at most once a day", () => {
    expect(shouldAlert("critical", null, now)).toBe(true);
    expect(shouldAlert("critical", new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(shouldAlert("critical", new Date(now.getTime() - ALERT_COOLDOWN_MS), now)).toBe(true);
  });

  it("never alerts for low or healthy items", () => {
    expect(shouldAlert("low", null, now)).toBe(false);
    expect(shouldAlert("ok", null, now)).toBe(false);
  });
});

describe("numericId", () => {
  it("reads ids from GIDs and numbers", () => {
    expect(numericId("gid://shopify/Product/123")).toBe(123);
    expect(numericId(456)).toBe(456);
    expect(numericId("gid://shopify/Product/")).toBeNull();
  });
});

describe("flowPayload", () => {
  it("fills every trigger field", () => {
    expect(
      flowPayload({
        productId: "gid://shopify/Product/9",
        productTitle: "Trail Runner",
        variantTitle: "Default Title",
        sku: "TR",
        available: 3,
        daysToStockout: 2.345,
        suggestedOrderQty: 40,
      }),
    ).toEqual({
      product_id: 9,
      Variant: "",
      SKU: "TR",
      Available: 3,
      "Days until stockout": 2.3,
      "Suggested order quantity": 40,
    });
  });
});

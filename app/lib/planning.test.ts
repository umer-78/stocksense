import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, openQtyByVariant, supplierLeadTimeMap, vendorKey, withPlanning } from "./planning";
import type { VariantInventory } from "./shopify/types";

const variant: VariantInventory = {
  variantId: "gid://shopify/ProductVariant/1",
  productId: "gid://shopify/Product/1",
  productTitle: "Trail Runner",
  variantTitle: "UK 9",
  sku: "TR-09",
  price: 80,
  unitCost: 30,
  onHand: 10,
  available: 8,
  committed: 2,
  incoming: 4,
  locationId: null,
  locationName: "All locations",
  vendor: "Acme Shoes",
};

describe("vendorKey", () => {
  it("ignores case and surrounding spaces", () => {
    expect(vendorKey("  Acme Shoes ")).toBe("acme shoes");
    expect(vendorKey(null)).toBe("");
  });
});

describe("supplierLeadTimeMap", () => {
  it("maps vendors to lead times and skips suppliers without either", () => {
    const map = supplierLeadTimeMap([
      { vendor: "Acme Shoes", leadTimeDays: 21 },
      { vendor: "acme shoes", leadTimeDays: 5 },
      { vendor: null, leadTimeDays: 9 },
      { vendor: "Laces Ltd", leadTimeDays: null },
    ]);
    expect([...map.entries()]).toEqual([["acme shoes", 21]]);
  });
});

describe("openQtyByVariant", () => {
  it("counts only unreceived units on sent or partly received orders", () => {
    const map = openQtyByVariant([
      { variantId: "a", qty: 10, receivedQty: 0, status: "sent" },
      { variantId: "a", qty: 10, receivedQty: 6, status: "partial" },
      { variantId: "b", qty: 5, receivedQty: 0, status: "draft" },
      { variantId: "c", qty: 5, receivedQty: 5, status: "received" },
      { variantId: "d", qty: 5, receivedQty: 0, status: "cancelled" },
    ]);
    expect([...map.entries()]).toEqual([["a", 14]]);
  });
});

describe("withPlanning", () => {
  it("adds open purchase-order units to incoming and finds the supplier lead time", () => {
    const result = withPlanning(variant, {
      supplierLeadTimes: new Map([["acme shoes", 21]]),
      openPoQty: new Map([[variant.variantId, 6]]),
    });
    expect(result.variant.incoming).toBe(10);
    expect(result.supplierLeadTime).toBe(21);
  });

  it("leaves the variant unchanged without planning inputs", () => {
    const result = withPlanning(variant, EMPTY_PLANNING);
    expect(result.variant).toBe(variant);
    expect(result.supplierLeadTime).toBeNull();
  });
});

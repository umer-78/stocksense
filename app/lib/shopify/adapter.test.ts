import { describe, expect, it } from "vitest";
import { ordersToSalesRecords, parseGid, variantsToInventory } from "./adapter";
import { ordersFixture, variantsFixture } from "./test-fixtures";

describe("parseGid", () => {
  it("strips the gid://shopify/<Type>/ prefix", () => {
    expect(parseGid("gid://shopify/ProductVariant/123")).toBe("123");
    expect(parseGid("gid://shopify/Product/9001")).toBe("9001");
  });
});

describe("variantsToInventory", () => {
  it("converts variants with inventory levels into domain types", () => {
    const result = variantsToInventory(variantsFixture);

    expect(result).toHaveLength(3);
    const first = result[0];
    expect(first.variantId).toBe("gid://shopify/ProductVariant/1001");
    expect(first.productId).toBe("gid://shopify/Product/9001");
    expect(first.productTitle).toBe("T-Shirt");
    expect(first.sku).toBe("SKU-001");
    expect(first.price).toBe(19.99);
    expect(first.unitCost).toBe(8.5);
    expect(first.onHand).toBe(25);
    expect(first.available).toBe(20);
    expect(first.committed).toBe(5);
    expect(first.incoming).toBe(10);
    expect(first.locationId).toBe("gid://shopify/Location/6001");
    expect(first.locationName).toBe("Main Warehouse");
  });

  it("uses the requested location's inventory level", () => {
    const result = variantsToInventory(variantsFixture, "gid://shopify/Location/6002");
    expect(result[0].onHand).toBe(4);
    expect(result[0].locationName).toBe("Retail Store");
  });

  it("defaults missing inventory to zeros", () => {
    const result = variantsToInventory(variantsFixture);
    const mug = result[1];
    expect(mug.sku).toBe("");
    expect(mug.onHand).toBe(0);
    expect(mug.available).toBe(0);
    expect(mug.price).toBeNull();
    expect(mug.unitCost).toBeNull();
  });

  it("handles variants without a product or inventory item", () => {
    const result = variantsToInventory(variantsFixture);
    const orphan = result[2];
    expect(orphan.productId).toBe("");
    expect(orphan.productTitle).toBe("");
    expect(orphan.onHand).toBe(0);
    expect(orphan.locationId).toBeNull();
  });

  it("returns an empty array for an empty response", () => {
    expect(
      variantsToInventory({ productVariants: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    ).toHaveLength(0);
  });
});

describe("ordersToSalesRecords", () => {
  it("converts line items into dated sales records per variant", () => {
    const result = ordersToSalesRecords(ordersFixture);

    const variant1 = result.get("gid://shopify/ProductVariant/1001");
    expect(variant1).toBeDefined();
    expect(variant1).toHaveLength(2);
    expect(variant1![0]).toEqual({ date: "2025-01-05", quantity: 2 });
    expect(variant1![1]).toEqual({ date: "2025-01-06", quantity: 3 });

    const variant2 = result.get("gid://shopify/ProductVariant/1002");
    expect(variant2).toHaveLength(1);
    expect(variant2![0]).toEqual({ date: "2025-01-05", quantity: 1 });
  });

  it("skips line items without a variant", () => {
    const result = ordersToSalesRecords(ordersFixture);
    // The custom line item (quantity 5, no variant) must not appear anywhere.
    const allQuantities = [...result.values()].flat().reduce((sum, r) => sum + r.quantity, 0);
    expect(allQuantities).toBe(6); // 2 + 1 + 3
  });

  it("returns an empty map for empty orders", () => {
    const result = ordersToSalesRecords({ orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    expect(result.size).toBe(0);
  });
});
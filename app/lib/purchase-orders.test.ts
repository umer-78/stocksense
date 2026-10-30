import { describe, expect, it } from "vitest";
import {
  MAILTO_BODY_LIMIT,
  applyReceipt,
  mailtoUrl,
  poEmail,
  poLabel,
  poTotals,
  sanitizeLines,
  statusAfterReceiving,
} from "./purchase-orders";

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";

describe("sanitizeLines", () => {
  it("keeps valid lines, merges duplicates and drops bad ones", () => {
    const lines = sanitizeLines([
      { variantId: V1, sku: " TR-09 ", title: "Trail Runner — UK 9", qty: "4", unitCost: "30" },
      { variantId: V1, qty: 2 },
      { variantId: V2, qty: 0 },
      { variantId: "not-a-gid", qty: 5 },
      null,
    ]);
    expect(lines).toEqual([{ variantId: V1, sku: "TR-09", title: "Trail Runner — UK 9", qty: 6, unitCost: 30 }]);
  });

  it("returns nothing for non-arrays", () => {
    expect(sanitizeLines("[]")).toEqual([]);
  });
});

describe("receiving", () => {
  const lines = [
    { id: 1, qty: 10, receivedQty: 0 },
    { id: 2, qty: 5, receivedQty: 0 },
  ];

  it("adds received units without going past the ordered quantity", () => {
    const after = applyReceipt(lines, { 1: 4, 2: 9 });
    expect(after).toEqual([
      { id: 1, qty: 10, receivedQty: 4 },
      { id: 2, qty: 5, receivedQty: 5 },
    ]);
    expect(statusAfterReceiving(after)).toBe("partial");
    expect(statusAfterReceiving(applyReceipt(after, { 1: 6 }))).toBe("received");
  });

  it("allows corrections but never below zero", () => {
    expect(applyReceipt([{ id: 1, qty: 10, receivedQty: 3 }], { 1: -5 })).toEqual([{ id: 1, qty: 10, receivedQty: 0 }]);
    expect(statusAfterReceiving([{ qty: 10, receivedQty: 0 }])).toBe("sent");
  });
});

describe("poTotals", () => {
  it("sums units and known costs", () => {
    expect(poTotals([{ qty: 3, unitCost: 2.5 }, { qty: 2, unitCost: null }])).toEqual({ units: 5, cost: 7.5, missingCost: true });
  });
});

describe("supplier email", () => {
  it("lists every line with its SKU", () => {
    const { subject, body } = poEmail(
      { number: 7, note: "Deliver to the back door.", lines: [{ sku: "TR-09", title: "Trail Runner — UK 9", qty: 6 }] },
      "Acme Shoes",
      "Snow City",
    );
    expect(poLabel(7)).toBe("PO-0007");
    expect(subject).toBe("Purchase order PO-0007 from Snow City");
    expect(body).toContain("Hello Acme Shoes,");
    expect(body).toContain("- 6 × Trail Runner — UK 9 (SKU TR-09)");
    expect(body).toContain("Deliver to the back door.");
  });

  it("shortens very long bodies in mailto links", () => {
    const url = mailtoUrl("a@b.co", "Hi", "x".repeat(MAILTO_BODY_LIMIT + 500));
    expect(url.startsWith("mailto:a%40b.co?subject=Hi&body=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Order shortened");
  });
});

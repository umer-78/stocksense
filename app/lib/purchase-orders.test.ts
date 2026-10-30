import { describe, expect, it } from "vitest";
import {
  MAILTO_BODY_LIMIT,
  applyReceipt,
  daysOverdue,
  expectedArrival,
  followUpEmail,
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

describe("late orders", () => {
  const sentAt = "2026-10-01T15:00:00.000Z";

  it("expects an order one lead time after it was sent", () => {
    expect(expectedArrival(sentAt, 14)?.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(expectedArrival(null, 14)).toBeNull();
    expect(expectedArrival("not a date", 14)).toBeNull();
  });

  it("counts whole days late only for open orders", () => {
    const expected = expectedArrival(sentAt, 14);
    expect(daysOverdue("sent", expected, new Date("2026-10-15T10:00:00Z"))).toBe(0);
    expect(daysOverdue("sent", expected, new Date("2026-10-18T16:00:00Z"))).toBe(3);
    expect(daysOverdue("partial", expected, new Date("2026-10-18T16:00:00Z"))).toBe(3);
    expect(daysOverdue("received", expected, new Date("2026-10-18T16:00:00Z"))).toBe(0);
    expect(daysOverdue("draft", null, new Date("2026-10-18T16:00:00Z"))).toBe(0);
  });

  it("writes a follow-up that says how late and how much has arrived", () => {
    const email = followUpEmail({ number: 7, sentAt, units: 40, receivedUnits: 10 }, "Acme Socks", "Trail Co", 3);
    expect(email.subject).toBe("Following up: purchase order PO-0007 from Trail Co");
    expect(email.body).toContain("Hello Acme Socks,");
    expect(email.body).toContain("purchase order PO-0007 sent on 2026-10-01. It was due 3 days ago, and 10 of 40 units have arrived so far.");
    expect(followUpEmail({ number: 7, sentAt, units: 40, receivedUnits: 0 }, null, "Trail Co", 1).body).toContain("It was due yesterday.");
  });
});

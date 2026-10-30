import { describe, expect, it } from "vitest";
import { sanitizeSupplier, uncoveredVendors } from "./suppliers";

describe("sanitizeSupplier", () => {
  it("cleans a valid supplier", () => {
    expect(
      sanitizeSupplier({ name: " Acme Shoes ", vendor: "Acme", email: "orders@acme.co", leadTimeDays: "21", notes: "" }),
    ).toEqual({
      ok: true,
      value: { name: "Acme Shoes", vendor: "Acme", email: "orders@acme.co", leadTimeDays: 21, notes: null },
    });
  });

  it("allows a blank lead time", () => {
    const result = sanitizeSupplier({ name: "Acme", leadTimeDays: "" });
    expect(result.ok && result.value.leadTimeDays).toBeNull();
  });

  it("reports each invalid field", () => {
    const result = sanitizeSupplier({ name: "", email: "nope", leadTimeDays: "2.5" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["email", "leadTimeDays", "name"]);
    }
  });
});

describe("uncoveredVendors", () => {
  it("lists catalog vendors without a supplier, once each, sorted", () => {
    expect(uncoveredVendors(["Zeta", "acme", "Acme", "", "Laces Ltd"], [{ vendor: "Laces ltd" }])).toEqual(["acme", "Zeta"]);
  });
});

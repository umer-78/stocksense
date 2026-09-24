import { describe, expect, it } from "vitest";
import { daysToStockout } from "./stockout";

describe("daysToStockout", () => {
  it("divides on-hand by velocity", () => {
    expect(daysToStockout(8.2, 25)).toBeCloseTo(3.05, 2);
  });

  it("returns Infinity when velocity is zero (divide-by-zero guard)", () => {
    expect(daysToStockout(0, 25)).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns 0 when on-hand is zero", () => {
    expect(daysToStockout(8.2, 0)).toBe(0);
  });

  it("clamps negative inputs", () => {
    expect(daysToStockout(-5, 10)).toBe(Number.POSITIVE_INFINITY); // velocity clamped to 0
    expect(daysToStockout(5, -10)).toBe(0); // on-hand clamped to 0
  });

  it("treats NaN velocity as zero", () => {
    expect(daysToStockout(Number.NaN, 10)).toBe(Number.POSITIVE_INFINITY);
  });
});
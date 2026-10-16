import { describe, expect, it } from "vitest";
import { computeVelocity } from "./velocity";
import type { SalesRecord } from "./types";

describe("computeVelocity", () => {
  it("computes units per day over the full span", () => {
    const history: SalesRecord[] = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      quantity: 8,
    }));

    const result = computeVelocity(history);

    expect(result.velocity).toBe(8);
    expect(result.daysCovered).toBe(14);
    expect(result.totalUnits).toBe(112);
    expect(result.activeDays).toBe(14);
    expect(result.sampleSize).toBe(14);
  });

  it("counts zero-sales days in the span", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: 10 },
      { date: "2026-09-08", quantity: 10 },
    ];

    const result = computeVelocity(history);

    expect(result.daysCovered).toBe(8);
    expect(result.activeDays).toBe(2);
    expect(result.velocity).toBe(2.5);
  });

  it("returns zero (not NaN) for empty history", () => {
    const result = computeVelocity([]);

    expect(result.velocity).toBe(0);
    expect(result.daysCovered).toBe(0);
    expect(result.totalUnits).toBe(0);
    expect(Number.isNaN(result.velocity)).toBe(false);
  });

  it("handles a single data point", () => {
    const result = computeVelocity([{ date: "2026-09-01", quantity: 5 }]);

    expect(result.velocity).toBe(5);
    expect(result.daysCovered).toBe(1);
    expect(result.activeDays).toBe(1);
  });

  it("handles very high velocity", () => {
    const history: SalesRecord[] = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-09-0${i + 1}`,
      quantity: 1000,
    }));

    const result = computeVelocity(history);

    expect(result.velocity).toBe(1000);
    expect(result.totalUnits).toBe(7000);
  });

  it("respects lookbackDays by ignoring older records", () => {
    const history: SalesRecord[] = [
      { date: "2026-08-01", quantity: 100 },
      { date: "2026-09-01", quantity: 10 },
      { date: "2026-09-02", quantity: 10 },
    ];

    const result = computeVelocity(history, 3);

    expect(result.daysCovered).toBe(2);
    expect(result.totalUnits).toBe(20);
    expect(result.velocity).toBe(10);
  });

  it("clamps negative quantities to zero", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: -5 },
      { date: "2026-09-02", quantity: 10 },
    ];

    const result = computeVelocity(history);

    expect(result.totalUnits).toBe(10);
    expect(result.velocity).toBe(5);
  });

  it("skips records with invalid dates", () => {
    const history: SalesRecord[] = [
      { date: "not-a-date", quantity: 50 },
      { date: "2026-09-01", quantity: 10 },
    ];

    const result = computeVelocity(history);

    expect(result.totalUnits).toBe(10);
    expect(result.sampleSize).toBe(1);
  });

  it("aggregates duplicate dates instead of double-counting", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: 3 },
      { date: "2026-09-01", quantity: 4 },
      { date: "2026-09-02", quantity: 5 },
    ];

    const result = computeVelocity(history);

    expect(result.totalUnits).toBe(12);
    expect(result.daysCovered).toBe(2);
    expect(result.velocity).toBe(6);
  });

  it("treats NaN quantities as zero", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: Number.NaN },
      { date: "2026-09-02", quantity: 10 },
    ];

    const result = computeVelocity(history);

    expect(result.totalUnits).toBe(10);
    expect(Number.isNaN(result.velocity)).toBe(false);
  });

  it("ignores non-positive lookbackDays", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: 10 },
      { date: "2026-09-02", quantity: 10 },
    ];

    const result = computeVelocity(history, 0);

    expect(result.daysCovered).toBe(2);
    expect(result.velocity).toBe(10);
  });
});
describe("computeVelocity anchored to a window end (today)", () => {
  it("divides by the whole lookback window, not the span between sales", () => {
    // One sale of 5 units, 50 days before "today". Unanchored this reads as 5/day.
    const history: SalesRecord[] = [{ date: "2026-08-12", quantity: 5 }];
    expect(computeVelocity(history).velocity).toBe(5);

    const result = computeVelocity(history, 60, { end: "2026-10-01" });
    expect(result.daysCovered).toBe(60);
    expect(result.velocity).toBeCloseTo(5 / 60, 6);
    expect(result.lastDate).toBe("2026-10-01");
  });

  it("counts quiet days at the end of the window", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: 10 },
      { date: "2026-09-02", quantity: 10 },
    ];
    const result = computeVelocity(history, 30, { end: "2026-09-30" });
    expect(result.daysCovered).toBe(30);
    expect(result.velocity).toBeCloseTo(20 / 30, 6);
  });

  it("starts the window at the product's creation date when that is later", () => {
    const history: SalesRecord[] = [{ date: "2026-09-25", quantity: 20 }];
    const result = computeVelocity(history, 60, { end: "2026-09-30", start: "2026-09-21" });
    expect(result.daysCovered).toBe(10);
    expect(result.velocity).toBe(2);
    expect(result.firstDate).toBe("2026-09-21");
  });

  it("keeps sales recorded before the creation date (imported history)", () => {
    const history: SalesRecord[] = [
      { date: "2026-09-01", quantity: 15 },
      { date: "2026-09-25", quantity: 15 },
    ];
    const result = computeVelocity(history, 60, { end: "2026-09-30", start: "2026-09-21" });
    expect(result.firstDate).toBe("2026-09-01");
    expect(result.daysCovered).toBe(30);
    expect(result.totalUnits).toBe(30);
    expect(result.velocity).toBe(1);
  });

  it("still caps imported history at the lookback window", () => {
    const history: SalesRecord[] = [
      { date: "2026-06-01", quantity: 50 },
      { date: "2026-09-25", quantity: 10 },
    ];
    const result = computeVelocity(history, 30, { end: "2026-09-30", start: "2026-09-21" });
    expect(result.firstDate).toBe("2026-09-01");
    expect(result.daysCovered).toBe(30);
    expect(result.totalUnits).toBe(10);
  });

  it("drops sales after the window end and returns zero with no sales", () => {
    const result = computeVelocity([{ date: "2026-10-05", quantity: 9 }], 7, { end: "2026-10-01" });
    expect(result.totalUnits).toBe(0);
    expect(result.velocity).toBe(0);
    expect(result.daysCovered).toBe(7);
  });
});

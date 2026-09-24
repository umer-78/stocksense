import { describe, expect, it } from "vitest";
import { applySeasonality } from "./seasonality";
import { weeklyHistory } from "./test-helpers";

describe("applySeasonality", () => {
  it("detects weekday vs weekend uplift", () => {
    const result = applySeasonality(8, weeklyHistory(3, 10, 2));

    expect(result.weekdayUplift).toBeCloseTo(5, 5); // 10 / 2
    expect(result.reliable).toBe(true);
    expect(result.sampleSize).toBe(21);
    expect(result.weekdayAverage).toBe(10);
    expect(result.weekendAverage).toBe(2);
  });

  it("produces multipliers that average to 1 with correct peak/trough days", () => {
    const result = applySeasonality(8, weeklyHistory(3, 10, 2));

    const averageMultiplier =
      result.dayOfWeekMultipliers.reduce((a, b) => a + b, 0) / 7;
    expect(averageMultiplier).toBeCloseTo(1, 5);
    expect(result.peakDay).toBe(1); // Monday (first weekday)
    expect(result.troughDay).toBe(0); // Sunday (first weekend day)
    expect(result.dayOfWeekMultipliers[1]).toBeGreaterThan(1);
    expect(result.dayOfWeekMultipliers[0]).toBeLessThan(1);
  });

  it("scales expected daily sales by velocity", () => {
    const result = applySeasonality(8, weeklyHistory(3, 10, 2));

    expect(result.expectedDailySales[1]).toBeCloseTo(
      8 * result.dayOfWeekMultipliers[1],
      10,
    );
    expect(result.expectedDailySales[0]).toBeCloseTo(
      8 * result.dayOfWeekMultipliers[0],
      10,
    );
  });

  it("returns neutral multipliers for empty history", () => {
    const result = applySeasonality(5, []);

    expect(result.reliable).toBe(false);
    expect(result.sampleSize).toBe(0);
    expect(result.dayOfWeekMultipliers.every((m) => m === 1)).toBe(true);
    expect(result.weekdayUplift).toBe(1);
    expect(result.expectedDailySales.every((s) => s === 5)).toBe(true);
  });

  it("marks insufficient data as unreliable", () => {
    const result = applySeasonality(5, weeklyHistory(1, 10, 2)); // only 1 week

    expect(result.reliable).toBe(false);
  });

  it("handles zero velocity", () => {
    const result = applySeasonality(0, weeklyHistory(3, 10, 2));

    expect(result.expectedDailySales.every((s) => s === 0)).toBe(true);
    expect(result.reliable).toBe(true);
  });

  it("skips invalid records", () => {
    const history = [...weeklyHistory(3, 10, 2), { date: "garbage", quantity: 99 }];
    const result = applySeasonality(8, history);

    expect(result.sampleSize).toBe(21);
  });
});
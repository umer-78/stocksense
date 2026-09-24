import { describe, expect, it } from "vitest";
import { generateForecast } from "./forecast";
import { dailyHistory, weeklyHistory } from "./test-helpers";

describe("generateForecast", () => {
  it("produces an explainable forecast with real numbers", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(14, 8),
      onHand: 25,
      leadTimeDays: 14,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    expect(forecast.velocity).toBe(8);
    expect(forecast.daysToStockout).toBeCloseTo(3.125, 3); // 25 / 8
    expect(forecast.leadTimeDemand).toBe(112); // 8 × 14
    expect(forecast.safetyStock).toBe(23); // ceil(112 × 0.2)
    expect(forecast.reorderPoint).toBe(135); // ceil(112 + 23)
    expect(forecast.suggestedOrderQty).toBe(238); // ceil(8 × 30 + 23) − 25

    expect(forecast.explanation.length).toBeGreaterThanOrEqual(5);
    for (const line of forecast.explanation) {
      expect(line).toMatch(/\d/); // every line contains a real figure
    }
    expect(forecast.explanation[0]).toContain("8");
    expect(forecast.explanation[0]).toContain("14");
    expect(forecast.explanation.join(" ")).toContain("238");
  });

  it("matches the product example: 8.2/day, 25 on hand, 14-day lead time, +20% safety stock", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(14, 8.2),
      onHand: 25,
      leadTimeDays: 14,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    const text = forecast.explanation.join(" ");
    expect(text).toContain("8.2"); // velocity
    expect(text).toContain("25"); // on hand
    expect(text).toContain("14"); // lead time
    expect(text).toContain("20%"); // safety stock
    expect(text).toContain("3"); // stockout ≈ 3 days
    expect(forecast.daysToStockout).toBeCloseTo(3.05, 2);
  });

  it("returns zero velocity and no NaN for empty history", () => {
    const forecast = generateForecast({ salesHistory: [], onHand: 10, leadTimeDays: 7 });

    expect(forecast.velocity).toBe(0);
    expect(forecast.adjustedVelocity).toBe(0);
    expect(Number.isNaN(forecast.daysToStockout)).toBe(false);
    expect(forecast.daysToStockout).toBe(Number.POSITIVE_INFINITY);
    expect(forecast.suggestedOrderQty).toBe(0);
    expect(forecast.explanation.some((line) => line.includes("no stockout risk"))).toBe(true);
    expect(forecast.warnings.some((w) => w.includes("No sales history"))).toBe(true);
  });

  it("warns when stock runs out before the next order arrives", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(14, 8),
      onHand: 10,
      leadTimeDays: 14,
    });

    expect(forecast.warnings.some((w) => w.includes("before the next order arrives"))).toBe(true);
  });

  it("warns when on-hand is zero", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(14, 8),
      onHand: 0,
      leadTimeDays: 14,
    });

    expect(forecast.daysToStockout).toBe(0);
    expect(forecast.warnings.some((w) => w.includes("already stocked out"))).toBe(true);
  });

  it("warns on short sales history", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(3, 8),
      onHand: 100,
      leadTimeDays: 7,
    });

    expect(forecast.warnings.some((w) => w.includes("confidence is low"))).toBe(true);
  });

  it("applies seasonality when requested", () => {
    const forecast = generateForecast({
      salesHistory: weeklyHistory(3, 10, 2),
      onHand: 100,
      leadTimeDays: 7,
      applySeasonality: true,
    });

    expect(forecast.seasonal).not.toBeNull();
    expect(forecast.seasonal?.reliable).toBe(true);
    expect(forecast.adjustedVelocity).not.toBe(forecast.velocity);
    expect(forecast.explanation.some((line) => line.includes("Weekday demand runs"))).toBe(true);
  });

  it("does not apply seasonality by default", () => {
    const forecast = generateForecast({
      salesHistory: weeklyHistory(3, 10, 2),
      onHand: 100,
      leadTimeDays: 7,
    });

    expect(forecast.seasonal).toBeNull();
    expect(forecast.adjustedVelocity).toBe(forecast.velocity);
  });

  it("clamps negative on-hand and lead time", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(14, 8),
      onHand: -5,
      leadTimeDays: -3,
    });

    expect(forecast.onHand).toBe(0);
    expect(forecast.leadTimeDays).toBe(0);
    expect(forecast.daysToStockout).toBe(0);
    expect(forecast.leadTimeDemand).toBe(0);
  });
});
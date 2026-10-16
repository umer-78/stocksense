import { describe, expect, it } from "vitest";
import { generateForecast } from "./forecast";
import { dailyHistory, weeklyHistory } from "./test-helpers";

// weeklyHistory starts on Sunday 2026-08-30; 8 weeks end on Saturday 2026-10-24.
const EIGHT_WEEKS_END = "2026-10-24";

describe("generateForecast in auto (model) mode", () => {
  it("picks the weekly-pattern model on paid plans and explains why", () => {
    const forecast = generateForecast({
      salesHistory: weeklyHistory(8, 10, 2),
      asOf: EIGHT_WEEKS_END,
      lookbackDays: 56,
      onHand: 100,
      leadTimeDays: 14,
      targetDays: 28,
      method: "auto",
      allowSeasonalModel: true,
    });
    expect(forecast.model?.id).toBe("seasonal");
    expect(forecast.model?.tested).toBe(true);
    // 4 weeks × (5 × 10 + 2 × 2) = 216 units.
    expect(forecast.coverDemand).toBeCloseTo(216, -1);
    expect(forecast.dailyForecast).toHaveLength(28);
    expect(forecast.explanation.join(" ")).toContain("Weekly-pattern model");
    expect(forecast.confidence).toBe("high");
  });

  it("matches the classic formula for steady demand", () => {
    const classic = generateForecast({
      salesHistory: dailyHistory(60, 8),
      onHand: 25,
      leadTimeDays: 14,
      safetyStockPct: 0.2,
      targetDays: 30,
    });
    const auto = generateForecast({
      salesHistory: dailyHistory(60, 8),
      asOf: "2026-10-30",
      lookbackDays: 60,
      onHand: 25,
      leadTimeDays: 14,
      safetyStockPct: 0.2,
      targetDays: 30,
      method: "auto",
    });
    expect(auto.model?.id).toBe("average");
    expect(auto.reorderPoint).toBe(classic.reorderPoint);
    expect(auto.suggestedOrderQty).toBe(classic.suggestedOrderQty);
    expect(auto.daysToStockout).toBeCloseTo(classic.daysToStockout, 6);
  });

  it("falls back to the average with a note when history is under 4 weeks", () => {
    const forecast = generateForecast({
      salesHistory: dailyHistory(20, 3),
      asOf: "2026-09-20",
      lookbackDays: 60,
      availableSince: "2026-09-01",
      onHand: 30,
      leadTimeDays: 7,
      method: "auto",
    });
    expect(forecast.model?.tested).toBe(false);
    expect(forecast.velocity).toBe(3);
    expect(forecast.explanation.join(" ")).toContain("fewer than 4 weeks");
    expect(forecast.confidence).toBe("low");
  });

  it("no longer overstates an item that sold once, long ago", () => {
    const forecast = generateForecast({
      salesHistory: [{ date: "2026-08-12", quantity: 5 }],
      asOf: "2026-10-01",
      lookbackDays: 60,
      onHand: 10,
      leadTimeDays: 14,
      method: "auto",
    });
    expect(forecast.velocity).toBeCloseTo(5 / 60, 6);
    expect(forecast.suggestedOrderQty).toBe(0);
  });

  it("subtracts stock already on order from the suggestion", () => {
    const base = { salesHistory: dailyHistory(14, 8), onHand: 25, leadTimeDays: 14, targetDays: 30 };
    const without = generateForecast(base);
    const withIncoming = generateForecast({ ...base, incoming: 100 });
    expect(withIncoming.suggestedOrderQty).toBe(without.suggestedOrderQty - 100);
    expect(withIncoming.explanation.join(" ")).toContain("100 units already on order");
    expect(generateForecast({ ...base, incoming: 10_000 }).suggestedOrderQty).toBe(0);
  });

  it("sizes service-level safety stock from forecast error", () => {
    const noisy = dailyHistory(56, 0).map((r, i) => ({ ...r, quantity: i % 2 === 0 ? 2 : 8 }));
    const common = {
      salesHistory: noisy,
      asOf: "2026-10-26",
      lookbackDays: 56,
      onHand: 50,
      leadTimeDays: 9,
      method: "auto" as const,
      safetyStockMethod: "service" as const,
    };
    const ninety = generateForecast({ ...common, serviceLevel: 0.9 });
    const ninetyNine = generateForecast({ ...common, serviceLevel: 0.99 });
    expect(ninety.safetyStockMethod).toBe("service");
    expect(ninety.safetyStock).toBeGreaterThan(0);
    expect(ninetyNine.safetyStock).toBeGreaterThan(ninety.safetyStock);
    expect(ninety.explanation.join(" ")).toContain("90% chance");

    const steady = generateForecast({ ...common, salesHistory: dailyHistory(56, 5), serviceLevel: 0.99 });
    expect(steady.safetyStock).toBe(0);
  });

  it("ignores auto mode without a window end and stays on the classic path", () => {
    const forecast = generateForecast({ salesHistory: dailyHistory(30, 4), onHand: 10, leadTimeDays: 7, method: "auto" });
    expect(forecast.model).toBeNull();
    expect(forecast.velocity).toBe(4);
  });
});

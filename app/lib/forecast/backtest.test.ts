import { describe, expect, it } from "vitest";
import { candidateModels, isIntermittent, selectModel } from "./backtest";

function weekly(weeks: number, weekday: number, weekend: number): number[] {
  return Array.from({ length: weeks * 7 }, (_, t) => (t % 7 === 0 || t % 7 === 6 ? weekend : weekday));
}

describe("selectModel", () => {
  it("uses the simple average without back-testing when history is under 4 weeks", () => {
    const selection = selectModel(new Array(20).fill(3));
    expect(selection.tested).toBe(false);
    expect(selection.spec.id).toBe("average");
    expect(selection.model.forecast(1)[0]).toBe(3);
  });

  it("keeps the simple average when demand is steady (simplest model wins ties)", () => {
    const selection = selectModel(new Array(60).fill(4));
    expect(selection.tested).toBe(true);
    expect(selection.folds).toBe(4);
    expect(selection.spec.id).toBe("average");
    expect(selection.errorPct).toBe(0);
  });

  it("picks the weekly-pattern model for strong weekday/weekend demand on paid plans", () => {
    const series = weekly(9, 12, 1).map((x, t) => x + ((t * 7) % 3) - 1);
    const selection = selectModel(series, { allowSeasonal: true });
    expect(selection.spec.id).toBe("seasonal");
    const average = selection.scores.find((s) => s.id === "average")!;
    const seasonal = selection.scores.find((s) => s.id === "seasonal")!;
    expect(seasonal.rmse).toBeLessThan(average.rmse / 2);
    expect(selection.improvementPct!).toBeGreaterThan(0.5);
  });

  it("does not offer the weekly-pattern model unless allowed", () => {
    const selection = selectModel(weekly(9, 12, 1), { allowSeasonal: false });
    expect(selection.scores.map((s) => s.id)).not.toContain("seasonal");
  });

  it("beats the simple average after demand jumps", () => {
    const series = [...new Array(35).fill(2), ...new Array(28).fill(10)];
    const selection = selectModel(series);
    expect(selection.spec.id).not.toBe("average");
    expect(selection.errorPct!).toBeLessThan(selection.baselineErrorPct!);
    expect(selection.model.forecast(7).reduce((a, b) => a + b, 0)).toBeGreaterThan(55);
  });

  it("treats an item that sells every weekday as regular, so the weekly model can win", () => {
    const weekdaysOnly = Array.from({ length: 60 }, (_, t) => (t % 7 === 0 || t % 7 === 6 ? 0 : 1));
    expect(isIntermittent(weekdaysOnly)).toBe(false);
    expect(selectModel(weekdaysOnly, { allowSeasonal: true }).spec.id).toBe("seasonal");
  });

  it("offers Croston for intermittent demand", () => {
    const series = Array.from({ length: 56 }, (_, t) => (t % 9 === 4 ? 5 : 0));
    expect(isIntermittent(series)).toBe(true);
    expect(candidateModels(series, false).map((m) => m.id)).toContain("croston");
    expect(selectModel(series).intermittent).toBe(true);
  });

  it("reports out-of-sample error spread for safety stock", () => {
    const noisy = Array.from({ length: 60 }, (_, t) => 5 + (t % 2 === 0 ? 3 : -3));
    const selection = selectModel(noisy);
    expect(selection.residualStd).toBeGreaterThan(2);
    expect(selectModel(new Array(60).fill(5)).residualStd).toBe(0);
  });

  it("never throws on an all-zero history", () => {
    const selection = selectModel(new Array(60).fill(0), { allowSeasonal: true });
    expect(selection.model.forecast(7)).toEqual(new Array(7).fill(0));
    expect(selection.errorPct).toBeNull();
  });
});

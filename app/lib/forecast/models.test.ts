import { describe, expect, it } from "vitest";
import { fitAverage, fitCroston, fitHolt, fitRecent, fitSeasonal, fitSes, MODELS } from "./models";
import { inverseNormal } from "./normal";
import { toDailySeries, utcDay } from "./series";

/** Weekdays (Mon–Fri) sell `weekday`, weekends `weekend`; day 0 is a Sunday. */
function weekly(weeks: number, weekday: number, weekend: number): number[] {
  return Array.from({ length: weeks * 7 }, (_, t) => (t % 7 === 0 || t % 7 === 6 ? weekend : weekday));
}

describe("toDailySeries", () => {
  const start = utcDay("2026-09-01")!;
  const end = utcDay("2026-09-05")!;

  it("fills every day, summing duplicates and leaving gaps at zero", () => {
    const series = toDailySeries(
      [
        { date: "2026-09-01", quantity: 2 },
        { date: "2026-09-01", quantity: 3 },
        { date: "2026-09-04", quantity: 1 },
      ],
      start,
      end,
    );
    expect(series).toEqual([5, 0, 0, 1, 0]);
  });

  it("ignores records outside the range, bad dates and negative quantities", () => {
    const series = toDailySeries(
      [
        { date: "2026-08-31", quantity: 9 },
        { date: "2026-09-06", quantity: 9 },
        { date: "nope", quantity: 9 },
        { date: "2026-09-02", quantity: -4 },
      ],
      start,
      end,
    );
    expect(series).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns an empty series for an inverted range", () => {
    expect(toDailySeries([], end, start)).toEqual([]);
  });
});

describe("inverseNormal", () => {
  it("matches standard z-scores", () => {
    expect(inverseNormal(0.5)).toBeCloseTo(0, 6);
    expect(inverseNormal(0.95)).toBeCloseTo(1.6449, 3);
    expect(inverseNormal(0.99)).toBeCloseTo(2.3263, 3);
    expect(inverseNormal(0.01)).toBeCloseTo(-2.3263, 3);
  });
});

describe("forecasting models", () => {
  it("average forecasts the mean", () => {
    const fit = fitAverage([2, 4, 6, 8]);
    expect(fit?.forecast(3)).toEqual([5, 5, 5]);
  });

  it("recent average equals the simple average with 4 weeks or less", () => {
    const series = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41];
    expect(fitRecent(series)?.forecast(1)[0]).toBe(fitAverage(series)?.forecast(1)[0]);
  });

  it("recent average only looks at the last 28 days", () => {
    const series = [...new Array(30).fill(1), ...new Array(28).fill(9)];
    expect(fitRecent(series)?.forecast(1)[0]).toBe(9);
  });

  it("exponential smoothing follows a level shift", () => {
    const series = [...new Array(30).fill(2), ...new Array(30).fill(10)];
    const forecast = fitSes(series)!.forecast(7);
    expect(forecast[0]).toBeGreaterThan(8);
    expect(fitAverage(series)!.forecast(1)[0]).toBe(6);
  });

  it("the trend model projects growth forward", () => {
    const series = Array.from({ length: 60 }, (_, t) => 1 + t * 0.5);
    const forecast = fitHolt(series)!.forecast(7);
    expect(forecast[0]).toBeGreaterThan(29);
    expect(forecast[6]).toBeGreaterThan(forecast[0]);
  });

  it("the weekly-pattern model reproduces weekday and weekend demand", () => {
    const series = weekly(8, 10, 2);
    const forecast = fitSeasonal(series)!.forecast(7);
    // series length 56 → next day index 56 is a Sunday (weekend).
    expect(forecast[0]).toBeCloseTo(2, 0);
    expect(forecast[1]).toBeCloseTo(10, 0);
    expect(forecast[6]).toBeCloseTo(2, 0);
  });

  it("Croston estimates the rate of an item that sells once a week", () => {
    const series = Array.from({ length: 56 }, (_, t) => (t % 7 === 3 ? 7 : 0));
    const rate = fitCroston(series)!.forecast(1)[0];
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it("never forecasts negative demand", () => {
    const series = Array.from({ length: 42 }, (_, t) => Math.max(0, 20 - t));
    for (const spec of Object.values(MODELS)) {
      const fit = spec.fit(series);
      if (fit) {
        expect(fit.forecast(60).every((x) => x >= 0)).toBe(true);
      }
    }
  });

  it("returns null when a series is too short or has no demand to model", () => {
    expect(fitAverage([])).toBeNull();
    expect(fitSes(new Array(10).fill(1))).toBeNull();
    expect(fitHolt(new Array(20).fill(1))).toBeNull();
    expect(fitSeasonal(new Array(20).fill(1))).toBeNull();
    expect(fitRecent([])).toBeNull();
    expect(fitCroston(new Array(30).fill(0))).toBeNull();
  });
});

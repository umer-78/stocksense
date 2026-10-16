/**
 * Accuracy regression test on a simulated catalog.
 *
 * Generates items with steady, trending, weekly-pattern, intermittent and
 * step-change demand (Poisson noise, fixed seed), selects a model on 60 days
 * of history and scores the next 14 days against the simple average. Guards
 * the claim that model selection beats the average and never loses badly on
 * any demand pattern.
 */
import { describe, expect, it } from "vitest";
import { selectModel } from "./backtest";
import { fitAverage } from "./models";
import { sum } from "./series";

function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type Pattern = "steady" | "trend-up" | "trend-down" | "weekly" | "intermittent" | "jump";
const PATTERNS: Pattern[] = ["steady", "trend-up", "trend-down", "weekly", "intermittent", "jump"];
const TRAIN = 60;
const HORIZON = 14;
const ITEMS_PER_PATTERN = 40;

function simulate(pattern: Pattern, rand: () => number): number[] {
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rand();
    } while (p > limit);
    return k - 1;
  };
  const base = 1 + rand() * 9;
  const n = TRAIN + HORIZON;
  return Array.from({ length: n }, (_, t) => {
    let rate = base;
    if (pattern === "trend-up") rate = base * (0.5 + t / n);
    if (pattern === "trend-down") rate = base * (1.5 - t / n);
    if (pattern === "weekly") rate = base * (t % 7 === 0 || t % 7 === 6 ? 0.3 : 1.3);
    if (pattern === "intermittent") rate = rand() < 0.15 ? base : 0;
    if (pattern === "jump") rate = t < n * 0.6 ? base : base * 2.2;
    return poisson(rate);
  });
}

describe("forecast accuracy on a simulated catalog", () => {
  const rand = rng(42);
  const results = PATTERNS.map((pattern) => {
    let modelError = 0;
    let averageError = 0;
    let actual = 0;
    for (let i = 0; i < ITEMS_PER_PATTERN; i += 1) {
      const series = simulate(pattern, rand);
      const train = series.slice(0, TRAIN);
      const test = series.slice(TRAIN);
      const model = selectModel(train, { allowSeasonal: true }).model.forecast(HORIZON);
      const average = fitAverage(train)!.forecast(HORIZON);
      modelError += Math.abs(sum(model) - sum(test));
      averageError += Math.abs(sum(average) - sum(test));
      actual += sum(test);
    }
    return { pattern, modelError, averageError, actual };
  });

  it("cuts 14-day demand error well below the simple average overall", () => {
    const model = sum(results.map((r) => r.modelError));
    const average = sum(results.map((r) => r.averageError));
    expect(model).toBeLessThan(average * 0.7);
  });

  it("never loses badly to the simple average on any demand pattern", () => {
    for (const r of results) {
      expect(r.modelError / r.actual, r.pattern).toBeLessThan((r.averageError / r.actual) * 1.25 + 0.02);
    }
  });
});

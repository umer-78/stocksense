/**
 * Demand forecasting models, implemented from scratch.
 *
 * Each model fits itself to a dense daily sales series (see `series.ts`) by
 * grid-searching its smoothing parameters for the lowest one-step-ahead
 * squared error, then projects future daily demand. All models are classical,
 * well-understood methods chosen because their behavior is explainable to a
 * merchant in one sentence:
 *
 *   average  — every day in the window weighted equally (the baseline)
 *   recent   — average of the last 28 days only
 *   ses      — simple exponential smoothing: recent days weigh more
 *   holt     — exponential smoothing with a damped trend (growing/shrinking demand)
 *   seasonal — Holt-Winters with a 7-day season (weekday/weekend patterns)
 *   croston  — Croston's method with the Syntetos-Boylan correction, built for
 *              items that sell on only some days ("intermittent demand")
 *
 * Forecasts are never negative. Fitting never throws: a model that cannot fit
 * a series (too short, no sales) returns null.
 */
import { mean } from "./series";

export type ModelId = "average" | "recent" | "ses" | "holt" | "seasonal" | "croston";

export interface FittedModel {
  id: ModelId;
  /** Chosen smoothing parameters (empty for the averages). */
  params: Record<string, number>;
  /** Projected demand for each of the next `horizon` days. */
  forecast: (horizon: number) => number[];
  /** In-sample one-step-ahead errors (actual − predicted) after warm-up. */
  residuals: number[];
}

export interface ModelSpec {
  id: ModelId;
  /** Plain-English name shown to merchants. */
  label: string;
  /** Shortest series the model can be fitted to. */
  minLength: number;
  /** Lower = simpler. Used to break ties in favor of the simpler model. */
  complexity: number;
  fit: (series: number[]) => FittedModel | null;
}

/** Days ignored when scoring a fit, so initial values do not dominate. */
const WARMUP = 7;
const SEASON = 7;
const RECENT_WINDOW = 28;

function flat(value: number): (horizon: number) => number[] {
  const v = Math.max(0, value);
  return (horizon) => new Array<number>(Math.max(0, Math.floor(horizon))).fill(v);
}

function sse(residuals: number[]): number {
  let total = 0;
  for (const r of residuals) {
    total += r * r;
  }
  return total;
}

function grid<T>(axes: T[][]): T[][] {
  return axes.reduce<T[][]>(
    (combos, axis) => combos.flatMap((combo) => axis.map((value) => [...combo, value])),
    [[]],
  );
}

// ---------------------------------------------------------------------------
// Averages
// ---------------------------------------------------------------------------

export function fitAverage(series: number[]): FittedModel | null {
  if (series.length === 0) {
    return null;
  }
  const residuals: number[] = [];
  let running = 0;
  for (let t = 0; t < series.length; t += 1) {
    if (t >= WARMUP) {
      residuals.push(series[t] - running / t);
    }
    running += series[t];
  }
  return { id: "average", params: {}, forecast: flat(mean(series)), residuals };
}

/**
 * Mean of the last 4 weeks. Fits any length (with 4 weeks or less it equals
 * the simple average) so it is back-tested on every fold of a 60-day lookback.
 */
export function fitRecent(series: number[]): FittedModel | null {
  if (series.length === 0) {
    return null;
  }
  const residuals: number[] = [];
  for (let t = RECENT_WINDOW; t < series.length; t += 1) {
    residuals.push(series[t] - mean(series.slice(t - RECENT_WINDOW, t)));
  }
  return {
    id: "recent",
    params: { window: RECENT_WINDOW },
    forecast: flat(mean(series.slice(-RECENT_WINDOW))),
    residuals,
  };
}

// ---------------------------------------------------------------------------
// Simple exponential smoothing
// ---------------------------------------------------------------------------

function runSes(series: number[], alpha: number): { level: number; residuals: number[] } {
  let level = mean(series.slice(0, SEASON));
  const residuals: number[] = [];
  for (let t = 0; t < series.length; t += 1) {
    const error = series[t] - level;
    if (t >= WARMUP) {
      residuals.push(error);
    }
    level += alpha * error;
  }
  return { level, residuals };
}

export function fitSes(series: number[]): FittedModel | null {
  if (series.length < 2 * SEASON) {
    return null;
  }
  let best: { alpha: number; level: number; residuals: number[]; score: number } | null = null;
  for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5]) {
    const run = runSes(series, alpha);
    const score = sse(run.residuals);
    if (!best || score < best.score) {
      best = { alpha, ...run, score };
    }
  }
  if (!best) {
    return null;
  }
  return { id: "ses", params: { alpha: best.alpha }, forecast: flat(best.level), residuals: best.residuals };
}

// ---------------------------------------------------------------------------
// Holt's linear method with a damped trend
// ---------------------------------------------------------------------------

function dampedPath(level: number, trend: number, phi: number, horizon: number, season?: (i: number) => number) {
  const out: number[] = [];
  let damp = 0;
  let factor = 1;
  for (let i = 1; i <= Math.max(0, Math.floor(horizon)); i += 1) {
    factor *= phi;
    damp += factor;
    out.push(Math.max(0, level + damp * trend + (season ? season(i) : 0)));
  }
  return out;
}

function runHolt(series: number[], alpha: number, beta: number, phi: number) {
  let level = mean(series.slice(0, SEASON));
  let trend = (mean(series.slice(SEASON, 2 * SEASON)) - level) / SEASON;
  const residuals: number[] = [];
  for (let t = 0; t < series.length; t += 1) {
    const predicted = level + phi * trend;
    const error = series[t] - predicted;
    if (t >= WARMUP) {
      residuals.push(error);
    }
    const nextLevel = alpha * series[t] + (1 - alpha) * predicted;
    trend = beta * (nextLevel - level) + (1 - beta) * phi * trend;
    level = nextLevel;
  }
  return { level, trend, residuals };
}

export function fitHolt(series: number[]): FittedModel | null {
  if (series.length < 3 * SEASON) {
    return null;
  }
  let best: { params: number[]; level: number; trend: number; residuals: number[]; score: number } | null = null;
  for (const [alpha, beta, phi] of grid([
    [0.1, 0.2, 0.3, 0.5],
    [0.01, 0.05, 0.1],
    [0.9, 0.95, 0.98],
  ])) {
    const run = runHolt(series, alpha, beta, phi);
    const score = sse(run.residuals);
    if (!best || score < best.score) {
      best = { params: [alpha, beta, phi], ...run, score };
    }
  }
  if (!best) {
    return null;
  }
  const [alpha, beta, phi] = best.params;
  const { level, trend } = best;
  return {
    id: "holt",
    params: { alpha, beta, phi },
    forecast: (horizon) => dampedPath(level, trend, phi, horizon),
    residuals: best.residuals,
  };
}

// ---------------------------------------------------------------------------
// Holt-Winters additive with a weekly season and damped trend
// ---------------------------------------------------------------------------

function runHoltWinters(series: number[], alpha: number, beta: number, gamma: number, phi: number) {
  const firstTwoWeeks = mean(series.slice(0, 2 * SEASON));
  let level = firstTwoWeeks;
  let trend = beta > 0 ? (mean(series.slice(SEASON, 2 * SEASON)) - mean(series.slice(0, SEASON))) / SEASON : 0;
  const season = new Array<number>(SEASON).fill(0);
  for (let i = 0; i < SEASON; i += 1) {
    season[i] = (series[i] + series[i + SEASON]) / 2 - firstTwoWeeks;
  }
  const residuals: number[] = [];
  for (let t = 0; t < series.length; t += 1) {
    const s = season[t % SEASON];
    const base = level + phi * trend;
    const error = series[t] - (base + s);
    if (t >= WARMUP) {
      residuals.push(error);
    }
    const nextLevel = alpha * (series[t] - s) + (1 - alpha) * base;
    trend = beta * (nextLevel - level) + (1 - beta) * phi * trend;
    season[t % SEASON] = gamma * (series[t] - base) + (1 - gamma) * s;
    level = nextLevel;
  }
  return { level, trend, season, residuals };
}

export function fitSeasonal(series: number[]): FittedModel | null {
  if (series.length < 3 * SEASON) {
    return null;
  }
  let best:
    | { params: number[]; level: number; trend: number; season: number[]; residuals: number[]; score: number }
    | null = null;
  for (const [alpha, beta, gamma, phi] of grid([
    [0.05, 0.1, 0.2, 0.3],
    [0, 0.02, 0.05],
    [0.05, 0.1, 0.2],
    [0.9, 0.98],
  ])) {
    const run = runHoltWinters(series, alpha, beta, gamma, phi);
    const score = sse(run.residuals);
    if (!best || score < best.score) {
      best = { params: [alpha, beta, gamma, phi], ...run, score };
    }
  }
  if (!best) {
    return null;
  }
  const [alpha, beta, gamma, phi] = best.params;
  const { level, trend, season } = best;
  const n = series.length;
  return {
    id: "seasonal",
    params: { alpha, beta, gamma, phi },
    forecast: (horizon) => dampedPath(level, trend, phi, horizon, (i) => season[(n - 1 + i) % SEASON]),
    residuals: best.residuals,
  };
}

// ---------------------------------------------------------------------------
// Croston's method (Syntetos-Boylan approximation) for intermittent demand
// ---------------------------------------------------------------------------

function runCroston(series: number[], alpha: number) {
  const first = series.findIndex((x) => x > 0);
  let size = series[first];
  let interval = first + 1;
  let sinceLast = 1;
  const correction = 1 - alpha / 2;
  const residuals: number[] = [];
  for (let t = first + 1; t < series.length; t += 1) {
    const predicted = correction * (size / interval);
    if (t >= WARMUP) {
      residuals.push(series[t] - predicted);
    }
    if (series[t] > 0) {
      size += alpha * (series[t] - size);
      interval += alpha * (sinceLast - interval);
      sinceLast = 1;
    } else {
      sinceLast += 1;
    }
  }
  return { rate: correction * (size / interval), residuals };
}

export function fitCroston(series: number[]): FittedModel | null {
  const demandDays = series.filter((x) => x > 0).length;
  if (series.length < 2 * SEASON || demandDays < 2) {
    return null;
  }
  let best: { alpha: number; rate: number; residuals: number[]; score: number } | null = null;
  for (const alpha of [0.05, 0.1, 0.2, 0.3]) {
    const run = runCroston(series, alpha);
    const score = sse(run.residuals);
    if (!best || score < best.score) {
      best = { alpha, ...run, score };
    }
  }
  if (!best) {
    return null;
  }
  return { id: "croston", params: { alpha: best.alpha }, forecast: flat(best.rate), residuals: best.residuals };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MODELS: Record<ModelId, ModelSpec> = {
  average: { id: "average", label: "Simple average", minLength: 1, complexity: 0, fit: fitAverage },
  recent: { id: "recent", label: "Recent 4-week average", minLength: 1, complexity: 1, fit: fitRecent },
  ses: { id: "ses", label: "Exponential smoothing", minLength: 2 * SEASON, complexity: 2, fit: fitSes },
  croston: { id: "croston", label: "Intermittent-demand model (Croston)", minLength: 2 * SEASON, complexity: 2, fit: fitCroston },
  holt: { id: "holt", label: "Trend model (damped Holt)", minLength: 3 * SEASON, complexity: 3, fit: fitHolt },
  seasonal: { id: "seasonal", label: "Weekly-pattern model (Holt-Winters)", minLength: 3 * SEASON, complexity: 4, fit: fitSeasonal },
};

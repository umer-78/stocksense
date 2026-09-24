/**
 * Input sanitization helpers. Every public function in the forecasting engine
 * routes its inputs through these so that edge cases (NaN, Infinity, strings,
 * negatives) can never produce NaN or throw.
 */

/** Coerce an unknown value to a finite number, falling back when it isn't one. */
export function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/** Clamp a number into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
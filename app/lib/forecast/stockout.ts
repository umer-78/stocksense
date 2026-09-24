import { toFiniteNumber } from "./sanitize";

/**
 * Estimate how many days until on-hand inventory reaches zero.
 *
 * - Returns `Infinity` when velocity is 0 (no sales, no stockout risk) —
 *   this is the divide-by-zero guard.
 * - Returns 0 when on-hand is already 0.
 * - Negative inputs are clamped to 0.
 */
export function daysToStockout(velocity: number, onHand: number): number {
  const v = Math.max(0, toFiniteNumber(velocity, 0));
  const oh = Math.max(0, toFiniteNumber(onHand, 0));
  if (v === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return oh / v;
}
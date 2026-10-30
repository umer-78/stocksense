import { toFiniteNumber } from "./sanitize";

/**
 * Estimate how many days until on-hand inventory reaches zero.
 *
 * - Returns 0 when on-hand is already 0 (checked first, so an item with no
 *   sales history and no stock still counts as stocked out).
 * - Returns `Infinity` when velocity is 0 (no sales, no stockout risk) —
 *   this is the divide-by-zero guard.
 * - Negative inputs are clamped to 0.
 */
export function daysToStockout(velocity: number, onHand: number): number {
  const v = Math.max(0, toFiniteNumber(velocity, 0));
  const oh = Math.max(0, toFiniteNumber(onHand, 0));
  if (oh === 0) {
    return 0; // already out of stock, whatever the sales history says
  }
  if (v === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return oh / v;
}
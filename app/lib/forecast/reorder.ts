import { clamp, toFiniteNumber } from "./sanitize";
import type { ReorderSuggestion } from "./types";

export interface SuggestReorderQtyInput {
  velocity: number;
  leadTimeDays: number;
  onHand: number;
  safetyStockPct?: number;
  targetDays?: number;
}

/**
 * Reorder-point math, fully explained:
 *
 *   leadTimeDemand = velocity × leadTimeDays          (units sold while waiting)
 *   safetyStock    = ceil(leadTimeDemand × safetyStockPct)
 *   reorderPoint   = ceil(leadTimeDemand + safetyStock)
 *   targetLevel    = ceil(velocity × targetDays + safetyStock)
 *   orderQty       = max(0, targetLevel − onHand)
 *
 * All inputs are sanitized: negatives clamp to 0, safetyStockPct clamps to
 * [0, 1], targetDays clamps to [1, 365]. Never throws.
 */
export function suggestReorderQty(input: SuggestReorderQtyInput): ReorderSuggestion {
  const velocity = Math.max(0, toFiniteNumber(input.velocity, 0));
  const leadTimeDays = Math.max(0, toFiniteNumber(input.leadTimeDays, 0));
  const onHand = Math.max(0, toFiniteNumber(input.onHand, 0));
  const safetyStockPct = clamp(toFiniteNumber(input.safetyStockPct, 0.2), 0, 1);
  const targetDays = clamp(toFiniteNumber(input.targetDays, 30), 1, 365);

  const leadTimeDemand = velocity * leadTimeDays;
  const safetyStock = Math.ceil(leadTimeDemand * safetyStockPct);
  const reorderPoint = Math.ceil(leadTimeDemand + safetyStock);
  const targetLevel = Math.ceil(velocity * targetDays + safetyStock);
  const suggestedOrderQty = Math.max(0, targetLevel - onHand);

  return {
    leadTimeDemand,
    safetyStock,
    reorderPoint,
    targetLevel,
    suggestedOrderQty,
    velocity,
    leadTimeDays,
    onHand,
    safetyStockPct,
    targetDays,
  };
}
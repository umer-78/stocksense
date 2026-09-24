import { suggestReorderQty } from "./reorder";
import { applySeasonality } from "./seasonality";
import { daysToStockout } from "./stockout";
import { computeVelocity } from "./velocity";
import { clamp, toFiniteNumber } from "./sanitize";
import type { ForecastInput, ForecastResult, SeasonalIndex } from "./types";

const DAY_MS = 86_400_000;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatInteger(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Average day-of-week multiplier over the `days` days following `fromDate`. */
function horizonMultiplier(seasonal: SeasonalIndex, fromDate: Date, days: number): number {
  let sum = 0;
  for (let i = 1; i <= days; i += 1) {
    const day = new Date(fromDate.getTime() + i * DAY_MS);
    sum += seasonal.dayOfWeekMultipliers[day.getUTCDay()];
  }
  return sum / days;
}

/**
 * Generate a complete, explainable forecast for one product.
 *
 * Produces the numbers (velocity, stockout, reorder point, order quantity)
 * AND a human-readable `explanation[]` where every sentence contains the real
 * figures behind the recommendation. Never throws: inputs are sanitized and
 * every edge case (empty history, zero velocity, zero on-hand, negatives)
 * yields a structured result.
 */
export function generateForecast(input: ForecastInput): ForecastResult {
  const history = Array.isArray(input.salesHistory) ? input.salesHistory : [];
  const lookbackDays = toFiniteNumber(input.lookbackDays, 0);
  const onHand = Math.max(0, toFiniteNumber(input.onHand, 0));
  const leadTimeDays = Math.max(0, toFiniteNumber(input.leadTimeDays, 0));
  const safetyStockPct = clamp(toFiniteNumber(input.safetyStockPct, 0.2), 0, 1);
  const targetDays = clamp(toFiniteNumber(input.targetDays, 30), 1, 365);
  const applySeasonalityFlag = input.applySeasonality === true;

  const velocityResult = computeVelocity(history, lookbackDays > 0 ? lookbackDays : undefined);
  const velocity = velocityResult.velocity;

  const seasonal = applySeasonalityFlag ? applySeasonality(velocity, history) : null;

  let adjustedVelocity = velocity;
  if (seasonal && seasonal.reliable && velocityResult.lastDate) {
    const fromDate = new Date(`${velocityResult.lastDate}T00:00:00Z`);
    adjustedVelocity = velocity * horizonMultiplier(seasonal, fromDate, targetDays);
  }

  const stockoutDays = daysToStockout(adjustedVelocity, onHand);
  const reorder = suggestReorderQty({
    velocity: adjustedVelocity,
    leadTimeDays,
    onHand,
    safetyStockPct,
    targetDays,
  });

  const explanation: string[] = [];
  const warnings: string[] = [];

  if (velocityResult.daysCovered > 0) {
    explanation.push(
      `Sales averaged ${formatNumber(velocity)} units/day over the last ${velocityResult.daysCovered} ${pluralize(velocityResult.daysCovered, "day", "days")} (${formatInteger(velocityResult.totalUnits)} units total).`,
    );
  } else {
    explanation.push("No sales history was available, so velocity is estimated at 0 units/day.");
    warnings.push("No sales history found — forecast assumes zero demand.");
  }

  if (seasonal && seasonal.reliable) {
    if (seasonal.weekendAverage > 0) {
      explanation.push(
        `Weekday demand runs ${formatNumber(seasonal.weekdayUplift)}x weekend demand, so expected demand over the next ${formatInteger(targetDays)} days is ${formatNumber(adjustedVelocity)} units/day.`,
      );
    } else {
      explanation.push(
        `Sales are concentrated on weekdays (weekend sales are near zero), so expected demand over the next ${formatInteger(targetDays)} days is ${formatNumber(adjustedVelocity)} units/day.`,
      );
    }
  }

  if (Number.isFinite(stockoutDays)) {
    explanation.push(
      `With ${formatInteger(onHand)} units on hand, stock is projected to run out in about ${formatNumber(stockoutDays)} days.`,
    );
  } else {
    explanation.push(
      `With ${formatInteger(onHand)} units on hand and no projected sales, there is no stockout risk in the forecast window.`,
    );
  }

  explanation.push(
    `Supplier lead time is ${formatInteger(leadTimeDays)} days, so you need ${formatInteger(reorder.leadTimeDemand)} units to cover lead-time demand.`,
  );
  explanation.push(
    `Adding ${formatPercent(safetyStockPct)} safety stock (${formatInteger(reorder.safetyStock)} units) brings the reorder point to ${formatInteger(reorder.reorderPoint)} units.`,
  );
  explanation.push(
    `Targeting ${formatInteger(targetDays)} days of stock (${formatInteger(reorder.targetLevel)} units), we suggest ordering ${formatInteger(reorder.suggestedOrderQty)} units.`,
  );

  if (velocityResult.daysCovered > 0 && velocityResult.daysCovered < 14) {
    warnings.push(
      `Only ${velocityResult.daysCovered} ${pluralize(velocityResult.daysCovered, "day", "days")} of sales history — forecast confidence is low.`,
    );
  }
  if (onHand === 0) {
    warnings.push("On-hand inventory is 0 — you are already stocked out.");
  }
  if (velocity > 0 && Number.isFinite(stockoutDays) && stockoutDays < leadTimeDays) {
    warnings.push(
      `Stock is projected to run out (${formatNumber(stockoutDays)} days) before the next order arrives (${formatInteger(leadTimeDays)} days).`,
    );
  }

  return {
    velocity,
    adjustedVelocity,
    onHand,
    leadTimeDays,
    safetyStockPct,
    targetDays,
    daysToStockout: stockoutDays,
    reorderPoint: reorder.reorderPoint,
    suggestedOrderQty: reorder.suggestedOrderQty,
    safetyStock: reorder.safetyStock,
    leadTimeDemand: reorder.leadTimeDemand,
    targetLevel: reorder.targetLevel,
    seasonal,
    explanation,
    warnings,
  };
}
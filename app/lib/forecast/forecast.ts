import { selectModel, type ModelSelection } from "./backtest";
import { inverseNormal } from "./normal";
import { suggestReorderQty } from "./reorder";
import { applySeasonality } from "./seasonality";
import { DAY_MS, mean, toDailySeries, utcDay } from "./series";
import { daysToStockout } from "./stockout";
import { computeVelocity, type VelocityWindow } from "./velocity";
import { clamp, toFiniteNumber } from "./sanitize";
import type { ForecastInput, ForecastModelInfo, ForecastResult, SeasonalIndex } from "./types";

/** Days of daily demand projected for stockout timing in "auto" mode. */
const PROJECTION_DAYS = 365;
/** Days of the projection returned to callers (for charts). */
const RETURNED_FORECAST_DAYS = 28;

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

function noBetterMethod(others: number, weeks: string): string {
  if (others === 0) {
    return `No other method had enough history to be tested on the last ${weeks}.`;
  }
  return others === 1
    ? `The other method tested on the last ${weeks} of history did not predict better.`
    : `None of the other ${others} methods tested on the last ${weeks} of history predicted better.`;
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

/** Units expected over the first `days` days of a daily path (fractional days allowed). */
function horizonSum(path: number[], days: number): number {
  const whole = Math.min(path.length, Math.floor(days));
  let total = 0;
  for (let i = 0; i < whole; i += 1) {
    total += path[i];
  }
  const fraction = days - Math.floor(days);
  if (fraction > 0 && whole < path.length) {
    total += fraction * path[whole];
  }
  return total;
}

/** Days until cumulative projected demand uses up `stock`. Infinity when demand is zero. */
function stockoutFromPath(path: number[], stock: number): number {
  if (stock <= 0) {
    return 0;
  }
  let remaining = stock;
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] >= remaining) {
      return i + remaining / path[i];
    }
    remaining -= path[i];
  }
  const tail = mean(path.slice(-28));
  return tail > 0 ? path.length + remaining / tail : Number.POSITIVE_INFINITY;
}

/** z-score for a service level, clamped to a sensible 50%–99.9% range. */
export function serviceLevelZ(serviceLevel: number): number {
  return inverseNormal(clamp(serviceLevel, 0.5, 0.999));
}

function modelInfo(selection: ModelSelection): ForecastModelInfo {
  return {
    id: selection.spec.id,
    label: selection.spec.label,
    tested: selection.tested,
    errorPct: selection.errorPct,
    baselineErrorPct: selection.baselineErrorPct,
    improvementPct: selection.improvementPct,
    folds: selection.folds,
    params: selection.model.params,
  };
}

/**
 * Generate a complete, explainable forecast for one product.
 *
 * Produces the numbers (velocity, stockout, reorder point, order quantity)
 * AND a human-readable `explanation[]` where every sentence contains the real
 * figures behind the recommendation. Never throws: inputs are sanitized and
 * every edge case (empty history, zero velocity, zero on-hand, negatives)
 * yields a structured result.
 *
 * Two demand methods:
 * - "average" (default): demand = velocity × days, optionally scaled by the
 *   day-of-week pattern. This is the formula on the public calculator.
 * - "auto": several forecasting models are back-tested on this item's own
 *   history (see `backtest.ts`) and the most accurate one projects daily
 *   demand. Lead-time demand, cover demand and the stockout date come from
 *   that projection.
 */
export function generateForecast(input: ForecastInput): ForecastResult {
  const history = Array.isArray(input.salesHistory) ? input.salesHistory : [];
  const lookbackDays = toFiniteNumber(input.lookbackDays, 0);
  const onHand = Math.max(0, toFiniteNumber(input.onHand, 0));
  const incoming = Math.max(0, toFiniteNumber(input.incoming, 0));
  const leadTimeDays = Math.max(0, toFiniteNumber(input.leadTimeDays, 0));
  const safetyStockPct = clamp(toFiniteNumber(input.safetyStockPct, 0.2), 0, 1);
  const targetDays = clamp(toFiniteNumber(input.targetDays, 30), 1, 365);
  const serviceLevel = clamp(toFiniteNumber(input.serviceLevel, 0.95), 0.5, 0.999);
  const asOfDay = input.asOf ? utcDay(input.asOf) : null;
  const auto = input.method === "auto" && asOfDay !== null;
  const applySeasonalityFlag = input.applySeasonality === true && !auto;

  const window: VelocityWindow = asOfDay !== null ? { end: input.asOf, start: input.availableSince } : {};
  const velocityResult = computeVelocity(history, lookbackDays > 0 ? lookbackDays : undefined, window);
  const velocity = velocityResult.velocity;
  const hasSales = velocityResult.totalUnits > 0;

  // Dense daily series over the same window: input to the models and to
  // error-based safety stock.
  const series =
    asOfDay !== null && velocityResult.firstDate
      ? toDailySeries(history, utcDay(velocityResult.firstDate) ?? asOfDay, asOfDay)
      : [];

  const selection = auto ? selectModel(series, { allowSeasonal: input.allowSeasonalModel === true }) : null;

  const seasonal = applySeasonalityFlag ? applySeasonality(velocity, history) : null;

  let adjustedVelocity = velocity;
  let leadTimeDemand: number;
  let coverDemand: number;
  let stockoutDays: number;
  let dailyForecast: number[] = [];

  if (selection) {
    const path = selection.model.forecast(PROJECTION_DAYS);
    dailyForecast = path.slice(0, RETURNED_FORECAST_DAYS);
    leadTimeDemand = horizonSum(path, leadTimeDays);
    coverDemand = horizonSum(path, targetDays);
    adjustedVelocity = coverDemand / targetDays;
    stockoutDays = stockoutFromPath(path, onHand);
  } else {
    if (seasonal && seasonal.reliable && velocityResult.lastDate) {
      const fromDate = new Date(`${velocityResult.lastDate}T00:00:00Z`);
      adjustedVelocity = velocity * horizonMultiplier(seasonal, fromDate, targetDays);
    }
    leadTimeDemand = adjustedVelocity * leadTimeDays;
    coverDemand = adjustedVelocity * targetDays;
    stockoutDays = daysToStockout(adjustedVelocity, onHand);
  }

  // Safety stock: a flat percentage, or sized from how far forecasts have
  // missed (σ of daily error × √lead time × z for the service level).
  const residualStd = selection
    ? selection.residualStd
    : series.length > 1
      ? Math.sqrt(mean(series.map((x) => (x - mean(series)) ** 2)))
      : 0;
  const useService = input.safetyStockMethod === "service" && series.length > 0;
  const safetyStock = useService
    ? Math.ceil(Math.max(0, serviceLevelZ(serviceLevel) * residualStd * Math.sqrt(leadTimeDays)))
    : Math.ceil(leadTimeDemand * safetyStockPct);

  let reorderPoint: number;
  let targetLevel: number;
  if (!selection && !useService) {
    // Classic path: identical to the public calculator's formulas.
    const reorder = suggestReorderQty({ velocity: adjustedVelocity, leadTimeDays, onHand, safetyStockPct, targetDays });
    reorderPoint = reorder.reorderPoint;
    targetLevel = reorder.targetLevel;
  } else {
    reorderPoint = Math.ceil(leadTimeDemand + safetyStock);
    targetLevel = Math.ceil(coverDemand + safetyStock);
  }
  const suggestedOrderQty = Math.max(0, targetLevel - onHand - incoming);

  const explanation: string[] = [];
  const warnings: string[] = [];

  if (hasSales) {
    explanation.push(
      `Sales averaged ${formatNumber(velocity)} units/day over the last ${velocityResult.daysCovered} ${pluralize(velocityResult.daysCovered, "day", "days")} (${formatInteger(velocityResult.totalUnits)} units total).`,
    );
  } else {
    explanation.push("No sales history was available, so velocity is estimated at 0 units/day.");
    warnings.push("No sales history found — forecast assumes zero demand.");
  }

  if (selection && hasSales) {
    const info = selection;
    if (!info.tested) {
      explanation.push(
        `Forecast method: simple average. There are fewer than 4 weeks of history, which is not enough to test other methods.`,
      );
    } else {
      const weeks = `${info.folds} ${pluralize(info.folds, "week", "weeks")}`;
      const accuracy =
        info.errorPct !== null ? ` Its weekly totals were off by ${formatPercent(info.errorPct)} on average.` : "";
      if (info.spec.id === "average" || info.improvementPct === null || info.improvementPct <= 0) {
        explanation.push(
          `Forecast method: ${info.spec.label}. ${noBetterMethod(info.scores.length - 1, weeks)}${accuracy}`,
        );
      } else {
        explanation.push(
          `Forecast method: ${info.spec.label}, chosen from ${info.scores.length} methods: tested on the last ${weeks} of history, its daily forecasts had ${formatPercent(info.improvementPct)} less error than a simple average.${accuracy}`,
        );
      }
    }
    explanation.push(
      `It expects ${formatNumber(coverDemand)} units to sell over the next ${formatInteger(targetDays)} days (${formatNumber(adjustedVelocity)}/day).`,
    );
  } else if (seasonal && seasonal.reliable) {
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

  if (onHand <= 0) {
    explanation.push(`With 0 units on hand, this item is already out of stock.`);
  } else if (Number.isFinite(stockoutDays)) {
    explanation.push(
      `With ${formatInteger(onHand)} units on hand, stock is projected to run out in about ${formatNumber(stockoutDays)} days.`,
    );
  } else {
    explanation.push(
      `With ${formatInteger(onHand)} units on hand and no projected sales, there is no stockout risk in the forecast window.`,
    );
  }

  explanation.push(
    `Supplier lead time is ${formatInteger(leadTimeDays)} days, so you need ${formatInteger(leadTimeDemand)} units to cover lead-time demand.`,
  );
  if (useService) {
    explanation.push(
      `Safety stock of ${formatInteger(safetyStock)} units covers forecast misses of about ±${formatNumber(residualStd)} units/day, for a ${formatPercent(serviceLevel)} chance of not running out during the lead time; the reorder point is ${formatInteger(reorderPoint)} units.`,
    );
  } else {
    explanation.push(
      `Adding ${formatPercent(safetyStockPct)} safety stock (${formatInteger(safetyStock)} units) brings the reorder point to ${formatInteger(reorderPoint)} units.`,
    );
  }
  explanation.push(
    incoming > 0
      ? `Targeting ${formatInteger(targetDays)} days of stock (${formatInteger(targetLevel)} units), and counting ${formatInteger(incoming)} units already on order, we suggest ordering ${formatInteger(suggestedOrderQty)} units.`
      : `Targeting ${formatInteger(targetDays)} days of stock (${formatInteger(targetLevel)} units), we suggest ordering ${formatInteger(suggestedOrderQty)} units.`,
  );

  if (hasSales && velocityResult.daysCovered < 14) {
    warnings.push(
      `Only ${velocityResult.daysCovered} ${pluralize(velocityResult.daysCovered, "day", "days")} of sales history — forecast confidence is low.`,
    );
  }
  if (onHand === 0) {
    warnings.push("On-hand inventory is 0 — you are already stocked out.");
  }
  if (velocity > 0 && Number.isFinite(stockoutDays) && stockoutDays < leadTimeDays) {
    warnings.push(
      incoming > 0
        ? `Stock is projected to run out (${formatNumber(stockoutDays)} days) before a new order could arrive (${formatInteger(leadTimeDays)} days). The ${formatInteger(incoming)} units already on order only help if they arrive sooner.`
        : `Stock is projected to run out (${formatNumber(stockoutDays)} days) before the next order arrives (${formatInteger(leadTimeDays)} days).`,
    );
  }
  if (selection?.tested && selection.errorPct !== null && selection.errorPct > 0.5) {
    warnings.push(
      `Sales for this item are hard to predict: even the best method was off by ${formatPercent(selection.errorPct)} in back-tests. Consider a higher safety stock.`,
    );
  }

  let confidence: ForecastResult["confidence"] = "high";
  if (!hasSales || velocityResult.daysCovered < 14 || (selection && !selection.tested)) {
    confidence = "low";
  } else if (selection?.errorPct != null) {
    confidence = selection.errorPct > 0.5 ? "low" : selection.errorPct > 0.25 ? "medium" : "high";
  } else if (!selection) {
    confidence = velocityResult.daysCovered >= 28 ? "medium" : "low";
  }

  return {
    velocity,
    adjustedVelocity,
    onHand,
    leadTimeDays,
    safetyStockPct,
    targetDays,
    daysToStockout: stockoutDays,
    reorderPoint,
    suggestedOrderQty,
    safetyStock,
    leadTimeDemand,
    targetLevel,
    seasonal,
    explanation,
    warnings,
    incoming,
    coverDemand,
    model: selection ? modelInfo(selection) : null,
    dailyForecast,
    confidence,
    safetyStockMethod: useService ? "service" : "percent",
    serviceLevel,
  };
}

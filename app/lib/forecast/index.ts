/**
 * StockSense forecasting engine — public API.
 *
 * Pure TypeScript, no framework dependencies. Every function sanitizes its
 * inputs and returns structured data instead of throwing on edge cases.
 */
export { computeVelocity } from "./velocity";
export { daysToStockout } from "./stockout";
export { suggestReorderQty } from "./reorder";
export { applySeasonality } from "./seasonality";
export { generateForecast } from "./forecast";
export type { SuggestReorderQtyInput } from "./reorder";
export type {
  ForecastInput,
  ForecastResult,
  ReorderSuggestion,
  SalesRecord,
  SeasonalIndex,
  VelocityResult,
} from "./types";
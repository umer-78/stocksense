/**
 * Forelark forecasting engine — public API.
 *
 * Pure TypeScript, no framework dependencies. Every function sanitizes its
 * inputs and returns structured data instead of throwing on edge cases.
 */
export { computeVelocity } from "./velocity";
export { daysToStockout } from "./stockout";
export { suggestReorderQty } from "./reorder";
export { applySeasonality } from "./seasonality";
export { generateForecast, serviceLevelZ } from "./forecast";
export { selectModel, MIN_TRAIN_DAYS } from "./backtest";
export { MODELS } from "./models";
export { toDailySeries } from "./series";
export type { SuggestReorderQtyInput } from "./reorder";
export type { ModelSelection, ModelScore } from "./backtest";
export type { FittedModel, ModelId, ModelSpec } from "./models";
export type {
  ForecastInput,
  ForecastModelInfo,
  ForecastResult,
  ReorderSuggestion,
  SalesRecord,
  SeasonalIndex,
  VelocityResult,
} from "./types";
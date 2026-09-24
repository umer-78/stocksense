/**
 * Shared types for the StockSense forecasting engine.
 *
 * The engine is deliberately pure TypeScript with no I/O or framework
 * dependencies so it can be unit-tested in isolation and reused anywhere
 * (server loaders, background jobs, or a future shared package).
 */

/** A single dated sales record for one product/variant. */
export interface SalesRecord {
  /** ISO date string (YYYY-MM-DD) or a Date object. */
  date: string | Date;
  /** Units sold on that date. Negative/NaN values are clamped to 0. */
  quantity: number;
}

/** Result of {@link computeVelocity}. */
export interface VelocityResult {
  /** Units sold per day over the covered window. 0 when there is no usable data. */
  velocity: number;
  /** Total units sold in the window. */
  totalUnits: number;
  /** Number of calendar days covered by the window (zero-sales days included). */
  daysCovered: number;
  /** Number of days in the window that had sales > 0. */
  activeDays: number;
  /** Number of distinct days that contributed to the window. */
  sampleSize: number;
  /** ISO date (YYYY-MM-DD) of the first day in the window. Empty when no data. */
  firstDate: string;
  /** ISO date (YYYY-MM-DD) of the last day in the window. Empty when no data. */
  lastDate: string;
}

/** Result of {@link suggestReorderQty}. */
export interface ReorderSuggestion {
  /** Units expected to sell during the supplier lead time (velocity × lead time). */
  leadTimeDemand: number;
  /** Extra units held to absorb demand variability. */
  safetyStock: number;
  /** Inventory level that should trigger a reorder. */
  reorderPoint: number;
  /** Inventory level we want to be at after the order arrives. */
  targetLevel: number;
  /** Units to order now (never negative). */
  suggestedOrderQty: number;
  velocity: number;
  leadTimeDays: number;
  onHand: number;
  safetyStockPct: number;
  targetDays: number;
}

/** Result of {@link applySeasonality}. */
export interface SeasonalIndex {
  /** Multipliers indexed by day of week (0 = Sunday … 6 = Saturday). 1.0 = an average day. */
  dayOfWeekMultipliers: number[];
  /** Average units sold per day of week (0 = Sunday … 6 = Saturday). */
  dayOfWeekAverages: number[];
  /** Index (0–6) of the highest-multiplier day. */
  peakDay: number;
  /** Index (0–6) of the lowest-multiplier day. */
  troughDay: number;
  /** Average weekday (Mon–Fri) sales ÷ average weekend (Sat–Sun) sales. 1 when undefined. */
  weekdayUplift: number;
  /** Average units sold on weekdays (Mon–Fri). */
  weekdayAverage: number;
  /** Average units sold on weekends (Sat–Sun). */
  weekendAverage: number;
  /** Expected daily sales per day of week = velocity × multiplier. */
  expectedDailySales: number[];
  /** True when there was enough data (≥ 14 records covering every day of the week). */
  reliable: boolean;
  /** Number of records used. */
  sampleSize: number;
}

/** Input to {@link generateForecast}. */
export interface ForecastInput {
  salesHistory: SalesRecord[];
  /** Only consider the most recent N calendar days of history. 0/omitted = use all. */
  lookbackDays?: number;
  /** Units currently on hand. Negative values are clamped to 0. */
  onHand: number;
  /** Supplier lead time in days. Negative values are clamped to 0. */
  leadTimeDays: number;
  /** Safety stock as a fraction of lead-time demand (0.2 = 20%). Clamped to [0, 1]. */
  safetyStockPct?: number;
  /** How many days of stock to target after an order arrives. Clamped to [1, 365]. */
  targetDays?: number;
  /** When true, adjust velocity using the detected weekly pattern. */
  applySeasonality?: boolean;
}

/** Result of {@link generateForecast}. */
export interface ForecastResult {
  /** Base units/day from the sales history. */
  velocity: number;
  /** Velocity after seasonal adjustment (equals `velocity` when seasonality is off). */
  adjustedVelocity: number;
  onHand: number;
  leadTimeDays: number;
  safetyStockPct: number;
  targetDays: number;
  /** Estimated days until stockout. Infinity when velocity is 0. */
  daysToStockout: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  safetyStock: number;
  leadTimeDemand: number;
  targetLevel: number;
  /** Weekly pattern when requested, otherwise null. */
  seasonal: SeasonalIndex | null;
  /** Human-readable sentences explaining every number in the recommendation. */
  explanation: string[];
  /** Non-fatal notes about data quality and assumptions. */
  warnings: string[];
}
/**
 * Dashboard domain logic: status classification, row building, sorting and
 * filtering. Pure functions so the dashboard's behavior is unit-testable
 * without a Shopify connection.
 */
import { generateForecast } from "./forecast";
import type { ForecastResult, SalesRecord } from "./forecast";
import { resolveSettings, type ForecastSettings, type VariantOverride } from "./settings";
import { inventoryForLocation, salesFor } from "./shopify/adapter";
import type { StoredSnapshot, VariantInventory } from "./shopify/types";

export type StockStatus = "critical" | "low" | "ok";

/**
 * Classify stockout urgency against the supplier lead time:
 *   critical — stockout before the next order can arrive (< lead time)
 *   low      — stockout within 2× lead time
 *   ok       — otherwise (including no stockout risk, velocity 0)
 */
export function classifyStatus(
  daysToStockout: number,
  leadTimeDays: number,
): StockStatus {
  if (!Number.isFinite(daysToStockout)) {
    return "ok";
  }
  if (daysToStockout < leadTimeDays) {
    return "critical";
  }
  if (daysToStockout < leadTimeDays * 2) {
    return "low";
  }
  return "ok";
}

/**
 * Status for a finished forecast. "critical" means an order is needed now; when
 * stock runs out within the lead time but units already on order cover the
 * suggestion (order qty 0), the item is "low": it needs watching, not ordering.
 */
export function forecastStatus(
  forecast: { daysToStockout: number; suggestedOrderQty: number },
  leadTimeDays: number,
): StockStatus {
  const status = classifyStatus(forecast.daysToStockout, leadTimeDays);
  return status === "critical" && forecast.suggestedOrderQty === 0 ? "low" : status;
}

export interface DashboardRow {
  variant: VariantInventory;
  velocity: number;
  /** Expected units/day over the cover period (the model's forecast). */
  forecastPerDay: number;
  daysToStockout: number;
  suggestedOrderQty: number;
  status: StockStatus;
  leadTime: number;
  /** True when this variant has its own lead time / safety / cover settings. */
  overridden: boolean;
  modelLabel: string | null;
  confidence: ForecastResult["confidence"];
  explanation: string[];
  warnings: string[];
}

export interface RowOptions {
  /** Allow the weekly-pattern model (paid plans). */
  allowSeasonal: boolean;
  /** Last full day of sales (snapshot window end). Enables model selection. */
  asOf?: string;
  override?: VariantOverride | null;
}

/** Run the forecast for one variant. Shared by the dashboard, PO builder and detail page. */
export function forecastVariant(
  variant: VariantInventory,
  salesHistory: SalesRecord[],
  settings: ForecastSettings,
  options: RowOptions,
): { forecast: ForecastResult; leadTime: number; overridden: boolean } {
  const effective = resolveSettings(settings, options.override);
  const forecast = generateForecast({
    salesHistory,
    // Sellable stock: on-hand units already committed to open orders are sold.
    onHand: variant.available,
    incoming: variant.incoming,
    leadTimeDays: effective.leadTime,
    safetyStockPct: effective.safetyStockPct,
    targetDays: effective.targetDays,
    lookbackDays: settings.lookbackDays,
    asOf: options.asOf,
    availableSince: variant.productCreatedAt ?? undefined,
    method: options.asOf ? "auto" : "average",
    allowSeasonalModel: options.allowSeasonal,
    applySeasonality: options.allowSeasonal,
    safetyStockMethod: settings.safetyStockMethod,
    serviceLevel: settings.serviceLevel,
  });
  return { forecast, leadTime: effective.leadTime, overridden: effective.overridden };
}

export function buildDashboardRow(
  variant: VariantInventory,
  salesHistory: SalesRecord[],
  settings: ForecastSettings,
  options: RowOptions,
): DashboardRow {
  const { forecast, leadTime, overridden } = forecastVariant(variant, salesHistory, settings, options);
  return {
    variant,
    velocity: forecast.velocity,
    forecastPerDay: forecast.adjustedVelocity,
    daysToStockout: forecast.daysToStockout,
    suggestedOrderQty: forecast.suggestedOrderQty,
    status: forecastStatus(forecast, leadTime),
    leadTime,
    overridden,
    modelLabel: forecast.model?.label ?? null,
    confidence: forecast.confidence,
    explanation: forecast.explanation,
    warnings: forecast.warnings,
  };
}

/** Forecast every variant in a snapshot at a location (null = all locations combined). */
export function buildRows(
  snapshot: StoredSnapshot,
  settings: ForecastSettings,
  overrides: Map<string, VariantOverride>,
  options: { allowSeasonal: boolean; locationId: string | null; limit?: number | null },
): { rows: DashboardRow[]; variantCount: number } {
  const inventory = inventoryForLocation(snapshot, options.locationId);
  const visible = options.limit != null ? inventory.slice(0, options.limit) : inventory;
  const rows = visible.map((variant) =>
    buildDashboardRow(variant, salesFor(snapshot, variant.variantId), settings, {
      allowSeasonal: options.allowSeasonal,
      asOf: snapshot.windowEnd,
      override: overrides.get(variant.variantId),
    }),
  );
  return { rows: sortByUrgency(rows), variantCount: inventory.length };
}

const STATUS_RANK: Record<StockStatus, number> = { critical: 0, low: 1, ok: 2 };

/** Critical items first, then soonest stockout. */
export function sortByUrgency(rows: DashboardRow[]): DashboardRow[] {
  return [...rows].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const aDays = Number.isFinite(a.daysToStockout) ? a.daysToStockout : Number.MAX_SAFE_INTEGER;
    const bDays = Number.isFinite(b.daysToStockout) ? b.daysToStockout : Number.MAX_SAFE_INTEGER;
    return aDays - bDays;
  });
}

export interface DashboardFilters {
  status: string;
  search: string;
}

export function filterRows(
  rows: DashboardRow[],
  filters: DashboardFilters,
): DashboardRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) {
      return false;
    }
    if (search) {
      const haystack = `${row.variant.sku} ${row.variant.productTitle} ${row.variant.variantTitle}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

export interface DashboardSummary {
  critical: number;
  low: number;
  ok: number;
  /** Units the current suggestions add up to. */
  unitsToOrder: number;
  /** Cost of those units where unit cost is known. */
  orderValue: number;
}

export function summarize(rows: DashboardRow[]): DashboardSummary {
  const summary: DashboardSummary = { critical: 0, low: 0, ok: 0, unitsToOrder: 0, orderValue: 0 };
  for (const row of rows) {
    summary[row.status] += 1;
    summary.unitsToOrder += row.suggestedOrderQty;
    summary.orderValue += row.suggestedOrderQty * (row.variant.unitCost ?? 0);
  }
  return summary;
}

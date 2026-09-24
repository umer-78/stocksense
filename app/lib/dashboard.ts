/**
 * Dashboard domain logic: status classification, row building, sorting and
 * filtering. Pure functions so the dashboard's behavior is unit-testable
 * without a Shopify connection.
 */
import { generateForecast } from "./forecast";
import type { SalesRecord } from "./forecast";
import type { ForecastSettings } from "./settings";
import type { VariantInventory } from "./shopify/types";

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

export interface DashboardRow {
  variant: VariantInventory;
  velocity: number;
  daysToStockout: number;
  suggestedOrderQty: number;
  status: StockStatus;
  explanation: string[];
  warnings: string[];
}

export function buildDashboardRow(
  variant: VariantInventory,
  salesHistory: SalesRecord[],
  settings: ForecastSettings,
  applySeasonality: boolean,
): DashboardRow {
  const forecast = generateForecast({
    salesHistory,
    onHand: variant.onHand,
    leadTimeDays: settings.defaultLeadTime,
    safetyStockPct: settings.safetyStockPct,
    targetDays: settings.targetDays,
    applySeasonality,
  });
  return {
    variant,
    velocity: forecast.velocity,
    daysToStockout: forecast.daysToStockout,
    suggestedOrderQty: forecast.suggestedOrderQty,
    status: classifyStatus(forecast.daysToStockout, settings.defaultLeadTime),
    explanation: forecast.explanation,
    warnings: forecast.warnings,
  };
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
  locationId: string;
  status: string;
  search: string;
}

export function filterRows(
  rows: DashboardRow[],
  filters: DashboardFilters,
): DashboardRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.locationId && row.variant.locationId !== filters.locationId) {
      return false;
    }
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
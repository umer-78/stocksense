/**
 * Per-shop forecasting settings, persisted via Prisma (SQLite in dev).
 */
import db from "../db.server";

export interface ForecastSettings {
  /** Supplier lead time in days (default used for all variants). */
  defaultLeadTime: number;
  /** Safety stock as a fraction of lead-time demand (0.2 = 20%). */
  safetyStockPct: number;
  /** Target days of stock after an order arrives. */
  targetDays: number;
  /** Sales-history lookback window in days. */
  lookbackDays: number;
  /** Preferred inventory location (null = first location returned). */
  locationId: string | null;
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  defaultLeadTime: 14,
  safetyStockPct: 0.2,
  targetDays: 30,
  lookbackDays: 60,
  locationId: null,
};

export async function getShopSettings(shop: string): Promise<ForecastSettings> {
  const row = await db.shopSettings.findUnique({ where: { shop } });
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    defaultLeadTime: row.defaultLeadTime,
    safetyStockPct: row.safetyStockPct,
    targetDays: row.targetDays,
    lookbackDays: row.lookbackDays,
    locationId: row.locationId,
  };
}

export async function saveShopSettings(
  shop: string,
  settings: ForecastSettings,
): Promise<void> {
  await db.shopSettings.upsert({
    where: { shop },
    create: { shop, ...settings },
    update: { ...settings },
  });
}

/** Clamp user-entered settings to sane ranges. Pure, so it is testable. */
export function sanitizeSettings(input: Partial<ForecastSettings>): ForecastSettings {
  const lead = Number(input.defaultLeadTime);
  const safety = Number(input.safetyStockPct);
  const target = Number(input.targetDays);
  const lookback = Number(input.lookbackDays);

  return {
    defaultLeadTime: Number.isFinite(lead) ? Math.min(365, Math.max(0, Math.round(lead))) : DEFAULT_SETTINGS.defaultLeadTime,
    safetyStockPct: Number.isFinite(safety) ? Math.min(1, Math.max(0, safety)) : DEFAULT_SETTINGS.safetyStockPct,
    targetDays: Number.isFinite(target) ? Math.min(365, Math.max(1, Math.round(target))) : DEFAULT_SETTINGS.targetDays,
    lookbackDays: Number.isFinite(lookback) ? Math.min(365, Math.max(7, Math.round(lookback))) : DEFAULT_SETTINGS.lookbackDays,
    locationId: typeof input.locationId === "string" && input.locationId.length > 0 ? input.locationId : null,
  };
}
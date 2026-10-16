/**
 * Forecasting settings: types, defaults and pure validation. Database access
 * lives in `settings.server.ts` so this module can run in the browser (the
 * variant page recomputes forecasts live as settings are edited).
 */

export type SafetyStockMethod = "percent" | "service";

export interface ForecastSettings {
  /** Supplier lead time in days (default used for all variants). */
  defaultLeadTime: number;
  /** Safety stock as a fraction of lead-time demand (0.2 = 20%). */
  safetyStockPct: number;
  /** Target days of stock after an order arrives. */
  targetDays: number;
  /** Sales-history lookback window in days. */
  lookbackDays: number;
  /** Inventory location to forecast (null = all locations combined). */
  locationId: string | null;
  /** How safety stock is sized. */
  safetyStockMethod: SafetyStockMethod;
  /** Target chance of not running out during the lead time ("service" method). */
  serviceLevel: number;
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  defaultLeadTime: 14,
  safetyStockPct: 0.2,
  targetDays: 30,
  lookbackDays: 60,
  locationId: null,
  safetyStockMethod: "percent",
  serviceLevel: 0.95,
};

export const SERVICE_LEVELS = [0.8, 0.9, 0.95, 0.98, 0.99] as const;

function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/**
 * Clamp user-entered settings to sane ranges. Fields missing from `input`
 * keep the value from `base` (the shop's current settings), so a form that
 * edits only some fields never resets the others. Pure, so it is testable.
 */
export function sanitizeSettings(
  input: Partial<ForecastSettings>,
  base: ForecastSettings = DEFAULT_SETTINGS,
): ForecastSettings {
  const lead = Number(pick(input.defaultLeadTime, base.defaultLeadTime));
  const safety = Number(pick(input.safetyStockPct, base.safetyStockPct));
  const target = Number(pick(input.targetDays, base.targetDays));
  const lookback = Number(pick(input.lookbackDays, base.lookbackDays));
  const service = Number(pick(input.serviceLevel, base.serviceLevel));
  const method = pick(input.safetyStockMethod, base.safetyStockMethod);
  const location = pick(input.locationId, base.locationId);

  return {
    defaultLeadTime: Number.isFinite(lead) ? Math.min(365, Math.max(0, Math.round(lead))) : base.defaultLeadTime,
    safetyStockPct: Number.isFinite(safety) ? Math.min(1, Math.max(0, safety)) : base.safetyStockPct,
    targetDays: Number.isFinite(target) ? Math.min(365, Math.max(1, Math.round(target))) : base.targetDays,
    lookbackDays: Number.isFinite(lookback) ? Math.min(365, Math.max(7, Math.round(lookback))) : base.lookbackDays,
    locationId: typeof location === "string" && location.length > 0 ? location : null,
    safetyStockMethod: method === "service" ? "service" : "percent",
    serviceLevel: Number.isFinite(service) ? Math.min(0.999, Math.max(0.5, service)) : base.serviceLevel,
  };
}

// ---------------------------------------------------------------------------
// Per-variant overrides
// ---------------------------------------------------------------------------

export interface VariantOverride {
  leadTime: number | null;
  safetyStockPct: number | null;
  targetDays: number | null;
  source: "manual" | "stocky";
}

/** The three values a forecast actually uses, after applying an override. */
export interface EffectiveSettings {
  leadTime: number;
  safetyStockPct: number;
  targetDays: number;
  overridden: boolean;
}

export function resolveSettings(settings: ForecastSettings, override?: VariantOverride | null): EffectiveSettings {
  const leadTime = override?.leadTime ?? settings.defaultLeadTime;
  const safetyStockPct = override?.safetyStockPct ?? settings.safetyStockPct;
  const targetDays = override?.targetDays ?? settings.targetDays;
  return {
    leadTime,
    safetyStockPct,
    targetDays,
    overridden: Boolean(override && (override.leadTime != null || override.safetyStockPct != null || override.targetDays != null)),
  };
}

/** Parse override form fields; blank means "use the shop default". Pure. */
export function sanitizeOverride(input: {
  leadTime?: unknown;
  safetyStockPct?: unknown;
  targetDays?: unknown;
}): Omit<VariantOverride, "source"> {
  const parse = (value: unknown, min: number, max: number, round: boolean) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return null;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return null;
    }
    const clamped = Math.min(max, Math.max(min, n));
    return round ? Math.round(clamped) : clamped;
  };
  return {
    leadTime: parse(input.leadTime, 0, 365, true),
    safetyStockPct: parse(input.safetyStockPct, 0, 1, false),
    targetDays: parse(input.targetDays, 1, 365, true),
  };
}

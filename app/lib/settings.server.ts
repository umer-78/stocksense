/**
 * Settings persistence (Prisma). Pure logic lives in `settings.ts`.
 */
import db from "../db.server";
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type ForecastSettings,
  type SafetyStockMethod,
  type VariantOverride,
} from "./settings";

export async function getShopSettings(shop: string): Promise<ForecastSettings> {
  const row = await db.shopSettings.findUnique({ where: { shop } });
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }
  return sanitizeSettings({
    defaultLeadTime: row.defaultLeadTime,
    safetyStockPct: row.safetyStockPct,
    targetDays: row.targetDays,
    lookbackDays: row.lookbackDays,
    locationId: row.locationId,
    safetyStockMethod: row.safetyStockMethod as SafetyStockMethod,
    serviceLevel: row.serviceLevel,
  });
}

export async function saveShopSettings(shop: string, settings: ForecastSettings): Promise<void> {
  await db.shopSettings.upsert({
    where: { shop },
    create: { shop, ...settings },
    update: { ...settings },
  });
}

function toOverride(row: { leadTime: number | null; safetyStockPct: number | null; targetDays: number | null; source: string }): VariantOverride {
  return {
    leadTime: row.leadTime,
    safetyStockPct: row.safetyStockPct,
    targetDays: row.targetDays,
    source: row.source === "stocky" ? "stocky" : "manual",
  };
}

export async function getVariantOverrides(shop: string): Promise<Map<string, VariantOverride>> {
  const rows = await db.variantSettings.findMany({ where: { shop } });
  return new Map(rows.map((row) => [row.variantId, toOverride(row)]));
}

export async function getVariantOverride(shop: string, variantId: string): Promise<VariantOverride | null> {
  const row = await db.variantSettings.findUnique({ where: { shop_variantId: { shop, variantId } } });
  return row ? toOverride(row) : null;
}

/** Save an override; all-blank values delete it so the variant follows the defaults again. */
export async function saveVariantOverride(
  shop: string,
  variantId: string,
  values: Omit<VariantOverride, "source">,
  source: VariantOverride["source"] = "manual",
): Promise<void> {
  if (values.leadTime == null && values.safetyStockPct == null && values.targetDays == null) {
    await db.variantSettings.deleteMany({ where: { shop, variantId } });
    return;
  }
  await db.variantSettings.upsert({
    where: { shop_variantId: { shop, variantId } },
    create: { shop, variantId, ...values, source },
    update: { ...values, source },
  });
}

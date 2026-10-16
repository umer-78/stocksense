/**
 * Turn a stored Stocky "Variants" export into per-variant lead times.
 *
 * Stocky kept a supplier lead time per variant; StockSense matches those rows
 * to the live catalog by SKU (case- and whitespace-insensitive). Pure, so it
 * is testable; the route does the database writes.
 */
import type { VariantOverride } from "../settings";

function normalizeSku(sku: unknown): string {
  return String(sku ?? "").trim().toLowerCase();
}

/** SKU → lead time in days, from parsed Stocky rows. Duplicate SKUs (one row per location) keep the longest lead time. */
export function leadTimesBySku(rows: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as { kind?: unknown; sku?: unknown; leadTimeDays?: unknown };
    const days = Number(r.leadTimeDays);
    const sku = normalizeSku(r.sku);
    if (r.kind !== "variant" || !sku || !Number.isFinite(days) || days <= 0) continue;
    const rounded = Math.min(365, Math.round(days));
    out.set(sku, Math.max(out.get(sku) ?? 0, rounded));
  }
  return out;
}

export interface LeadTimeMatch {
  variantId: string;
  sku: string;
  leadTime: number;
}

/** Catalog variants whose SKU has a Stocky lead time. Variants without a SKU never match. */
export function matchLeadTimes(
  leadTimes: Map<string, number>,
  variants: Array<{ variantId: string; sku: string }>,
): LeadTimeMatch[] {
  const matches: LeadTimeMatch[] = [];
  for (const variant of variants) {
    const leadTime = leadTimes.get(normalizeSku(variant.sku));
    if (leadTime !== undefined && normalizeSku(variant.sku)) {
      matches.push({ variantId: variant.variantId, sku: variant.sku, leadTime });
    }
  }
  return matches;
}

/**
 * The override to save for a match, or null to leave the variant alone.
 * A lead time the merchant typed by hand always wins over an imported one;
 * other fields of an existing override are kept.
 */
export function overrideFromImport(
  match: LeadTimeMatch,
  existing: VariantOverride | undefined,
): Omit<VariantOverride, "source"> | null {
  if (existing?.source === "manual" && existing.leadTime != null) {
    return null;
  }
  return {
    leadTime: match.leadTime,
    safetyStockPct: existing?.safetyStockPct ?? null,
    targetDays: existing?.targetDays ?? null,
  };
}

/**
 * Low-stock alerts (pure parts). When a stock change pushes a variant into
 * "Reorder now", Forelark records an alert and fires its Shopify Flow trigger,
 * at most once a day per variant.
 */
import type { StockStatus } from "./dashboard";

/** Handle of the Flow trigger extension in `extensions/reorder-alert`. */
export const FLOW_TRIGGER_HANDLE = "item-needs-reordering";

export const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function shouldAlert(status: StockStatus, lastAlertAt: Date | null, now: Date): boolean {
  if (status !== "critical") {
    return false;
  }
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= ALERT_COOLDOWN_MS;
}

/** Numeric id from a Shopify GID (or a plain number), or null. */
export function numericId(value: unknown): number | null {
  const match = String(value ?? "").match(/(\d+)$/);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export interface AlertRow {
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  available: number;
  daysToStockout: number;
  suggestedOrderQty: number;
}

/**
 * Payload for the Flow trigger. Keys must match the fields declared in
 * `extensions/reorder-alert/shopify.extension.toml`, and every field is required.
 */
export function flowPayload(row: AlertRow): Record<string, string | number> | null {
  const productId = numericId(row.productId);
  if (productId === null) {
    return null;
  }
  return {
    product_id: productId,
    Variant: row.variantTitle === "Default Title" ? "" : row.variantTitle,
    SKU: row.sku,
    Available: row.available,
    "Days until stockout": Number.isFinite(row.daysToStockout) ? Math.round(row.daysToStockout * 10) / 10 : 0,
    "Suggested order quantity": row.suggestedOrderQty,
  };
}

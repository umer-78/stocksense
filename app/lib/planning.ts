/**
 * Planning inputs that come from Forelark itself rather than Shopify:
 * supplier lead times (matched to products by their Shopify vendor) and units
 * already ordered on open Forelark purchase orders.
 *
 * Pure helpers so the rules are unit-testable.
 */
import type { VariantInventory } from "./shopify/types";

export interface SupplierLike {
  vendor: string | null;
  leadTimeDays: number | null;
}

export interface OpenPoLine {
  variantId: string;
  qty: number;
  receivedQty: number;
  /** Status of the purchase order the line belongs to. */
  status: string;
}

export interface PlanningInputs {
  /** Supplier lead time in days, keyed by normalized Shopify vendor name. */
  supplierLeadTimes: Map<string, number>;
  /** Units still to arrive on open Forelark purchase orders, per variant. */
  openPoQty: Map<string, number>;
}

export const EMPTY_PLANNING: PlanningInputs = { supplierLeadTimes: new Map(), openPoQty: new Map() };

/** Purchase-order statuses whose unreceived units count as stock on the way. */
export const OPEN_PO_STATUSES: readonly string[] = ["sent", "partial"];

export function vendorKey(vendor: string | null | undefined): string {
  return (vendor ?? "").trim().toLowerCase();
}

/** Lead time per vendor. The first supplier listed for a vendor wins. */
export function supplierLeadTimeMap(suppliers: SupplierLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const supplier of suppliers) {
    const key = vendorKey(supplier.vendor);
    const days = supplier.leadTimeDays;
    if (key && days != null && Number.isFinite(days) && days >= 0 && !map.has(key)) {
      map.set(key, days);
    }
  }
  return map;
}

/** Units ordered but not yet received on sent / partly received purchase orders. */
export function openQtyByVariant(lines: OpenPoLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!OPEN_PO_STATUSES.includes(line.status)) {
      continue;
    }
    const open = Math.max(0, Math.floor(line.qty) - Math.floor(line.receivedQty));
    if (open > 0) {
      map.set(line.variantId, (map.get(line.variantId) ?? 0) + open);
    }
  }
  return map;
}

/**
 * Apply the planning inputs to one variant: Forelark purchase-order units are
 * added to what Shopify reports as incoming, and the supplier lead time for the
 * product's vendor is returned (null when no supplier covers that vendor).
 */
export function withPlanning(
  variant: VariantInventory,
  planning: PlanningInputs,
): { variant: VariantInventory; supplierLeadTime: number | null } {
  const extra = planning.openPoQty.get(variant.variantId) ?? 0;
  const supplierLeadTime = planning.supplierLeadTimes.get(vendorKey(variant.vendor)) ?? null;
  return {
    variant: extra > 0 ? { ...variant, incoming: variant.incoming + extra } : variant,
    supplierLeadTime,
  };
}

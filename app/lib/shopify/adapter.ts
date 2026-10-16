/**
 * Adapter: stored snapshot -> StockSense domain types.
 *
 * Pure functions (no I/O) so they can be unit-tested. Nothing Shopify-shaped
 * leaks past these functions into the forecasting engine.
 */
import type { SalesRecord } from "../forecast";
import type { CatalogVariant, StoredSnapshot, VariantInventory } from "./types";

/** Strip the `gid://shopify/<Type>/` prefix from a Shopify GID. */
export function parseGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\/[^/]+\//, "");
}

/**
 * Inventory of one variant at `locationId`, or summed across all locations
 * when `locationId` is null. Returns null when the variant is not stocked at
 * the requested location.
 */
export function inventoryAt(variant: CatalogVariant, locationId: string | null): VariantInventory | null {
  const levels = locationId ? variant.levels.filter((l) => l.locationId === locationId) : variant.levels;
  if (locationId && levels.length === 0) {
    return null;
  }
  const total = (key: "onHand" | "available" | "committed" | "incoming") =>
    levels.reduce((sum, level) => sum + level[key], 0);
  return {
    variantId: variant.variantId,
    productId: variant.productId,
    productTitle: variant.productTitle,
    variantTitle: variant.variantTitle,
    sku: variant.sku,
    price: variant.price,
    unitCost: variant.unitCost,
    onHand: total("onHand"),
    available: total("available"),
    committed: total("committed"),
    incoming: total("incoming"),
    locationId: locationId ?? null,
    locationName: locationId ? (levels[0]?.locationName ?? null) : "All locations",
    productCreatedAt: variant.productCreatedAt,
  };
}

/** Every variant's inventory at a location (or all locations), skipping variants not stocked there. */
export function inventoryForLocation(snapshot: StoredSnapshot, locationId: string | null): VariantInventory[] {
  const out: VariantInventory[] = [];
  for (const variant of snapshot.variants) {
    const inventory = inventoryAt(variant, locationId);
    if (inventory) {
      out.push(inventory);
    }
  }
  return out;
}

export function salesFor(snapshot: StoredSnapshot, variantId: string): SalesRecord[] {
  return (snapshot.sales[variantId] ?? []).map(([date, quantity]) => ({ date, quantity }));
}

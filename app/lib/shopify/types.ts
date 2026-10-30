/**
 * Adapter-boundary types for the Shopify data layer.
 *
 * These types are the ONLY thing that crosses from Shopify into the rest of
 * the app. The forecasting engine (`app/lib/forecast`) never sees Shopify
 * types — it only receives `SalesRecord[]` and plain numbers.
 */

export interface LocationInfo {
  id: string;
  name: string;
}

/** Stock of one variant at one location. */
export interface InventoryLevelInfo {
  locationId: string;
  locationName: string;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
}

/** A variant as stored in the snapshot, with stock at every location. */
export interface CatalogVariant {
  /** Shopify GID, e.g. `gid://shopify/ProductVariant/123`. */
  variantId: string;
  productId: string;
  productTitle: string;
  /** Product creation timestamp; the earliest the variant could have sold. */
  productCreatedAt: string | null;
  variantTitle: string;
  sku: string;
  price: number | null;
  /** InventoryItem.unitCost when set. */
  unitCost: number | null;
  /** Product vendor (matched to Forelark suppliers). */
  vendor?: string;
  /** InventoryItem GID, used to match inventory webhooks. */
  inventoryItemId?: string | null;
  levels: InventoryLevelInfo[];
}

/** One product variant with its inventory at one location (or summed across all). */
export interface VariantInventory {
  /** Shopify GID, e.g. `gid://shopify/ProductVariant/123`. */
  variantId: string;
  /** Shopify GID of the parent product. */
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  /** Variant price in the shop currency, or null when unknown. */
  price: number | null;
  /** Unit cost (InventoryItem.unitCost) when the merchant grants cost access. */
  unitCost: number | null;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
  /** Null when quantities are summed across all locations. */
  locationId: string | null;
  locationName: string | null;
  productCreatedAt?: string | null;
  /** Product vendor (matched to Forelark suppliers). */
  vendor?: string;
}

/**
 * A complete inventory + sales snapshot, built by the bulk-operation sync and
 * stored gzipped in `ShopSnapshot.data`.
 */
export interface StoredSnapshot {
  /** Format version; snapshots from an older version are re-synced (see SNAPSHOT_VERSION). */
  version: number;
  /** When the sync finished (ISO timestamp). */
  fetchedAt: string;
  /** Sales window: first and last day counted (YYYY-MM-DD). */
  windowStart: string;
  windowEnd: string;
  /** Days of order history fetched (may be capped by order access). */
  lookbackDays: number;
  locations: LocationInfo[];
  variants: CatalogVariant[];
  /** Units sold per variant: [day, quantity] pairs sorted by day. */
  sales: Record<string, Array<[string, number]>>;
}

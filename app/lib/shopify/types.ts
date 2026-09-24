/**
 * Adapter-boundary types for the Shopify data layer.
 *
 * These types are the ONLY thing that crosses from Shopify into the rest of
 * the app. The forecasting engine (`app/lib/forecast`) never sees Shopify
 * types — it only receives `SalesRecord[]` and plain numbers.
 */
import type { SalesRecord } from "../forecast";

export interface LocationInfo {
  id: string;
  name: string;
}

/** One product variant with its inventory at a single location. */
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
  locationId: string | null;
  locationName: string | null;
}

/** A full snapshot of the store's inventory + sales history for forecasting. */
export interface InventorySnapshot {
  variants: VariantInventory[];
  /** Sales history keyed by variant GID. */
  salesHistory: Map<string, SalesRecord[]>;
  locations: LocationInfo[];
  fetchedAt: string;
  lookbackDays: number;
}

// ---------------------------------------------------------------------------
// Raw GraphQL response shapes (the adapter's input). Kept structural so the
// adapter is testable with plain fixture JSON.
// ---------------------------------------------------------------------------

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GraphQLEdge<T> {
  node: T;
}

export interface RawInventoryQuantity {
  name: string;
  quantity: number;
}

export interface RawInventoryLevel {
  id: string;
  quantities: RawInventoryQuantity[];
  location: { id: string; name: string } | null;
}

export interface RawVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string | null;
  product: { id: string; title: string; status: string } | null;
  inventoryItem: {
    id: string;
    unitCost: { amount: string; currencyCode: string } | null;
    inventoryLevels: { edges: GraphQLEdge<RawInventoryLevel>[] };
  } | null;
}

export interface RawVariantsResponse {
  productVariants: {
    edges: GraphQLEdge<RawVariant>[];
    pageInfo: PageInfo;
  };
}

export interface RawOrderLineItem {
  id: string;
  quantity: number;
  variant: { id: string } | null;
}

export interface RawOrder {
  id: string;
  createdAt: string;
  lineItems: { edges: GraphQLEdge<RawOrderLineItem>[] };
}

export interface RawOrdersResponse {
  orders: {
    edges: GraphQLEdge<RawOrder>[];
    pageInfo: PageInfo;
  };
}

export interface RawLocationsResponse {
  locations: {
    edges: GraphQLEdge<{ id: string; name: string }>[];
  };
}
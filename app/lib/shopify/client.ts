/**
 * Shopify Admin API client helpers.
 *
 * All fetches are collection-level with cursor pagination — a store with
 * 5,000 SKUs costs ~20 requests for the full catalog, never one per SKU.
 * Callers are expected to cache snapshots (see `app/lib/cache.ts`).
 */
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { variantsToInventory } from "./adapter";
import { LOCATIONS_QUERY, VARIANTS_QUERY, VARIANT_QUERY } from "./queries";
import { getSalesHistory } from "./sales-history";
import type {
  InventorySnapshot,
  LocationInfo,
  RawVariantsResponse,
  VariantInventory,
} from "./types";

const PAGE_SIZE = 250;
/** Safety valve: 250 pages × 250 variants = 62,500 variants max. */
const MAX_PAGES = 250;

export interface SnapshotOptions {
  lookbackDays: number;
  locationId?: string | null;
}

/** Fetch every variant (with inventory levels) via paginated collection queries. */
export async function fetchAllVariants(
  admin: AdminApiContext,
): Promise<RawVariantsResponse> {
  const allEdges: RawVariantsResponse["productVariants"]["edges"] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_PAGES) {
    const response = await admin.graphql(VARIANTS_QUERY, {
      variables: { first: PAGE_SIZE, after: cursor },
    });
    const json = (await response.json()) as { data?: RawVariantsResponse };
    const variants = json.data?.productVariants;
    if (!variants) {
      break;
    }
    allEdges.push(...variants.edges);
    hasNextPage = variants.pageInfo.hasNextPage;
    cursor = variants.pageInfo.endCursor;
    pages += 1;
  }

  return {
    productVariants: {
      edges: allEdges,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

/** Fetch a single variant by GID (detail page). */
export async function fetchVariant(
  admin: AdminApiContext,
  variantId: string,
): Promise<VariantInventory | null> {
  const response = await admin.graphql(VARIANT_QUERY, {
    variables: { id: variantId },
  });
  const json = (await response.json()) as {
    data?: { variant?: RawVariantsResponse["productVariants"]["edges"][number]["node"] };
  };
  const node = json.data?.variant;
  if (!node) {
    return null;
  }
  const converted = variantsToInventory({
    productVariants: { edges: [{ node }], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  return converted[0] ?? null;
}

export async function fetchLocations(admin: AdminApiContext): Promise<LocationInfo[]> {
  const response = await admin.graphql(LOCATIONS_QUERY);
  const json = (await response.json()) as {
    data?: { locations?: { edges: Array<{ node: { id: string; name: string } }> } };
  };
  return (json.data?.locations?.edges ?? []).map((e) => e.node);
}

/**
 * Build a full inventory + sales-history snapshot for a shop.
 *
 * This is the expensive call (paginated catalog + paginated orders); cache it
 * per shop with a short TTL in the routes.
 */
export async function getInventorySnapshot(
  admin: AdminApiContext,
  options: SnapshotOptions,
): Promise<InventorySnapshot> {
  const [variantsResponse, locations, salesHistory] = await Promise.all([
    fetchAllVariants(admin),
    fetchLocations(admin),
    getSalesHistory(admin, { lookbackDays: options.lookbackDays }),
  ]);

  return {
    variants: variantsToInventory(variantsResponse, options.locationId ?? undefined),
    salesHistory,
    locations,
    fetchedAt: new Date().toISOString(),
    lookbackDays: options.lookbackDays,
  };
}

/** Targeted fetch for the variant detail page (one variant + its product's orders). */
export async function getVariantDetail(
  admin: AdminApiContext,
  variantId: string,
  options: SnapshotOptions,
): Promise<{ variant: VariantInventory; salesHistory: InventorySnapshot["salesHistory"] } | null> {
  const variant = await fetchVariant(admin, variantId);
  if (!variant) {
    return null;
  }
  const salesHistory = await getSalesHistory(admin, {
    lookbackDays: options.lookbackDays,
    productId: variant.productId,
  });
  return { variant, salesHistory };
}
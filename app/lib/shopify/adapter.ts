/**
 * Adapter: raw Shopify GraphQL responses -> StockSense domain types.
 *
 * Pure functions (no I/O) so they can be unit-tested with fixture JSON. This
 * is the clean boundary: nothing Shopify-shaped leaks past these functions
 * into the forecasting engine.
 */
import type { SalesRecord } from "../forecast";
import type {
  RawInventoryLevel,
  RawOrdersResponse,
  RawVariantsResponse,
  VariantInventory,
} from "./types";

/** Strip the `gid://shopify/<Type>/` prefix from a Shopify GID. */
export function parseGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\/[^/]+\//, "");
}

const QUANTITY_NAMES = ["available", "committed", "incoming", "on_hand"] as const;
type QuantityName = (typeof QUANTITY_NAMES)[number];

function quantityFor(level: RawInventoryLevel | undefined, name: QuantityName): number {
  if (!level) {
    return 0;
  }
  const match = level.quantities?.find((q) => q.name === name);
  const value = Number(match?.quantity);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Convert a `productVariants` response into `VariantInventory[]`.
 *
 * When `locationId` is given, only that location's inventory level is used;
 * otherwise the first location returned for each variant is used (the API
 * returns levels in location order).
 */
export function variantsToInventory(
  data: RawVariantsResponse,
  locationId?: string,
): VariantInventory[] {
  const out: VariantInventory[] = [];
  for (const { node: variant } of data.productVariants.edges) {
    const levels = variant.inventoryItem?.inventoryLevels?.edges ?? [];
    const level =
      levels.find((l) => l.node.location?.id === locationId)?.node ?? levels[0]?.node;

    const price = variant.price != null ? Number(variant.price) : null;
    const unitCost = variant.inventoryItem?.unitCost?.amount
      ? Number(variant.inventoryItem.unitCost.amount)
      : null;

    out.push({
      variantId: variant.id,
      productId: variant.product?.id ?? "",
      productTitle: variant.product?.title ?? "",
      variantTitle: variant.title,
      sku: variant.sku ?? "",
      price: Number.isFinite(price as number) ? price : null,
      unitCost: Number.isFinite(unitCost as number) ? unitCost : null,
      onHand: quantityFor(level, "on_hand"),
      available: quantityFor(level, "available"),
      committed: quantityFor(level, "committed"),
      incoming: quantityFor(level, "incoming"),
      locationId: level?.location?.id ?? null,
      locationName: level?.location?.name ?? null,
    });
  }
  return out;
}

/**
 * Convert an `orders` response into per-variant `SalesRecord[]`.
 *
 * Each line item becomes one dated record; the forecast engine aggregates
 * duplicate dates itself. Line items without a variant (e.g. custom items)
 * are skipped.
 */
export function ordersToSalesRecords(
  data: RawOrdersResponse,
): Map<string, SalesRecord[]> {
  const byVariant = new Map<string, SalesRecord[]>();
  for (const { node: order } of data.orders.edges) {
    const date = order.createdAt.slice(0, 10);
    for (const { node: line } of order.lineItems.edges) {
      if (!line.variant) {
        continue;
      }
      const records = byVariant.get(line.variant.id) ?? [];
      records.push({ date, quantity: line.quantity });
      byVariant.set(line.variant.id, records);
    }
  }
  return byVariant;
}
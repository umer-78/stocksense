/**
 * Shopify bulk operations: catalog and order exports without query-cost limits.
 *
 * A regular GraphQL query may cost at most 1,000 points. Asking for 250
 * variants with their inventory levels, or 250 orders with their line items,
 * costs many times that, so paginated queries cannot read a real catalog.
 * Bulk operations run the same query server-side with no cost limit and
 * produce a JSONL file (one object per line; nested connection items carry a
 * `__parentId`). This module holds the queries, the streaming downloader, and
 * pure parsers that turn JSONL objects into StockSense types.
 */
import type { CatalogVariant, InventoryLevelInfo } from "./types";

/** Minimal Admin API client surface (the Remix `admin` object satisfies it). */
export interface GraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown>; tries?: number }) => Promise<Response>;
}

export const VARIANTS_BULK_QUERY = `{
  productVariants {
    edges {
      node {
        id
        title
        sku
        price
        product { id title status createdAt isGiftCard }
        inventoryItem {
          id
          tracked
          unitCost { amount }
          inventoryLevels {
            edges {
              node {
                location { id name }
                quantities(names: ["available", "committed", "incoming", "on_hand"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Orders processed on or after `sinceDay` (YYYY-MM-DD), with their line items.
 * `processedAt` is when the sale happened; `createdAt` is when the record was
 * made, which for orders imported from another system is the import date.
 */
export function ordersBulkQuery(sinceDay: string): string {
  return `{
  orders(query: "processed_at:>=${sinceDay}") {
    edges {
      node {
        id
        processedAt
        createdAt
        cancelledAt
        test
        lineItems {
          edges {
            node {
              quantity
              currentQuantity
              variant { id }
            }
          }
        }
      }
    }
  }
}`;
}

const RUN_BULK_MUTATION = `#graphql
  mutation RunBulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

const BULK_STATUS_QUERY = `#graphql
  query BulkOperationStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode objectCount url partialDataUrl }
    }
  }`;

export type BulkStatus = "CREATED" | "RUNNING" | "COMPLETED" | "CANCELING" | "CANCELED" | "FAILED" | "EXPIRED";

export interface BulkOperationInfo {
  id: string;
  status: BulkStatus;
  errorCode: string | null;
  objectCount: number;
  /** Result file; null when the export matched no objects. */
  url: string | null;
}

export class BulkOperationBusyError extends Error {}

export async function startBulkQuery(client: GraphqlClient, query: string): Promise<string> {
  const response = await client.graphql(RUN_BULK_MUTATION, { variables: { query }, tries: 3 });
  const json = (await response.json()) as {
    data?: {
      bulkOperationRunQuery?: {
        bulkOperation: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    };
  };
  const result = json.data?.bulkOperationRunQuery;
  const message = result?.userErrors?.map((e) => e.message).join("; ") ?? "";
  if (!result?.bulkOperation) {
    if (/already in progress/i.test(message)) {
      throw new BulkOperationBusyError(message);
    }
    throw new Error(message || "Shopify did not start the export");
  }
  return result.bulkOperation.id;
}

export async function getBulkOperation(client: GraphqlClient, id: string): Promise<BulkOperationInfo | null> {
  const response = await client.graphql(BULK_STATUS_QUERY, { variables: { id }, tries: 3 });
  const json = (await response.json()) as {
    data?: {
      node?: {
        id: string;
        status: BulkStatus;
        errorCode: string | null;
        objectCount: string | number;
        url: string | null;
        partialDataUrl: string | null;
      } | null;
    };
  };
  const node = json.data?.node;
  if (!node?.status) {
    return null;
  }
  return {
    id: node.id,
    status: node.status,
    errorCode: node.errorCode,
    objectCount: Number(node.objectCount) || 0,
    url: node.url,
  };
}

/** Stream a JSONL file line by line without loading it into memory. */
export async function* jsonlObjects(
  url: string,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<Record<string, unknown>> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the Shopify export (HTTP ${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        yield JSON.parse(line) as Record<string, unknown>;
      }
      newline = buffer.indexOf("\n");
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) {
    yield JSON.parse(rest) as Record<string, unknown>;
  }
}

// ---------------------------------------------------------------------------
// Pure JSONL parsers
// ---------------------------------------------------------------------------

type Lines = Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>;

interface RawBulkVariant {
  id: string;
  title?: string;
  sku?: string | null;
  price?: string | null;
  product?: { id?: string; title?: string; status?: string; createdAt?: string; isGiftCard?: boolean } | null;
  inventoryItem?: { id?: string; tracked?: boolean; unitCost?: { amount?: string } | null } | null;
}

interface RawBulkLevel {
  __parentId: string;
  location?: { id?: string; name?: string } | null;
  quantities?: Array<{ name: string; quantity: number }>;
}

function quantity(level: RawBulkLevel, name: string): number {
  const value = Number(level.quantities?.find((q) => q.name === name)?.quantity);
  return Number.isFinite(value) ? value : 0;
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the catalog from the variants export. Only variants of ACTIVE products
 * with tracked inventory are kept: drafts and archived products are not on
 * sale, untracked items have no stock to forecast, and gift cards are digital.
 */
export async function parseVariantsJsonl(lines: Lines): Promise<CatalogVariant[]> {
  const variants = new Map<string, CatalogVariant>();
  const byInventoryItem = new Map<string, string>();
  const orphanLevels: RawBulkLevel[] = [];

  const addLevel = (variantId: string, level: RawBulkLevel) => {
    const variant = variants.get(variantId);
    if (!variant || !level.location?.id) {
      return;
    }
    const info: InventoryLevelInfo = {
      locationId: level.location.id,
      locationName: level.location.name ?? "",
      onHand: quantity(level, "on_hand"),
      available: quantity(level, "available"),
      committed: quantity(level, "committed"),
      incoming: quantity(level, "incoming"),
    };
    variant.levels.push(info);
  };

  for await (const line of lines) {
    if (typeof line.__parentId === "string") {
      const level = line as unknown as RawBulkLevel;
      const owner = variants.has(level.__parentId) ? level.__parentId : byInventoryItem.get(level.__parentId);
      if (owner) {
        addLevel(owner, level);
      } else {
        orphanLevels.push(level);
      }
      continue;
    }
    const raw = line as unknown as RawBulkVariant;
    if (typeof raw.id !== "string" || !raw.id.includes("/ProductVariant/")) {
      continue;
    }
    if (raw.product?.status && raw.product.status !== "ACTIVE") {
      continue;
    }
    if (raw.inventoryItem?.tracked === false || raw.product?.isGiftCard === true) {
      continue;
    }
    variants.set(raw.id, {
      variantId: raw.id,
      productId: raw.product?.id ?? "",
      productTitle: raw.product?.title ?? "",
      productCreatedAt: raw.product?.createdAt ?? null,
      variantTitle: raw.title ?? "",
      sku: raw.sku ?? "",
      price: toNumber(raw.price),
      unitCost: toNumber(raw.inventoryItem?.unitCost?.amount),
      levels: [],
    });
    if (raw.inventoryItem?.id) {
      byInventoryItem.set(raw.inventoryItem.id, raw.id);
    }
  }

  for (const level of orphanLevels) {
    const owner = variants.has(level.__parentId) ? level.__parentId : byInventoryItem.get(level.__parentId);
    if (owner) {
      addLevel(owner, level);
    }
  }
  return [...variants.values()];
}

interface RawBulkOrder {
  id: string;
  processedAt?: string | null;
  createdAt?: string;
  cancelledAt?: string | null;
  test?: boolean;
}

interface RawBulkLineItem {
  __parentId: string;
  quantity?: number;
  currentQuantity?: number | null;
  variant?: { id?: string } | null;
}

export interface SalesWindow {
  /** First day counted, YYYY-MM-DD. */
  start: string;
  /** Last day counted, YYYY-MM-DD (yesterday, so a partial day is never counted). */
  end: string;
}

/**
 * Aggregate the orders export into units sold per variant per day.
 *
 * Skips cancelled orders and (unless `includeTest`) test orders, uses the
 * line's current quantity (after refunds and removals), ignores custom items
 * without a variant, and keeps only days inside `window`. A sale is dated by
 * `processedAt` (falling back to `createdAt`). Days are UTC calendar days.
 */
export async function parseOrdersJsonl(
  lines: Lines,
  window: SalesWindow,
  options: { includeTest?: boolean } = {},
): Promise<Record<string, Array<[string, number]>>> {
  const orderDays = new Map<string, string | null>();
  const pending: Array<[string, string, number]> = [];
  const totals = new Map<string, Map<string, number>>();

  const add = (variantId: string, day: string, qty: number) => {
    if (qty <= 0 || day < window.start || day > window.end) {
      return;
    }
    const days = totals.get(variantId) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + qty);
    totals.set(variantId, days);
  };

  for await (const line of lines) {
    if (typeof line.__parentId === "string") {
      const item = line as unknown as RawBulkLineItem;
      const variantId = item.variant?.id;
      if (!variantId) {
        continue;
      }
      const qty = Number(item.currentQuantity ?? item.quantity ?? 0);
      if (!Number.isFinite(qty)) {
        continue;
      }
      const day = orderDays.get(item.__parentId);
      if (day === undefined) {
        pending.push([item.__parentId, variantId, qty]);
      } else if (day !== null) {
        add(variantId, day, qty);
      }
      continue;
    }
    const order = line as unknown as RawBulkOrder;
    if (typeof order.id !== "string" || !order.id.includes("/Order/")) {
      continue;
    }
    const placedAt = order.processedAt || order.createdAt;
    const skip = Boolean(order.cancelledAt) || (order.test === true && !options.includeTest) || !placedAt;
    orderDays.set(order.id, skip ? null : String(placedAt).slice(0, 10));
  }

  for (const [orderId, variantId, qty] of pending) {
    const day = orderDays.get(orderId);
    if (day) {
      add(variantId, day, qty);
    }
  }

  const out: Record<string, Array<[string, number]>> = {};
  for (const [variantId, days] of totals) {
    out[variantId] = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  return out;
}

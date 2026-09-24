/**
 * Sales-history abstraction for velocity computation.
 *
 * Implementation: the standard `orders` Admin query with an explicit
 * `created_at:>=` filter and cursor pagination.
 *
 * LIMITATION (documented): Shopify's `orders` query only returns orders from
 * the last 60 days when NO filter is supplied. We always pass an explicit
 * `created_at` filter so the configured lookback is honored, but the Admin API
 * may still cap how far back order data is available for very old stores.
 *
 * TODO(shopifyql): Replace this orders-based implementation with a ShopifyQL
 * query (`orders.sales` / `inventory_levels` tables) once ShopifyQL is
 * accessible from standard embedded app sessions. ShopifyQL would let us
 * compute per-variant sales server-side in a single request instead of
 * paginating every order in the window.
 */
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { SalesRecord } from "../forecast";
import { ordersToSalesRecords } from "./adapter";
import { ORDERS_QUERY } from "./queries";
import type { RawOrdersResponse } from "./types";

const PAGE_SIZE = 250;
/** Safety valve: never loop more than this many pages (250 × 250 = 62,500 orders). */
const MAX_PAGES = 250;

export interface SalesHistoryOptions {
  lookbackDays: number;
  /** When set, only orders containing this product are fetched (detail page). */
  productId?: string;
}

function startDateFor(lookbackDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - lookbackDays);
  return date.toISOString().slice(0, 10);
}

export async function getSalesHistory(
  admin: AdminApiContext,
  options: SalesHistoryOptions,
): Promise<Map<string, SalesRecord[]>> {
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays || 60));
  const createdAfter = startDateFor(lookbackDays);
  const query = options.productId
    ? `created_at:>='${createdAfter}' AND line_item.product_id:${options.productId.replace(/^gid:\/\/shopify\/Product\//, "")}`
    : `created_at:>='${createdAfter}'`;

  const allOrders: RawOrdersResponse["orders"]["edges"] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_PAGES) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: PAGE_SIZE, after: cursor, query },
    });
    const json = (await response.json()) as { data?: RawOrdersResponse };
    const orders = json.data?.orders;
    if (!orders) {
      break;
    }
    allOrders.push(...orders.edges);
    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;
    pages += 1;
  }

  return ordersToSalesRecords({ orders: { edges: allOrders, pageInfo: { hasNextPage: false, endCursor: null } } });
}
/**
 * Admin GraphQL queries for the StockSense data layer.
 *
 * API version: the app pins `ApiVersion.January25` (2025-01, stable) in
 * `app/shopify.server.ts`; these queries are written against that version.
 *
 * Performance notes:
 * - `productVariants` is a root-level collection query, so a store with 5,000
 *   SKUs costs ~20 paginated requests (250/page), never one request per SKU.
 * - Inventory levels are fetched per variant via `inventoryItem.inventoryLevels`
 *   (bounded to 10 locations per variant).
 */

export const VARIANTS_QUERY = `#graphql
  query VariantsWithInventory($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          sku
          price
          product {
            id
            title
            status
          }
          inventoryItem {
            id
            unitCost {
              amount
              currencyCode
            }
            inventoryLevels(first: 10) {
              edges {
                node {
                  id
                  quantities(names: ["available", "committed", "incoming", "on_hand"]) {
                    name
                    quantity
                  }
                  location {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

export const VARIANT_QUERY = `#graphql
  query VariantById($id: ID!) {
    variant(id: $id) {
      id
      title
      sku
      price
      product {
        id
        title
        status
      }
      inventoryItem {
        id
        unitCost {
          amount
          currencyCode
        }
        inventoryLevels(first: 10) {
          edges {
            node {
              id
              quantities(names: ["available", "committed", "incoming", "on_hand"]) {
                name
                quantity
              }
              location {
                id
                name
              }
            }
          }
        }
      }
    }
  }`;

/**
 * Orders within a lookback window.
 *
 * `query` is always supplied with an explicit `created_at:>=` filter so the
 * configured lookback is honored (see `app/lib/shopify/sales-history.ts` for
 * the 60-day default-window limitation).
 */
export const ORDERS_QUERY = `#graphql
  query OrdersInWindow($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                id
                quantity
                variant {
                  id
                }
              }
            }
          }
        }
      }
    }
  }`;

export const LOCATIONS_QUERY = `#graphql
  query Locations {
    locations(first: 100) {
      edges {
        node {
          id
          name
        }
      }
    }
  }`;
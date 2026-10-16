/**
 * Regular (non-bulk) Admin GraphQL queries. Each must stay under Shopify's
 * 1,000-point single-query cost limit; anything catalog- or order-sized is a
 * bulk operation instead (see `bulk.ts`).
 */

/**
 * Active locations, including fulfillment-service ("legacy") locations such
 * as a 3PL warehouse, which Shopify leaves out unless asked.
 * 250 × 1 point + connection ≈ 252 points.
 */
export const LOCATIONS_QUERY = `#graphql
  query Locations {
    locations(first: 250, includeLegacy: true) {
      edges {
        node {
          id
          name
        }
      }
    }
  }`;

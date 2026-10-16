/**
 * Regular (non-bulk) Admin GraphQL queries. Each must stay under Shopify's
 * 1,000-point single-query cost limit; anything catalog- or order-sized is a
 * bulk operation instead (see `bulk.ts`).
 */

/** Active locations; 250 × 1 point + connection ≈ 252 points. */
export const LOCATIONS_QUERY = `#graphql
  query Locations {
    locations(first: 250) {
      edges {
        node {
          id
          name
        }
      }
    }
  }`;

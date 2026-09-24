/**
 * Environment helpers.
 *
 * The Shopify Remix template constructs `shopifyApp()` at module load time and
 * throws when `SHOPIFY_APP_URL` is missing, so routes must check for
 * credentials BEFORE importing `../shopify.server`. All StockSense routes use
 * the lazy helpers in `./auth.ts` instead of importing `shopify.server`
 * directly.
 */

export function hasShopifyCredentials(): boolean {
  return Boolean(
    process.env.SHOPIFY_API_KEY &&
      process.env.SHOPIFY_API_SECRET &&
      process.env.SHOPIFY_APP_URL,
  );
}

/** Human-readable hint shown when credentials are missing. */
export const MISSING_CREDENTIALS_HINT =
  "Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL and SCOPES in your .env file (see .env.example), then restart the dev server.";
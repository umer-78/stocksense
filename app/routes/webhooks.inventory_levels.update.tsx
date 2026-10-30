import type { ActionFunctionArgs } from "@remix-run/node";

import { handleInventoryLevelUpdate } from "../lib/alerts.server";

/**
 * inventory_levels/update: re-check that variant's forecast and raise a
 * low-stock alert (and the Flow trigger) when it becomes "Reorder now".
 * Always answers 200 so Shopify does not retry a failed check forever.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Lazy import: shopifyApp() throws at module load when SHOPIFY_APP_URL is missing.
  const { authenticate } = await import("../shopify.server");
  const { shop, payload } = await authenticate.webhook(request);
  try {
    await handleInventoryLevelUpdate(shop, payload as Record<string, unknown>);
  } catch (error) {
    console.error("[forelark] inventory alert check failed", error);
  }
  return new Response();
};

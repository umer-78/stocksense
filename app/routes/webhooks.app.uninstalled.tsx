import type { ActionFunctionArgs } from "@remix-run/node";

import { deleteShopData } from "../lib/shop-data.server";

/**
 * app/uninstalled: delete the shop's sessions, settings, overrides, snapshot
 * and Stocky imports. The privacy-event log is kept until shop/redact, which
 * Shopify sends 48 hours later and which wipes everything.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Lazy import: shopifyApp() throws at module load when SHOPIFY_APP_URL is
  // missing, and the server bundle executes every route module at boot.
  const { authenticate } = await import("../shopify.server");
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can be delivered more than once; deleting is idempotent.
  await deleteShopData(shop, { keepPrivacyLog: true });

  return new Response();
};

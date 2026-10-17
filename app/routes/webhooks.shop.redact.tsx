import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateWebhook } from "../lib/auth";
import db from "../db.server";
import { deleteShopData } from "../lib/shop-data.server";

/**
 * GDPR compliance webhook: shop/redact.
 *
 * Shopify asks the app to delete all data for the shop. Forelark deletes the
 * shop's settings, per-product overrides, inventory snapshot, Stocky imports,
 * privacy-event log and auth sessions (which hold PII such as the shop
 * owner's email and access tokens), then acknowledges with 200.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, missingCredentials } = await authenticateWebhook(request);

  if (missingCredentials) {
    return json({});
  }

  console.log(`[stocksense] ${topic} webhook for ${shop}`);

  await db.privacyEvent.create({
    data: {
      shop,
      topic,
      payload: JSON.stringify(payload ?? {}),
    },
  });

  await deleteShopData(shop);

  return json({});
};
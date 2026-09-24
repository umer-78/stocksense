import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateWebhook } from "../lib/auth";
import db from "../db.server";

/**
 * GDPR compliance webhook: shop/redact.
 *
 * Shopify asks the app to delete all data for the shop. StockSense deletes the
 * shop's settings, Stocky imports, privacy-event log and auth sessions (which
 * hold PII such as the shop owner's email and access tokens), then
 * acknowledges with 200.
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

  await db.$transaction([
    db.shopSettings.deleteMany({ where: { shop } }),
    db.stockyImport.deleteMany({ where: { shop } }),
    db.privacyEvent.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  return json({});
};
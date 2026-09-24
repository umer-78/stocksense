import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateWebhook } from "../lib/auth";
import db from "../db.server";

/**
 * GDPR compliance webhook: customers/redact.
 *
 * Shopify asks the app to delete all data for the given customer. StockSense
 * stores no customer data, so we log the request and acknowledge with 200.
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

  // No customer-scoped data is stored by StockSense, so there is nothing to
  // delete beyond the log entry above.
  return json({});
};
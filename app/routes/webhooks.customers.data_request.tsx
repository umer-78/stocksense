import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateWebhook } from "../lib/auth";
import db from "../db.server";

/**
 * GDPR compliance webhook: customers/data_request.
 *
 * Shopify expects the app to respond with the customer's data as JSON at the
 * ROOT of the response body (not wrapped in a `data` key) and a 200 status.
 * The payload's `customer` object carries the identifying fields (id, email,
 * phone); the `orders` array should hold the order data the app stores for
 * that customer. StockSense stores no customer or order data, so we echo the
 * identifying fields Shopify sent us plus an empty orders array, and log the
 * request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, missingCredentials } = await authenticateWebhook(request);

  if (missingCredentials) {
    return json({ customer: null, orders: [] });
  }

  console.log(`[stocksense] ${topic} webhook for ${shop}`);

  await db.privacyEvent.create({
    data: {
      shop,
      topic,
      payload: JSON.stringify(payload ?? {}),
    },
  });

  const customer = (payload?.customer as Record<string, unknown> | undefined) ?? null;

  return json({
    customer,
    // StockSense does not store order data beyond what Shopify already has.
    orders: [],
  });
};
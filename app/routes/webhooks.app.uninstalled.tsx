import type { ActionFunctionArgs } from "@remix-run/node";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Lazy import: shopifyApp() throws at module load when SHOPIFY_APP_URL is
  // missing, and the server bundle executes every route module at boot.
  const { authenticate } = await import("../shopify.server");
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
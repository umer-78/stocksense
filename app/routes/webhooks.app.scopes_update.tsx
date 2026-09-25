import type { ActionFunctionArgs } from "@remix-run/node";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Lazy import: shopifyApp() throws at module load when SHOPIFY_APP_URL is
  // missing, and the server bundle executes every route module at boot.
  const { authenticate } = await import("../shopify.server");
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }
  return new Response();
};
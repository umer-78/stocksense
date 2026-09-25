import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Lazy import: shopifyApp() throws at module load when SHOPIFY_APP_URL is
  // missing, and the server bundle executes every route module at boot.
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  return null;
};
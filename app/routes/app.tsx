import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { MissingCredentials } from "../components/MissingCredentials";
import { hasShopifyCredentials } from "../lib/env";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Guard BEFORE importing ../shopify.server: shopifyApp() throws at module
  // load when SHOPIFY_APP_URL is missing.
  if (!hasShopifyCredentials()) {
    return { apiKey: "", missingCredentials: true };
  }
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "", missingCredentials: false };
};

export default function App() {
  const { apiKey, missingCredentials } = useLoaderData<typeof loader>();

  if (missingCredentials) {
    return <MissingCredentials />;
  }

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/purchase-orders">Purchase orders</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/import">Import Stocky</Link>
        <Link to="/app/billing">Billing</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
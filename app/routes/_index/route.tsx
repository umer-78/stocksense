import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { MARKETING_SITE_URL } from "../../lib/config";
import { hasShopifyCredentials } from "../../lib/env";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Local setup without credentials: explain what is missing.
  if (!hasShopifyCredentials()) {
    return { missingCredentials: true };
  }

  // Merchants open Forelark from the Shopify admin (with ?shop=). Anyone else
  // goes to the marketing site; no shop-domain login form (requirement 2.3.1).
  throw redirect(MARKETING_SITE_URL);
};

export default function App() {
  const { missingCredentials } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Forelark — inventory forecasting for Shopify</h1>
        <p className={styles.text}>
          Sales velocity, days-to-stockout and reorder suggestions for every
          variant, with plain-English explanations behind every number.
        </p>
        {missingCredentials && (
          <p className={styles.text}>
            Shopify credentials are not configured. Set SHOPIFY_API_KEY,
            SHOPIFY_API_SECRET, SHOPIFY_APP_URL and SCOPES in your .env file
            (see .env.example), then restart the dev server.
          </p>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Explainable forecasts</strong>. Every recommendation comes
            with the numbers behind it: velocity, lead-time demand, safety
            stock and target coverage.
          </li>
          <li>
            <strong>Urgency dashboard</strong>. Variants sorted by stockout
            risk, with filters for location, status and search.
          </li>
          <li>
            <strong>Purchase order builder</strong>. Turn suggestions into a
            CSV purchase order in one click.
          </li>
        </ul>
      </div>
    </div>
  );
}
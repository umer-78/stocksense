import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { hasShopifyCredentials } from "../../lib/env";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Guard BEFORE importing ../../shopify.server: shopifyApp() throws at module
  // load when SHOPIFY_APP_URL is missing.
  if (!hasShopifyCredentials()) {
    return { showForm: false, missingCredentials: true };
  }
  const { login } = await import("../../shopify.server");

  return { showForm: Boolean(login), missingCredentials: false };
};

export default function App() {
  const { showForm, missingCredentials } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StockSense — inventory forecasting for Shopify</h1>
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
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
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
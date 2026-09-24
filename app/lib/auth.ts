/**
 * Lazy Shopify authentication helpers.
 *
 * `shopify.server.ts` calls `shopifyApp()` at module load and throws when the
 * required environment variables are missing. These helpers only import it
 * when credentials exist, so every route can degrade to a friendly
 * "credentials missing" state instead of crashing.
 */
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Session } from "@shopify/shopify-api";
import { hasShopifyCredentials } from "./env";

export interface AdminAuthResult {
  missingCredentials: boolean;
  admin: AdminApiContext | null;
  session: Session | null;
  /** Billing context (present when credentials exist). */
  billing: {
    check: (options?: {
      plans?: Array<"Growth" | "Pro">;
      isTest?: boolean;
    }) => Promise<{
      hasActivePayment: boolean;
      appSubscriptions: Array<{ id: string; name: string; status: string }>;
      oneTimePurchases: unknown[];
    }>;
    request: (options: {
      plan: "Growth" | "Pro";
      isTest?: boolean;
      returnUrl?: string;
    }) => Promise<never>;
  } | null;
}

/**
 * Authenticate an admin request, returning a null context (instead of
 * throwing) when Shopify credentials are not configured.
 */
export async function authenticateAdmin(
  request: Request,
): Promise<AdminAuthResult> {
  if (!hasShopifyCredentials()) {
    return { missingCredentials: true, admin: null, session: null, billing: null };
  }
  const { authenticate } = await import("../shopify.server");
  const context = await authenticate.admin(request);
  return {
    missingCredentials: false,
    admin: context.admin,
    session: context.session,
    billing: context.billing,
  };
}

export interface WebhookAuthResult {
  missingCredentials: boolean;
  payload: Record<string, unknown> | null;
  shop: string;
  topic: string;
}

/**
 * Authenticate a webhook request. When credentials are missing there is no
 * secret to verify against, so we log and return a 200-shaped result rather
 * than crash (dev-only situation; production always has credentials).
 */
export async function authenticateWebhook(
  request: Request,
): Promise<WebhookAuthResult> {
  if (!hasShopifyCredentials()) {
    console.warn(
      "[stocksense] Received webhook but Shopify credentials are not configured; skipping verification.",
    );
    return { missingCredentials: true, payload: null, shop: "", topic: "" };
  }
  const { authenticate } = await import("../shopify.server");
  const context = await authenticate.webhook(request);
  return {
    missingCredentials: false,
    payload: context.payload as Record<string, unknown>,
    shop: context.shop,
    topic: context.topic,
  };
}
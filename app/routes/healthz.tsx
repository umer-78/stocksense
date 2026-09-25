import { json } from "@remix-run/node";

/**
 * Health check endpoint for hosting platforms (Render healthCheckPath,
 * Fly.io / Fly health checks). Deliberately unauthenticated and dependency
 * free — it must answer even when Shopify credentials are not configured.
 */
export const loader = () => json({ ok: true, service: "stocksense" });
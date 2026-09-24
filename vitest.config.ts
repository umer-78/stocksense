import { defineConfig } from "vitest/config";

// Standalone Vitest config: deliberately does NOT load vite.config.ts so the
// Remix plugin stays out of the unit-test pipeline. The forecasting engine and
// the pure lib modules (Shopify adapter, billing plans, Stocky parser,
// dashboard logic) run in a plain Node environment, as do the route-level
// tests (GDPR webhooks, import action limits) with their auth/db modules
// mocked.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
import { defineConfig } from "vitest/config";

// Standalone Vitest config: deliberately does NOT load vite.config.ts so the
// Remix plugin stays out of the unit-test pipeline. The forecasting engine and
// the pure lib modules (Shopify adapter, billing plans, Stocky parser,
// dashboard logic) run in a plain Node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/lib/**/*.test.ts"],
  },
});
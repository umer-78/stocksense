import { defineConfig } from "vitest/config";

// Standalone Vitest config: deliberately does NOT load vite.config.ts so the
// Remix plugin stays out of the unit-test pipeline. The forecasting engine is
// pure TypeScript and runs in a plain Node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/lib/forecast/**/*.test.ts"],
  },
});
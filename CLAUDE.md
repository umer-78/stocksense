# StockSense — notes for Claude

Shopify embedded app (Remix 2 + Polaris 12 + Prisma/Postgres) that forecasts
inventory: sales velocity, days to stockout, reorder point and suggested order
quantity per variant, with a sentence explaining every number.

## Commands

```shell
npm test            # vitest
npm run typecheck   # tsc --noEmit (run `npx prisma generate` first on a fresh clone)
npm run lint        # eslint
npm run build       # remix vite:build
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `prisma generate`, typecheck and
tests on Node 22 and 24. Run the same before pushing.

## Layout

- `app/lib/forecast/` — pure forecast engine, no Shopify types. The formulas in
  `reorder.ts` are the source of truth; the marketing site and calculator
  (`docs/`) must match them.
- `app/lib/billing/plans.ts` — plans and server-side limits (Free 100 variants,
  Growth $19 / 2,000, Pro $49 / unlimited, 14-day trial).
- `app/lib/shopify/` — Admin GraphQL queries and the adapter to domain types.
- `app/lib/stocky/parser.ts` — Stocky CSV import.
- `app/routes/webhooks.*` — GDPR and app lifecycle webhooks.
- `docs/` — static marketing site on GitHub Pages (no build step). Absolute
  URLs use `https://umer-78.github.io/stocksense/`; keep `docs/sitemap.xml`
  in sync when adding a page.

## Rules

- The app is read-only on Shopify data (scopes: `read_inventory`,
  `read_products`, `read_orders`, `read_locations`). Do not add write scopes.
- Store no customer data.
- Do not bump React past 18 or Prisma past 6: Polaris 12 and the Shopify
  Prisma session storage pin them.
- Marketing copy must not claim features the code does not have.

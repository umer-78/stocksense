# StockSense

Inventory forecasting for Shopify — a "Stocky replacement" for merchants who
need to know what to reorder and when, with the math shown for every number.

Stocky, Shopify's native inventory app, shut down on August 31, 2026. StockSense
fills part of that gap: it reads a store's real sales history from the Shopify
Admin API, computes sales velocity per variant, projects days-to-stockout, and
suggests reorder quantities — and explains every recommendation in plain
English.

## Features

- **Explainable forecasts.** Every recommendation comes with the numbers behind
  it: average daily sales, lead-time demand, safety stock, reorder point,
  target level and suggested order quantity (`app/lib/forecast/forecast.ts`).
  No black-box predictions — seasonality is simple day-of-week index math.
- **Urgency dashboard.** Every variant ranked by stockout risk (critical / low /
  ok), with filters for location, status and SKU/product search.
- **Live recompute.** Edit supplier lead time, safety stock % or target
  coverage days on the variant page and the forecast updates instantly.
- **Purchase order builder.** Variants that need reordering, adjustable
  quantities, and CSV export (download or copy). CSV only — no automatic PO
  emailing.
- **Stocky CSV import.** Best-effort parser for Stocky's two export files
  (`Stocky - Variants.csv` and `Stocky - Purchase Orders.csv`), with a preview
  before confirming. Imported data is stored as reference history; suppliers
  are not carried over.
- **Per-location forecasting.** Choose the inventory location to forecast
  against in Settings (one location at a time).
- **Plans and billing.** Free (100 SKUs) / Growth $19/mo (2,000 SKUs) / Pro
  $49/mo (unlimited), billed through Shopify's Billing API with 14-day trials
  on paid plans. Plan limits are enforced server-side
  (`app/lib/billing/plans.ts`).
- **GDPR compliance.** All three mandated webhooks implemented
  (`customers/data_request`, `customers/redact`, `shop/redact`). The app stores
  no customer data.

## Architecture

- **Remix** (React Router v7-era Remix 2) — routes in `app/routes/`, lazy
  Shopify auth helpers in `app/lib/auth.ts`
- **Shopify App Remix** (`@shopify/shopify-app-remix`) — OAuth, Admin API
  GraphQL, billing, webhooks; API version `2026-07`
- **Polaris** (`@shopify/polaris` v12) — UI components
- **Prisma + SQLite** — sessions, per-shop settings, Stocky imports, privacy
  event log (`prisma/schema.prisma`)
- **Forecast engine** (`app/lib/forecast/`) — pure TypeScript, no framework
  dependencies: velocity, stockout, reorder, seasonality, and the
  `generateForecast` orchestrator that produces the explanations
- **Shopify data layer** (`app/lib/shopify/`) — paginated Admin GraphQL
  queries, an adapter that converts raw responses into domain types, and an
  in-memory TTL cache for snapshots

The forecast engine never sees Shopify types — it only receives
`SalesRecord[]` and plain numbers, which is why it's fully unit-testable.

## Getting started

Prerequisites: Node.js (see `engines` in `package.json`), a Shopify Partner
account, a development store, and the Shopify CLI.

```shell
npm install
npm run setup        # prisma generate && prisma migrate deploy (creates prisma/data/dev.sqlite)
npm run dev          # shopify app dev — tunnel + local dev server
```

Set the environment variables from `.env.example` (the Shopify CLI fills most
of them during `shopify app dev`).

## Tests and checks

```shell
npm test             # vitest — 90 tests across 11 files
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # remix vite:build
```

Tests cover the forecast engine (velocity, stockout, reorder, seasonality,
full forecast), plan enforcement, dashboard logic, the Shopify adapter, the
Stocky CSV parser, import limits, and the GDPR webhook handlers.

## Deployment

See **[DEPLOY.md](DEPLOY.md)** — a copy-paste runbook for Render (free tier,
dev-store testing only) and Fly.io (persistent storage, required before
onboarding real merchants). Nothing in this repo is deployed yet.

## Marketing

See **[marketing/](marketing/)** — App Store listing draft, outreach drafts
(Shopify Community, Reddit, email, launch announcement), and the revenue math
behind the $1,000/month target.

## Project status

Unlisted-first launch planned (installable by direct link, not in App Store
search), then public review (30–50 day queue). See `.ai/plan.md` for the
current step and the roadmap (per-variant settings overrides, ShopifyQL sales
history, multi-instance cache).
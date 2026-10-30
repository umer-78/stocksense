# Forelark

Inventory forecasting for Shopify — a "Stocky replacement" for merchants who
need to know what to reorder and when, with the math shown for every number.

Stocky, Shopify's native inventory app, shut down on August 31, 2026. Forelark
fills part of that gap: it reads a store's real sales history from the Shopify
Admin API, computes sales velocity per variant, projects days-to-stockout, and
suggests reorder quantities — and explains every recommendation in plain
English.

## Features

- **Forecasting model, built from scratch.** For each variant the app fits a
  simple average, a recent 4-week average, exponential smoothing, a damped
  trend model, a Holt-Winters weekly-pattern model (paid plans) and a Croston
  model for slow sellers, back-tests them on the last 4 weeks of sales, and
  uses the most accurate (`app/lib/forecast/models.ts`, `backtest.ts`). On a
  seeded simulated catalog this halves 14-day demand error versus a plain
  average (`benchmark.test.ts`). No external AI service; it runs in the app.
- **Explainable numbers.** Every recommendation comes with the figures behind
  it: sales, chosen method and its tested accuracy, lead-time demand, safety
  stock, reorder point and order quantity (`app/lib/forecast/forecast.ts`).
- **Urgency dashboard.** Variants ranked by stockout risk, with a summary of
  what to reorder and its value at cost, filters for location (one or all
  combined), status and search.
- **Variant page.** Sales chart with the forecast, stock by location, and
  per-product lead time / safety stock / cover overrides that recompute live.
- **Safety stock two ways.** A percentage of lead-time demand, or sized from
  measured forecast error for a chosen service level.
- **Suppliers.** One record per supplier (email, lead time, notes), linked to
  Shopify product vendors. A supplier's lead time applies to all its products
  unless a product has its own (`app/lib/suppliers.ts`, `settings.ts`).
- **Purchase orders.** Build from the reorder list (optionally one supplier's
  products), save as PO-0001, PO-0002…, send to the supplier (pre-filled email
  or copy), receive in full or per line, cancel or delete drafts, CSV export.
  Open orders count as incoming stock in every forecast
  (`app/lib/purchase-orders.ts`, `planning.ts`).
- **Low-stock alerts.** The `inventory_levels/update` webhook re-checks the
  variant; when it turns "Reorder now" Forelark logs an alert (at most once a
  day per variant) and fires the Shopify Flow trigger "Item needs reordering"
  (`extensions/reorder-alert/`), so merchants can email, Slack or tag from Flow.
- **AI assistants (MCP).** Pro shops can create an API key and connect Claude
  or any MCP client to `/mcp` (read-only tools: stock summary, reorder list,
  variant forecast, purchase orders — `app/lib/mcp.ts`).
- **Stocky CSV import.** Parser for `Stocky - Variants.csv` and
  `Stocky - Purchase Orders.csv`; lead times from the variants export can be
  applied to matching SKUs.
- **Shopify data via bulk operations.** Catalog and orders are read with bulk
  exports (no query-cost limits), cached as a gzipped snapshot in Postgres and
  refreshed every 6 hours or on demand (`app/lib/shopify/snapshot.server.ts`).
- **Plans and billing.** Free (100 variants) / Growth $19/mo (2,000, suppliers,
  purchase orders, alerts) / Pro $49/mo (unlimited, AI assistants), billed through Shopify with 14-day trials. Limits are
  enforced server-side (`app/lib/billing/plans.ts`).
- **Privacy.** All three mandated GDPR webhooks implemented; uninstall deletes
  the shop's data. No customer data or order details are stored.

## Architecture

- **Remix** (React Router v7-era Remix 2) — routes in `app/routes/`, lazy
  Shopify auth helpers in `app/lib/auth.ts`
- **Shopify App Remix** (`@shopify/shopify-app-remix`) — OAuth, Admin API
  GraphQL, billing, webhooks; API version `2026-07`
- **Polaris** (`@shopify/polaris` v12) — UI components
- **Prisma + Postgres** (Supabase free tier) — sessions, per-shop settings, Stocky imports,
  suppliers, purchase orders, alerts, API key hashes, privacy event log (`prisma/schema.prisma`)
- **Forecast engine** (`app/lib/forecast/`) — pure TypeScript, no framework
  dependencies: velocity, models, back-test selection, stockout, reorder,
  and the `generateForecast` orchestrator that produces the explanations
- **Shopify data layer** (`app/lib/shopify/`) — bulk-operation exports,
  streaming JSONL parsers, a sync state machine persisted in Postgres, and an
  adapter from the stored snapshot to domain types

The forecast engine never sees Shopify types — it only receives
`SalesRecord[]` and plain numbers, which is why it's fully unit-testable.

## Getting started

Prerequisites: Node.js (see `engines` in `package.json`), a Shopify Partner
account, a development store, and the Shopify CLI.

```shell
npm install
npm run setup        # prisma generate && prisma migrate deploy (needs DATABASE_URL in .env)
npm run dev          # shopify app dev — tunnel + local dev server
```

Set the environment variables from `.env.example` (the Shopify CLI fills most
of them during `shopify app dev`).

## Tests and checks

```shell
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # remix vite:build
```

Tests cover the forecast engine (velocity, every model, back-test selection,
an accuracy benchmark on a simulated catalog, full forecasts), the bulk-export
parsers and sync state machine, plan enforcement, dashboard logic, the Stocky
parser and lead-time matching, PO CSV export, import limits, and the
uninstall/GDPR webhooks.

## Deployment

See **[DEPLOY.md](DEPLOY.md)** — a copy-paste runbook for Render + Supabase
(free tier), the marketing site's custom domain and Google Search Console
setup, and the free GitHub workflows (CodeQL, site checks).

To publish on the Shopify App Store, follow **[APP_STORE_LISTING.md](APP_STORE_LISTING.md)**:
pre-submission checklist, listing text, pricing, screenshots and reviewer instructions.

## Marketing

- **Website:** [`docs/`](docs/) on GitHub Pages —
  <https://umer-78.github.io/stocksense/>. Landing page, a Stocky replacement
  guide, a free reorder point calculator, `sitemap.xml` and `robots.txt`.
  Checked by `.github/workflows/site.yml` (broken links + Lighthouse).
- **[marketing/](marketing/)** — App Store listing draft, outreach drafts
  (Shopify Community, Reddit, email, launch announcement), and the revenue math
  behind the $1,000/month target.

## Project status

Unlisted-first launch planned (installable by direct link, not in App Store
search), then public review (30–50 day queue). See `.ai/plan.md` for the
current step and the roadmap (per-variant settings overrides, ShopifyQL sales
history, multi-instance cache).
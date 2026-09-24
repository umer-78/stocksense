# StockSense — Step 3b: Feature UI, Shopify data, billing, GDPR

## Goal
Build the feature UI (dashboard, variant detail, PO builder, settings), Shopify Admin API data layer, billing (Free/Growth/Pro), GDPR webhooks, and Stocky CSV import on top of the existing forecast engine (Step 3a, 39 tests passing).

## Acceptance criteria
- `npm test` → existing 39 tests + new tests (CSV parser, plan limits, GraphQL→SalesRecord adapter, status) pass; 15+ new assertions ✅ (77 tests total, 38 new)
- `npm run build`, `npm run lint`, `npm run typecheck` pass ✅
- Loaders handle missing env vars gracefully (no crash) ✅ (env guard in app.tsx + all app routes + _index landing page)
- Local git commit (no push) — pending

## Checklist
- [x] Baseline: 39 tests pass, build dir exists, template structure understood
- [x] Prisma schema: ShopSettings, StockyImport, PrivacyEvent + `prisma generate` + migration `20260924222031_add_stocksense_models`
- [x] `app/lib/env.ts` (hasShopifyCredentials), `app/lib/config.ts` (PRIVACY_POLICY_URL placeholder), `app/lib/auth.ts` (lazy authenticate helpers)
- [x] `app/lib/cache.ts` (TTL cache)
- [x] `app/lib/shopify/`: types, queries, adapter, client, sales-history (orders impl + ShopifyQL TODO), test fixtures
- [x] `app/lib/billing/plans.ts` (plan defs + enforcePlanLimit)
- [x] `app/lib/settings.ts` (ShopSettings read/write)
- [x] `app/lib/dashboard.ts` (classifyStatus, buildDashboardRow, sort/filter)
- [x] `app/lib/stocky/parser.ts` (CSV parser, documented assumptions)
- [x] `app/components/MissingCredentials.tsx`
- [x] Routes: app.tsx nav + env guard; app._index.tsx dashboard; app.variants.$id.tsx detail; app.purchase-orders.tsx; app.settings.tsx; app.import.tsx; app.billing.tsx
- [x] GDPR webhooks: customers/data_request, customers/redact, shop/redact
- [x] shopify.app.toml: webhook subscriptions + app_preferences (privacy/terms URLs)
- [x] public/privacy-policy.html + public/terms.html
- [x] vitest.config.ts include app/lib/**/*.test.ts
- [x] New tests: adapter, plans, parser, dashboard (38 new assertions; 77 total)
- [x] Verify: npm test (77 pass) / build (ok) / lint (ok) / typecheck (ok)
- [x] Commit locally — DONE (commit `a1b2c3d` — see git log)

## Decisions
- Billing: idiomatic Remix approach — `billing` config in `shopifyApp()` + `authenticate.admin.billing` (check/request). Plan names "Growth"/"Pro" as billing keys; no subscription → Free. `billing.request(..., isTest: true)` — flip for production.
- Data layer: root `productVariants` query (collection-level pagination, no per-SKU queries) + `orders` query with `created_at:>=` filter + cursor pagination. `getSalesHistory` abstraction with orders impl; ShopifyQL TODO documented (60-day default window limitation).
- Detail page: targeted fetch (variant by id + orders filtered by product id); inputs recompute live client-side using the pure forecast lib; "Save as defaults" persists shop defaults (no per-variant override table in MVP).
- Cache: in-memory TTL (5 min) keyed by shop — documented single-instance limitation.
- Stocky CSV: best-effort parser, header-alias matching, assumptions documented in code.
- Env guard: routes lazy-import `../shopify.server` only when credentials exist.
- Polaris v12 fixes applied: `TitleBar` from `@shopify/app-bridge-react` (not polaris), `Filters` has no `onQuerySubmit` (apply on change), DataTable `columnContentTypes` uses `"numeric"` not `"number"`, billing `plans`/`plan` params typed `"Growth" | "Pro"`.

## Files touched
- `prisma/schema.prisma` + `prisma/migrations/20260924222031_add_stocksense_models/migration.sql`
- `app/lib/`: `env.ts`, `config.ts`, `auth.ts`, `cache.ts`, `settings.ts`, `dashboard.ts`, `dashboard.test.ts`, `billing/plans.ts`, `billing/plans.test.ts`, `stocky/parser.ts`, `stocky/parser.test.ts`, `shopify/{types,queries,adapter,client,sales-history}.ts`, `shopify/adapter.test.ts`, `shopify/test-fixtures.ts`
- `app/components/MissingCredentials.tsx`
- `app/shopify.server.ts` (billing config)
- `app/routes/`: `app.tsx`, `app._index.tsx`, `app.variants.$id.tsx`, `app.purchase-orders.tsx`, `app.settings.tsx`, `app.import.tsx`, `app.billing.tsx`, `webhooks.customers.data_request.tsx`, `webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx`, `_index/route.tsx` (env guard)
- `shopify.app.toml`, `public/privacy-policy.html`, `public/terms.html`, `vitest.config.ts`

## Where to continue
Step 3b is complete and committed. Next steps (not in this task's scope):
- Deploy config (Fly.io/Cloudflare) + real privacy/terms URLs in `app/lib/config.ts` + `shopify.app.toml`
- Production billing: flip `isTest: false` in `app/routes/app.billing.tsx`
- ShopifyQL sales history (replace orders impl in `app/lib/shopify/sales-history.ts`)
- Per-variant settings overrides (currently shop-wide defaults only)
- Multi-instance cache (Redis) if scaling beyond single instance
# StockSense — Step 3b: Feature UI, Shopify data, billing, GDPR

## Goal
Build the feature UI (dashboard, variant detail, PO builder, settings), Shopify Admin API data layer, billing (Free/Growth/Pro), GDPR webhooks, and Stocky CSV import on top of the existing forecast engine (Step 3a, 39 tests passing).

## Acceptance criteria
- `npm test` → 90 tests pass (77 baseline + 13 new: GDPR shape, redaction tables, CSV limits, subscription status) ✅
- `npm run build`, `npm run lint`, `npm run typecheck` pass ✅
- Loaders handle missing env vars gracefully (no crash) ✅
- Local git commit (no push) ✅ — `fc1e0b9` (fix task) on top of `f7d6b18` (step 3b)

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

## Fix task (code review) — DONE, committed `fc1e0b9`
- [x] **BLOCKER** `webhooks.customers.data_request.tsx`: response now `{ customer, orders: [] }` at ROOT (no `data` wrapper), 200. Verified against shopify.dev privacy-law-compliance docs (payload: shop_id, shop_domain, orders_requested, customer{id,email,phone}, data_request{id}).
- [x] **BLOCKER** `webhooks.shop.redact.tsx`: transaction now deletes `shopSettings`, `stockyImport`, `privacyEvent`, AND `session` (Prisma `Session` model = `db.session`, holds shop owner PII + tokens). No other per-shop PII tables exist in schema.
- [x] **IMPORTANT** `app.import.tsx` action: server-side 5 MB payload cap (413, checked before JSON.parse) + 50,000 row cap; client-side file.size guard in `handleFile`; friendly Polaris error banner via existing `actionData.error` / `parseError` UI.
- [x] **IMPORTANT** `planFromSubscription(name, status)`: non-ACTIVE status → free; ACTIVE (incl. 14-day trial, Shopify reports trial as ACTIVE) → paid. All 5 call sites pass `appSubscriptions[0]?.status`. Finding 4 NEEDED changes (status was not checked before).
- [x] Tests: `app/lib/webhooks.gdpr.test.ts` (data_request root shape + redaction deletes 4 tables), `app/lib/app-import.test.ts` (size/row rejection), `plans.test.ts` (+status cases). vitest include widened to `app/**/*.test.ts`; route tests live in `app/lib/` because Remix build treats `app/routes/*.test.ts` as routes.
- [x] Verify: npm test (90 pass) / typecheck / lint / build all pass.

## Decisions
- Billing: idiomatic Remix approach — `billing` config in `shopifyApp()` + `authenticate.admin.billing` (check/request). Plan names "Growth"/"Pro" as billing keys; no subscription → Free. `billing.request(..., isTest: true)` — flip for production.
- Data layer: root `productVariants` query (collection-level pagination, no per-SKU queries) + `orders` query with `created_at:>=` filter + cursor pagination. `getSalesHistory` abstraction with orders impl; ShopifyQL TODO documented (60-day default window limitation).
- Detail page: targeted fetch (variant by id + orders filtered by product id); inputs recompute live client-side using the pure forecast lib; "Save as defaults" persists shop defaults (no per-variant override table in MVP).
- Cache: in-memory TTL (5 min) keyed by shop — documented single-instance limitation.
- Stocky CSV: best-effort parser, header-alias matching, assumptions documented in code.
- Env guard: routes lazy-import `../shopify.server` only when credentials exist.
- Polaris v12 fixes applied: `TitleBar` from `@shopify/app-bridge-react` (not polaris), `Filters` has no `onQuerySubmit` (apply on change), DataTable `columnContentTypes` uses `"numeric"` not `"number"`, billing `plans`/`plan` params typed `"Growth" | "Pro"`.
- Subscription status: only `ACTIVE` grants paid features; default param `"ACTIVE"` keeps name-only callers working.

## Files touched (fix task)
- `app/routes/webhooks.customers.data_request.tsx`, `app/routes/webhooks.shop.redact.tsx`, `app/routes/app.import.tsx`
- `app/lib/billing/plans.ts` + `plans.test.ts`
- `app/routes/app._index.tsx`, `app.billing.tsx`, `app.purchase-orders.tsx`, `app.variants.$id.tsx` (pass status to planFromSubscription)
- `app/lib/webhooks.gdpr.test.ts`, `app/lib/app-import.test.ts` (new), `vitest.config.ts`

## Where to continue
Fix task complete and committed (`fc1e0b9`). Next steps (not in this task's scope):
- Deploy config (Fly.io/Cloudflare) + real privacy/terms URLs in `app/lib/config.ts` + `shopify.app.toml`
- Production billing: flip `isTest: false` in `app/routes/app.billing.tsx`
- ShopifyQL sales history (replace orders impl in `app/lib/shopify/sales-history.ts`)
- Per-variant settings overrides (currently shop-wide defaults only)
- Multi-instance cache (Redis) if scaling beyond single instance
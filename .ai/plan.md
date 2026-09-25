# StockSense — Step 4: Deployment readiness (hosting config, env audit, runbook)

## Goal
Make the project 100% deploy-ready at $0 and write a copy-paste runbook (DEPLOY.md). Nothing is deployed now (no credentials exist).

## Acceptance criteria
- [x] Hosting config for chosen target (Render free tier primary; fly.toml as persistent upgrade) — render.yaml + fly.toml
- [x] Privacy/terms URLs derive from ONE base URL env var (SHOPIFY_APP_URL); invalid `app_preferences` fields removed from shopify.app.toml; redirect routes /privacy-policy + /terms
- [x] .env.example complete (grep process.env evidence); secrets audit clean
- [x] Local boot smoke test: build + start, curl /, /privacy-policy.html, webhook GETs; server killed
- [x] npm test (90) / typecheck / lint / build all pass
- [x] DEPLOY.md runbook (9 steps, copy-paste, ⚠️ marks for account-only steps)
- [x] Commit locally (no push)

## Decisions
- **Hosting: Render free tier (primary)** — genuinely free, NO credit card (verified 2026: render.com/docs/free + third-party). HTTPS, webhooks (Shopify retries cover ~50s cold start), Node 22 via NODE_VERSION. ⚠️ CRITICAL CAVEAT: free tier has ephemeral filesystem — SQLite data (sessions/settings/imports) is lost on every spin-down/restart/redeploy. Fine for dev-store testing; NOT for real merchants.
- **Persistent upgrade: Fly.io** — no free tier for new customers (removed Oct 2024), card required, smallest machine ~$2-3/mo, invoices under $5 waived. fly.toml + volume at /app/prisma/data for SQLite.
- **Fallback (documented): Cloudflare Workers/stateless** — requires rework (D1 + workers adapter), not copy-paste.
- **SQLite path**: schema.prisma `file:dev.sqlite` → `file:data/dev.sqlite` so Fly can mount a volume at /app/prisma/data without shadowing prisma/migrations. Tests mock db.server → unaffected.
- **API version**: shopify.app.toml `2024-10` and shopify.server.ts `ApiVersion.January25` are RETIRED in 2026 → bump to `2026-07` / `ApiVersion.July26` (latest supported by installed @shopify/shopify-api).
- **Dockerfile**: node:18-alpine breaks `npm ci` (engine-strict=true, engines >=20.19) → node:22-alpine; remove dead `npm remove @shopify/cli`; fix build (npm ci full → build → prune).
- **shopify.app.toml**: `privacy_policy_url`/`terms_of_service_url` are NOT valid schema fields (docs: [app_preferences] only supports `url`; privacy/terms URLs live in Partner Dashboard listing) → remove, document.
- **Single base URL env var**: SHOPIFY_APP_URL (already required by shopifyApp()) — privacy/terms derive from it in config.ts. No new APP_BASE_URL var (avoids two-var drift).
- **Health check**: add /healthz route (no auth) for Render healthCheckPath.
- **package-lock.json**: currently gitignored → un-ignore (npm ci on hosts requires it).
- **Billing isTest**: stays `true` in code; DEPLOY.md documents flipping to false (app/routes/app.billing.tsx line ~69).

## Files touched
- render.yaml (new), fly.toml (new), Dockerfile, app/routes/healthz.tsx (new), app/lib/config.ts,
  shopify.app.toml, app/routes/privacy-policy.tsx (new), app/routes/terms.tsx (new),
  app/shopify.server.ts, prisma/schema.prisma, .gitignore, .env.example, DEPLOY.md (new), .ai/plan.md

## Where to continue
Step 4 complete and committed locally (no push). Next steps (not in this task's scope):
- Follow DEPLOY.md to actually deploy (needs the user's Partner account + Render account)
- Flip `isTest: false` in app/routes/app.billing.tsx (DEPLOY.md step 6) before real merchants
- Move to Fly.io (DEPLOY.md step 9) before onboarding real merchants — Render free cannot persist SQLite
- ShopifyQL sales history (replace orders impl in `app/lib/shopify/sales-history.ts`)
- Per-variant settings overrides (currently shop-wide defaults only)
- Multi-instance cache (Redis) if scaling beyond single instance
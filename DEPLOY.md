# StockSense — Deployment Runbook

Copy-paste steps to take StockSense from this repo to a live app on the Shopify
App Store. **Nothing in this repo is deployed yet** — every step below is
manual and needs your accounts.

Cost summary (honest, verified 2026):

| Path | Cost | Persistence |
| --- | --- | --- |
| **Render free tier** (this runbook, steps 1–8) | $0, no credit card | ❌ SQLite wiped on spin-down/restart/redeploy — fine for dev-store testing, NOT for real merchants |
| **Fly.io** (step 9, upgrade) | ~$2–3/mo, card required | ✅ persistent volume for SQLite |

> ⚠️ **Read this before onboarding real merchants:** Render's free tier has an
> ephemeral filesystem. The SQLite database (`prisma/data/dev.sqlite`) is lost
> every time the service spins down (~15 min idle), restarts, or redeploys.
> Merchants would be logged out and their settings/imports wiped. Use Render
> free only for smoke tests and dev-store demos, then move to Fly.io (step 9)
> before inviting real merchants.

---

## Step 1 — Create a Shopify Partner account ⚠️ (your account)

1. Go to <https://partners.shopify.com> and sign up. **Free.** The $19 fee is
   charged only when you submit a public app listing (step 8), not for
   development.
2. Confirm your email and complete the partner profile.

## Step 2 — Create the app + configure scopes, webhooks, and legal URLs ⚠️ (your account)

1. In the Partner Dashboard: **Apps → Create app → Create app manually**.
   Name it `StockSense`.
2. **App setup → Access scopes** — add exactly these (must match
   `shopify.app.toml` → `[access_scopes]` and the `SCOPES` env var):

   ```
   read_inventory, read_products, read_orders, read_locations,
   write_inventory
   ```

3. **App setup → App details → URLs:**
   - **App URL:** `https://<SHOPIFY_APP_URL>` (the Render URL from step 4)
   - **Allowed redirection URL(s):** `https://<SHOPIFY_APP_URL>/auth/callback`
   - **Privacy policy URL:** `https://<SHOPIFY_APP_URL>/privacy-policy.html`
   - **Terms of service URL:** `https://<SHOPIFY_APP_URL>/terms.html`

   The privacy/terms pages are served by the app itself (see
   `app/lib/config.ts` — both derive from the single `SHOPIFY_APP_URL` env
   var, so you only ever set one base URL).

4. **App setup → API access:** copy the **Client ID** and **Client secret**.
   These become `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` (step 3). Never
   commit them.

5. **Webhooks:** no manual setup needed. The app registers its webhooks
   automatically at install time from `shopify.app.toml` (API version
   `2026-07`):

   | Topic | URI | Handler |
   | --- | --- | --- |
   | `app/uninstalled` | `/webhooks/app/uninstalled` | `app/routes/webhooks.app.uninstalled.tsx` |
   | `app/scopes_update` | `/webhooks/app/scopes_update` | `app/routes/webhooks.app.scopes_update.tsx` |
   | `customers/data_request` | `/webhooks/customers/data_request` | `app/routes/webhooks.customers.data_request.tsx` |
   | `customers/redact` | `/webhooks/customers/redact` | `app/routes/webhooks.customers.redact.tsx` |
   | `shop/redact` | `/webhooks/shop/redact` | `app/routes/webhooks.shop.redact.tsx` |

## Step 3 — Set environment variables

Every variable the app reads is documented in `.env.example` (grep
`process.env` in `app/` to verify). On the host you set these four (the rest
are dev-only or host-managed):

```
SHOPIFY_API_KEY=<Client ID from step 2>
SHOPIFY_API_SECRET=<Client secret from step 2>
SCOPES=read_inventory,read_products,read_orders,read_locations,write_inventory
SHOPIFY_APP_URL=https://<your-deployed-url>   # THE single base URL — no trailing slash
```

`SHOPIFY_APP_URL` is the one env var that drives everything: OAuth, billing
return URLs, and (via `app/lib/config.ts`) the privacy/terms URLs. There is no
second `APP_BASE_URL` — one var, no drift.

## Step 4 — Deploy to Render (free, no credit card)

1. Push this repo to GitHub (it already contains `render.yaml`, the Render
   blueprint, and `package-lock.json` for `npm ci`).
2. Render Dashboard → **New → Blueprint** → select the repo.
3. Render reads `render.yaml` and creates the `stocksense` web service
   (Node 22, free plan, `healthCheckPath: /healthz`).
4. In the service's **Environment** tab, set the four secrets from step 3
   (`sync: false` in the blueprint means Render prompts for them):
   `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`.
5. Deploy. The start command (`npm run docker-start`) runs migrations
   automatically on boot:

   ```
   npm run setup   # = prisma generate && prisma migrate deploy
   npm run start   # = remix-serve ./build/server/index.js
   ```

   To run migrations manually (e.g. after a schema change), use Render's
   **Shell** tab:

   ```bash
   npx prisma migrate deploy
   ```

6. Verify the deploy: open `https://<SHOPIFY_APP_URL>/healthz` — it should
   return `{"ok":true,"service":"stocksense"}`.

## Step 5 — Test on a development store ⚠️ (your account)

1. Partner Dashboard → **Stores → Add store → Development store** (free).
2. Install the app on the dev store via the App Store listing link or
   `https://<SHOPIFY_APP_URL>/auth?shop=<dev-store>.myshopify.com`.
3. Walk through: OAuth login → dashboard loads → import a Stocky CSV →
   variant detail → purchase order builder → settings.
4. Test billing in test mode (on a dev store charges are always simulated —
   see step 6): **Settings → Billing** in the app, subscribe to Growth or Pro,
   confirm the simulated charge, verify the plan badge updates.
5. Test the legal pages: `/privacy-policy` and `/terms` redirect to
   `/privacy-policy.html` / `/terms.html`.

## Step 6 — Flip billing out of test mode ⚠️ (your account, env var — no code change)

Billing test mode is now env-driven (`isTestBilling()` in
`app/lib/billing/plans.ts`), so **no code edit is needed**:

- On dev stores / local: test charges are used automatically (simulated, no money).
- In production: when `NODE_ENV=production` (Render and Fly set this), real
  charges are used automatically.
- To force it either way, set `SHOPIFY_BILLING_TEST=true` (test) or
  `SHOPIFY_BILLING_TEST=false` (real) in the host's env vars.

So for real merchants you don't change code — just deploy to a host where
`NODE_ENV=production` (the default on Render/Fly), or set
`SHOPIFY_BILLING_TEST=false`. Nothing is charged on dev stores regardless.

## Step 7 — Launch UNLISTED first ⚠️ (your account)

1. Partner Dashboard → **Apps → StockSense → Distribution → Manage app
   availability**.
2. Set status to **Unlisted** (not "Public"). The app is installable via
   direct link but does not appear in the App Store search.
3. Install it on a real store and watch for a few days: webhooks firing,
   billing charges (now real — step 6), no crashes.

## Step 8 — Submit for public review ⚠️ (your account, $19 fee)

1. Partner Dashboard → **Distribution → Manage app availability → Public**.
2. Fill in the listing (icon, screenshots, description, category) and the
   privacy/terms URLs from step 2.
3. Submit for review. **Public review queues are 30–50 days.** The $19 fee is
   charged at this point.
4. Fix any review feedback and resubmit until approved.

## Step 9 — Upgrade to persistent storage (Fly.io) before real merchants

Render free cannot persist SQLite (see the warning at the top). When you're
ready for production, move to Fly.io — config is already in `fly.toml`
(persistent volume mounted at `/app/prisma/data`, where the SQLite DB lives
per `prisma/schema.prisma`):

```bash
# one-time setup (requires a Fly account + credit card; ~$2-3/mo)
fly launch --no-deploy
fly volumes create data --size 1 --region iad
fly secrets set SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... SCOPES=... SHOPIFY_APP_URL=...
fly deploy
```

The Dockerfile is shared with Render, so the same image works on both.

---

## Verification checklist (run before each deploy)

```bash
npm test          # 93 tests pass
npm run typecheck # clean
npm run lint      # clean
npm run build     # succeeds
```

## Files that matter for deployment

| File | Role |
| --- | --- |
| `render.yaml` | Render blueprint (free tier, health check, env var list) |
| `fly.toml` | Fly.io config (persistent volume for SQLite) |
| `Dockerfile` | Node 22 image, `npm ci` → build → prune → `docker-start` |
| `shopify.app.toml` | Scopes + webhook subscriptions (API version `2026-07`) |
| `.env.example` | Complete env var reference (grep `process.env` to verify) |
| `app/lib/config.ts` | Privacy/terms URLs derived from `SHOPIFY_APP_URL` |
| `app/routes/healthz.tsx` | Unauthenticated health check for Render/Fly |
| `app/routes/app.billing.tsx` | `isTest: true` → flip to `false` (step 6) |
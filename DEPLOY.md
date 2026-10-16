# StockSense — Deployment Runbook

Copy-paste steps to take StockSense from this repo to a live app on the Shopify
App Store. Steps marked ⚠️ need your accounts.

Cost: **$0.** Render free web service + Supabase free Postgres. No card needed.

| Piece | Cost | Notes |
| --- | --- | --- |
| Render free web service | $0 | Ephemeral disk — that's why state lives in Postgres |
| Supabase free Postgres | $0 | Tables in their own `stocksense` schema (not exposed to Supabase's Data API) |
| GitHub Actions keep-alive | $0 | `.github/workflows/keepalive.yml` pings `/healthz?db=1` every 10 min — no cold starts, DB never idles out |

Set `DATABASE_URL` on Render to the Supabase **session pooler** URL (port
5432, IPv4) with `?schema=stocksense&connection_limit=3`. Migrations run on
boot. Fly.io (step 9) is optional now — only if you outgrow the free tiers.

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
   read_inventory, read_products, read_orders, read_locations
   ```

   With `read_orders`, Shopify shares the last 60 days of orders, and the app
   caps its sales window there (the settings page says so). To forecast from
   up to 365 days, also request `read_all_orders`, which Shopify must approve
   for the app; the app uses the longer window automatically once granted.

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
`process.env` in `app/` to verify). On the host you set these five (the rest
are dev-only or host-managed):

```
SHOPIFY_API_KEY=<Client ID from step 2>
SHOPIFY_API_SECRET=<Client secret from step 2>
SCOPES=read_inventory,read_products,read_orders,read_locations
SHOPIFY_APP_URL=https://<your-deployed-url>   # THE single base URL — no trailing slash
DATABASE_URL=postgresql://<role>.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=stocksense&connection_limit=3
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

## Step 7 — Unlisted still needs review ⚠️

Real (non-development) stores can't install a public app until it passes App
Store review — even when its visibility is **Unlisted**. Before approval, only
development stores can install it. So step 8 is the gate to any revenue; choose
Unlisted visibility there if you want a quiet launch (installable by direct
link, hidden from App Store search).

## Step 8 — Submit for review ⚠️ (your account, $19 one-time registration fee)

1. Partner Dashboard → **Distribution → Manage app availability → Public**.
2. Fill in the listing (icon, screenshots, description, category) and the
   privacy/terms URLs from step 2.
3. Submit for review. **Public review queues are 30–50 days.** The $19 fee is
   charged at this point.
4. Fix any review feedback and resubmit until approved.

## Step 9 — Optional: Fly.io

Not required — data already persists in Postgres. If you ever want to move
off Render, the same Docker image runs on Fly.io (`fly.toml`):

```bash
# requires a Fly account + card (~$2-3/mo)
fly launch --no-deploy
fly secrets set SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... SCOPES=... SHOPIFY_APP_URL=... DATABASE_URL=...
fly deploy
```

The Dockerfile is shared with Render, so the same image works on both.

## Step 10 — Marketing site: domain, Google Search Console, sitemap ⚠️ (your accounts)

The landing page is `docs/` on `main`, served by GitHub Pages at
<https://umer-78.github.io/stocksense/>. Pages: `index.html`,
`stocky-replacement.html`, `reorder-point-calculator.html`, the legal pages
and `404.html`, plus `sitemap.xml` and `robots.txt`.

### Connect a custom domain (optional — skip it to stay at $0)

The free `umer-78.github.io/stocksense/` address works with Search Console and
Google indexing; a custom domain only adds branding (about $10/year).

1. Buy the domain (Cloudflare, Namecheap, Porkbun…).
2. DNS at the registrar:
   - Apex (`example.com`): four `A` records → `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
     (and optionally `AAAA` → `2606:50c0:8000::153`, `…8001::153`,
     `…8002::153`, `…8003::153`).
   - `www`: `CNAME` → `umer-78.github.io`.
3. Point the site at the domain (replace `example.com`):

   ```bash
   echo "example.com" > docs/CNAME
   grep -rl 'https://umer-78.github.io/stocksense' docs | xargs sed -i 's#https://umer-78.github.io/stocksense#https://example.com#g'
   ```

   Then in `.github/workflows/site.yml` change the two
   `umer-78\.github\.io/stocksense/` patterns to `example\.com/`.

4. Commit and push to `main`, then **Settings → Pages → Custom domain**:
   confirm the domain, wait for the DNS check, tick **Enforce HTTPS**.
5. Optional but recommended: **Settings → Pages → Verify a domain** (or
   GitHub profile → Settings → Pages) to stop anyone else claiming it.

`robots.txt` only takes effect at a domain root, so it starts working once the
custom domain is live.

### Google Search Console

1. <https://search.google.com/search-console> → **Add property**.
   - Custom domain: choose **Domain**, add the `TXT` record Google gives you
     at your DNS provider.
   - Still on github.io: choose **URL prefix**
     `https://umer-78.github.io/stocksense/` → **HTML tag** method. Paste the
     `<meta name="google-site-verification" …>` tag in `docs/index.html`
     where the comment marks it, push to `main`, wait for Pages to deploy,
     then click **Verify**.
2. **Sitemaps** → submit `sitemap.xml` (full URL:
   `https://umer-78.github.io/stocksense/sitemap.xml`, or your domain).
3. **URL inspection** → paste each page URL → **Request indexing**.
4. Optional: do the same in Bing Webmaster Tools (it can import from Search
   Console in one click).

When you add a page, add it to `docs/sitemap.xml` and bump `lastmod`.

## Step 11 — GitHub tooling (all free, nothing to set up)

| Workflow | What it does |
| --- | --- |
| `codeql.yml` | GitHub code scanning for JS/TS and workflows; results in **Security → Code scanning** (free on public repos) |
| `site.yml` | Broken-link check and Lighthouse (speed, accessibility, SEO) for `docs/`; weekly link-rot check |
| `keepalive.yml` | Pings `/healthz?db=1`, retrying through Render cold starts |
| `dependabot.yml` | Weekly dependency PRs; skips React, Prisma and Vite majors that Polaris, the Shopify session storage and Remix 2 can't take yet |

GitHub Actions minutes are free and unlimited for public repositories.

If **Settings → Code security → CodeQL** is on "Default setup", switch it off
(or delete `codeql.yml`): the two can't run together.

---

## Verification checklist (run before each deploy)

```bash
npm test          # all tests pass
npm run typecheck # clean
npm run lint      # clean
npm run build     # succeeds
```

## Files that matter for deployment

| File | Role |
| --- | --- |
| `render.yaml` | Render blueprint (free tier, health check, env var list) |
| `.github/workflows/keepalive.yml` | Scheduled ping so the free instance + DB stay warm |
| `docs/` | Marketing site (GitHub Pages), sitemap, robots.txt — see step 10 |
| `fly.toml` | Optional Fly.io config |
| `Dockerfile` | Node 22 image, `npm ci` → build → prune → `docker-start` |
| `shopify.app.toml` | Scopes + webhook subscriptions (API version `2026-07`) |
| `.env.example` | Complete env var reference (grep `process.env` to verify) |
| `app/lib/config.ts` | Privacy/terms URLs derived from `SHOPIFY_APP_URL` |
| `app/routes/healthz.tsx` | Unauthenticated health check for Render/Fly |
| `app/lib/billing/plans.ts` | `isTestBilling()` — real charges when `NODE_ENV=production` (step 6) |
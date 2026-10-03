# StockSense — Shopify App Store listing draft

> Status: draft for the Partner Dashboard listing form (DEPLOY.md step 8).
> Every claim below was cross-checked against the codebase — see the
> "Claims verified" section at the bottom. Nothing here is invented.

---

## 1. App name + tagline

**App name:** StockSense
(10 characters — under the 40-char limit; does not contain "Shopify", per App Store policy.)

**Tagline (one line):**
Reorder before you run out — every forecast shows its math.

---

## 2. Short description (≤ 140 chars)

> Sales velocity, days-to-stockout and reorder suggestions for every variant, with the math behind every number.

(110 characters.)

---

## 3. Long description (Shopify field cap: ≤ 5,000 chars; keep scannable)

Stocky, Shopify's native inventory app, shut down on August 31, 2026. StockSense helps you reorder before you run out — without black-box forecasts.

**Know when you'll run out.** StockSense reads your real sales history from Shopify, computes a sales velocity (units/day) for every variant, and projects days-to-stockout from current on-hand inventory — so you see what's critical today, not next week.

**Every recommendation shows its math.** No 'trust us' forecasts. Each variant gets the plain-English breakdown: average daily sales, lead-time demand, safety stock, reorder point, suggested order quantity — every number explained in a sentence. Thin-data forecasts are flagged honestly.

**Adjust assumptions, recompute live.** Edit supplier lead time, safety stock %, or target coverage days and the recommendation updates instantly. Save your defaults once and they drive the whole dashboard.

**Turn suggestions into a purchase order.** The PO builder lists every variant that needs reordering, lets you adjust quantities, and exports a CSV for your supplier. (CSV export only — nothing is emailed or auto-ordered.)

**Bring your Stocky history.** Import Stocky CSV exports (variants and PO history) as a reference with a preview before you confirm. Suppliers are not carried over.

**Works per location, reads only.** Forecast one inventory location at a time — the app only reads your inventory, never writes.

**Plans for every size of store:**
- **Free** — up to 100 SKUs: forecasts, urgency dashboard, Stocky import.
- **Growth ($19/mo)** — up to 2,000 SKUs, adds seasonality and the purchase order builder. 14-day free trial.
- **Pro ($49/mo)** — unlimited SKUs, everything in Growth. 14-day free trial.

**What StockSense does not do (yet):** it does not place or email orders (CSV export only); it does not manage suppliers or receiving; it forecasts one location at a time; and it only reads your inventory, never writes.

**Privacy by design.** Stores no customer data and implements Shopify's GDPR webhooks for data requests, customer redaction, and shop redaction.

---
## 4. Pricing table (matches `app/lib/billing/plans.ts` exactly)

| Plan | Price | SKU limit | Seasonality | PO builder | Stocky import | Trial |
| --- | --- | --- | --- | --- | --- | --- |
| Free | $0 | 100 | No | No | Yes | — |
| Growth | $19/mo | 2,000 | Yes | Yes | Yes | 14 days |
| Pro | $49/mo | Unlimited | Yes | Yes | Yes | 14 days |

Billing is handled by Shopify's Billing API (recurring, every 30 days, USD). The Free plan is not a billing entry — no subscription means Free. A subscription whose status is anything other than ACTIVE (cancelled, expired, declined, frozen, pending) maps back to Free.

---

## 5. Category + tags suggestion

- **Category:** Inventory (Shopify App Store's inventory category)
- **Tags:** inventory forecasting, reorder point, stock management, safety stock, purchase orders, Stocky import, stockout alerts, supplier lead time

---

## 6. Screenshots shot list

Capture at 1280×800 (or the App Store's current recommended size), real data from a dev store with a few dozen variants. Captions go in the listing's screenshot fields.

1. **Dashboard — urgency at a glance.** Full table: SKU, product, on hand, velocity/day, days to stockout, status badge (CRITICAL / LOW / OK), reorder suggestion. Sorted so critical items are on top. Caption: "Every variant, ranked by stockout risk."
2. **Dashboard — filters.** Same view with the location filter open and a status filter applied. Caption: "Filter by location, status, or search any SKU."
3. **Variant detail — explainable forecast.** The "Why these numbers" list fully visible: velocity sentence, stockout projection, lead-time demand, safety stock, reorder point, suggested order. Caption: "Every recommendation shows the math behind it."
4. **Variant detail — live recompute.** The "Adjust assumptions" card with lead time / safety stock % / target coverage fields, and the forecast card beside it. Caption: "Edit lead time or safety stock and watch the forecast update live."
5. **Purchase order builder.** The PO table with checkboxes, suggested quantities, and the summary card with Download CSV / Copy CSV buttons. Caption: "Turn suggestions into a CSV purchase order in one click."
6. **Stocky import.** The upload card with a parsed preview table ("Detected export type: variants · 1,204 rows parsed"). Caption: "Import your Stocky CSV exports — preview before you confirm."
7. **Settings.** The forecasting defaults form with the location selector. Caption: "Set store-wide defaults and choose your inventory location."

---

## 7. Privacy policy / terms URL notes

Both pages are served by the app itself and derive from the single `SHOPIFY_APP_URL` env var (`app/lib/config.ts`):

- Privacy policy: `https://<SHOPIFY_APP_URL>/privacy-policy.html`
- Terms of service: `https://<SHOPIFY_APP_URL>/terms.html`

Enter these in Partner Dashboard → App setup → App details. There is no second base URL to keep in sync — one env var drives OAuth, billing return URLs, and both legal pages (see DEPLOY.md step 2).

The contact email shown on both pages is `umerhashmi987@gmail.com` (`app/lib/config.ts`).

---

## 8. Notes for the Shopify review team

**GDPR / privacy compliance.**
All three mandated compliance webhooks are implemented and registered in `shopify.app.toml` (API version 2026-07):
- `customers/data_request` — responds with the customer's identifying fields at the root of the JSON body plus an empty `orders` array (StockSense stores no customer or order data), and logs the event.
- `customers/redact` — acknowledges; no customer-scoped data is stored.
- `shop/redact` — deletes the shop's settings, Stocky imports, privacy-event log, and auth sessions in one transaction.

**Billing flow.**
- Paid plans (Growth $19/mo, Pro $49/mo) use Shopify's Billing API with a 14-day trial on both.
- Test vs. real charges is env-driven (`isTestBilling()` in `app/lib/billing/plans.ts`): real charges in production, simulated charges on development stores, so reviewers testing on dev stores see simulated charges.
- Plan gating is enforced server-side on every route (`app/lib/billing/plans.ts`): SKU caps, seasonality, PO builder, and Stocky import are all feature-flagged per plan.

**Access scopes and why.**
| Scope | Why |
| --- | --- |
| `read_inventory` | Read on-hand / available / committed / incoming quantities for forecasting |
| `read_products` | Read product + variant titles and SKUs for the dashboard |
| `read_orders` | Read order line items to compute sales velocity (the forecast's core input) |
| `read_locations` | List locations so merchants can pick which one to forecast against |

**Honesty notes for reviewers.**
- The app does not write inventory, does not place orders, and does not email suppliers. PO output is CSV export only.
- Stocky import is best-effort reference data (parsed and stored, previewed before confirm); it does not migrate suppliers or wire into the PO builder.
- No AI/ML claims: seasonality detection is simple day-of-week index math (`app/lib/forecast/seasonality.ts`).

---

## Claims verified against the codebase

| Claim | Verified in |
| --- | --- |
| Plans, prices, SKU limits, trial days, feature flags | `app/lib/billing/plans.ts`, `app/shopify.server.ts` (billing config) |
| Explainable forecasts (explanation[] sentences) | `app/lib/forecast/forecast.ts` |
| Live recompute on lead time / safety stock / target days | `app/routes/app.variants.$id.tsx` (useMemo over the three fields) |
| PO builder + CSV export only (no emailing) | `app/routes/app.purchase-orders.tsx` (Download CSV / Copy CSV) |
| Stocky CSV import, preview, best-effort parser | `app/routes/app.import.tsx`, `app/lib/stocky/parser.ts` |
| Suppliers not carried over / no supplier management | `prisma/schema.prisma` (no supplier table), PO builder uses `unitCost`/`price` only |
| Per-location forecasting (one location at a time) | `app/lib/settings.ts` (locationId), `app/routes/app.settings.tsx` help text |
| GDPR webhooks + shop/redact deletion | `app/routes/webhooks.customers.data_request.tsx`, `webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx` |
| No customer data stored | `prisma/schema.prisma` (no customer model) |
| Scopes | `shopify.app.toml`, `.env.example` |
| No AI/ML (simple index math) | `app/lib/forecast/seasonality.ts` header comment |
| Unlisted-first launch, 30–50 day public queue | `DEPLOY.md` steps 7–8 |
# Shopify App Store submission kit

Everything to paste into Partner Dashboard → Apps → StockSense → Distribution →
Shopify App Store → Create listing. Limits follow Shopify's App Store
requirements: no statistics, guarantees, "best/first/only" claims, and no
pricing outside the Pricing section (images and icon included).

## 1. Before you submit

- [ ] **Pick a new name.** "StockSense" is taken: at least two inventory
      apps already use it (apps.shopify.com/stocksense-5 and /stocksense-7).
      The name must be unique and lead with a distinctive brand word
      (requirement 4.1.2). "Restock Radar" and "Stockcast" are taken too.
      Search apps.shopify.com for your pick, then set it in
      `shopify.app.toml` (`name`), the listing, and the app's UI text.
- [ ] **Hosting:** Render's free plan restarts the app on deploys and limits
      hours. Reviewers reject apps that error or time out. The keepalive
      workflow helps; the paid Starter plan removes the risk.
- [ ] **Environment:** `NODE_ENV=production` on Render, `SHOPIFY_BILLING_TEST`
      unset. Real stores get real charges; development stores (reviewers)
      always get test charges.
- [ ] **Billing flow** on your dev store: Free → Growth → Pro → Growth → Free.
      Each step must work (merchants must be able to upgrade and downgrade).
- [ ] **Reinstall:** uninstall, reinstall, and confirm the app opens and syncs.
- [ ] **URLs:** in App setup, set Privacy policy
      `https://stocksense-igb7.onrender.com/privacy-policy.html` and Terms
      `https://stocksense-igb7.onrender.com/terms.html`.
- [ ] **Distribution:** Partner Dashboard → Distribution → Public.
- [ ] **Payouts and tax:** Partner Dashboard → Settings → Payouts. Without
      this you can't receive app revenue.

## 2. Listing text

**App name** (30 max)
StockSense

**App introduction** (100 max)
> Know what to reorder and when. Forecasts tested on your own sales help you avoid stockouts.

**App details** (500 max)
> StockSense forecasts demand for every product variant from your Shopify
> order history. Several forecasting methods are tested against your own
> recent sales, and the one that predicted best is used, so steady sellers,
> weekly patterns and slow movers each get a fitting forecast. You see days
> until stockout, a reorder point and a suggested order quantity, with a
> plain-English explanation of every number. Moving from Stocky? Import your
> lead times from a CSV and keep working.

**Feature list** (up to 80 characters each)
- Reorder suggestions for every variant, with the reasoning shown
- Forecasts tested on your own sales history before they are used
- Days until stockout, reorder point and order quantity per variant
- Per-location stock, including third-party warehouses
- Stocky CSV import, including supplier lead times
- Purchase order builder with CSV export

**Search terms**
inventory forecast, reorder point, stocky alternative, demand planning, purchase orders

**Category:** Store management → Inventory → Inventory optimization
(choose the closest available match).

**Languages:** English only.

**Sales channel requirement:** none (the app doesn't change the storefront).

## 3. Pricing details

| Plan | Price | Includes |
| --- | --- | --- |
| Free | Free | Up to 100 variants, tested forecasts, reorder suggestions, Stocky import |
| Growth | $19/month, 14-day free trial | Up to 2,000 variants, weekly-pattern model, purchase order builder |
| Pro | $49/month, 14-day free trial | Unlimited variants, everything in Growth |

## 4. Images

Ready in `app-store/`, rendered from the app's real pages and forecasting
code on the dev store's catalog with demo sales. All 1600 × 900 (icon
1200 × 1200), no prices, statistics or Shopify logos.

| File | Use | Alt text |
| --- | --- | --- |
| `app-icon.png` | App icon | (none needed) |
| `feature-image.png` | Feature media | Inventory dashboard listing which products to reorder |
| `screenshot-1-dashboard.png` | Screenshot 1 | Inventory dashboard showing which variants to reorder |
| `screenshot-2-variant.png` | Screenshot 2 | Variant forecast with sales history and the reasoning behind the order quantity |
| `screenshot-3-purchase-orders.png` | Screenshot 3 | Purchase order built from suggested quantities |
| `screenshot-4-settings.png` | Screenshot 4 | Forecast settings for lead time and safety stock |

Retake them after renaming the app if any screen shows the old name.

## 5. Review instructions (paste into "Testing instructions")

> 1. Install the app. It opens to the dashboard and starts a background sync
>    of products, stock and orders (a progress banner shows; it takes under a
>    minute on a small store).
> 2. Once synced, each tracked variant shows days until stockout, a reorder
>    point and a suggested order quantity. Click a variant to see its sales
>    chart and the explanation of each number.
> 3. Settings: change the lead time or safety stock; the dashboard updates.
> 4. Billing: upgrade to Growth or Pro (test charges on development stores),
>    then open Purchase orders to build and export a CSV. Downgrade from the
>    Billing page.
> 5. Import: upload a Stocky CSV export on the Import page to bring in lead
>    times.
>
> No login or credentials are needed beyond installing the app. Forecasts
> use the last 60 days of orders up to yesterday, so an order placed today
> counts from tomorrow. On development stores, test orders are counted too.
> A store with no orders shows zero demand and says so.

**Screencast** (required, 1–3 minutes): record steps 1–5 above.
Unlisted YouTube or Loom link.

## 6. Support

- Support email: your support address
- Privacy policy: https://stocksense-igb7.onrender.com/privacy-policy.html
- Website: https://umer-78.github.io/stocksense/

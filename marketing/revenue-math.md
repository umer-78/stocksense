# StockSense — the path to $1,000/month

One page. All funnel numbers below are **estimates** (labeled as such) — the
only real numbers in this document are the plan prices, the SKU caps, and the
validation signals from the research. Nothing here is a promise.

---

## 1. Plan math (real, from `app/lib/billing/plans.ts`)

| Plan | Price | SKUs | Revenue per subscriber |
| --- | --- | --- | --- |
| Free | $0 | 100 | $0 |
| Growth | $19/mo | 2,000 | $19 |
| Pro | $49/mo | Unlimited | $49 |

**Subscribers needed for $1,000/mo MRR:**

- All Growth: 1,000 ÷ 19 = **53 subscribers**
- All Pro: 1,000 ÷ 49 = **21 subscribers**
- Blended (estimate: 60% Growth / 40% Pro): average revenue ≈ $31/subscriber →
  **~33 subscribers**

So the honest target is roughly **30–55 paying merchants**, depending on the
Growth/Pro mix. That is a small number of stores — the hard part is getting
them to install and stay.

---

## 2. Funnel assumptions (ESTIMATES — label these as guesses in any plan)

The funnel: **unlisted installs → trial starts → paid subscribers**.

Working estimate (conservative, based on typical indie-app benchmarks, not on
StockSense data — we have none yet):

| Stage | Rate (estimate) | Example: 100 installs |
| --- | --- | --- |
| Install → start a trial | 20% | 20 trials |
| Trial → paid | 25% | 5 paid |
| Paid → still paid after 3 months | 70% | ~3.5 retained |

At those rates, 100 unlisted installs ≈ **$155/mo** (5 × $31 blended). To reach
$1,000/mo you need roughly **640 installs** at these rates — or better
conversion, which is what the unlisted phase is for.

**Demand signal (real, from validation research):** Shopify Community threads
about Stocky replacements have 27, 82 and 145 replies, and the topic is active
on r/shopify, r/ecommerce and r/smallbusiness. That tells us merchants are
actively looking — it does not tell us how many will pay. Treat it as
"demand exists," not "demand is proven."

**Timeline estimate:** at ~20–40 unlisted installs/month from the free
channels in `marketing/outreach/launch.md`, plus the public App Store listing
after the 30–50 day review queue, $1,000/mo is plausibly a 6–12 month target.
That is an estimate, not a plan guarantee.

---

## 3. What's automated vs manual

**Automated (already built):**
- Install + OAuth + billing via Shopify's Billing API (14-day trials, recurring
  charges, plan gating server-side)
- Forecast computation (velocity, stockout, reorder, seasonality) — pure code,
  no human in the loop
- Live recompute when merchants edit lead time / safety stock / target days
- PO CSV export
- Stocky CSV import (parsed, previewed, stored)
- GDPR webhooks (data request, redact, shop redact)

**Manual (the founder's job, no tooling exists):**
- Every outreach post and reply (the 4 drafts in `marketing/outreach/`)
- Support: answering merchants, walking them through installs
- The unlisted phase: watching webhooks/billing on real stores, fixing issues
- App Store listing assets + review process (30–50 day queue, $19 fee)
- Moving to Fly.io before onboarding real merchants (DEPLOY.md step 9) — this
  is a manual, account-level step

---

## 4. The 3 biggest risks and mitigations

**Risk 1 — Public review queue (30–50 days) + $19 fee delays the main channel.**
The App Store listing is the biggest distribution lever, and it's the slowest.
*Mitigation:* launch unlisted now, drive direct-link installs from the free
channels, and have the full listing (this file's sibling,
`marketing/app-store-listing.md`) ready so submission is one form-fill when the
time comes.

**Risk 2 — Render free tier wipes SQLite on spin-down (data loss for real
merchants).**
DEPLOY.md documents this: settings, imports and sessions are lost on every
restart. Fine for dev stores, unacceptable for paying merchants.
*Mitigation:* move to Fly.io (~$2–3/mo, persistent volume) BEFORE onboarding
real merchants. This is a hard gate, not a nice-to-have.

**Risk 3 — Expectation mismatch on the Stocky import.**
Merchants migrating from Stocky may expect a full 1:1 replacement. The import
is best-effort reference data: suppliers are not carried over (there is no
supplier management in the app), and the PO builder uses Shopify's unit cost,
not imported supplier data.
*Mitigation:* the listing and outreach copy already state the limits explicitly
("CSV export only", "suppliers must be re-entered"). Keep that honesty — a
merchant who uninstalls in week one because of a surprise is a lost review and
a lost referral.

**Risk 4 (watch item) — Churn from missing features.**
Single-location-at-a-time forecasting and no supplier management will lose some
merchants. *Mitigation:* the roadmap already points at the highest-value gaps
(per-variant settings overrides, ShopifyQL sales history, multi-instance cache)
— see `.ai/plan.md` "Where to continue".

---

## Bottom line

$1,000/mo = ~33 blended subscribers. The product and billing are automated; the
acquisition is not. The unlisted phase exists to convert the real demand signal
into a handful of paying stores and honest feedback before the public listing
lands.
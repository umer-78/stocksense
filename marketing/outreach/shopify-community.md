# Shopify Community reply draft — "Stocky replacement?" threads

**WHEN to post:** Reply within the first few days of a "Stocky replacement?" thread
(several active threads on Shopify Community, e.g. ones with 27, 82 and 145 replies).
Post only if you can genuinely answer the merchant's question first. If the thread is
older than ~2 weeks, skip it and reply to a newer one instead.

**WHERE:** Shopify Community → Apps / Inventory & fulfillment sections. Search
"Stocky replacement" and sort by newest.

---

Stocky shutting down on Aug 31, 2026 left a lot of us scrambling, so here's a
quick rundown of the options I looked at when I was in the same spot. I'm the
builder of one of the tools below, so take the last part with that in mind.

**Option 1: Stay on Shopify native (free).**
Shopify's inventory reports and low-stock alerts still work. You can export
inventory to CSV and do your reorder math in a spreadsheet. This is genuinely
fine if you have a small catalog and a steady sales pattern. The catch: nothing
projects forward. You're reacting to what's already low, not what will be low
in two weeks.

**Option 2: Spreadsheet (free, manual).**
A simple reorder-point sheet works: average daily sales x supplier lead time,
plus a safety-stock buffer. It's honest math and it's free. It just doesn't
update itself, and with hundreds of SKUs it becomes a chore.

**Option 3: A forecasting app.**
This is where I ended up building StockSense. It reads your sales history from
Shopify, computes velocity per variant, and shows days-to-stockout and a
suggested reorder quantity. Every number is explained in plain English, so you
can sanity-check it. It has a purchase order builder that exports a CSV, and it
imports Stocky CSV exports so you don't lose your history.

What it does NOT do yet, honestly: it doesn't email suppliers or place orders
(CSV export only), it doesn't manage suppliers (you re-enter those yourself),
and it forecasts one location at a time. Free plan covers 100 SKUs; paid plans
start at $19/mo.

If you're on a tight budget, start with options 1 or 2. If you want the
forecasting without the spreadsheet upkeep, StockSense is worth a look. Happy
to answer questions either way.
# Reddit post draft — reorder-point math that works without any tool

**WHEN to post:** Weekday morning US time (9–11am ET) when r/shopify and
r/smallbusiness are most active. Post as a text post, not a link. Do not post
the same text to both subreddits on the same day.

**WHERE:** r/shopify (merchants, app-savvy) or r/smallbusiness (broader
audience, less Shopify-specific). Pick one; adapt the last paragraph.

---

Since Stocky shut down, a lot of us are suddenly doing reorder math by hand
again. Here's the simple formula I use, and it works even if you never install
another app.

**The reorder point:**
`reorder point = (average daily sales x supplier lead time in days) + safety stock`

**Safety stock** is just a buffer on top of lead-time demand. A common starting
point is 20% of lead-time demand.

Worked example:
- You sell 3 units/day on average
- Your supplier takes 14 days to deliver
- Lead-time demand = 3 x 14 = 42 units
- Safety stock = 20% of 42 = 8.4, round up to 9
- Reorder point = 42 + 9 = 51 units

So when on-hand inventory hits 51, you order. That's the number that keeps you
from running out while the next shipment is in transit.

**How much to order:** decide how many days of stock you want after the order
arrives (say 30 days). Target level = (3 x 30) + 9 = 99 units. Order quantity =
99 minus what you have on hand.

Two things I learned the hard way:
1. Average daily sales should come from a real window (last 30-60 days), not a
   gut feel. A week of holiday sales will lie to you.
2. If your lead time is longer than your days-to-stockout, you're already in
   trouble. Fix the lead time or the buffer, not the order size.

I built a small Shopify app called StockSense that does exactly this math per
variant and shows the numbers behind each suggestion, since maintaining this in
a spreadsheet gets old past a few hundred SKUs. It's free up to 100 SKUs. But
the formula above is the whole idea, and you can run it in a sheet today.
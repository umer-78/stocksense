import type { SalesRecord } from "./types";

/**
 * Generate `weeks` weeks of sales history starting on a Sunday, with
 * `weekdayQty` units on Mon–Fri and `weekendQty` units on Sat–Sun.
 * Used by the seasonality and forecast tests.
 */
export function weeklyHistory(
  weeks: number,
  weekdayQty: number,
  weekendQty: number,
): SalesRecord[] {
  const records: SalesRecord[] = [];
  // 2026-09-01 is a Tuesday; back up to the preceding Sunday (2026-08-30).
  const start = new Date(Date.UTC(2026, 8, 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  for (let w = 0; w < weeks; w += 1) {
    for (let dow = 0; dow < 7; dow += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + w * 7 + dow);
      const quantity = dow === 0 || dow === 6 ? weekendQty : weekdayQty;
      records.push({ date: date.toISOString().slice(0, 10), quantity });
    }
  }
  return records;
}

/** Generate `days` consecutive days of history starting at `start` (default 2026-09-01). */
export function dailyHistory(days: number, qty: number, start = "2026-09-01"): SalesRecord[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), quantity: qty };
  });
}
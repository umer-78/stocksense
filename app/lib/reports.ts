/**
 * Inventory health reports — the ones merchants used in Stocky and get from
 * every inventory planner: ABC analysis (which products earn the money),
 * dead stock (stock that hasn't sold at all in the sales window) and
 * overstock (more stock than the cover target needs). Pure functions over
 * plain numbers, so the rules are unit-testable.
 */

export interface ReportItem {
  variantId: string;
  sku: string;
  /** "Product — Variant" (or just the product for a single-variant product). */
  title: string;
  available: number;
  unitCost: number | null;
  price: number | null;
  /** Units sold in the sales window. */
  unitsSold: number;
  /** Expected units per day (the forecast). */
  forecastPerDay: number;
}

export type AbcClass = "A" | "B" | "C";

export interface AbcRow extends ReportItem {
  /** Units sold × current price (an estimate: discounts and price changes aren't known). */
  revenue: number;
  /** Share of all revenue in the window (0–1). */
  share: number;
  abc: AbcClass;
}

export interface AbcSummary {
  variants: number;
  revenue: number;
  share: number;
  /** Stock on hand at cost, where cost is known. */
  stockValue: number;
}

/** Revenue cut-offs: A items earn the first 80% of revenue, B the next 15%, C the rest. */
export const ABC_CUTS = { a: 0.8, b: 0.95 } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const stockValue = (item: ReportItem) => (item.unitCost != null ? Math.max(0, item.available) * item.unitCost : 0);

export function abcAnalysis(items: ReportItem[], cuts: { a: number; b: number } = ABC_CUTS): { rows: AbcRow[]; summary: Record<AbcClass, AbcSummary>; total: number } {
  const withRevenue = items.map((item) => ({ ...item, revenue: round2(Math.max(0, item.unitsSold) * (item.price ?? 0)) }));
  const total = withRevenue.reduce((sum, item) => sum + item.revenue, 0);
  const sorted = [...withRevenue].sort((x, y) => y.revenue - x.revenue || x.title.localeCompare(y.title));
  const summary: Record<AbcClass, AbcSummary> = {
    A: { variants: 0, revenue: 0, share: 0, stockValue: 0 },
    B: { variants: 0, revenue: 0, share: 0, stockValue: 0 },
    C: { variants: 0, revenue: 0, share: 0, stockValue: 0 },
  };
  let before = 0;
  const rows: AbcRow[] = sorted.map((item) => {
    const share = total > 0 ? item.revenue / total : 0;
    // The item that crosses a cut-off still belongs to the higher class.
    const abc: AbcClass = item.revenue <= 0 ? "C" : before < cuts.a ? "A" : before < cuts.b ? "B" : "C";
    before += share;
    const s = summary[abc];
    s.variants += 1;
    s.revenue = round2(s.revenue + item.revenue);
    s.share += share;
    s.stockValue = round2(s.stockValue + stockValue(item));
    return { ...item, share, abc };
  });
  return { rows, summary, total: round2(total) };
}

export interface DeadStockRow extends ReportItem {
  /** Stock at cost, or null when the cost isn't known. */
  stockValue: number | null;
}

/** In stock, but not one unit sold in the whole sales window. Most money tied up first. */
export function deadStock(items: ReportItem[]): DeadStockRow[] {
  return items
    .filter((item) => item.available > 0 && item.unitsSold <= 0)
    .map((item) => ({ ...item, stockValue: item.unitCost != null ? round2(item.available * item.unitCost) : null }))
    .sort((x, y) => (y.stockValue ?? -1) - (x.stockValue ?? -1) || y.available - x.available);
}

export interface OverstockRow extends ReportItem {
  /** Days the stock lasts at the forecast rate (Infinity when the forecast is zero). */
  daysOfCover: number;
  /** Units beyond the cover target. */
  excessUnits: number;
  /** Those units at cost, or null when the cost isn't known. */
  excessValue: number | null;
}

/**
 * Selling, but with far more stock than needed: more than `limitDays` of
 * cover (default three times the cover target). Excess is what's above the
 * cover target itself. Items that sold nothing are dead stock, not overstock.
 */
export function overstock(items: ReportItem[], targetDays: number, limitDays = Math.max(60, targetDays * 3)): OverstockRow[] {
  const rows: OverstockRow[] = [];
  for (const item of items) {
    if (item.available <= 0 || item.unitsSold <= 0) {
      continue;
    }
    const daysOfCover = item.forecastPerDay > 0 ? item.available / item.forecastPerDay : Number.POSITIVE_INFINITY;
    if (daysOfCover <= limitDays) {
      continue;
    }
    const excessUnits = Math.max(0, Math.floor(item.available - item.forecastPerDay * targetDays));
    rows.push({ ...item, daysOfCover, excessUnits, excessValue: item.unitCost != null ? round2(excessUnits * item.unitCost) : null });
  }
  return rows.sort((x, y) => (y.excessValue ?? -1) - (x.excessValue ?? -1) || y.excessUnits - x.excessUnits);
}

/** Units sold on or after `since` (YYYY-MM-DD). */
export function unitsSince(sales: Array<{ date: string | Date; quantity: number }>, since: string): number {
  let units = 0;
  for (const sale of sales) {
    const day = typeof sale.date === "string" ? sale.date.slice(0, 10) : sale.date.toISOString().slice(0, 10);
    if (day >= since && Number.isFinite(sale.quantity) && sale.quantity > 0) {
      units += sale.quantity;
    }
  }
  return units;
}

function csvCell(value: string): string {
  // Neutralize leading =,+,-,@ so spreadsheets don't run a title as a formula (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A report as CSV: text columns quoted, numbers as they are. */
export function reportCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const line = (cells: Array<string | number | null>) =>
    cells.map((cell) => (cell == null ? "" : typeof cell === "number" ? (Number.isFinite(cell) ? String(cell) : "") : csvCell(cell))).join(",");
  return [headers.map(csvCell).join(","), ...rows.map(line)].join("\n");
}

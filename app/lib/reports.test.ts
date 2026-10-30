import { describe, expect, it } from "vitest";
import { abcAnalysis, deadStock, overstock, reportCsv, unitsSince, type ReportItem } from "./reports";

const item = (over: Partial<ReportItem> & { title: string }): ReportItem => ({
  variantId: `gid://shopify/ProductVariant/${over.title}`,
  sku: over.title.toUpperCase(),
  available: 10,
  unitCost: 5,
  price: 10,
  unitsSold: 0,
  forecastPerDay: 0,
  ...over,
});

describe("abcAnalysis", () => {
  it("puts the products earning the first 80% of revenue in A, the next 15% in B, the rest in C", () => {
    const { rows, summary, total } = abcAnalysis([
      item({ title: "boots", unitsSold: 70 }), // 700 = 70%
      item({ title: "socks", unitsSold: 20 }), // 200 → crosses 80%: still A
      item({ title: "laces", unitsSold: 6 }), // 60 → B (90% before it)
      item({ title: "wax", unitsSold: 4 }), // 40 → C (96% before it)
      item({ title: "brush", unitsSold: 0 }), // nothing sold → C
    ]);
    expect(total).toBe(1000);
    expect(rows.map((r) => [r.title, r.abc])).toEqual([
      ["boots", "A"],
      ["socks", "A"],
      ["laces", "B"],
      ["wax", "C"],
      ["brush", "C"],
    ]);
    expect(summary.A.variants).toBe(2);
    expect(summary.A.revenue).toBe(900);
    expect(summary.A.share).toBeCloseTo(0.9);
    expect(summary.C.stockValue).toBe(100);
  });

  it("handles a shop with no sales", () => {
    const { rows, total } = abcAnalysis([item({ title: "a" })]);
    expect(total).toBe(0);
    expect(rows[0].abc).toBe("C");
  });
});

describe("deadStock", () => {
  it("lists stock that hasn't sold at all, most money tied up first", () => {
    const rows = deadStock([
      item({ title: "selling", unitsSold: 3 }),
      item({ title: "cheap", available: 50, unitCost: 1 }),
      item({ title: "dear", available: 4, unitCost: 40 }),
      item({ title: "no-cost", available: 99, unitCost: null }),
      item({ title: "out", available: 0 }),
    ]);
    expect(rows.map((r) => [r.title, r.stockValue])).toEqual([
      ["dear", 160],
      ["cheap", 50],
      ["no-cost", null],
    ]);
  });
});

describe("overstock", () => {
  it("flags selling items with far more cover than the target and works out the excess", () => {
    const rows = overstock(
      [
        item({ title: "fine", available: 30, unitsSold: 30, forecastPerDay: 1 }), // 30 days
        item({ title: "heavy", available: 400, unitsSold: 60, forecastPerDay: 2, unitCost: 3 }), // 200 days
        item({ title: "stale", available: 25, unitsSold: 2, forecastPerDay: 0 }), // sold once, forecast now zero
        item({ title: "dead", available: 80, unitsSold: 0 }),
      ],
      30,
    );
    expect(rows.map((r) => r.title)).toEqual(["heavy", "stale"]);
    expect(rows[0]).toMatchObject({ daysOfCover: 200, excessUnits: 340, excessValue: 1020 });
    expect(rows[1].daysOfCover).toBe(Number.POSITIVE_INFINITY);
    expect(rows[1].excessUnits).toBe(25);
  });
});

describe("helpers", () => {
  it("counts units sold since a date", () => {
    expect(unitsSince([{ date: "2026-09-01", quantity: 5 }, { date: "2026-10-02", quantity: 3 }, { date: new Date("2026-10-03T00:00:00Z"), quantity: 2 }], "2026-10-01")).toBe(5);
  });

  it("writes CSV that spreadsheets won't run as formulas", () => {
    expect(reportCsv(["SKU", "Units"], [["=HYPERLINK()", 3], ['Say "hi"', null]])).toBe('"SKU","Units"\n"\'=HYPERLINK()",3\n"Say ""hi""",');
  });
});

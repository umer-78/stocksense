import { describe, expect, it } from "vitest";
import { toCsv } from "./purchase-order";

describe("toCsv", () => {
  it("writes one line per variant with totals", () => {
    const csv = toCsv([
      { sku: "TR-9", productTitle: 'Trail "Runner"', variantTitle: "UK 9", qty: 17, unitCost: 48.5 },
      { sku: "CAP", productTitle: "Cap", variantTitle: "Default Title", qty: 3, unitCost: null },
    ]);
    expect(csv.split("\n")).toEqual([
      "SKU,Product,Variant,Quantity,Unit cost,Total",
      '"TR-9","Trail ""Runner""","UK 9",17,48.50,824.50',
      '"CAP","Cap","",3,,',
    ]);
  });

  it("skips zero quantities and neutralizes spreadsheet formulas", () => {
    const csv = toCsv([
      { sku: "=HYPERLINK(1)", productTitle: "+cmd", variantTitle: "x", qty: 1, unitCost: 1 },
      { sku: "Z", productTitle: "Zero", variantTitle: "x", qty: 0, unitCost: 1 },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(1)","'+cmd"`);
    expect(csv).not.toContain("Zero");
  });
});

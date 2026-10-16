/** Purchase-order CSV export (pure, so it is testable). */

export interface PoLine {
  sku: string;
  productTitle: string;
  variantTitle: string;
  qty: number;
  unitCost: number | null;
}

function csvCell(value: string): string {
  // Quote every text cell; neutralize leading =,+,-,@ so spreadsheets do not
  // run a product title as a formula (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: PoLine[]): string {
  const header = "SKU,Product,Variant,Quantity,Unit cost,Total";
  const lines = rows
    .filter((row) => row.qty > 0)
    .map((row) => {
      const variant = row.variantTitle === "Default Title" ? "" : row.variantTitle;
      const cost = row.unitCost;
      return [
        csvCell(row.sku),
        csvCell(row.productTitle),
        csvCell(variant),
        row.qty,
        cost != null ? cost.toFixed(2) : "",
        cost != null ? (cost * row.qty).toFixed(2) : "",
      ].join(",");
    });
  return [header, ...lines].join("\n");
}

import { describe, expect, it } from "vitest";
import { parseCsvLines, parseStockyCsv } from "./parser";

const VARIANTS_CSV = `Variant SKU,Variant Name,Product Name,On Hand,Available,Committed,Incoming,Location,Cost,Lead Time
SKU-001,Black / Large,T-Shirt,25,20,5,10,Main Warehouse,8.50,14
SKU-002,White / Small,T-Shirt,4,3,1,0,Retail Store,7.00,10
,No Sku Row,Should Skip,9,9,0,0,Main Warehouse,1.00,5`;

const PO_CSV = `PO Number,Supplier,Variant SKU,Variant Name,Quantity,Received,Cost,Ordered At
PO-1001,Acme Fabrics,SKU-001,Black / Large,120,120,8.50,2025-08-01
PO-1002,Acme Fabrics,SKU-002,White / Small,60,0,7.00,2025-09-15`;

const QUOTED_CSV = `"Variant SKU","Variant Name","Product Name","On Hand"
"SKU-001","Black, Large","T-Shirt, Cotton",10`;

describe("parseCsvLines", () => {
  it("splits rows and fields, handling quoted commas", () => {
    const rows = parseCsvLines(QUOTED_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("SKU-001");
    expect(rows[1][1]).toBe("Black, Large");
    expect(rows[1][2]).toBe("T-Shirt, Cotton");
    expect(rows[1][3]).toBe("10");
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsvLines("a,b\r\nc,d\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseStockyCsv", () => {
  it("parses a variants export", () => {
    const result = parseStockyCsv(VARIANTS_CSV);
    expect(result.kind).toBe("variants");
    expect(result.rows).toHaveLength(2);
    expect(result.skippedRows).toBe(1);

    const first = result.rows[0];
    expect(first.kind).toBe("variant");
    if (first.kind === "variant") {
      expect(first.sku).toBe("SKU-001");
      expect(first.variantName).toBe("Black / Large");
      expect(first.productName).toBe("T-Shirt");
      expect(first.onHand).toBe(25);
      expect(first.available).toBe(20);
      expect(first.committed).toBe(5);
      expect(first.incoming).toBe(10);
      expect(first.location).toBe("Main Warehouse");
      expect(first.cost).toBe(8.5);
      expect(first.leadTimeDays).toBe(14);
    }
  });

  it("parses a purchase orders export", () => {
    const result = parseStockyCsv(PO_CSV);
    expect(result.kind).toBe("purchase-orders");
    expect(result.rows).toHaveLength(2);

    const first = result.rows[0];
    expect(first.kind).toBe("po");
    if (first.kind === "po") {
      expect(first.poNumber).toBe("PO-1001");
      expect(first.supplier).toBe("Acme Fabrics");
      expect(first.sku).toBe("SKU-001");
      expect(first.quantity).toBe(120);
      expect(first.received).toBe(120);
      expect(first.cost).toBe(8.5);
      expect(first.orderedAt).toBe("2025-08-01");
    }
  });

  it("parses quoted fields with commas", () => {
    const result = parseStockyCsv(QUOTED_CSV);
    expect(result.kind).toBe("variants");
    expect(result.rows).toHaveLength(1);
    if (result.rows[0].kind === "variant") {
      expect(result.rows[0].variantName).toBe("Black, Large");
      expect(result.rows[0].productName).toBe("T-Shirt, Cotton");
    }
  });

  it("reports unknown kind for unrecognized headers", () => {
    const result = parseStockyCsv("foo,bar,baz\n1,2,3\n");
    expect(result.kind).toBe("unknown");
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports an error for an empty file", () => {
    const result = parseStockyCsv("");
    expect(result.kind).toBe("unknown");
    expect(result.errors).toContain("Empty file");
  });

  it("reports an error when no rows have a SKU", () => {
    const result = parseStockyCsv("Variant SKU,On Hand\n,5\n");
    expect(result.rows).toHaveLength(0);
    expect(result.skippedRows).toBe(1);
    expect(result.errors.some((e) => e.includes("No rows with a SKU"))).toBe(true);
  });
});
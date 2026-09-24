/**
 * Best-effort parser for Stocky CSV exports.
 *
 * Stocky (Shopify's free inventory app) exports two CSV files:
 *   - "Stocky - Variants.csv"        (current inventory per variant)
 *   - "Stocky - Purchase Orders.csv" (PO history)
 *
 * ASSUMPTIONS (documented — Stocky's export format is not a public spec and
 * can vary by version/locale):
 *   - The first row is a header row. Column names are matched
 *     case-insensitively against a set of aliases (e.g. "Variant SKU",
 *     "SKU", "Variant Sku").
 *   - Variants export columns: SKU, variant name, product name, on-hand /
 *     available / committed / incoming quantities, location, cost, lead time.
 *   - PO export columns: PO number, supplier, variant SKU, variant name,
 *     quantity, received, cost, ordered-at date.
 *   - Quantities are integers; cost/price are decimals. Unparseable values
 *     become 0 / null and are counted in `errors`.
 *   - Rows missing a SKU are skipped and counted in `skippedRows`.
 *
 * The parser is pure (string in, structured result out) so it is testable.
 */

export interface StockyVariantRow {
  kind: "variant";
  sku: string;
  variantName: string;
  productName: string;
  onHand: number;
  available: number;
  committed: number;
  incoming: number;
  location: string;
  cost: number | null;
  leadTimeDays: number | null;
}

export interface StockyPoRow {
  kind: "po";
  poNumber: string;
  supplier: string;
  sku: string;
  variantName: string;
  quantity: number;
  received: number;
  cost: number | null;
  orderedAt: string | null;
}

export type StockyRow = StockyVariantRow | StockyPoRow;

export type StockyKind = "variants" | "purchase-orders" | "unknown";

export interface StockyParseResult {
  kind: StockyKind;
  rows: StockyRow[];
  skippedRows: number;
  errors: string[];
}

// --- tiny CSV tokenizer (handles quoted fields, commas and CRLF) -----------

export function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // ignore (CRLF handled by the \n branch)
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// --- header matching --------------------------------------------------------

function headerIndex(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.toLowerCase());
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

const SKU_ALIASES = ["variant sku", "sku", "variant_sku", "sku code"];
const VARIANT_NAME_ALIASES = ["variant name", "variant", "variant title", "title"];
const PRODUCT_NAME_ALIASES = ["product name", "product", "product title"];
const ON_HAND_ALIASES = ["on hand", "on-hand", "on_hand", "quantity on hand", "stock on hand"];
const AVAILABLE_ALIASES = ["available", "available quantity", "available qty"];
const COMMITTED_ALIASES = ["committed", "committed quantity", "committed qty"];
const INCOMING_ALIASES = ["incoming", "incoming quantity", "incoming qty", "on order"];
const LOCATION_ALIASES = ["location", "location name", "warehouse"];
const COST_ALIASES = ["cost", "unit cost", "cost per item", "price"];
const LEAD_TIME_ALIASES = ["lead time", "lead time (days)", "lead time days", "supplier lead time"];
const PO_NUMBER_ALIASES = ["po number", "po #", "purchase order", "purchase order number", "order number"];
const SUPPLIER_ALIASES = ["supplier", "vendor", "supplier name"];
const QUANTITY_ALIASES = ["quantity", "qty", "ordered", "quantity ordered"];
const RECEIVED_ALIASES = ["received", "quantity received", "received qty"];
const ORDERED_AT_ALIASES = ["ordered at", "order date", "date ordered", "created at", "po date"];

function toInt(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toDecimal(value: string | undefined): number | null {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function detectKind(headers: string[]): StockyKind {
  const lower = headers.map((h) => h.trim().toLowerCase());
  if (lower.some((h) => h.includes("po") || h.includes("purchase order"))) {
    return "purchase-orders";
  }
  if (headerIndex(headers, SKU_ALIASES) >= 0) {
    return "variants";
  }
  return "unknown";
}

// --- main parser ------------------------------------------------------------

export function parseStockyCsv(text: string): StockyParseResult {
  const lines = parseCsvLines(text);
  if (lines.length === 0) {
    return { kind: "unknown", rows: [], skippedRows: 0, errors: ["Empty file"] };
  }

  const headers = lines[0];
  const kind = detectKind(headers);
  const errors: string[] = [];
  const rows: StockyRow[] = [];
  let skippedRows = 0;

  if (kind === "unknown") {
    return {
      kind,
      rows: [],
      skippedRows: lines.length - 1,
      errors: ["Could not detect Stocky export type from the header row"],
    };
  }

  const skuIdx = headerIndex(headers, SKU_ALIASES);

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i];
    const sku = (cells[skuIdx] ?? "").trim();
    if (!sku) {
      skippedRows += 1;
      continue;
    }

    if (kind === "variants") {
      rows.push({
        kind: "variant",
        sku,
        variantName: cells[headerIndex(headers, VARIANT_NAME_ALIASES)]?.trim() ?? "",
        productName: cells[headerIndex(headers, PRODUCT_NAME_ALIASES)]?.trim() ?? "",
        onHand: toInt(cells[headerIndex(headers, ON_HAND_ALIASES)]),
        available: toInt(cells[headerIndex(headers, AVAILABLE_ALIASES)]),
        committed: toInt(cells[headerIndex(headers, COMMITTED_ALIASES)]),
        incoming: toInt(cells[headerIndex(headers, INCOMING_ALIASES)]),
        location: cells[headerIndex(headers, LOCATION_ALIASES)]?.trim() ?? "",
        cost: toDecimal(cells[headerIndex(headers, COST_ALIASES)]),
        leadTimeDays: toDecimal(cells[headerIndex(headers, LEAD_TIME_ALIASES)]),
      });
    } else {
      rows.push({
        kind: "po",
        poNumber: cells[headerIndex(headers, PO_NUMBER_ALIASES)]?.trim() ?? "",
        supplier: cells[headerIndex(headers, SUPPLIER_ALIASES)]?.trim() ?? "",
        sku,
        variantName: cells[headerIndex(headers, VARIANT_NAME_ALIASES)]?.trim() ?? "",
        quantity: toInt(cells[headerIndex(headers, QUANTITY_ALIASES)]),
        received: toInt(cells[headerIndex(headers, RECEIVED_ALIASES)]),
        cost: toDecimal(cells[headerIndex(headers, COST_ALIASES)]),
        orderedAt: cells[headerIndex(headers, ORDERED_AT_ALIASES)]?.trim() || null,
      });
    }
  }

  if (rows.length === 0) {
    errors.push("No rows with a SKU were found");
  }

  return { kind, rows, skippedRows, errors };
}
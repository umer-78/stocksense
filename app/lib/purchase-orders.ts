/**
 * Saved purchase orders: statuses, receiving and the supplier email.
 * Pure functions so the rules are unit-testable; persistence lives in
 * `purchase-orders.server.ts`.
 */

export type PoStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

export const PO_STATUSES: readonly PoStatus[] = ["draft", "sent", "partial", "received", "cancelled"];

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};

export function isPoStatus(value: unknown): value is PoStatus {
  return typeof value === "string" && (PO_STATUSES as readonly string[]).includes(value);
}

export function poLabel(number: number): string {
  return `PO-${String(number).padStart(4, "0")}`;
}

export interface PoLineInput {
  variantId: string;
  sku: string;
  title: string;
  qty: number;
  unitCost: number | null;
}

const MAX_LINES = 500;
const MAX_QTY = 1_000_000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Validate purchase-order lines posted from the builder. Drops lines without a
 * variant or with a quantity below 1, merges duplicates and caps sizes.
 */
export function sanitizeLines(input: unknown): PoLineInput[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const byVariant = new Map<string, PoLineInput>();
  for (const raw of input.slice(0, MAX_LINES)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const variantId = text(row.variantId, 200);
    const qty = Math.min(MAX_QTY, Math.floor(Number(row.qty)));
    if (!variantId.startsWith("gid://shopify/ProductVariant/") || !Number.isFinite(qty) || qty < 1) {
      continue;
    }
    const cost = row.unitCost == null || row.unitCost === "" ? null : Number(row.unitCost);
    const existing = byVariant.get(variantId);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + qty);
      continue;
    }
    byVariant.set(variantId, {
      variantId,
      sku: text(row.sku, 100),
      title: text(row.title, 300),
      qty,
      unitCost: cost != null && Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
    });
  }
  return [...byVariant.values()];
}

export interface ReceivableLine {
  id: number;
  qty: number;
  receivedQty: number;
}

/**
 * Add a receipt (units received now, per line id) to the lines. Each line's
 * total is kept between 0 and the ordered quantity.
 */
export function applyReceipt(lines: ReceivableLine[], receipt: Record<number, number>): ReceivableLine[] {
  return lines.map((line) => {
    const now = Math.floor(Number(receipt[line.id] ?? 0));
    if (!Number.isFinite(now) || now === 0) {
      return line;
    }
    const total = Math.min(line.qty, Math.max(0, line.receivedQty + now));
    return { ...line, receivedQty: total };
  });
}

/** Status of a sent order after receiving: received, partly received, or still sent. */
export function statusAfterReceiving(lines: Array<{ qty: number; receivedQty: number }>): "sent" | "partial" | "received" {
  if (lines.length > 0 && lines.every((line) => line.receivedQty >= line.qty)) {
    return "received";
  }
  return lines.some((line) => line.receivedQty > 0) ? "partial" : "sent";
}

export function poTotals(lines: Array<{ qty: number; unitCost: number | null }>): {
  units: number;
  cost: number;
  missingCost: boolean;
} {
  let units = 0;
  let cost = 0;
  let missingCost = false;
  for (const line of lines) {
    units += line.qty;
    if (line.unitCost == null) {
      missingCost = true;
    } else {
      cost += line.unitCost * line.qty;
    }
  }
  return { units, cost: Math.round(cost * 100) / 100, missingCost };
}

export interface PoForEmail {
  number: number;
  note: string | null;
  lines: Array<{ sku: string; title: string; qty: number }>;
}

/** Subject and plain-text body for sending the order to a supplier. */
export function poEmail(po: PoForEmail, supplierName: string | null, shopName: string): { subject: string; body: string } {
  const label = poLabel(po.number);
  const greeting = supplierName ? `Hello ${supplierName},` : "Hello,";
  const lines = po.lines.map((line) => `- ${line.qty} × ${line.title}${line.sku ? ` (SKU ${line.sku})` : ""}`);
  const body = [
    greeting,
    "",
    `Please supply the following for purchase order ${label}:`,
    "",
    ...lines,
    "",
    ...(po.note ? [po.note, ""] : []),
    "Please confirm the expected delivery date.",
    "",
    "Thank you,",
    shopName,
  ].join("\n");
  return { subject: `Purchase order ${label} from ${shopName}`, body };
}

/** Email clients cut long mailto links, so the body is shortened past this length. */
export const MAILTO_BODY_LIMIT = 1800;

export function mailtoUrl(to: string | null, subject: string, body: string): string {
  const shortBody =
    body.length > MAILTO_BODY_LIMIT
      ? `${body.slice(0, MAILTO_BODY_LIMIT)}\n\n[Order shortened: attach the CSV for the full list.]`
      : body;
  return `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shortBody)}`;
}

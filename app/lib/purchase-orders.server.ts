/** Purchase-order persistence (Prisma). Every query is scoped to the shop. */
import { Prisma } from "@prisma/client";

import db from "../db.server";
import {
  applyReceipt,
  isPoStatus,
  poTotals,
  statusAfterReceiving,
  type PoLineInput,
  type PoStatus,
} from "./purchase-orders";

export interface PoSummary {
  id: number;
  number: number;
  status: PoStatus;
  supplierName: string | null;
  createdAt: string;
  sentAt: string | null;
  lineCount: number;
  units: number;
  receivedUnits: number;
  cost: number;
  missingCost: boolean;
}

export interface PoDetail extends PoSummary {
  note: string | null;
  closedAt: string | null;
  supplier: { id: number; name: string; email: string | null } | null;
  lines: Array<{ id: number; variantId: string; sku: string; title: string; qty: number; receivedQty: number; unitCost: number | null }>;
}

type PoRow = Prisma.PurchaseOrderGetPayload<{ include: { lines: true; supplier: true } }>;

function toSummary(row: PoRow): PoSummary {
  const totals = poTotals(row.lines);
  return {
    id: row.id,
    number: row.number,
    status: isPoStatus(row.status) ? row.status : "draft",
    supplierName: row.supplier?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    lineCount: row.lines.length,
    units: totals.units,
    receivedUnits: row.lines.reduce((sum, line) => sum + line.receivedQty, 0),
    cost: totals.cost,
    missingCost: totals.missingCost,
  };
}

export async function listPurchaseOrders(shop: string, take = 50): Promise<PoSummary[]> {
  const rows = await db.purchaseOrder.findMany({
    where: { shop },
    orderBy: { number: "desc" },
    take,
    include: { lines: true, supplier: true },
  });
  return rows.map(toSummary);
}

export async function getPurchaseOrder(shop: string, id: number): Promise<PoDetail | null> {
  const row = await db.purchaseOrder.findFirst({
    where: { shop, id },
    include: { lines: { orderBy: { id: "asc" } }, supplier: true },
  });
  if (!row) {
    return null;
  }
  return {
    ...toSummary(row),
    note: row.note,
    closedAt: row.closedAt?.toISOString() ?? null,
    supplier: row.supplier ? { id: row.supplier.id, name: row.supplier.name, email: row.supplier.email } : null,
    lines: row.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      sku: line.sku,
      title: line.title,
      qty: line.qty,
      receivedQty: line.receivedQty,
      unitCost: line.unitCost,
    })),
  };
}

/** Save a new draft order. Order numbers count up per shop (PO-0001, PO-0002, ...). */
export async function createPurchaseOrder(
  shop: string,
  input: { supplierId: number | null; note: string | null; lines: PoLineInput[] },
): Promise<number> {
  const supplierId =
    input.supplierId != null && (await db.supplier.count({ where: { shop, id: input.supplierId } })) > 0
      ? input.supplierId
      : null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.purchaseOrder.findFirst({ where: { shop }, orderBy: { number: "desc" }, select: { number: true } });
        const created = await tx.purchaseOrder.create({
          data: {
            shop,
            number: (last?.number ?? 0) + 1,
            supplierId,
            note: input.note,
            lines: { create: input.lines.map((line) => ({ ...line })) },
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      // Two saves at once can pick the same number; the unique index rejects one, so retry.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not number the purchase order. Try again.");
}

export async function markSent(shop: string, id: number): Promise<void> {
  await db.purchaseOrder.updateMany({ where: { shop, id, status: "draft" }, data: { status: "sent", sentAt: new Date() } });
}

/** Record received units (per line id). Corrections may be negative. */
export async function receive(shop: string, id: number, receipt: Record<number, number>): Promise<void> {
  await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { shop, id }, include: { lines: true } });
    if (!po || !["sent", "partial", "received"].includes(po.status)) {
      return;
    }
    const updated = applyReceipt(po.lines, receipt);
    for (const line of updated) {
      const before = po.lines.find((l) => l.id === line.id);
      if (before && before.receivedQty !== line.receivedQty) {
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
      }
    }
    const status = statusAfterReceiving(updated);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status, closedAt: status === "received" ? new Date() : null },
    });
  });
}

export async function cancel(shop: string, id: number): Promise<void> {
  await db.purchaseOrder.updateMany({
    where: { shop, id, status: { in: ["draft", "sent", "partial"] } },
    data: { status: "cancelled", closedAt: new Date() },
  });
}

export async function deleteDraft(shop: string, id: number): Promise<void> {
  await db.purchaseOrder.deleteMany({ where: { shop, id, status: "draft" } });
}

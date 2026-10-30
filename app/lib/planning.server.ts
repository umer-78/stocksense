/** Load supplier lead times and open purchase-order quantities for a shop. */
import db from "../db.server";
import { OPEN_PO_STATUSES, openQtyByVariant, supplierLeadTimeMap, type PlanningInputs } from "./planning";

export async function getPlanningInputs(shop: string): Promise<PlanningInputs> {
  const [suppliers, lines] = await Promise.all([
    db.supplier.findMany({ where: { shop }, orderBy: { id: "asc" }, select: { vendor: true, leadTimeDays: true } }),
    db.purchaseOrderLine.findMany({
      where: { po: { shop, status: { in: [...OPEN_PO_STATUSES] } } },
      select: { variantId: true, qty: true, receivedQty: true, po: { select: { status: true } } },
    }),
  ]);
  return {
    supplierLeadTimes: supplierLeadTimeMap(suppliers),
    openPoQty: openQtyByVariant(
      lines.map((line) => ({ variantId: line.variantId, qty: line.qty, receivedQty: line.receivedQty, status: line.po.status })),
    ),
  };
}

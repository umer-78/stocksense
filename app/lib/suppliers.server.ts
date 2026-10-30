/** Supplier persistence (Prisma). Every query is scoped to the shop. */
import db from "../db.server";
import type { SupplierInput, SupplierRecord } from "./suppliers";

const SELECT = { id: true, name: true, vendor: true, email: true, leadTimeDays: true, notes: true } as const;

export async function listSuppliers(shop: string): Promise<SupplierRecord[]> {
  return db.supplier.findMany({ where: { shop }, orderBy: { name: "asc" }, select: SELECT });
}

export async function getSupplier(shop: string, id: number): Promise<SupplierRecord | null> {
  return db.supplier.findFirst({ where: { shop, id }, select: SELECT });
}

export async function createSupplier(shop: string, values: SupplierInput): Promise<number> {
  const row = await db.supplier.create({ data: { shop, ...values }, select: { id: true } });
  return row.id;
}

export async function updateSupplier(shop: string, id: number, values: SupplierInput): Promise<boolean> {
  const result = await db.supplier.updateMany({ where: { shop, id }, data: values });
  return result.count > 0;
}

/** Purchase orders keep their history; the supplier link is cleared. */
export async function deleteSupplier(shop: string, id: number): Promise<void> {
  await db.$transaction([
    db.purchaseOrder.updateMany({ where: { shop, supplierId: id }, data: { supplierId: null } }),
    db.supplier.deleteMany({ where: { shop, id } }),
  ]);
}

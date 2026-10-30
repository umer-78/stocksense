/**
 * Delete everything Forelark stores for a shop. Used on uninstall and on
 * Shopify's shop/redact request, as the privacy policy promises.
 */
import db from "../db.server";

export async function deleteShopData(shop: string, options: { keepPrivacyLog?: boolean } = {}): Promise<void> {
  await db.$transaction([
    db.shopSettings.deleteMany({ where: { shop } }),
    db.variantSettings.deleteMany({ where: { shop } }),
    db.shopSnapshot.deleteMany({ where: { shop } }),
    db.stockyImport.deleteMany({ where: { shop } }),
    db.purchaseOrder.deleteMany({ where: { shop } }),
    db.supplier.deleteMany({ where: { shop } }),
    db.stockAlert.deleteMany({ where: { shop } }),
    db.apiKey.deleteMany({ where: { shop } }),
    db.shopPlan.deleteMany({ where: { shop } }),
    ...(options.keepPrivacyLog ? [] : [db.privacyEvent.deleteMany({ where: { shop } })]),
    db.session.deleteMany({ where: { shop } }),
  ]);
}

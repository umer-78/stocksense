/**
 * Low-stock alerts from Shopify's inventory_levels/update webhook.
 *
 * Each stock change is applied to the stored snapshot's copy of that variant
 * and the forecast is re-run. When the variant becomes "Reorder now", Forelark
 * records an alert and fires its Shopify Flow trigger (at most once a day per
 * variant), so merchants can get an email, Slack message or task from Flow.
 */
import db from "../db.server";
import { FLOW_TRIGGER_HANDLE, flowPayload, numericId, shouldAlert } from "./alerts";
import { PLANS, canUseFeature } from "./billing/plans";
import { buildDashboardRow } from "./dashboard";
import { cachedPlan } from "./plan-cache.server";
import { withPlanning } from "./planning";
import { getPlanningInputs } from "./planning.server";
import { getShopSettings, getVariantOverride } from "./settings.server";
import { inventoryAt, salesFor } from "./shopify/adapter";
import { getStoredSnapshot } from "./shopify/snapshot.server";

const FLOW_MUTATION = `#graphql
  mutation ForelarkReorderAlert($handle: String, $payload: JSON) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors { field message }
    }
  }`;

export interface AlertOutcome {
  alerted: boolean;
  reason: string;
}

export async function handleInventoryLevelUpdate(
  shop: string,
  payload: Record<string, unknown>,
  now = new Date(),
): Promise<AlertOutcome> {
  const plan = await cachedPlan(shop);
  if (!canUseFeature(plan, "alerts")) {
    return { alerted: false, reason: "plan" };
  }
  const itemId = numericId(payload.inventory_item_id);
  const locationId = numericId(payload.location_id);
  const available = Number(payload.available);
  if (itemId === null || locationId === null || !Number.isFinite(available)) {
    return { alerted: false, reason: "payload" };
  }

  const snapshot = await getStoredSnapshot(shop);
  if (!snapshot) {
    return { alerted: false, reason: "no-snapshot" };
  }
  const index = snapshot.variants.findIndex((v) => v.inventoryItemId === `gid://shopify/InventoryItem/${itemId}`);
  const limit = PLANS[plan].skuLimit;
  if (index < 0 || (limit != null && index >= limit)) {
    return { alerted: false, reason: "untracked" };
  }
  const catalogVariant = snapshot.variants[index];
  const locationGid = `gid://shopify/Location/${locationId}`;
  const levels = catalogVariant.levels.map((level) =>
    level.locationId === locationGid ? { ...level, available } : level,
  );

  const settings = await getShopSettings(shop);
  const location = settings.locationId && levels.some((l) => l.locationId === settings.locationId) ? settings.locationId : null;
  if (location && location !== locationGid) {
    return { alerted: false, reason: "other-location" };
  }
  const inventory = inventoryAt({ ...catalogVariant, levels }, location);
  if (!inventory) {
    return { alerted: false, reason: "untracked" };
  }
  const [planning, override] = await Promise.all([getPlanningInputs(shop), getVariantOverride(shop, catalogVariant.variantId)]);
  const { variant, supplierLeadTime } = withPlanning(inventory, planning);
  const row = buildDashboardRow(variant, salesFor(snapshot, variant.variantId), { ...settings, lookbackDays: snapshot.lookbackDays }, {
    allowSeasonal: canUseFeature(plan, "seasonality"),
    asOf: snapshot.windowEnd,
    override,
    supplierLeadTime,
  });

  const last = await db.stockAlert.findFirst({
    where: { shop, variantId: variant.variantId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!shouldAlert(row.status, last?.createdAt ?? null, now)) {
    return { alerted: false, reason: row.status === "critical" ? "cooldown" : row.status };
  }

  const alert = await db.stockAlert.create({
    data: {
      shop,
      variantId: variant.variantId,
      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle,
      sku: variant.sku,
      available: variant.available,
      daysToStockout: Number.isFinite(row.daysToStockout) ? row.daysToStockout : null,
      suggestedOrderQty: row.suggestedOrderQty,
    },
    select: { id: true },
  });

  const flow = flowPayload({ ...variant, daysToStockout: row.daysToStockout, suggestedOrderQty: row.suggestedOrderQty });
  if (flow) {
    try {
      const { unauthenticated } = await import("../shopify.server");
      const { admin } = await unauthenticated.admin(shop);
      const response = await admin.graphql(FLOW_MUTATION, { variables: { handle: FLOW_TRIGGER_HANDLE, payload: flow } });
      const body = (await response.json()) as { data?: { flowTriggerReceive?: { userErrors?: Array<{ message: string }> } } };
      const errors = body.data?.flowTriggerReceive?.userErrors ?? [];
      if (errors.length === 0) {
        await db.stockAlert.update({ where: { id: alert.id }, data: { flowSent: true } });
      } else {
        console.warn("[forelark] Flow trigger rejected", errors.map((e) => e.message).join("; "));
      }
    } catch (error) {
      console.error("[forelark] Flow trigger failed", error);
    }
  }
  return { alerted: true, reason: "critical" };
}

export interface AlertListItem {
  id: number;
  variantId: string;
  title: string;
  sku: string;
  available: number;
  daysToStockout: number | null;
  suggestedOrderQty: number;
  flowSent: boolean;
  createdAt: string;
}

export async function listAlerts(shop: string, take = 50): Promise<AlertListItem[]> {
  const rows = await db.stockAlert.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take });
  return rows.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    title: row.variantTitle && row.variantTitle !== "Default Title" ? `${row.productTitle} — ${row.variantTitle}` : row.productTitle,
    sku: row.sku,
    available: row.available,
    daysToStockout: row.daysToStockout,
    suggestedOrderQty: row.suggestedOrderQty,
    flowSent: row.flowSent,
    createdAt: row.createdAt.toISOString(),
  }));
}

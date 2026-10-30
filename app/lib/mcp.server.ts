/** Shop data for the AI-assistant (MCP) endpoint. Reads only what Forelark already stores. */
import db from "../db.server";
import { PLANS, canUseFeature } from "./billing/plans";
import { buildRows, summarize, type DashboardRow } from "./dashboard";
import type { McpData } from "./mcp";
import { cachedPlan } from "./plan-cache.server";
import { getPlanningInputs } from "./planning.server";
import { PO_STATUS_LABEL, isPoStatus, poLabel } from "./purchase-orders";
import { getShopSettings, getVariantOverrides } from "./settings.server";
import { getStoredSnapshot } from "./shopify/snapshot.server";

function title(row: DashboardRow): string {
  const v = row.variant;
  return v.variantTitle && v.variantTitle !== "Default Title" ? `${v.productTitle} — ${v.variantTitle}` : v.productTitle;
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const LABEL = { critical: "Reorder now", low: "Reorder soon", ok: "Healthy" } as const;

function brief(row: DashboardRow) {
  return {
    product: title(row),
    sku: row.variant.sku || null,
    variantId: row.variant.variantId,
    status: LABEL[row.status],
    available: row.variant.available,
    onTheWay: row.variant.incoming,
    unitsPerDay: round(row.forecastPerDay, 2),
    daysUntilStockout: Number.isFinite(row.daysToStockout) ? round(row.daysToStockout) : null,
    leadTimeDays: row.leadTime,
    suggestedOrderQty: row.suggestedOrderQty,
    unitCost: row.variant.unitCost,
  };
}

async function loadRows(shop: string) {
  const [plan, settings, snapshot, overrides, planning] = await Promise.all([
    cachedPlan(shop),
    getShopSettings(shop),
    getStoredSnapshot(shop),
    getVariantOverrides(shop),
    getPlanningInputs(shop),
  ]);
  if (!snapshot) {
    return { snapshot: null, rows: [] as DashboardRow[], locationName: null as string | null };
  }
  const locationId =
    settings.locationId && snapshot.locations.some((l) => l.id === settings.locationId) ? settings.locationId : null;
  const { rows } = buildRows(snapshot, { ...settings, lookbackDays: snapshot.lookbackDays }, overrides, {
    allowSeasonal: canUseFeature(plan, "seasonality"),
    locationId,
    limit: PLANS[plan].skuLimit,
    planning,
  });
  const locationName = locationId ? (snapshot.locations.find((l) => l.id === locationId)?.name ?? null) : "All locations";
  return { snapshot, rows, locationName };
}

const NO_DATA = {
  message: "Forelark has no data for this shop yet. Open the app in Shopify once so it can read your catalog and sales.",
};

export function mcpDataForShop(shop: string): McpData {
  let cache: Promise<Awaited<ReturnType<typeof loadRows>>> | null = null;
  const rows = () => (cache ??= loadRows(shop));

  return {
    async summary() {
      const { snapshot, rows: all, locationName } = await rows();
      if (!snapshot) return NO_DATA;
      const s = summarize(all);
      return {
        reorderNow: s.critical,
        reorderSoon: s.low,
        healthy: s.ok,
        unitsToOrder: s.unitsToOrder,
        orderValueAtCost: round(s.orderValue, 2),
        variantsTracked: all.length,
        location: locationName,
        salesWindow: `${snapshot.windowStart} to ${snapshot.windowEnd}`,
        dataUpdatedAt: snapshot.fetchedAt,
      };
    },

    async reorderList({ status, limit, search }) {
      const { snapshot, rows: all } = await rows();
      if (!snapshot) return NO_DATA;
      const needle = search.trim().toLowerCase();
      const matches = all.filter((row) => {
        const statusOk = status === "needs_order" ? row.status !== "ok" : row.status === status;
        if (!statusOk) return false;
        return !needle || `${row.variant.sku} ${title(row)}`.toLowerCase().includes(needle);
      });
      return { total: matches.length, rows: matches.slice(0, limit).map(brief), dataUpdatedAt: snapshot.fetchedAt };
    },

    async variant({ query }) {
      const { snapshot, rows: all } = await rows();
      if (!snapshot) return NO_DATA;
      const q = query.toLowerCase();
      const row =
        all.find((r) => r.variant.variantId === query) ??
        all.find((r) => r.variant.sku && r.variant.sku.toLowerCase() === q) ??
        all.find((r) => title(r).toLowerCase().includes(q));
      if (!row) return null;
      return {
        ...brief(row),
        forecastMethod: row.modelLabel,
        confidence: row.confidence,
        explanation: row.explanation,
        warnings: row.warnings,
        dataUpdatedAt: snapshot.fetchedAt,
      };
    },

    async purchaseOrders({ status }) {
      const where =
        status === "all"
          ? { shop }
          : status === "open" || !isPoStatus(status)
            ? { shop, status: { in: ["sent", "partial"] } }
            : { shop, status };
      const orders = await db.purchaseOrder.findMany({
        where,
        orderBy: { number: "desc" },
        take: 50,
        include: { lines: { orderBy: { id: "asc" } }, supplier: true },
      });
      return {
        orders: orders.map((po) => ({
          number: poLabel(po.number),
          status: isPoStatus(po.status) ? PO_STATUS_LABEL[po.status] : po.status,
          supplier: po.supplier?.name ?? null,
          created: po.createdAt.toISOString().slice(0, 10),
          sent: po.sentAt?.toISOString().slice(0, 10) ?? null,
          lines: po.lines.map((line) => ({ product: line.title, sku: line.sku || null, ordered: line.qty, received: line.receivedQty })),
        })),
      };
    },
  };
}

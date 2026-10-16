import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  DataTable,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { SyncStatus } from "../components/SyncStatus";
import { authenticateAdmin } from "../lib/auth";
import { PLANS, canUseFeature } from "../lib/billing/plans";
import { getForecastContext, isAuthed, syncInfo } from "../lib/context.server";
import { buildRows } from "../lib/dashboard";
import { toCsv, type PoLine } from "../lib/purchase-order";
import { getVariantOverrides } from "../lib/settings.server";
import type { SyncInfo } from "../lib/sync-info";

const MAX_ROWS = 500;

interface PoRow extends PoLine {
  variantId: string;
  status: "critical" | "low" | "ok";
  available: number;
  incoming: number;
  daysToStockout: number | null;
  suggestedOrderQty: number;
}

interface PoLoaderData {
  missingCredentials: boolean;
  error?: string;
  blocked?: boolean;
  sync: SyncInfo | null;
  plan: string;
  rows: PoRow[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<PoLoaderData>({ missingCredentials: true, sync: null, plan: "free", rows: [] });
  }

  try {
    const context = await getForecastContext(auth);
    if (!canUseFeature(context.plan, "poBuilder")) {
      return json<PoLoaderData>({ missingCredentials: false, blocked: true, sync: null, plan: context.plan, rows: [] });
    }
    const snapshot = context.sync.snapshot;
    if (!snapshot) {
      return json<PoLoaderData>({ missingCredentials: false, sync: syncInfo(context.sync), plan: context.plan, rows: [] });
    }
    const overrides = await getVariantOverrides(context.shop);
    const locationId = context.settings.locationId && snapshot.locations.some((l) => l.id === context.settings.locationId) ? context.settings.locationId : null;
    const { rows } = buildRows(snapshot, context.settings, overrides, {
      allowSeasonal: canUseFeature(context.plan, "seasonality"),
      locationId,
      limit: PLANS[context.plan].skuLimit,
    });

    return json<PoLoaderData>({
      missingCredentials: false,
      sync: syncInfo(context.sync),
      plan: context.plan,
      rows: rows
        .filter((row) => row.suggestedOrderQty > 0)
        .slice(0, MAX_ROWS)
        .map((row) => ({
          variantId: row.variant.variantId,
          sku: row.variant.sku,
          productTitle: row.variant.productTitle,
          variantTitle: row.variant.variantTitle,
          qty: row.suggestedOrderQty,
          unitCost: row.variant.unitCost,
          status: row.status,
          available: row.variant.available,
          incoming: row.variant.incoming,
          daysToStockout: Number.isFinite(row.daysToStockout) ? row.daysToStockout : null,
          suggestedOrderQty: row.suggestedOrderQty,
        })),
    });
  } catch (error) {
    console.error("[stocksense] PO builder loader failed", error);
    return json<PoLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load variants",
      sync: null,
      plan: "free",
      rows: [],
    });
  }
};

function displayTitle(row: { productTitle: string; variantTitle: string }): string {
  return row.variantTitle && row.variantTitle !== "Default Title" ? `${row.productTitle} — ${row.variantTitle}` : row.productTitle;
}

export default function PurchaseOrders() {
  const data = useLoaderData<PoLoaderData>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  const selectedRows = useMemo(
    () =>
      data.rows
        .filter((row) => selected.has(row.variantId))
        .map((row) => ({ ...row, qty: quantities[row.variantId] ?? row.suggestedOrderQty })),
    [data.rows, selected, quantities],
  );
  const totalCost = selectedRows.reduce((sum, row) => sum + (row.unitCost ?? 0) * row.qty, 0);
  const missingCost = selectedRows.some((row) => row.unitCost == null);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (data.blocked) {
    return (
      <Page>
        <TitleBar title="Purchase orders" />
        <Banner tone="warning" title="The purchase order builder is a Growth or Pro feature">
          <InlineStack gap="300" blockAlign="center">
            <Text as="p">Upgrade to Growth ($19/mo) or Pro ($49/mo) to turn forecasts into purchase orders.</Text>
            <Button url="/app/billing" variant="primary">
              See plans
            </Button>
          </InlineStack>
        </Banner>
      </Page>
    );
  }

  const csv = toCsv(selectedRows);
  const toggle = (variantId: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(variantId);
    else next.delete(variantId);
    setSelected(next);
  };

  const downloadCsv = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stocksense-po-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(csv);
    } catch {
      // The Clipboard API can be blocked inside the admin iframe; fall back.
      const textarea = document.createElement("textarea");
      textarea.value = csv;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Page>
      <TitleBar title="Purchase order builder" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load variants">
            <Text as="p">{data.error}</Text>
          </Banner>
        )}
        {data.sync && <SyncStatus info={data.sync} />}

        {data.sync?.hasData && (
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <Text as="p">
                  {data.rows.length} {data.rows.length === 1 ? "variant needs" : "variants need"} reordering. Quantities start at the forecast suggestion.
                </Text>
                <InlineStack gap="200">
                  <Button size="slim" onClick={() => setSelected(new Set(data.rows.filter((r) => r.status === "critical").map((r) => r.variantId)))}>
                    Select "reorder now"
                  </Button>
                  <Button size="slim" onClick={() => setSelected(new Set(data.rows.map((r) => r.variantId)))}>
                    Select all
                  </Button>
                  <Button size="slim" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                    Clear
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>
            {data.rows.length === 0 ? (
              <Box padding="400">
                <Text as="p">Nothing needs reordering right now.</Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric"]}
                headings={["", "Product", "Status", "Available", "Days left", "Suggested", "Order qty"]}
                rows={data.rows.map((row) => [
                  <Checkbox
                    key={`check-${row.variantId}`}
                    label={`Select ${displayTitle(row)}`}
                    labelHidden
                    checked={selected.has(row.variantId)}
                    onChange={(checked) => toggle(row.variantId, checked)}
                  />,
                  <BlockStack key={`title-${row.variantId}`} gap="050">
                    <Text as="span">{displayTitle(row)}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {row.sku || "No SKU"}
                    </Text>
                  </BlockStack>,
                  <Badge key={`status-${row.variantId}`} tone={row.status === "critical" ? "critical" : row.status === "low" ? "warning" : "success"}>
                    {row.status === "critical" ? "Reorder now" : row.status === "low" ? "Reorder soon" : "Healthy"}
                  </Badge>,
                  row.incoming > 0 ? `${row.available} (+${row.incoming})` : row.available,
                  row.daysToStockout === null ? "—" : Math.round(row.daysToStockout),
                  row.suggestedOrderQty,
                  <Box key={`qty-${row.variantId}`} maxWidth="100px">
                    <TextField
                      label={`Quantity for ${displayTitle(row)}`}
                      labelHidden
                      type="number"
                      value={String(quantities[row.variantId] ?? row.suggestedOrderQty)}
                      min={0}
                      onChange={(value) => {
                        setQuantities((prev) => ({ ...prev, [row.variantId]: Math.max(0, Math.round(Number(value) || 0)) }));
                        if (!selected.has(row.variantId)) toggle(row.variantId, true);
                      }}
                      autoComplete="off"
                    />
                  </Box>,
                ])}
              />
            )}
          </Card>
        )}

        {data.sync?.hasData && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Purchase order
              </Text>
              {selectedRows.length === 0 ? (
                <Text as="p" tone="subdued">
                  Select variants above to build the order.
                </Text>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                    headings={["SKU", "Product", "Qty", "Unit cost", "Total"]}
                    rows={selectedRows.map((row) => [
                      row.sku || "—",
                      displayTitle(row),
                      row.qty,
                      row.unitCost != null ? row.unitCost.toFixed(2) : "—",
                      row.unitCost != null ? (row.unitCost * row.qty).toFixed(2) : "—",
                    ])}
                    totals={["", "", selectedRows.reduce((sum, row) => sum + row.qty, 0), "", totalCost.toFixed(2)]}
                    showTotalsInFooter
                  />
                  {missingCost && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Some variants have no unit cost in Shopify, so the total leaves them out. Add costs under Products → Variant → Cost per item.
                    </Text>
                  )}
                  <InlineStack gap="300" blockAlign="center">
                    <Button variant="primary" onClick={downloadCsv}>
                      Download CSV
                    </Button>
                    <Button onClick={copyCsv}>{copied ? "Copied" : "Copy CSV"}</Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

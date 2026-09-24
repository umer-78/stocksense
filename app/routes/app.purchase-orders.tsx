import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
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
import { authenticateAdmin } from "../lib/auth";
import { PAID_PLAN_NAMES, canUseFeature, planFromSubscription } from "../lib/billing/plans";
import { cacheGet, cacheSet } from "../lib/cache";
import { buildDashboardRow, sortByUrgency } from "../lib/dashboard";
import { getShopSettings } from "../lib/settings";
import { getInventorySnapshot } from "../lib/shopify/client";
import type { InventorySnapshot } from "../lib/shopify/types";

const MAX_ROWS = 500;

interface PoLoaderData {
  missingCredentials: boolean;
  error?: string;
  blocked?: boolean;
  plan: string;
  rows: Array<{
    variantId: string;
    sku: string;
    productTitle: string;
    variantTitle: string;
    onHand: number;
    suggestedOrderQty: number;
    unitCost: number | null;
  }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.admin || !auth.billing || !auth.session) {
    return json<PoLoaderData>({ missingCredentials: true, plan: "free", rows: [] });
  }

  try {
    const billingCheck = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    const plan = planFromSubscription(billingCheck.appSubscriptions[0]?.name);

    if (!canUseFeature(plan, "poBuilder")) {
      return json<PoLoaderData>({ missingCredentials: false, blocked: true, plan, rows: [] });
    }

    const settings = await getShopSettings(auth.session.shop);
    const cacheKey = `snapshot:${auth.session.shop}:${settings.lookbackDays}:${settings.locationId ?? "all"}`;
    let snapshot = cacheGet<InventorySnapshot>(cacheKey);
    if (!snapshot) {
      snapshot = await getInventorySnapshot(auth.admin, {
        lookbackDays: settings.lookbackDays,
        locationId: settings.locationId,
      });
      cacheSet(cacheKey, snapshot);
    }

    const rows = sortByUrgency(
      snapshot.variants.map((variant) =>
        buildDashboardRow(
          variant,
          snapshot.salesHistory.get(variant.variantId) ?? [],
          settings,
          true,
        ),
      ),
    )
      .filter((row) => row.suggestedOrderQty > 0)
      .slice(0, MAX_ROWS)
      .map((row) => ({
        variantId: row.variant.variantId,
        sku: row.variant.sku,
        productTitle: row.variant.productTitle,
        variantTitle: row.variant.variantTitle,
        onHand: row.variant.onHand,
        suggestedOrderQty: row.suggestedOrderQty,
        unitCost: row.variant.unitCost ?? row.variant.price,
      }));

    return json<PoLoaderData>({ missingCredentials: false, plan, rows });
  } catch (error) {
    console.error("[stocksense] PO builder loader failed", error);
    return json<PoLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load variants",
      plan: "free",
      rows: [],
    });
  }
};

function toCsv(rows: Array<{ sku: string; productTitle: string; variantTitle: string; qty: number; unitCost: number | null }>): string {
  const header = "SKU,Product,Variant,Quantity,Unit cost,Total";
  const lines = rows.map((row) => {
    const cost = row.unitCost ?? 0;
    const total = cost * row.qty;
    const esc = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return [esc(row.sku), esc(row.productTitle), esc(row.variantTitle), row.qty, cost.toFixed(2), total.toFixed(2)].join(",");
  });
  return [header, ...lines].join("\n");
}

export default function PurchaseOrders() {
  const data = useLoaderData<PoLoaderData>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const selectedRows = useMemo(
    () =>
      data.rows
        .filter((row) => selected.has(row.variantId))
        .map((row) => ({
          ...row,
          qty: quantities[row.variantId] ?? row.suggestedOrderQty,
        })),
    [data.rows, selected, quantities],
  );

  const totalCost = useMemo(
    () => selectedRows.reduce((sum, row) => sum + (row.unitCost ?? 0) * row.qty, 0),
    [selectedRows],
  );

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (data.blocked) {
    return (
      <Page>
        <TitleBar title="Purchase orders" />
        <Banner tone="warning" title="Purchase order builder is a Growth or Pro feature">
          <InlineStack gap="300" blockAlign="center">
            <Text as="p" variant="bodyMd">
              Upgrade to Growth ($19/mo) or Pro ($49/mo) to generate purchase orders from your forecasts.
            </Text>
            <Button url="/app/billing" variant="primary">
              Upgrade plan
            </Button>
          </InlineStack>
        </Banner>
      </Page>
    );
  }

  const csv = toCsv(selectedRows);

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
      // Clipboard API can be unavailable in some embedded contexts; fall back to a textarea trick.
      const textarea = document.createElement("textarea");
      textarea.value = csv;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <Page>
      <TitleBar title="Purchase order builder" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load variants">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <Text as="p" variant="bodyMd">
              Select variants to add to the purchase order. Quantities default to the forecast suggestion.
            </Text>
          </Box>
          {data.rows.length === 0 ? (
            <Box padding="400">
              <Text as="p" variant="bodyMd">
                No variants need reordering right now (suggested quantity is 0 for everything).
              </Text>
            </Box>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
              headings={["", "SKU", "Product", "On hand", "Suggested qty", "Qty to order"]}
              rows={data.rows.map((row) => [
                <Checkbox
                  key={`check-${row.variantId}`}
                  label=""
                  checked={selected.has(row.variantId)}
                  onChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) {
                      next.add(row.variantId);
                    } else {
                      next.delete(row.variantId);
                    }
                    setSelected(next);
                  }}
                />,
                row.sku || "—",
                `${row.productTitle}${row.variantTitle && row.variantTitle !== "Default Title" ? ` — ${row.variantTitle}` : ""}`,
                row.onHand,
                row.suggestedOrderQty,
                <TextField
                  key={`qty-${row.variantId}`}
                  label=""
                  labelHidden
                  type="number"
                  value={String(quantities[row.variantId] ?? row.suggestedOrderQty)}
                  min={0}
                  onChange={(value) =>
                    setQuantities((prev) => ({ ...prev, [row.variantId]: Math.max(0, Number(value) || 0) }))
                  }
                  autoComplete="off"
                />,
              ])}
            />
          )}
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Purchase order summary
            </Text>
            {selectedRows.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Select at least one variant above.
              </Text>
            ) : (
              <>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                  headings={["SKU", "Product", "Qty", "Unit cost", "Total"]}
                  rows={selectedRows.map((row) => [
                    row.sku || "—",
                    `${row.productTitle}${row.variantTitle && row.variantTitle !== "Default Title" ? ` — ${row.variantTitle}` : ""}`,
                    row.qty,
                    row.unitCost != null ? `$${row.unitCost.toFixed(2)}` : "—",
                    `$${((row.unitCost ?? 0) * row.qty).toFixed(2)}`,
                  ])}
                  totals={[
                    "",
                    "",
                    selectedRows.reduce((sum, row) => sum + row.qty, 0),
                    "",
                    `$${totalCost.toFixed(2)}`,
                  ]}
                />
                <InlineStack gap="300">
                  <Button onClick={downloadCsv}>Download CSV</Button>
                  <Button onClick={copyCsv}>Copy CSV</Button>
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
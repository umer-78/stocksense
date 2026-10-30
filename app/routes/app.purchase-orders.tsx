import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { SyncStatus } from "../components/SyncStatus";
import { authenticateAdmin } from "../lib/auth";
import { PLANS, canUseFeature } from "../lib/billing/plans";
import { currentPlan, getForecastContext, isAuthed, syncInfo } from "../lib/context.server";
import { buildRows } from "../lib/dashboard";
import { vendorKey } from "../lib/planning";
import { getPlanningInputs } from "../lib/planning.server";
import { toCsv, type PoLine } from "../lib/purchase-order";
import { PO_STATUS_LABEL, poLabel, sanitizeLines, type PoStatus } from "../lib/purchase-orders";
import { createPurchaseOrder, listPurchaseOrders, type PoSummary } from "../lib/purchase-orders.server";
import { getVariantOverrides } from "../lib/settings.server";
import type { SupplierRecord } from "../lib/suppliers";
import { listSuppliers } from "../lib/suppliers.server";
import type { SyncInfo } from "../lib/sync-info";

const MAX_ROWS = 500;

interface PoRow extends PoLine {
  variantId: string;
  vendor: string;
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
  suppliers: SupplierRecord[];
  orders: PoSummary[];
}

const EMPTY = { sync: null, plan: "free", rows: [], suppliers: [], orders: [] };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<PoLoaderData>({ missingCredentials: true, ...EMPTY });
  }

  try {
    const context = await getForecastContext(auth);
    if (!canUseFeature(context.plan, "poBuilder")) {
      return json<PoLoaderData>({ missingCredentials: false, blocked: true, ...EMPTY, plan: context.plan });
    }
    const [suppliers, orders] = await Promise.all([listSuppliers(context.shop), listPurchaseOrders(context.shop, context.settings.defaultLeadTime)]);
    const snapshot = context.sync.snapshot;
    if (!snapshot) {
      return json<PoLoaderData>({ missingCredentials: false, ...EMPTY, sync: syncInfo(context.sync), plan: context.plan, suppliers, orders });
    }
    const [overrides, planning] = await Promise.all([getVariantOverrides(context.shop), getPlanningInputs(context.shop)]);
    const locationId = context.settings.locationId && snapshot.locations.some((l) => l.id === context.settings.locationId) ? context.settings.locationId : null;
    const { rows } = buildRows(snapshot, context.settings, overrides, {
      allowSeasonal: canUseFeature(context.plan, "seasonality"),
      locationId,
      limit: PLANS[context.plan].skuLimit,
      planning,
    });

    return json<PoLoaderData>({
      missingCredentials: false,
      sync: syncInfo(context.sync),
      plan: context.plan,
      suppliers,
      orders,
      rows: rows
        .filter((row) => row.suggestedOrderQty > 0)
        .slice(0, MAX_ROWS)
        .map((row) => ({
          variantId: row.variant.variantId,
          vendor: row.variant.vendor ?? "",
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
      ...EMPTY,
      error: error instanceof Error ? error.message : "Failed to load variants",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canUseFeature(await currentPlan(auth), "poBuilder")) {
    return json({ error: "Purchase orders need the Growth or Pro plan." }, { status: 403 });
  }
  const shop = auth.session.shop;
  const form = await request.formData();
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    parsed = [];
  }
  const lines = sanitizeLines(parsed);
  if (lines.length === 0) {
    return json({ error: "Select at least one variant with a quantity above 0." }, { status: 400 });
  }
  const supplierRaw = Number(form.get("supplierId"));
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  const id = await createPurchaseOrder(shop, {
    supplierId: Number.isInteger(supplierRaw) && supplierRaw > 0 ? supplierRaw : null,
    note,
    lines,
  });
  return redirect(`/app/purchase-orders/${id}`);
};

function displayTitle(row: { productTitle: string; variantTitle: string }): string {
  return row.variantTitle && row.variantTitle !== "Default Title" ? `${row.productTitle} — ${row.variantTitle}` : row.productTitle;
}

const STATUS_TONE: Record<PoStatus, "info" | "attention" | "success" | "critical" | undefined> = {
  draft: undefined,
  sent: "info",
  partial: "attention",
  received: "success",
  cancelled: "critical",
};

export default function PurchaseOrders() {
  const data = useLoaderData<PoLoaderData>();
  const lateOrders = data.orders.filter((po) => po.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [onlySupplier, setOnlySupplier] = useState(false);
  const [note, setNote] = useState("");

  const supplier = data.suppliers.find((s) => String(s.id) === supplierId) ?? null;
  const visibleRows = useMemo(
    () =>
      onlySupplier && supplier?.vendor
        ? data.rows.filter((row) => vendorKey(row.vendor) === vendorKey(supplier.vendor))
        : data.rows,
    [data.rows, onlySupplier, supplier],
  );

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
        <Banner tone="warning" title="Purchase orders are a Growth or Pro feature">
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
  const linesJson = JSON.stringify(
    selectedRows
      .filter((row) => row.qty > 0)
      .map((row) => ({ variantId: row.variantId, sku: row.sku, title: displayTitle(row), qty: row.qty, unitCost: row.unitCost })),
  );
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
    link.download = `forelark-po-${new Date().toISOString().slice(0, 10)}.csv`;
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

  const supplierOptions = [
    { label: "No supplier", value: "" },
    ...data.suppliers.map((s) => ({ label: s.vendor ? `${s.name} (${s.vendor})` : s.name, value: String(s.id) })),
  ];

  return (
    <Page>
      <TitleBar title="Purchase orders" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load variants">
            <Text as="p">{data.error}</Text>
          </Banner>
        )}
        {actionData?.error && (
          <Banner tone="critical" title="The purchase order was not saved">
            <Text as="p">{actionData.error}</Text>
          </Banner>
        )}
        {data.sync && <SyncStatus info={data.sync} />}

        {data.sync?.hasData && (
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Text as="p">
                    {visibleRows.length} {visibleRows.length === 1 ? "variant is" : "variants are"} below target stock. Quantities start at the forecast suggestion.
                  </Text>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={() => setSelected(new Set(visibleRows.filter((r) => r.status === "critical").map((r) => r.variantId)))}>
                      Select &quot;reorder now&quot;
                    </Button>
                    <Button size="slim" onClick={() => setSelected(new Set(visibleRows.map((r) => r.variantId)))}>
                      Select all
                    </Button>
                    <Button size="slim" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                      Clear
                    </Button>
                  </InlineStack>
                </InlineStack>
                {data.suppliers.length > 0 && (
                  <InlineStack gap="400" blockAlign="end" wrap>
                    <Box minWidth="240px">
                      <Select label="Supplier" options={supplierOptions} value={supplierId} onChange={setSupplierId} />
                    </Box>
                    <Checkbox
                      label="Only this supplier's products"
                      checked={onlySupplier}
                      onChange={setOnlySupplier}
                      disabled={!supplier?.vendor}
                    />
                  </InlineStack>
                )}
              </BlockStack>
            </Box>
            {visibleRows.length === 0 ? (
              <Box padding="400">
                <Text as="p">Every variant is at or above its target stock.</Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric"]}
                headings={["", "Product", "Status", "Available", "Days left", "Suggested", "Order qty"]}
                rows={visibleRows.map((row) => [
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
                      {[row.sku || "No SKU", row.vendor].filter(Boolean).join(" · ")}
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
                New purchase order
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
                  <Form method="post">
                    <input type="hidden" name="lines" value={linesJson} />
                    <input type="hidden" name="supplierId" value={supplierId} />
                    <BlockStack gap="300">
                      <TextField
                        label="Note for the supplier (optional)"
                        name="note"
                        value={note}
                        onChange={setNote}
                        multiline={2}
                        maxLength={1000}
                        autoComplete="off"
                      />
                      <InlineStack gap="300" blockAlign="center">
                        <Button submit variant="primary" loading={navigation.state === "submitting"}>
                          {supplier ? `Save purchase order for ${supplier.name}` : "Save purchase order"}
                        </Button>
                        <Button onClick={downloadCsv}>Download CSV</Button>
                        <Button onClick={copyCsv}>{copied ? "Copied" : "Copy CSV"}</Button>
                      </InlineStack>
                      {data.suppliers.length === 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          <Link to="/app/suppliers">Add your suppliers</Link> to send orders by email and use their lead times.
                        </Text>
                      )}
                    </BlockStack>
                  </Form>
                </>
              )}
            </BlockStack>
          </Card>
        )}

        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Saved purchase orders
              </Text>
              <Text as="p" tone="subdued">
                Units on sent orders count as on the way in every forecast until you mark them received. An order is late once its supplier's lead time has
                passed since it was sent.
              </Text>
              {lateOrders.length > 0 && (
                <Banner tone="warning" title={`${lateOrders.length} order${lateOrders.length === 1 ? " is" : "s are"} late`}>
                  <Text as="p">
                    {lateOrders.map((po) => `${poLabel(po.number)} (${po.overdueDays} d)`).join(", ")}. Open an order to send the supplier a follow-up.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Box>
          {data.orders.length === 0 ? (
            <Box padding="400" paddingBlockStart="0">
              <Text as="p">No purchase orders yet.</Text>
            </Box>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "numeric", "numeric", "text", "text"]}
              headings={["Order", "Supplier", "Status", "Units received", "Cost", "Created", "Expected"]}
              rows={data.orders.map((po) => [
                <Link key={`po-${po.id}`} to={`/app/purchase-orders/${po.id}`}>
                  {poLabel(po.number)}
                </Link>,
                po.supplierName ?? "—",
                <InlineStack key={`st-${po.id}`} gap="100" wrap={false}>
                  <Badge tone={STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>
                  {po.overdueDays > 0 && <Badge tone="critical">{`${po.overdueDays} d late`}</Badge>}
                </InlineStack>,
                `${po.receivedUnits} / ${po.units}`,
                po.missingCost ? `${po.cost.toFixed(2)}+` : po.cost.toFixed(2),
                po.createdAt.slice(0, 10),
                (po.status === "sent" || po.status === "partial") && po.expectedAt ? po.expectedAt.slice(0, 10) : "—",
              ])}
            />
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

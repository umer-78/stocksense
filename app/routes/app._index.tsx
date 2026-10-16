import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  Filters,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { SyncStatus } from "../components/SyncStatus";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature, enforcePlanLimit } from "../lib/billing/plans";
import { getForecastContext, isAuthed, syncInfo } from "../lib/context.server";
import { buildRows, filterRows, summarize, type DashboardSummary } from "../lib/dashboard";
import { getVariantOverrides } from "../lib/settings.server";
import type { SyncInfo } from "../lib/sync-info";
import type { LocationInfo } from "../lib/shopify/types";

const PER_PAGE = 25;

interface Row {
  variantId: string;
  sku: string;
  title: string;
  available: number;
  incoming: number;
  forecastPerDay: number;
  daysToStockout: number | null;
  status: "critical" | "low" | "ok";
  suggestedOrderQty: number;
  overridden: boolean;
  modelLabel: string | null;
}

interface DashboardLoaderData {
  missingCredentials: boolean;
  error?: string;
  sync: SyncInfo | null;
  rows: Row[];
  total: number;
  page: number;
  summary: DashboardSummary | null;
  locations: LocationInfo[];
  locationValue: string;
  plan: string;
  overLimit: boolean;
  skuCount: number;
  limit: number | null;
  lookbackCapped: boolean;
  filters: { status: string; search: string };
}

const EMPTY: Omit<DashboardLoaderData, "missingCredentials"> = {
  sync: null,
  rows: [],
  total: 0,
  page: 1,
  summary: null,
  locations: [],
  locationValue: "all",
  plan: "free",
  overLimit: false,
  skuCount: 0,
  limit: null,
  lookbackCapped: false,
  filters: { status: "", search: "" },
};

function displayTitle(productTitle: string, variantTitle: string): string {
  return variantTitle && variantTitle !== "Default Title" ? `${productTitle} — ${variantTitle}` : productTitle;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<DashboardLoaderData>({ missingCredentials: true, ...EMPTY });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const status = url.searchParams.get("status") ?? "";
  const search = url.searchParams.get("search") ?? "";

  try {
    const context = await getForecastContext(auth);
    const snapshot = context.sync.snapshot;
    const base = {
      ...EMPTY,
      missingCredentials: false,
      sync: syncInfo(context.sync),
      plan: context.plan,
      lookbackCapped: context.lookbackCapped,
      filters: { status, search },
    };
    if (!snapshot) {
      return json<DashboardLoaderData>(base);
    }

    // ?location=all | <location id>; absent = the location chosen in settings.
    const locationParam = url.searchParams.get("location");
    const locationId =
      locationParam === null ? context.settings.locationId : locationParam === "all" ? null : locationParam;
    const validLocation = locationId && snapshot.locations.some((l) => l.id === locationId) ? locationId : null;

    const allowedCount = enforcePlanLimit(context.plan, snapshot.variants.length);
    const overrides = await getVariantOverrides(context.shop);
    const { rows: allRows, variantCount } = buildRows(snapshot, context.settings, overrides, {
      allowSeasonal: canUseFeature(context.plan, "seasonality"),
      locationId: validLocation,
      limit: allowedCount.limit,
    });

    const filtered = filterRows(allRows, { status, search });
    const start = (page - 1) * PER_PAGE;
    const rows: Row[] = filtered.slice(start, start + PER_PAGE).map((row) => ({
      variantId: row.variant.variantId,
      sku: row.variant.sku,
      title: displayTitle(row.variant.productTitle, row.variant.variantTitle),
      available: row.variant.available,
      incoming: row.variant.incoming,
      forecastPerDay: row.forecastPerDay,
      daysToStockout: Number.isFinite(row.daysToStockout) ? row.daysToStockout : null,
      status: row.status,
      suggestedOrderQty: row.suggestedOrderQty,
      overridden: row.overridden,
      modelLabel: row.modelLabel,
    }));
    const limitResult = enforcePlanLimit(context.plan, variantCount);

    return json<DashboardLoaderData>({
      ...base,
      rows,
      total: filtered.length,
      page,
      summary: summarize(allRows),
      locations: snapshot.locations,
      locationValue: validLocation ?? "all",
      overLimit: limitResult.overLimit,
      skuCount: variantCount,
      limit: limitResult.limit,
    });
  } catch (error) {
    console.error("[stocksense] dashboard loader failed", error);
    return json<DashboardLoaderData>({
      missingCredentials: false,
      ...EMPTY,
      error: error instanceof Error ? error.message : "Failed to load inventory from Shopify",
    });
  }
};

const STATUS_TONE: Record<string, "critical" | "warning" | "success"> = {
  critical: "critical",
  low: "warning",
  ok: "success",
};
const STATUS_LABEL: Record<string, string> = { critical: "Reorder now", low: "Reorder soon", ok: "Healthy" };

function formatDays(days: number | null): string {
  if (days === null) {
    return "—";
  }
  return days < 1 ? "<1" : String(Math.round(days));
}

function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "critical" | "caution" | "success" }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg" tone={tone}>
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function Dashboard() {
  const data = useLoaderData<DashboardLoaderData>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(data.filters.search);

  const updateParams = useCallback(
    (patch: Record<string, string>, keepPage = false) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      }
      if (!keepPage) {
        next.delete("page");
      }
      navigate(`/app?${next.toString()}`, { replace: true });
    },
    [navigate, searchParams],
  );

  const statusFilter = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        filter: (
          <Select
            label="Status"
            labelHidden
            value={data.filters.status}
            onChange={(value) => updateParams({ status: value })}
            options={[
              { label: "All statuses", value: "" },
              { label: "Reorder now", value: "critical" },
              { label: "Reorder soon", value: "low" },
              { label: "Healthy", value: "ok" },
            ]}
          />
        ),
      },
    ],
    [data.filters.status, updateParams],
  );

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  const summary = data.summary;

  return (
    <Page>
      <TitleBar title="StockSense dashboard" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load inventory">
            <Text as="p">{data.error}</Text>
          </Banner>
        )}

        {data.sync && <SyncStatus info={data.sync} />}

        {data.overLimit && (
          <Banner tone="warning" title={`You have ${data.skuCount.toLocaleString()} variants, above your plan's limit of ${data.limit?.toLocaleString()}`}>
            <InlineStack gap="300" blockAlign="center">
              <Text as="p">Forecasts cover the first {data.limit?.toLocaleString()} variants. Upgrade to forecast everything.</Text>
              <Link to="/app/billing">Upgrade plan</Link>
            </InlineStack>
          </Banner>
        )}

        {data.lookbackCapped && (
          <Banner tone="info" title="Using the last 60 days of orders">
            <Text as="p">
              Shopify only shares the last 60 days of orders with apps unless the store grants access to all orders. Forecasts use the 60 days available.
            </Text>
          </Banner>
        )}

        {summary && (
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <SummaryCard label="Reorder now" value={String(summary.critical)} tone={summary.critical > 0 ? "critical" : undefined} />
            <SummaryCard label="Reorder soon" value={String(summary.low)} tone={summary.low > 0 ? "caution" : undefined} />
            <SummaryCard label="Units to order" value={summary.unitsToOrder.toLocaleString()} />
            <SummaryCard label="Order value (at cost)" value={summary.orderValue > 0 ? money(summary.orderValue) : "—"} />
          </InlineGrid>
        )}

        {data.sync?.hasData && (
          <Card padding="0">
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="300" blockAlign="center" wrap>
                <Box minWidth="220px">
                  <Select
                    label="Location"
                    labelInline
                    value={data.locationValue}
                    onChange={(value) => updateParams({ location: value })}
                    options={[
                      { label: "All locations combined", value: "all" },
                      ...data.locations.map((location) => ({ label: location.name, value: location.id })),
                    ]}
                  />
                </Box>
              </InlineStack>
            </Box>
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search SKU or product"
              onQueryChange={(value) => {
                setQueryValue(value);
                updateParams({ search: value });
              }}
              onQueryClear={() => {
                setQueryValue("");
                updateParams({ search: "" });
              }}
              filters={statusFilter}
              appliedFilters={
                data.filters.status
                  ? [{ key: "status", label: `Status: ${STATUS_LABEL[data.filters.status] ?? data.filters.status}`, onRemove: () => updateParams({ status: "" }) }]
                  : []
              }
              onClearAll={() => {
                setQueryValue("");
                updateParams({ status: "", search: "" });
              }}
            />
            {data.rows.length === 0 ? (
              <Box padding="400">
                <Text as="p">
                  {data.skuCount === 0
                    ? "No active products with tracked inventory were found at this location."
                    : "No variants match the current filters."}
                </Text>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: "variant", plural: "variants" }}
                itemCount={data.rows.length}
                selectable={false}
                headings={[
                  { title: "Product" },
                  { title: "SKU" },
                  { title: "Available", alignment: "end" },
                  { title: "Forecast / day", alignment: "end" },
                  { title: "Days left", alignment: "end" },
                  { title: "Status" },
                  { title: "Order qty", alignment: "end" },
                ]}
                pagination={{
                  hasPrevious: data.page > 1,
                  onPrevious: () => updateParams({ page: String(data.page - 1) }, true),
                  hasNext: data.page < totalPages,
                  onNext: () => updateParams({ page: String(data.page + 1) }, true),
                  label: `${(data.page - 1) * PER_PAGE + 1}–${Math.min(data.page * PER_PAGE, data.total)} of ${data.total}`,
                }}
              >
                {data.rows.map((row, index) => (
                  <IndexTable.Row id={row.variantId} key={row.variantId} position={index}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Link to={`/app/variants/${encodeURIComponent(row.variantId)}`}>{row.title}</Link>
                        {row.overridden && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            Custom settings
                          </Text>
                        )}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {row.sku || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric>
                        {row.available}
                        {row.incoming > 0 ? ` (+${row.incoming})` : ""}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric>
                        {row.forecastPerDay.toFixed(1)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric>
                        {formatDays(row.daysToStockout)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric fontWeight={row.suggestedOrderQty > 0 ? "semibold" : "regular"} tone={row.suggestedOrderQty > 0 ? undefined : "subdued"}>
                        {row.suggestedOrderQty > 0 ? row.suggestedOrderQty : "—"}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

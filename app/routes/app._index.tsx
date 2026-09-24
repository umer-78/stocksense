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
  InlineStack,
  Page,
  Pagination,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { PAID_PLAN_NAMES, canUseFeature, enforcePlanLimit, planFromSubscription } from "../lib/billing/plans";
import { cacheGet, cacheSet } from "../lib/cache";
import { buildDashboardRow, filterRows, sortByUrgency, type DashboardRow } from "../lib/dashboard";
import { getShopSettings } from "../lib/settings";
import { getInventorySnapshot } from "../lib/shopify/client";
import type { InventorySnapshot, LocationInfo } from "../lib/shopify/types";

const PER_PAGE = 25;

interface DashboardLoaderData {
  missingCredentials: boolean;
  error?: string;
  rows: DashboardRow[];
  total: number;
  page: number;
  perPage: number;
  locations: LocationInfo[];
  plan: string;
  overLimit: boolean;
  skuCount: number;
  limit: number | null;
  filters: { locationId: string; status: string; search: string };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.admin || !auth.billing || !auth.session) {
    return json<DashboardLoaderData>({ missingCredentials: true, rows: [], total: 0, page: 1, perPage: PER_PAGE, locations: [], plan: "free", overLimit: false, skuCount: 0, limit: null, filters: { locationId: "", status: "", search: "" } });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const locationId = url.searchParams.get("location") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const search = url.searchParams.get("search") ?? "";

  try {
    const billingCheck = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    const plan = planFromSubscription(billingCheck.appSubscriptions[0]?.name);
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

    const limit = enforcePlanLimit(plan, snapshot.variants.length);
    const visibleVariants = limit.overLimit
      ? snapshot.variants.slice(0, limit.allowedCount)
      : snapshot.variants;

    const applySeasonality = canUseFeature(plan, "seasonality");
    const allRows = sortByUrgency(
      visibleVariants.map((variant) =>
        buildDashboardRow(
          variant,
          snapshot.salesHistory.get(variant.variantId) ?? [],
          settings,
          applySeasonality,
        ),
      ),
    );

    const filtered = filterRows(allRows, { locationId, status, search });
    const total = filtered.length;
    const start = (page - 1) * PER_PAGE;
    const rows = filtered.slice(start, start + PER_PAGE);

    return json<DashboardLoaderData>({
      missingCredentials: false,
      rows,
      total,
      page,
      perPage: PER_PAGE,
      locations: snapshot.locations,
      plan,
      overLimit: limit.overLimit,
      skuCount: snapshot.variants.length,
      limit: limit.limit,
      filters: { locationId, status, search },
    });
  } catch (error) {
    console.error("[stocksense] dashboard loader failed", error);
    return json<DashboardLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load inventory from Shopify",
      rows: [],
      total: 0,
      page: 1,
      perPage: PER_PAGE,
      locations: [],
      plan: "free",
      overLimit: false,
      skuCount: 0,
      limit: null,
      filters: { locationId: "", status: "", search: "" },
    });
  }
};

const STATUS_TONE: Record<string, "critical" | "warning" | "success"> = {
  critical: "critical",
  low: "warning",
  ok: "success",
};

function formatDays(days: number): string {
  if (!Number.isFinite(days)) {
    return "—";
  }
  return days < 1 ? "<1" : String(Math.round(days));
}

export default function Dashboard() {
  const data = useLoaderData<DashboardLoaderData>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(data.filters.search);

  const updateParams = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      }
      next.delete("page");
      navigate(`/app?${next.toString()}`, { replace: true });
    },
    [navigate, searchParams],
  );

  const filters = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        filter: (
          <select
            value={data.filters.status}
            onChange={(e) => updateParams({ status: e.target.value })}
            style={{ padding: "8px", borderRadius: "8px", border: "1px solid #c9cccf" }}
          >
            <option value="">All statuses</option>
            <option value="critical">Critical</option>
            <option value="low">Low</option>
            <option value="ok">OK</option>
          </select>
        ),
      },
      {
        key: "location",
        label: "Location",
        filter: (
          <select
            value={data.filters.locationId}
            onChange={(e) => updateParams({ location: e.target.value })}
            style={{ padding: "8px", borderRadius: "8px", border: "1px solid #c9cccf" }}
          >
            <option value="">All locations</option>
            {data.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        ),
      },
    ],
    [data.filters.locationId, data.filters.status, data.locations, updateParams],
  );

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));

  return (
    <Page>
      <TitleBar title="StockSense dashboard" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load inventory">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}

        {data.overLimit && (
          <Banner tone="warning" title={`You have ${data.skuCount} SKUs — above your ${data.plan} plan limit of ${data.limit}`}>
            <InlineStack gap="300" blockAlign="center">
              <Text as="p" variant="bodyMd">
                Showing the first {data.limit} SKUs. Upgrade to see everything.
              </Text>
              <Link to="/app/billing">Upgrade plan</Link>
            </InlineStack>
          </Banner>
        )}

        <Card padding="0">
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
            filters={filters}
            appliedFilters={[
              ...(data.filters.status
                ? [{ key: "status", label: `Status: ${data.filters.status}`, onRemove: () => updateParams({ status: "" }) }]
                : []),
              ...(data.filters.locationId
                ? [{ key: "location", label: `Location: ${data.locations.find((l) => l.id === data.filters.locationId)?.name ?? data.filters.locationId}`, onRemove: () => updateParams({ location: "" }) }]
                : []),
            ]}
            onClearAll={() => {
              setQueryValue("");
              updateParams({ status: "", location: "", search: "" });
            }}
          />
        </Card>

        <Card padding="0">
          {data.rows.length === 0 ? (
            <Box padding="400">
              <Text as="p" variant="bodyMd">
                No variants match the current filters. Adjust the filters or check that your store has products with inventory.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "variant", plural: "variants" }}
              itemCount={data.rows.length}
              selectable={false}
              headings={[
                { title: "SKU" },
                { title: "Product" },
                { title: "On hand" },
                { title: "Velocity/day" },
                { title: "Days to stockout" },
                { title: "Status" },
                { title: "Reorder suggestion" },
              ]}
              pagination={{
                hasPrevious: data.page > 1,
                onPrevious: () => updateParams({ page: String(data.page - 1) }),
                hasNext: data.page < totalPages,
                onNext: () => updateParams({ page: String(data.page + 1) }),
                label: `${(data.page - 1) * data.perPage + 1}-${Math.min(data.page * data.perPage, data.total)} of ${data.total}`,
              }}
            >
              {data.rows.map((row, index) => (
                <IndexTable.Row id={row.variant.variantId} key={row.variant.variantId} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {row.variant.sku || "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Link to={`/app/variants/${encodeURIComponent(row.variant.variantId)}`}>
                      {row.variant.productTitle}
                      {row.variant.variantTitle && row.variant.variantTitle !== "Default Title"
                        ? ` — ${row.variant.variantTitle}`
                        : ""}
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.variant.onHand}</IndexTable.Cell>
                  <IndexTable.Cell>{row.velocity.toFixed(1)}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDays(row.daysToStockout)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[row.status]}>{row.status.toUpperCase()}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.suggestedOrderQty > 0 ? (
                      <Text as="span" fontWeight="semibold">
                        {row.suggestedOrderQty}
                      </Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        —
                      </Text>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {data.total > data.perPage && (
          <Box>
            <Pagination
              hasPrevious={data.page > 1}
              onPrevious={() => updateParams({ page: String(data.page - 1) })}
              hasNext={data.page < totalPages}
              onNext={() => updateParams({ page: String(data.page + 1) })}
              label={`Page ${data.page} of ${totalPages}`}
            />
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}
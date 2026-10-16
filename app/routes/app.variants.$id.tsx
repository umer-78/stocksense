import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { SalesChart } from "../components/SalesChart";
import { SyncStatus } from "../components/SyncStatus";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature } from "../lib/billing/plans";
import { getForecastContext, isAuthed, syncInfo } from "../lib/context.server";
import { forecastStatus, forecastVariant } from "../lib/dashboard";
import type { SalesRecord } from "../lib/forecast";
import { toDailySeries } from "../lib/forecast";
import { sanitizeOverride, type ForecastSettings, type VariantOverride } from "../lib/settings";
import { getVariantOverride, saveVariantOverride } from "../lib/settings.server";
import { inventoryAt, salesFor } from "../lib/shopify/adapter";
import type { InventoryLevelInfo, VariantInventory } from "../lib/shopify/types";
import type { SyncInfo } from "../lib/sync-info";

const CHART_HISTORY_DAYS = 56;

interface DetailLoaderData {
  missingCredentials: boolean;
  error?: string;
  sync: SyncInfo | null;
  variant?: VariantInventory;
  levels: InventoryLevelInfo[];
  salesHistory: SalesRecord[];
  settings: ForecastSettings | null;
  override: VariantOverride | null;
  allowSeasonal: boolean;
  asOf: string | null;
}

const EMPTY: Omit<DetailLoaderData, "missingCredentials"> = {
  sync: null,
  levels: [],
  salesHistory: [],
  settings: null,
  override: null,
  allowSeasonal: false,
  asOf: null,
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<DetailLoaderData>({ missingCredentials: true, ...EMPTY });
  }
  const variantId = params.id ? decodeURIComponent(params.id) : "";
  if (!variantId) {
    throw new Response("Variant id is required", { status: 400 });
  }

  try {
    const context = await getForecastContext(auth);
    const snapshot = context.sync.snapshot;
    const base = { ...EMPTY, missingCredentials: false, sync: syncInfo(context.sync), settings: context.settings };
    if (!snapshot) {
      return json<DetailLoaderData>(base);
    }
    const catalogVariant = snapshot.variants.find((v) => v.variantId === variantId);
    if (!catalogVariant) {
      throw new Response("Variant not found", { status: 404 });
    }
    const variant =
      inventoryAt(catalogVariant, context.settings.locationId) ?? inventoryAt(catalogVariant, null)!;
    return json<DetailLoaderData>({
      ...base,
      variant,
      levels: catalogVariant.levels,
      salesHistory: salesFor(snapshot, variantId),
      override: await getVariantOverride(context.shop, variantId),
      allowSeasonal: canUseFeature(context.plan, "seasonality"),
      asOf: snapshot.windowEnd,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("[stocksense] variant loader failed", error);
    return json<DetailLoaderData>({
      missingCredentials: false,
      ...EMPTY,
      error: error instanceof Error ? error.message : "Failed to load variant",
    });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ ok: false }, { status: 401 });
  }
  const variantId = params.id ? decodeURIComponent(params.id) : "";
  const form = await request.formData();
  if (form.get("intent") === "reset") {
    await saveVariantOverride(auth.session.shop, variantId, { leadTime: null, safetyStockPct: null, targetDays: null });
    return json({ ok: true, reset: true });
  }
  const safety = String(form.get("safetyStockPct") ?? "").trim();
  const values = sanitizeOverride({
    leadTime: form.get("leadTime"),
    safetyStockPct: safety === "" ? "" : Number(safety) / 100,
    targetDays: form.get("targetDays"),
  });
  await saveVariantOverride(auth.session.shop, variantId, values);
  return json({ ok: true });
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const CONFIDENCE_TONE = { high: "success", medium: "attention", low: "warning" } as const;

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg">
        {value}
      </Text>
      {help && (
        <Text as="p" variant="bodySm" tone="subdued">
          {help}
        </Text>
      )}
    </BlockStack>
  );
}

export default function VariantDetail() {
  const data = useLoaderData<DetailLoaderData>();
  const fetcher = useFetcher<{ ok?: boolean; reset?: boolean }>();
  const settings = data.settings;

  const initial = {
    leadTime: data.override?.leadTime != null ? String(data.override.leadTime) : "",
    safetyStockPct: data.override?.safetyStockPct != null ? String(Math.round(data.override.safetyStockPct * 100)) : "",
    targetDays: data.override?.targetDays != null ? String(data.override.targetDays) : "",
  };
  const [leadTime, setLeadTime] = useState(initial.leadTime);
  const [safetyStockPct, setSafetyStockPct] = useState(initial.safetyStockPct);
  const [targetDays, setTargetDays] = useState(initial.targetDays);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.reset) {
      setLeadTime("");
      setSafetyStockPct("");
      setTargetDays("");
    }
  }, [fetcher.state, fetcher.data]);

  const draftOverride = useMemo<VariantOverride>(() => {
    const values = sanitizeOverride({
      leadTime,
      safetyStockPct: safetyStockPct.trim() === "" ? "" : Number(safetyStockPct) / 100,
      targetDays,
    });
    return { ...values, source: data.override?.source ?? "manual" };
  }, [leadTime, safetyStockPct, targetDays, data.override?.source]);

  const result = useMemo(() => {
    if (!data.variant || !settings) {
      return null;
    }
    return forecastVariant(data.variant, data.salesHistory, settings, {
      allowSeasonal: data.allowSeasonal,
      asOf: data.asOf ?? undefined,
      override: draftOverride,
    });
  }, [data.variant, data.salesHistory, data.allowSeasonal, data.asOf, settings, draftOverride]);

  const chart = useMemo(() => {
    if (!data.asOf) {
      return null;
    }
    const end = Date.parse(`${data.asOf}T00:00:00Z`);
    const start = end - (CHART_HISTORY_DAYS - 1) * 86_400_000;
    return { history: toDailySeries(data.salesHistory, start, end), start };
  }, [data.asOf, data.salesHistory]);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (!data.variant || !result || !settings) {
    return (
      <Page backAction={{ content: "Dashboard", url: "/app" }}>
        <TitleBar title="Variant" />
        <BlockStack gap="400">
          {data.sync && <SyncStatus info={data.sync} />}
          {data.error && (
            <Banner tone="critical" title="Could not load this variant">
              <Text as="p">{data.error}</Text>
            </Banner>
          )}
        </BlockStack>
      </Page>
    );
  }

  const { forecast, leadTime: effectiveLeadTime } = result;
  const variant = data.variant;
  const status = forecastStatus(forecast, effectiveLeadTime);
  const title = variant.variantTitle && variant.variantTitle !== "Default Title" ? `${variant.productTitle} — ${variant.variantTitle}` : variant.productTitle;
  const dirty = leadTime !== initial.leadTime || safetyStockPct !== initial.safetyStockPct || targetDays !== initial.targetDays;

  return (
    <Page backAction={{ content: "Dashboard", url: "/app" }} title={title} subtitle={variant.sku ? `SKU ${variant.sku}` : undefined}>
      <TitleBar title={title} />
      <BlockStack gap="500">
        {data.sync && <SyncStatus info={data.sync} />}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Forecast
              </Text>
              <InlineStack gap="200">
                <Badge tone={status === "critical" ? "critical" : status === "low" ? "warning" : "success"}>
                  {status === "critical" ? "Reorder now" : status === "low" ? "Reorder soon" : "Healthy"}
                </Badge>
                <Badge tone={CONFIDENCE_TONE[forecast.confidence]}>{`${forecast.confidence[0].toUpperCase()}${forecast.confidence.slice(1)} confidence`}</Badge>
              </InlineStack>
            </InlineStack>
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
              <Stat label="Forecast demand" value={`${formatNumber(forecast.adjustedVelocity)}/day`} help={`last ${settings.lookbackDays} days: ${formatNumber(forecast.velocity)}/day`} />
              <Stat label="Days of stock left" value={Number.isFinite(forecast.daysToStockout) ? formatNumber(forecast.daysToStockout) : "No risk"} help={`${variant.available} available`} />
              <Stat label="Reorder point" value={String(forecast.reorderPoint)} help={`${effectiveLeadTime}-day lead time`} />
              <Stat label="Suggested order" value={String(forecast.suggestedOrderQty)} help={forecast.incoming > 0 ? `after ${forecast.incoming} incoming` : undefined} />
            </InlineGrid>
            {chart && (
              <SalesChart history={chart.history} forecast={forecast.dailyForecast} startDay={chart.start} />
            )}
            {forecast.model && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    Method: {forecast.model.label}
                  </Text>
                  <Text as="p" tone="subdued">
                    {forecast.model.tested
                      ? `Tested on the last ${forecast.model.folds} weeks of sales. Weekly totals were off by ${percent(forecast.model.errorPct)}${
                          forecast.model.id !== "average" ? ` (simple average: ${percent(forecast.model.baselineErrorPct)})` : ""
                        }.`
                      : "Fewer than 4 weeks of sales history, so the simple average is used until there is enough data to test other methods."}
                  </Text>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Why these numbers
                </Text>
                <List type="bullet">
                  {forecast.explanation.map((line, i) => (
                    <List.Item key={i}>{line}</List.Item>
                  ))}
                </List>
                {forecast.warnings.length > 0 && (
                  <Banner tone="warning" title="Things to know">
                    <List type="bullet">
                      {forecast.warnings.map((warning, i) => (
                        <List.Item key={i}>{warning}</List.Item>
                      ))}
                    </List>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Settings for this product
                </Text>
                <Text as="p" tone="subdued">
                  Leave a field blank to use the store default. The forecast updates as you type.
                </Text>
                {data.override?.source === "stocky" && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Lead time imported from Stocky.
                  </Text>
                )}
                <fetcher.Form method="post">
                  <BlockStack gap="300">
                    <TextField
                      label="Supplier lead time (days)"
                      type="number"
                      name="leadTime"
                      value={leadTime}
                      onChange={setLeadTime}
                      placeholder={String(settings.defaultLeadTime)}
                      autoComplete="off"
                      min={0}
                      max={365}
                    />
                    <TextField
                      label="Safety stock (%)"
                      type="number"
                      name="safetyStockPct"
                      value={safetyStockPct}
                      onChange={setSafetyStockPct}
                      placeholder={String(Math.round(settings.safetyStockPct * 100))}
                      autoComplete="off"
                      min={0}
                      max={100}
                      helpText={settings.safetyStockMethod === "service" ? "Not used: safety stock is sized from forecast error (Settings)." : undefined}
                    />
                    <TextField
                      label="Target cover (days)"
                      type="number"
                      name="targetDays"
                      value={targetDays}
                      onChange={setTargetDays}
                      placeholder={String(settings.targetDays)}
                      autoComplete="off"
                      min={1}
                      max={365}
                    />
                    <InlineStack gap="200">
                      <Button variant="primary" submit loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") !== "reset"} disabled={!dirty}>
                        Save for this product
                      </Button>
                      {data.override && (
                        <Button
                          onClick={() => fetcher.submit({ intent: "reset" }, { method: "post" })}
                          loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "reset"}
                        >
                          Use store defaults
                        </Button>
                      )}
                    </InlineStack>
                    {fetcher.state === "idle" && fetcher.data?.ok && !dirty && (
                      <Text as="p" tone="success">
                        Saved.
                      </Text>
                    )}
                  </BlockStack>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingMd">
              Stock by location
            </Text>
          </Box>
          <DataTable
            columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
            headings={["Location", "On hand", "Committed", "Available", "Incoming"]}
            rows={data.levels.map((level) => [level.locationName, level.onHand, level.committed, level.available, level.incoming])}
            totals={["", variant.onHand, variant.committed, variant.available, variant.incoming]}
            showTotalsInFooter
          />
          <Box padding="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Forecast uses {variant.locationName === "All locations" ? "all locations combined" : variant.locationName}. Change the location in Settings.
              {variant.price != null ? ` Price ${variant.price.toFixed(2)}.` : ""}
              {variant.unitCost != null ? ` Unit cost ${variant.unitCost.toFixed(2)}.` : ""}
            </Text>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}

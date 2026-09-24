import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  List,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { PAID_PLAN_NAMES, canUseFeature, planFromSubscription } from "../lib/billing/plans";
import { generateForecast } from "../lib/forecast";
import type { SalesRecord } from "../lib/forecast";
import { getShopSettings, saveShopSettings, sanitizeSettings } from "../lib/settings";
import { getVariantDetail } from "../lib/shopify/client";
import type { VariantInventory } from "../lib/shopify/types";

interface DetailLoaderData {
  missingCredentials: boolean;
  error?: string;
  variant?: VariantInventory;
  salesHistory: SalesRecord[];
  settings: { defaultLeadTime: number; safetyStockPct: number; targetDays: number };
  plan: string;
  applySeasonality: boolean;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.admin || !auth.billing || !auth.session) {
    return json<DetailLoaderData>({ missingCredentials: true, salesHistory: [], settings: { defaultLeadTime: 14, safetyStockPct: 0.2, targetDays: 30 }, plan: "free", applySeasonality: false });
  }

  const variantId = params.id ? decodeURIComponent(params.id) : "";
  if (!variantId) {
    throw new Response("Variant id is required", { status: 400 });
  }

  try {
    const billingCheck = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    const plan = planFromSubscription(billingCheck.appSubscriptions[0]?.name, billingCheck.appSubscriptions[0]?.status);
    const settings = await getShopSettings(auth.session.shop);

    const detail = await getVariantDetail(auth.admin, variantId, {
      lookbackDays: settings.lookbackDays,
      locationId: settings.locationId,
    });
    if (!detail) {
      throw new Response("Variant not found", { status: 404 });
    }

    return json<DetailLoaderData>({
      missingCredentials: false,
      variant: detail.variant,
      salesHistory: detail.salesHistory.get(variantId) ?? [],
      settings: {
        defaultLeadTime: settings.defaultLeadTime,
        safetyStockPct: settings.safetyStockPct,
        targetDays: settings.targetDays,
      },
      plan,
      applySeasonality: canUseFeature(plan, "seasonality"),
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("[stocksense] variant loader failed", error);
    return json<DetailLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load variant",
      salesHistory: [],
      settings: { defaultLeadTime: 14, safetyStockPct: 0.2, targetDays: 30 },
      plan: "free",
      applySeasonality: false,
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.session) {
    return json({ missingCredentials: true });
  }
  const form = await request.formData();
  const settings = sanitizeSettings({
    defaultLeadTime: Number(form.get("defaultLeadTime")),
    safetyStockPct: Number(form.get("safetyStockPct")) / 100,
    targetDays: Number(form.get("targetDays")),
  });
  await saveShopSettings(auth.session.shop, settings);
  return json({ saved: true });
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export default function VariantDetail() {
  const data = useLoaderData<DetailLoaderData>();
  const fetcher = useFetcher<{ saved?: boolean }>();

  const [leadTime, setLeadTime] = useState(String(data.settings.defaultLeadTime));
  const [safetyStockPct, setSafetyStockPct] = useState(String(Math.round(data.settings.safetyStockPct * 100)));
  const [targetDays, setTargetDays] = useState(String(data.settings.targetDays));

  const forecast = useMemo(() => {
    if (!data.variant) {
      return null;
    }
    return generateForecast({
      salesHistory: data.salesHistory,
      onHand: data.variant.onHand,
      leadTimeDays: Number(leadTime) || 0,
      safetyStockPct: (Number(safetyStockPct) || 0) / 100,
      targetDays: Number(targetDays) || 30,
      applySeasonality: data.applySeasonality,
    });
  }, [data.variant, data.salesHistory, data.applySeasonality, leadTime, safetyStockPct, targetDays]);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (!data.variant || !forecast) {
    return (
      <Page>
        <TitleBar title="Variant" />
        <Banner tone="critical" title="Variant not found">
          <Text as="p" variant="bodyMd">
            {data.error ?? "This variant could not be loaded."}
          </Text>
        </Banner>
      </Page>
    );
  }

  const variant = data.variant;

  return (
    <Page>
      <TitleBar title={`${variant.productTitle} — ${variant.variantTitle}`} />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load variant">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {variant.sku || "No SKU"}
            </Text>
            <InlineStack gap="400" wrap>
              <Text as="p" variant="bodyMd">
                On hand: <strong>{variant.onHand}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Available: <strong>{variant.available}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Committed: <strong>{variant.committed}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Incoming: <strong>{variant.incoming}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Location: <strong>{variant.locationName ?? "—"}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Price: <strong>{variant.price != null ? `$${variant.price.toFixed(2)}` : "—"}</strong>
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Forecast
            </Text>
            <InlineStack gap="400" wrap>
              <Text as="p" variant="bodyMd">
                Velocity: <strong>{formatNumber(forecast.velocity)}/day</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Days to stockout: <strong>{Number.isFinite(forecast.daysToStockout) ? formatNumber(forecast.daysToStockout) : "no risk"}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Reorder point: <strong>{forecast.reorderPoint}</strong>
              </Text>
              <Text as="p" variant="bodyMd">
                Suggested order: <strong>{forecast.suggestedOrderQty}</strong>
              </Text>
            </InlineStack>

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Why these numbers
              </Text>
              <List type="bullet">
                {forecast.explanation.map((line, i) => (
                  <List.Item key={i}>{line}</List.Item>
                ))}
              </List>
            </BlockStack>

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

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Adjust assumptions
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              The forecast above recomputes live as you edit. Saving updates the store-wide defaults used by the dashboard.
            </Text>
            <fetcher.Form method="post">
              <BlockStack gap="300">
                <InlineStack gap="400" wrap>
                  <Box minWidth="200px">
                    <TextField
                      label="Supplier lead time (days)"
                      type="number"
                      name="defaultLeadTime"
                      value={leadTime}
                      onChange={setLeadTime}
                      autoComplete="off"
                      min={0}
                      max={365}
                    />
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label="Safety stock (%)"
                      type="number"
                      name="safetyStockPct"
                      value={safetyStockPct}
                      onChange={setSafetyStockPct}
                      autoComplete="off"
                      min={0}
                      max={100}
                    />
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label="Target coverage (days)"
                      type="number"
                      name="targetDays"
                      value={targetDays}
                      onChange={setTargetDays}
                      autoComplete="off"
                      min={1}
                      max={365}
                    />
                  </Box>
                </InlineStack>
                <Box>
                  <Button
                    variant="primary"
                    submit
                    loading={fetcher.state === "submitting"}
                  >
                    Save as defaults
                  </Button>
                </Box>
              </BlockStack>
            </fetcher.Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
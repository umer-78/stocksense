import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { getShopSettings, saveShopSettings, sanitizeSettings } from "../lib/settings";
import { fetchLocations } from "../lib/shopify/client";
import type { LocationInfo } from "../lib/shopify/types";

interface SettingsLoaderData {
  missingCredentials: boolean;
  error?: string;
  settings: {
    defaultLeadTime: number;
    safetyStockPct: number;
    targetDays: number;
    lookbackDays: number;
    locationId: string | null;
  };
  locations: LocationInfo[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.admin || !auth.session) {
    return json<SettingsLoaderData>({
      missingCredentials: true,
      settings: { defaultLeadTime: 14, safetyStockPct: 0.2, targetDays: 30, lookbackDays: 60, locationId: null },
      locations: [],
    });
  }

  try {
    const [settings, locations] = await Promise.all([
      getShopSettings(auth.session.shop),
      fetchLocations(auth.admin),
    ]);
    return json<SettingsLoaderData>({
      missingCredentials: false,
      settings,
      locations,
    });
  } catch (error) {
    console.error("[stocksense] settings loader failed", error);
    return json<SettingsLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load settings",
      settings: { defaultLeadTime: 14, safetyStockPct: 0.2, targetDays: 30, lookbackDays: 60, locationId: null },
      locations: [],
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
    lookbackDays: Number(form.get("lookbackDays")),
    locationId: String(form.get("locationId") ?? ""),
  });
  await saveShopSettings(auth.session.shop, settings);
  return json({ saved: true });
};

export default function Settings() {
  const data = useLoaderData<SettingsLoaderData>();
  const actionData = useActionData<{ saved?: boolean }>();

  const [leadTime, setLeadTime] = useState(String(data.settings.defaultLeadTime));
  const [safetyStockPct, setSafetyStockPct] = useState(String(Math.round(data.settings.safetyStockPct * 100)));
  const [targetDays, setTargetDays] = useState(String(data.settings.targetDays));
  const [lookbackDays, setLookbackDays] = useState(String(data.settings.lookbackDays));
  const [locationId, setLocationId] = useState(data.settings.locationId ?? "");

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load settings">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}
        {actionData?.saved && (
          <Banner tone="success" title="Settings saved">
            <Text as="p" variant="bodyMd">
              Your forecasting defaults were updated.
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Forecasting defaults
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              These defaults drive the dashboard and the variant detail page. You can also adjust them per variant.
            </Text>
            <form method="post">
              <BlockStack gap="300">
                <Box maxWidth="400px">
                  <TextField
                    label="Default supplier lead time (days)"
                    type="number"
                    name="defaultLeadTime"
                    value={leadTime}
                    onChange={setLeadTime}
                    autoComplete="off"
                    min={0}
                    max={365}
                    helpText="How long it takes your supplier to deliver after you order."
                  />
                </Box>
                <Box maxWidth="400px">
                  <TextField
                    label="Safety stock (%)"
                    type="number"
                    name="safetyStockPct"
                    value={safetyStockPct}
                    onChange={setSafetyStockPct}
                    autoComplete="off"
                    min={0}
                    max={100}
                    helpText="Extra stock held to absorb demand variability, as a percentage of lead-time demand."
                  />
                </Box>
                <Box maxWidth="400px">
                  <TextField
                    label="Target coverage (days)"
                    type="number"
                    name="targetDays"
                    value={targetDays}
                    onChange={setTargetDays}
                    autoComplete="off"
                    min={1}
                    max={365}
                    helpText="How many days of stock you want after an order arrives."
                  />
                </Box>
                <Box maxWidth="400px">
                  <TextField
                    label="Sales history lookback (days)"
                    type="number"
                    name="lookbackDays"
                    value={lookbackDays}
                    onChange={setLookbackDays}
                    autoComplete="off"
                    min={7}
                    max={365}
                    helpText="How far back to look when computing sales velocity."
                  />
                </Box>
                <Box maxWidth="400px">
                  <Select
                    label="Inventory location"
                    name="locationId"
                    value={locationId}
                    onChange={setLocationId}
                    options={[
                      { label: "All locations (first returned)", value: "" },
                      ...data.locations.map((location) => ({
                        label: location.name,
                        value: location.id,
                      })),
                    ]}
                    helpText="Forecast against a single location's inventory."
                  />
                </Box>
                <Box>
                  <Button variant="primary" submit>
                    Save settings
                  </Button>
                </Box>
              </BlockStack>
            </form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { isAuthed } from "../lib/context.server";
import { DEFAULT_SETTINGS, SERVICE_LEVELS, sanitizeSettings, type ForecastSettings } from "../lib/settings";
import { getShopSettings, saveShopSettings } from "../lib/settings.server";
import { fetchLocations } from "../lib/shopify/client";
import { DEFAULT_ORDER_ACCESS_DAYS, effectiveLookbackDays } from "../lib/shopify/snapshot.server";
import type { LocationInfo } from "../lib/shopify/types";

interface SettingsLoaderData {
  missingCredentials: boolean;
  error?: string;
  settings: ForecastSettings;
  locations: LocationInfo[];
  /** Days of orders the app can read with its current access. */
  maxLookbackDays: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<SettingsLoaderData>({ missingCredentials: true, settings: DEFAULT_SETTINGS, locations: [], maxLookbackDays: DEFAULT_ORDER_ACCESS_DAYS });
  }
  const maxLookbackDays = effectiveLookbackDays(365, auth.session.scope);
  try {
    const [settings, locations] = await Promise.all([getShopSettings(auth.session.shop), fetchLocations(auth.admin)]);
    return json<SettingsLoaderData>({ missingCredentials: false, settings, locations, maxLookbackDays });
  } catch (error) {
    console.error("[stocksense] settings loader failed", error);
    return json<SettingsLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load settings",
      settings: await getShopSettings(auth.session.shop).catch(() => DEFAULT_SETTINGS),
      locations: [],
      maxLookbackDays,
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ saved: false }, { status: 401 });
  }
  const form = await request.formData();
  const current = await getShopSettings(auth.session.shop);
  const field = (name: string) => {
    const value = form.get(name);
    return value === null ? undefined : String(value);
  };
  const safety = field("safetyStockPct");
  const settings = sanitizeSettings(
    {
      defaultLeadTime: field("defaultLeadTime") === undefined ? undefined : Number(field("defaultLeadTime")),
      safetyStockPct: safety === undefined ? undefined : Number(safety) / 100,
      targetDays: field("targetDays") === undefined ? undefined : Number(field("targetDays")),
      lookbackDays: field("lookbackDays") === undefined ? undefined : Number(field("lookbackDays")),
      locationId: field("locationId"),
      safetyStockMethod: field("safetyStockMethod") === "service" ? "service" : field("safetyStockMethod") === undefined ? undefined : "percent",
      serviceLevel: field("serviceLevel") === undefined ? undefined : Number(field("serviceLevel")),
    },
    current,
  );
  await saveShopSettings(auth.session.shop, settings);
  return json({ saved: true });
};

export default function Settings() {
  const data = useLoaderData<SettingsLoaderData>();
  const actionData = useActionData<{ saved?: boolean }>();
  const navigation = useNavigation();

  const [leadTime, setLeadTime] = useState(String(data.settings.defaultLeadTime));
  const [method, setMethod] = useState<string>(data.settings.safetyStockMethod);
  const [safetyStockPct, setSafetyStockPct] = useState(String(Math.round(data.settings.safetyStockPct * 100)));
  const [serviceLevel, setServiceLevel] = useState(String(data.settings.serviceLevel));
  const [targetDays, setTargetDays] = useState(String(data.settings.targetDays));
  const [lookbackDays, setLookbackDays] = useState(String(data.settings.lookbackDays));
  const [locationId, setLocationId] = useState(data.settings.locationId ?? "");

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  const lookbackOverCap = Number(lookbackDays) > data.maxLookbackDays;

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load locations">
            <Text as="p">{data.error}</Text>
          </Banner>
        )}
        {actionData?.saved && navigation.state === "idle" && (
          <Banner tone="success" title="Settings saved">
            <Text as="p">Forecasts now use these defaults. A change to the sales history window refreshes the data in the background.</Text>
          </Banner>
        )}

        <Form method="post">
          <Layout>
            <Layout.AnnotatedSection
              title="Reorder defaults"
              description="Used for every product unless you set something different on the product's own page."
            >
              <Card>
                <FormLayout>
                  <TextField
                    label="Supplier lead time (days)"
                    type="number"
                    name="defaultLeadTime"
                    value={leadTime}
                    onChange={setLeadTime}
                    autoComplete="off"
                    min={0}
                    max={365}
                    helpText="Days from placing an order to the stock being sellable."
                  />
                  <TextField
                    label="Target cover (days)"
                    type="number"
                    name="targetDays"
                    value={targetDays}
                    onChange={setTargetDays}
                    autoComplete="off"
                    min={1}
                    max={365}
                    helpText="How long one order should last. Usually how often you reorder."
                  />
                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Safety stock"
              description="Extra stock held for late deliveries and busier-than-forecast weeks."
            >
              <Card>
                <FormLayout>
                  <Select
                    label="How to size safety stock"
                    name="safetyStockMethod"
                    value={method}
                    onChange={setMethod}
                    options={[
                      { label: "A percentage of lead-time demand", value: "percent" },
                      { label: "From measured forecast error (service level)", value: "service" },
                    ]}
                  />
                  {method === "percent" ? (
                    <TextField
                      label="Safety stock (%)"
                      type="number"
                      name="safetyStockPct"
                      value={safetyStockPct}
                      onChange={setSafetyStockPct}
                      autoComplete="off"
                      min={0}
                      max={100}
                      helpText="20% is a common starting point."
                    />
                  ) : (
                    <>
                      <input type="hidden" name="safetyStockPct" value={safetyStockPct} />
                      <Select
                        label="Chance of not running out during the lead time"
                        name="serviceLevel"
                        value={serviceLevel}
                        onChange={setServiceLevel}
                        options={SERVICE_LEVELS.map((level) => ({ label: `${Math.round(level * 100)}%`, value: String(level) }))}
                        helpText="Each product's safety stock is sized from how far its forecasts missed in testing. Higher levels hold more stock."
                      />
                    </>
                  )}
                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Data"
              description="Which sales and stock the forecasts are built from."
            >
              <Card>
                <FormLayout>
                  <TextField
                    label="Sales history window (days)"
                    type="number"
                    name="lookbackDays"
                    value={lookbackDays}
                    onChange={setLookbackDays}
                    autoComplete="off"
                    min={7}
                    max={365}
                    helpText={
                      lookbackOverCap
                        ? `Shopify shares only the last ${data.maxLookbackDays} days of orders with this app, so forecasts will use ${data.maxLookbackDays} days.`
                        : "At least 28 days lets the app test forecasting methods against your history."
                    }
                  />
                  <Select
                    label="Inventory location"
                    name="locationId"
                    value={locationId}
                    onChange={setLocationId}
                    options={[
                      { label: "All locations combined", value: "" },
                      ...data.locations.map((location) => ({ label: location.name, value: location.id })),
                    ]}
                    helpText="Sales are counted store-wide; stock comes from this location."
                  />
                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.Section>
              <Box paddingBlockEnd="800">
                <Button variant="primary" submit loading={navigation.state === "submitting"}>
                  Save settings
                </Button>
              </Box>
            </Layout.Section>
          </Layout>
        </Form>
      </BlockStack>
    </Page>
  );
}

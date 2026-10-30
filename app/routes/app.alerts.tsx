import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, DataTable, InlineStack, Layout, List, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { MissingCredentials } from "../components/MissingCredentials";
import { listAlerts, type AlertListItem } from "../lib/alerts.server";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature } from "../lib/billing/plans";
import { currentPlan, isAuthed } from "../lib/context.server";
import { rememberPlan } from "../lib/plan-cache.server";

interface LoaderData {
  missingCredentials: boolean;
  blocked: boolean;
  alerts: AlertListItem[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<LoaderData>({ missingCredentials: true, blocked: false, alerts: [] });
  }
  const plan = await currentPlan(auth);
  await rememberPlan(auth.session.shop, plan);
  if (!canUseFeature(plan, "alerts")) {
    return json<LoaderData>({ missingCredentials: false, blocked: true, alerts: [] });
  }
  return json<LoaderData>({ missingCredentials: false, blocked: false, alerts: await listAlerts(auth.session.shop) });
};

export default function Alerts() {
  const data = useLoaderData<LoaderData>();
  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  return (
    <Page>
      <TitleBar title="Alerts" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.blocked && (
              <Banner tone="warning" title="Low-stock alerts are a Growth or Pro feature">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="p">Upgrade to get told the moment a product needs reordering.</Text>
                  <Button url="/app/billing" variant="primary">
                    See plans
                  </Button>
                </InlineStack>
              </Banner>
            )}
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Recent alerts
                  </Text>
                  <Text as="p" tone="subdued">
                    When a sale or stock change means a product will run out before a new order could arrive, Forelark raises an alert here, at most once a day per product.
                  </Text>
                </BlockStack>
              </Box>
              {data.alerts.length === 0 ? (
                <Box padding="400" paddingBlockStart="0">
                  <Text as="p">No alerts yet.</Text>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                  headings={["When", "Product", "Available", "Days left", "Suggested order", "Flow"]}
                  rows={data.alerts.map((a) => [
                    new Date(a.createdAt).toLocaleString(),
                    <Link key={`v-${a.id}`} to={`/app/variants/${encodeURIComponent(a.variantId)}`}>
                      {a.title}
                    </Link>,
                    a.available,
                    a.daysToStockout == null ? "—" : Math.round(a.daysToStockout),
                    a.suggestedOrderQty,
                    <Badge key={`f-${a.id}`} tone={a.flowSent ? "success" : undefined}>
                      {a.flowSent ? "Sent" : "Not sent"}
                    </Badge>,
                  ])}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Get alerts by email or Slack
              </Text>
              <Text as="p">Forelark sends each alert to Shopify Flow, Shopify&apos;s free automation app. To get an email:</Text>
              <List type="number">
                <List.Item>Install Shopify Flow from the Shopify App Store.</List.Item>
                <List.Item>Create a workflow and choose the trigger &quot;Item needs reordering&quot; from Forelark.</List.Item>
                <List.Item>Add the action &quot;Send internal email&quot; (or Slack), and use the Product, SKU and suggested order quantity in the message.</List.Item>
                <List.Item>Turn the workflow on.</List.Item>
              </List>
              <Button url="https://apps.shopify.com/flow" target="_blank">
                Open Shopify Flow
              </Button>
              <Text as="p" variant="bodySm" tone="subdued">
                &quot;Not sent&quot; means Flow was not installed or no workflow uses the trigger yet. Alerts still show here.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { PAID_PLAN_NAMES, PLANS, planFromSubscription, type PlanId } from "../lib/billing/plans";

interface BillingLoaderData {
  missingCredentials: boolean;
  error?: string;
  plan: PlanId;
  subscriptions: Array<{ id: string; name: string; status: string }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.billing) {
    return json<BillingLoaderData>({ missingCredentials: true, plan: "free", subscriptions: [] });
  }
  try {
    const check = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    return json<BillingLoaderData>({
      missingCredentials: false,
      plan: planFromSubscription(check.appSubscriptions[0]?.name),
      subscriptions: check.appSubscriptions.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    });
  } catch (error) {
    console.error("[stocksense] billing loader failed", error);
    return json<BillingLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to check billing status",
      plan: "free",
      subscriptions: [],
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.billing) {
    return json({ missingCredentials: true });
  }
  const form = await request.formData();
  const plan = String(form.get("plan") ?? "");

  if (plan !== "Growth" && plan !== "Pro") {
    return json({ error: "Unknown plan" }, { status: 400 });
  }

  // billing.request throws a redirect to Shopify's confirmation page; the
  // merchant returns to /app/billing after approving. isTest: true prevents
  // real charges (required for test shops). Flip to false for production.
  await auth.billing.request({
    plan,
    isTest: true,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
  return json({});
};

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: ["Up to 100 SKUs", "Basic forecast (velocity, stockout, reorder)", "Stocky CSV import"],
  growth: ["Up to 2,000 SKUs", "Full forecasts with seasonality", "Purchase order builder", "Stocky CSV import", "14-day free trial"],
  pro: ["Unlimited SKUs", "Full forecasts with seasonality", "Purchase order builder", "Stocky CSV import", "14-day free trial"],
};

export default function Billing() {
  const data = useLoaderData<BillingLoaderData>();

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  return (
    <Page>
      <TitleBar title="Billing" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not check billing">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Current plan: {PLANS[data.plan].name}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {data.subscriptions.length > 0
                ? `Active subscription: ${data.subscriptions.map((s) => `${s.name} (${s.status})`).join(", ")}`
                : "No paid subscription — you are on the Free plan."}
            </Text>
          </BlockStack>
        </Card>

        <InlineStack gap="400" wrap>
          {(Object.keys(PLANS) as PlanId[]).map((planId) => {
            const plan = PLANS[planId];
            const isCurrent = planId === data.plan;
            return (
              <Box key={planId} minWidth="280px" maxWidth="320px">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {plan.name}
                      </Text>
                      {isCurrent && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="p" variant="headingLg">
                      {plan.priceMonthly != null ? `$${plan.priceMonthly}/mo` : "Free"}
                    </Text>
                    <List type="bullet">
                      {PLAN_FEATURES[planId].map((feature) => (
                        <List.Item key={feature}>{feature}</List.Item>
                      ))}
                    </List>
                    {planId !== "free" && (
                      <form method="post">
                        <input type="hidden" name="plan" value={plan.name} />
                        <Button variant={isCurrent ? "secondary" : "primary"} submit disabled={isCurrent}>
                          {isCurrent ? "Current plan" : `Upgrade to ${plan.name}`}
                        </Button>
                      </form>
                    )}
                  </BlockStack>
                </Card>
              </Box>
            );
          })}
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
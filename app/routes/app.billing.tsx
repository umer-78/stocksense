import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
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
import { isDevelopmentStore } from "../lib/shopify/client";
import { PAID_PLAN_NAMES, PLANS, isTestBilling, planFromSubscription, type PlanId } from "../lib/billing/plans";

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
      plan: planFromSubscription(check.appSubscriptions[0]?.name, check.appSubscriptions[0]?.status),
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
  // Development stores (including the ones app reviewers use) can't pay, so
  // they always get test charges, even in production.
  const isTest = isTestBilling() || (auth.admin ? await isDevelopmentStore(auth.admin) : false);

  if (plan === "Free") {
    // Downgrade: cancel the active subscription, with a prorated credit for
    // the unused part of the billing period.
    const check = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    for (const subscription of check.appSubscriptions) {
      await auth.billing.cancel({ subscriptionId: subscription.id, isTest, prorate: true });
    }
    return redirect("/app/billing");
  }

  if (plan !== "Growth" && plan !== "Pro") {
    return json({ error: "Unknown plan" }, { status: 400 });
  }

  // billing.request throws a redirect to Shopify's confirmation page; the
  // merchant returns to /app/billing after approving. Real charges in
  // production, test charges in development (isTestBilling /
  // SHOPIFY_BILLING_TEST) and on development stores.
  await auth.billing.request({
    plan,
    isTest,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
  return json({});
};

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: [
    "Up to 100 variants",
    "Forecasts tested against your own sales: average, smoothing, trend and slow-mover methods",
    "Days to stockout, reorder point and order quantity",
    "Stocky CSV import, including lead times",
  ],
  growth: [
    "Up to 2,000 variants",
    "Everything in Free, plus the weekly-pattern (weekday/weekend) model",
    "Purchase order builder with CSV export",
    "14-day free trial",
  ],
  pro: [
    "Unlimited variants",
    "Everything in Growth",
    "14-day free trial",
  ],
};

const PLAN_ORDER: PlanId[] = ["free", "growth", "pro"];

function planChangeLabel(current: PlanId, target: PlanId): string {
  const name = PLANS[target].name;
  return PLAN_ORDER.indexOf(target) > PLAN_ORDER.indexOf(current) ? `Upgrade to ${name}` : `Downgrade to ${name}`;
}

export default function Billing() {
  const data = useLoaderData<BillingLoaderData>();
  const navigation = useNavigation();

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
                    {(planId !== "free" || !isCurrent) && (
                      <Form method="post">
                        <input type="hidden" name="plan" value={plan.name} />
                        <Button
                          variant={isCurrent || planId === "free" ? "secondary" : "primary"}
                          submit
                          disabled={isCurrent}
                          loading={navigation.state !== "idle" && navigation.formData?.get("plan") === plan.name}
                        >
                          {isCurrent ? "Current plan" : planChangeLabel(data.plan, planId)}
                        </Button>
                      </Form>
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
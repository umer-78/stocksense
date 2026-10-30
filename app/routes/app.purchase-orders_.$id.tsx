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
  DataTable,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature } from "../lib/billing/plans";
import { currentPlan, isAuthed } from "../lib/context.server";
import { toCsv } from "../lib/purchase-order";
import { PO_STATUS_LABEL, mailtoUrl, poEmail, poLabel, type PoStatus } from "../lib/purchase-orders";
import { cancel, deleteDraft, getPurchaseOrder, markSent, receive, type PoDetail } from "../lib/purchase-orders.server";

interface LoaderData {
  missingCredentials: boolean;
  blocked: boolean;
  po: PoDetail | null;
  shopName: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<LoaderData>({ missingCredentials: true, blocked: false, po: null, shopName: "" });
  }
  if (!canUseFeature(await currentPlan(auth), "poBuilder")) {
    return json<LoaderData>({ missingCredentials: false, blocked: true, po: null, shopName: "" });
  }
  const id = Number(params.id);
  const po = Number.isInteger(id) ? await getPurchaseOrder(auth.session.shop, id) : null;
  if (!po) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  let shopName = auth.session.shop.replace(/\.myshopify\.com$/, "");
  try {
    const response = await auth.admin.graphql(`#graphql
      query ForelarkShopName { shop { name } }`);
    const body = (await response.json()) as { data?: { shop?: { name?: string } } };
    shopName = body.data?.shop?.name || shopName;
  } catch {
    // The domain is a fine fallback for the email signature.
  }
  return json<LoaderData>({ missingCredentials: false, blocked: false, po, shopName });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ ok: false }, { status: 401 });
  }
  if (!canUseFeature(await currentPlan(auth), "poBuilder")) {
    return json({ ok: false }, { status: 403 });
  }
  const shop = auth.session.shop;
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return json({ ok: false }, { status: 400 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "send") {
    await markSent(shop, id);
  } else if (intent === "receive") {
    const receipt: Record<number, number> = {};
    for (const [key, value] of form.entries()) {
      const match = key.match(/^receive-(\d+)$/);
      const qty = Math.floor(Number(value));
      if (match && Number.isFinite(qty) && qty !== 0) {
        receipt[Number(match[1])] = qty;
      }
    }
    await receive(shop, id, receipt);
  } else if (intent === "cancel") {
    await cancel(shop, id);
  } else if (intent === "delete") {
    await deleteDraft(shop, id);
    return redirect("/app/purchase-orders");
  }
  return redirect(`/app/purchase-orders/${id}`);
};

const STATUS_TONE: Record<PoStatus, "info" | "attention" | "success" | "critical" | undefined> = {
  draft: undefined,
  sent: "info",
  partial: "attention",
  received: "success",
  cancelled: "critical",
};

function IntentButton({ intent, children, primary, tone }: { intent: string; children: string; primary?: boolean; tone?: "critical" }) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <Button submit variant={primary ? "primary" : undefined} tone={tone} loading={busy}>
        {children}
      </Button>
    </Form>
  );
}

export default function PurchaseOrderDetail() {
  const data = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const [receiving, setReceiving] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }
  if (data.blocked || !data.po) {
    return (
      <Page>
        <TitleBar title="Purchase order" />
        <Banner tone="warning" title="Purchase orders are a Growth or Pro feature">
          <Button url="/app/billing" variant="primary">
            See plans
          </Button>
        </Banner>
      </Page>
    );
  }

  const po = data.po;
  const label = poLabel(po.number);
  const email = poEmail(po, po.supplier?.name ?? null, data.shopName);
  const mailto = mailtoUrl(po.supplier?.email ?? null, email.subject, email.body);
  const open = po.status === "sent" || po.status === "partial";
  const canReceive = open || po.status === "received";

  const csv = toCsv(po.lines.map((line) => ({ sku: line.sku, productTitle: line.title, variantTitle: "", qty: line.qty, unitCost: line.unitCost })));
  const downloadCsv = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${label}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const copyEmail = async () => {
    const textValue = `${email.subject}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(textValue);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = textValue;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Page backAction={{ content: "Purchase orders", url: "/app/purchase-orders" }} title={label} titleMetadata={<Badge tone={STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>}>
      <TitleBar title={label} />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Form method="post">
              <input type="hidden" name="intent" value="receive" />
              <DataTable
                columnContentTypes={canReceive ? ["text", "text", "numeric", "numeric", "numeric"] : ["text", "text", "numeric", "numeric"]}
                headings={canReceive ? ["SKU", "Product", "Ordered", "Received", "Receive now"] : ["SKU", "Product", "Ordered", "Unit cost"]}
                rows={po.lines.map((line) => {
                  const base = [line.sku || "—", line.title, line.qty];
                  if (!canReceive) {
                    return [...base, line.unitCost != null ? line.unitCost.toFixed(2) : "—"];
                  }
                  return [
                    ...base,
                    line.receivedQty,
                    <Box key={`recv-${line.id}`} maxWidth="110px">
                      <TextField
                        label={`Units of ${line.title} received now`}
                        labelHidden
                        type="number"
                        name={`receive-${line.id}`}
                        value={receiving[line.id] ?? ""}
                        placeholder={String(Math.max(0, line.qty - line.receivedQty))}
                        onChange={(value) => setReceiving((prev) => ({ ...prev, [line.id]: value }))}
                        autoComplete="off"
                      />
                    </Box>,
                  ];
                })}
              />
              {canReceive && (
                <Box padding="400">
                  <InlineStack gap="300" blockAlign="center" wrap>
                    <Button submit variant="primary" loading={navigation.state === "submitting" && navigation.formData?.get("intent") === "receive"}>
                      Record received units
                    </Button>
                    <Button
                      onClick={() =>
                        setReceiving(Object.fromEntries(po.lines.map((line) => [line.id, String(Math.max(0, line.qty - line.receivedQty))])))
                      }
                    >
                      Fill in everything outstanding
                    </Button>
                  </InlineStack>
                  <Box paddingBlockStart="200">
                    <Text as="p" tone="subdued">
                      This updates the purchase order only. Add the units to your stock in Shopify as usual.
                    </Text>
                  </Box>
                </Box>
              )}
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {po.supplier ? po.supplier.name : "No supplier"}
                </Text>
                <Text as="p" tone="subdued">
                  {po.units} units ordered, {po.receivedUnits} received. Created {po.createdAt.slice(0, 10)}
                  {po.sentAt ? `, sent ${po.sentAt.slice(0, 10)}` : ""}.
                </Text>
                {po.note && <Text as="p">{po.note}</Text>}
                <InlineStack gap="200" wrap>
                  <Button url={mailto} target="_blank" variant={po.status === "draft" ? "primary" : undefined}>
                    {po.supplier?.email ? `Email ${po.supplier.email}` : "Open as email"}
                  </Button>
                  <Button onClick={copyEmail}>{copied ? "Copied" : "Copy email text"}</Button>
                  <Button onClick={downloadCsv}>Download CSV</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                {po.status === "draft" && (
                  <>
                    <Text as="p">Once you have sent the order, mark it as sent. Its units then count as on the way in your forecasts.</Text>
                    <InlineStack gap="200">
                      <IntentButton intent="send" primary>
                        Mark as sent
                      </IntentButton>
                      <IntentButton intent="delete" tone="critical">
                        Delete draft
                      </IntentButton>
                    </InlineStack>
                  </>
                )}
                {open && (
                  <>
                    <Text as="p">
                      Recording units here does not change stock in Shopify. When goods arrive, update the quantities in Shopify too.
                    </Text>
                    <IntentButton intent="cancel" tone="critical">
                      Cancel order
                    </IntentButton>
                  </>
                )}
                {po.status === "received" && <Text as="p">Everything on this order has arrived.</Text>}
                {po.status === "cancelled" && <Text as="p">This order was cancelled and no longer counts as stock on the way.</Text>}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

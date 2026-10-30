import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Layout, List, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { getApiKeyInfo, createApiKey, revokeApiKey, type ApiKeyInfo } from "../lib/api-keys.server";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature } from "../lib/billing/plans";
import { currentPlan, isAuthed } from "../lib/context.server";
import { rememberPlan } from "../lib/plan-cache.server";

interface LoaderData {
  missingCredentials: boolean;
  blocked: boolean;
  key: ApiKeyInfo | null;
  endpoint: string;
}

function endpoint(): string {
  return `${(process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "")}/mcp`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<LoaderData>({ missingCredentials: true, blocked: false, key: null, endpoint: "" });
  }
  const plan = await currentPlan(auth);
  await rememberPlan(auth.session.shop, plan);
  if (!canUseFeature(plan, "aiAccess")) {
    return json<LoaderData>({ missingCredentials: false, blocked: true, key: null, endpoint: endpoint() });
  }
  return json<LoaderData>({ missingCredentials: false, blocked: false, key: await getApiKeyInfo(auth.session.shop), endpoint: endpoint() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ key: null as string | null }, { status: 401 });
  }
  const plan = await currentPlan(auth);
  await rememberPlan(auth.session.shop, plan);
  if (!canUseFeature(plan, "aiAccess")) {
    return json({ key: null as string | null }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("intent") === "revoke") {
    await revokeApiKey(auth.session.shop);
    return json({ key: null as string | null });
  }
  return json({ key: await createApiKey(auth.session.shop) });
};

function CodeBlock({ children }: { children: string }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200" overflowX="scroll">
      <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{children}</pre>
    </Box>
  );
}

export default function AiAssistants() {
  const data = useLoaderData<LoaderData>();
  const actionData = useActionData<{ key: string | null }>();
  const navigation = useNavigation();
  const [copied, setCopied] = useState(false);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  const newKey = actionData?.key ?? null;
  const keyText = newKey ?? "YOUR_KEY";
  const claudeCode = `claude mcp add --transport http forelark ${data.endpoint} --header "Authorization: Bearer ${keyText}"`;
  const genericConfig = JSON.stringify(
    { mcpServers: { forelark: { type: "http", url: data.endpoint, headers: { Authorization: `Bearer ${keyText}` } } } },
    null,
    2,
  );

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Selecting the key text by hand still works.
    }
  };

  return (
    <Page>
      <TitleBar title="AI assistants" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.blocked && (
              <Banner tone="warning" title="AI assistant access is a Pro feature">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="p">Upgrade to Pro to ask Claude and other assistants about your stock.</Text>
                  <Button url="/app/billing" variant="primary">
                    See plans
                  </Button>
                </InlineStack>
              </Banner>
            )}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Ask an AI assistant about your stock
                </Text>
                <Text as="p">
                  Connect Claude, or any assistant that supports the Model Context Protocol (MCP), and ask things like &quot;What do I need to reorder this week?&quot; or &quot;Why is the Trail Runner flagged?&quot;. Answers come from your Forelark forecasts.
                </Text>
                <List>
                  <List.Item>Read-only: an assistant can look at forecasts and purchase orders but cannot change anything.</List.Item>
                  <List.Item>The key only works for this shop. Revoke it here at any time.</List.Item>
                </List>
              </BlockStack>
            </Card>

            {!data.blocked && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Connection
                  </Text>
                  <Text as="p">Server address</Text>
                  <CodeBlock>{data.endpoint}</CodeBlock>

                  {newKey ? (
                    <Banner tone="success" title="Copy your key now">
                      <BlockStack gap="200">
                        <Text as="p">For your security it will not be shown again. Creating a new key stops the old one working.</Text>
                        <CodeBlock>{newKey}</CodeBlock>
                        <InlineStack>
                          <Button onClick={copyKey}>{copied ? "Copied" : "Copy key"}</Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  ) : data.key ? (
                    <Text as="p" tone="subdued">
                      Key {data.key.hint} created {data.key.createdAt.slice(0, 10)}
                      {data.key.lastUsedAt ? `, last used ${data.key.lastUsedAt.slice(0, 10)}` : ", not used yet"}.
                    </Text>
                  ) : (
                    <Text as="p" tone="subdued">
                      No key yet.
                    </Text>
                  )}

                  <InlineStack gap="200">
                    <Form method="post">
                      <input type="hidden" name="intent" value="create" />
                      <Button submit variant="primary" loading={navigation.state === "submitting"}>
                        {data.key || newKey ? "Create a new key" : "Create key"}
                      </Button>
                    </Form>
                    {(data.key || newKey) && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="revoke" />
                        <Button submit tone="critical">
                          Revoke key
                        </Button>
                      </Form>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        {!data.blocked && (
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Set up
                </Text>
                <Text as="p">Claude Code: run this once in a terminal.</Text>
                <CodeBlock>{claudeCode}</CodeBlock>
                <Text as="p">Other assistants: add this to their MCP settings.</Text>
                <CodeBlock>{genericConfig}</CodeBlock>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

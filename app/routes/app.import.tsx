import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useRef, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { PAID_PLAN_NAMES, canUseFeature, planFromSubscription } from "../lib/billing/plans";
import { parseStockyCsv, type StockyParseResult } from "../lib/stocky/parser";
import db from "../db.server";

interface ImportLoaderData {
  missingCredentials: boolean;
  error?: string;
  blocked?: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.billing) {
    return json<ImportLoaderData>({ missingCredentials: true });
  }
  try {
    const billingCheck = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    const plan = planFromSubscription(billingCheck.appSubscriptions[0]?.name);
    if (!canUseFeature(plan, "stockyImport")) {
      return json<ImportLoaderData>({ missingCredentials: false, blocked: true });
    }
    return json<ImportLoaderData>({ missingCredentials: false });
  } catch (error) {
    console.error("[stocksense] import loader failed", error);
    return json<ImportLoaderData>({
      missingCredentials: false,
      error: error instanceof Error ? error.message : "Failed to load import page",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.session) {
    return json({ missingCredentials: true });
  }
  const form = await request.formData();
  const fileName = String(form.get("fileName") ?? "stocky-export.csv");
  const rawRows = String(form.get("rows") ?? "[]");

  try {
    const rows = JSON.parse(rawRows) as unknown[];
    if (!Array.isArray(rows)) {
      return json({ error: "Invalid rows payload" }, { status: 400 });
    }
    await db.stockyImport.create({
      data: {
        shop: auth.session.shop,
        fileName,
        rowCount: rows.length,
        data: rawRows,
      },
    });
    return json({ saved: true, rowCount: rows.length });
  } catch (error) {
    console.error("[stocksense] import action failed", error);
    return json({ error: "Failed to store import" }, { status: 500 });
  }
};

const PREVIEW_LIMIT = 10;

export default function ImportStocky() {
  const data = useLoaderData<ImportLoaderData>();
  const actionData = useActionData<{ saved?: boolean; rowCount?: number; error?: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseResult, setParseResult] = useState<StockyParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (data.blocked) {
    return (
      <Page>
        <TitleBar title="Import Stocky" />
        <Banner tone="warning" title="Stocky import is not available on your plan">
          <Text as="p" variant="bodyMd">
            Contact support to enable Stocky imports on the Free plan.
          </Text>
        </Banner>
      </Page>
    );
  }

  const handleFile = (file: File | undefined) => {
    setParseError(null);
    setParseResult(null);
    if (!file) {
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseStockyCsv(String(reader.result ?? ""));
        setParseResult(result);
      } catch (error) {
        setParseError(error instanceof Error ? error.message : "Failed to parse CSV");
      }
    };
    reader.onerror = () => setParseError("Failed to read the file");
    reader.readAsText(file);
  };

  const previewRows = parseResult?.rows.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <Page>
      <TitleBar title="Import Stocky" />
      <BlockStack gap="500">
        {data.error && (
          <Banner tone="critical" title="Could not load import page">
            <Text as="p" variant="bodyMd">
              {data.error}
            </Text>
          </Banner>
        )}
        {actionData?.saved && (
          <Banner tone="success" title={`Imported ${actionData.rowCount} rows`}>
            <Text as="p" variant="bodyMd">
              The Stocky export was stored. It can be used as a reference for inventory and PO history.
            </Text>
          </Banner>
        )}
        {actionData?.error && (
          <Banner tone="critical" title="Import failed">
            <Text as="p" variant="bodyMd">
              {actionData.error}
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Upload a Stocky CSV export
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Stocky exports two CSV files: <strong>Stocky - Variants.csv</strong> (current inventory) and{" "}
              <strong>Stocky - Purchase Orders.csv</strong> (PO history). Both are accepted. The parser is
              best-effort — column names are matched flexibly, and rows without a SKU are skipped.
            </Text>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <InlineStack gap="300">
              <Button onClick={() => fileInputRef.current?.click()}>Choose CSV file</Button>
              {fileName && (
                <Text as="span" variant="bodyMd">
                  {fileName}
                </Text>
              )}
            </InlineStack>
            {parseError && (
              <Banner tone="critical" title="Could not parse the file">
                <Text as="p" variant="bodyMd">
                  {parseError}
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {parseResult && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Preview
              </Text>
              <Text as="p" variant="bodyMd">
                Detected export type: <strong>{parseResult.kind}</strong> · {parseResult.rows.length} rows parsed ·{" "}
                {parseResult.skippedRows} skipped
              </Text>
              {parseResult.errors.map((error, i) => (
                <Banner key={i} tone="warning" title="Parser note">
                  <Text as="p" variant="bodyMd">
                    {error}
                  </Text>
                </Banner>
              ))}
              {previewRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "numeric"]}
                  headings={
                    parseResult.kind === "purchase-orders"
                      ? ["PO number", "SKU", "Variant", "Quantity"]
                      : ["SKU", "Variant", "Location", "On hand"]
                  }
                  rows={previewRows.map((row) =>
                    row.kind === "po"
                      ? [row.poNumber || "—", row.sku, row.variantName, row.quantity]
                      : [row.sku, row.variantName, row.location || "—", row.onHand],
                  )}
                />
              ) : (
                <Text as="p" variant="bodyMd">
                  No rows to preview.
                </Text>
              )}
              {parseResult.rows.length > PREVIEW_LIMIT && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  Showing the first {PREVIEW_LIMIT} of {parseResult.rows.length} rows.
                </Text>
              )}
              <Box>
                <form method="post">
                  <input type="hidden" name="fileName" value={fileName} />
                  <input type="hidden" name="rows" value={JSON.stringify(parseResult.rows)} />
                  <Button variant="primary" submit disabled={parseResult.rows.length === 0}>
                    Confirm import
                  </Button>
                </form>
              </Box>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
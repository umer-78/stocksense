import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
import { getForecastContext, isAuthed } from "../lib/context.server";
import { getVariantOverrides, saveVariantOverride } from "../lib/settings.server";
import { leadTimesBySku, matchLeadTimes, overrideFromImport } from "../lib/stocky/apply";
import { parseStockyCsv, type StockyParseResult } from "../lib/stocky/parser";
import db from "../db.server";

interface ImportSummary {
  id: number;
  fileName: string;
  rowCount: number;
  createdAt: string;
  /** Variants rows that carry a supplier lead time. */
  leadTimeSkus: number;
}

interface ImportLoaderData {
  missingCredentials: boolean;
  error?: string;
  blocked?: boolean;
  imports?: ImportSummary[];
}

/** Recent imports listed on the page. */
const RECENT_IMPORTS = 5;

/** Max accepted upload size (raw rows JSON payload) — guards against OOM. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
/** Max accepted number of parsed rows. */
const MAX_IMPORT_ROWS = 50_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (auth.missingCredentials || !auth.billing) {
    return json<ImportLoaderData>({ missingCredentials: true });
  }
  try {
    const billingCheck = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
    const plan = planFromSubscription(billingCheck.appSubscriptions[0]?.name, billingCheck.appSubscriptions[0]?.status);
    if (!canUseFeature(plan, "stockyImport")) {
      return json<ImportLoaderData>({ missingCredentials: false, blocked: true });
    }
    const recent = auth.session
      ? await db.stockyImport.findMany({
          where: { shop: auth.session.shop },
          orderBy: { createdAt: "desc" },
          take: RECENT_IMPORTS,
        })
      : [];
    const imports = recent.map((row) => {
      let leadTimeSkus = 0;
      try {
        leadTimeSkus = leadTimesBySku(JSON.parse(row.data) as unknown[]).size;
      } catch {
        // A malformed stored import just shows no lead times.
      }
      return { id: row.id, fileName: row.fileName, rowCount: row.rowCount, createdAt: row.createdAt.toISOString(), leadTimeSkus };
    });
    return json<ImportLoaderData>({ missingCredentials: false, imports });
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
  if (form.get("intent") === "apply-lead-times") {
    return applyLeadTimes(auth, Number(form.get("importId")));
  }
  const fileName = String(form.get("fileName") ?? "stocky-export.csv");
  const rawRows = String(form.get("rows") ?? "[]");

  // Server-side guard: reject oversized payloads before parsing so a huge
  // upload cannot OOM the server.
  if (Buffer.byteLength(rawRows, "utf8") > MAX_IMPORT_BYTES) {
    return json(
      {
        error:
          "The import is larger than 5 MB. Split the export into smaller files and try again.",
      },
      { status: 413 },
    );
  }

  try {
    const rows = JSON.parse(rawRows) as unknown[];
    if (!Array.isArray(rows)) {
      return json({ error: "Invalid rows payload" }, { status: 400 });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return json(
        {
          error: `The import has ${rows.length.toLocaleString()} rows, which exceeds the 50,000 row limit. Split the export into smaller files and try again.`,
        },
        { status: 413 },
      );
    }
    await db.stockyImport.create({
      data: {
        shop: auth.session.shop,
        fileName,
        rowCount: rows.length,
        data: rawRows,
      },
    });
    return json({ saved: true, rowCount: rows.length, leadTimeSkus: leadTimesBySku(rows).size });
  } catch (error) {
    console.error("[stocksense] import action failed", error);
    return json({ error: "Failed to store import" }, { status: 500 });
  }
};

/** Save the import's lead times as per-variant overrides, matched by SKU. */
async function applyLeadTimes(auth: Awaited<ReturnType<typeof authenticateAdmin>>, importId: number) {
  if (!isAuthed(auth) || !Number.isInteger(importId)) {
    return json({ error: "Import not found" }, { status: 400 });
  }
  const stored = await db.stockyImport.findFirst({ where: { id: importId, shop: auth.session.shop } });
  if (!stored) {
    return json({ error: "Import not found" }, { status: 404 });
  }
  const context = await getForecastContext(auth);
  const snapshot = context.sync.snapshot;
  if (!snapshot) {
    return json({ error: "Your products are still syncing from Shopify. Try again in a minute." }, { status: 409 });
  }
  const matches = matchLeadTimes(leadTimesBySku(JSON.parse(stored.data) as unknown[]), snapshot.variants);
  const overrides = await getVariantOverrides(context.shop);
  let applied = 0;
  let keptManual = 0;
  for (const match of matches) {
    const values = overrideFromImport(match, overrides.get(match.variantId));
    if (!values) {
      keptManual += 1;
      continue;
    }
    await saveVariantOverride(context.shop, match.variantId, values, "stocky");
    applied += 1;
  }
  return json({ applied, keptManual, matched: matches.length });
}

const PREVIEW_LIMIT = 10;

export default function ImportStocky() {
  const data = useLoaderData<ImportLoaderData>();
  const actionData = useActionData<{ saved?: boolean; rowCount?: number; leadTimeSkus?: number; error?: string }>();
  const navigation = useNavigation();
  const applyFetcher = useFetcher<{ applied?: number; keptManual?: number; matched?: number; error?: string }>();
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
            Upgrade your plan to import Stocky exports.
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
    if (file.size > MAX_IMPORT_BYTES) {
      setParseError(
        "The file is larger than 5 MB. Split the export into smaller files and try again.",
      );
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
        {actionData?.saved && navigation.state === "idle" && (
          <Banner tone="success" title={`Imported ${actionData.rowCount} rows`}>
            <Text as="p" variant="bodyMd">
              {actionData.leadTimeSkus
                ? `The export has supplier lead times for ${actionData.leadTimeSkus} SKUs. Apply them below to use them in forecasts.`
                : "The export was stored as reference history."}
            </Text>
          </Banner>
        )}
        {applyFetcher.state === "idle" && applyFetcher.data?.applied !== undefined && (
          <Banner tone="success" title={`Applied lead times to ${applyFetcher.data.applied} products`}>
            <Text as="p" variant="bodyMd">
              {applyFetcher.data.matched} SKUs matched your catalog.
              {applyFetcher.data.keptManual ? ` ${applyFetcher.data.keptManual} kept the lead time you set by hand.` : ""} Each product's page shows where its lead time came from.
            </Text>
          </Banner>
        )}
        {applyFetcher.state === "idle" && applyFetcher.data?.error && (
          <Banner tone="critical" title="Could not apply lead times">
            <Text as="p" variant="bodyMd">
              {applyFetcher.data.error}
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
              <strong>Stocky - Purchase Orders.csv</strong> (PO history). Both are accepted. Supplier lead times
              in the variants export can be applied to matching products by SKU. Column names are matched
              flexibly, and rows without a SKU are skipped.
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
                <Form method="post">
                  <input type="hidden" name="fileName" value={fileName} />
                  <input type="hidden" name="rows" value={JSON.stringify(parseResult.rows)} />
                  <Button variant="primary" submit disabled={parseResult.rows.length === 0} loading={navigation.state === "submitting"}>
                    Confirm import
                  </Button>
                </Form>
              </Box>
            </BlockStack>
          </Card>
        )}
        {data.imports && data.imports.length > 0 && (
          <Card padding="0">
            <Box padding="400">
              <Text as="h2" variant="headingMd">
                Recent imports
              </Text>
            </Box>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "text"]}
              headings={["File", "Imported", "Rows", "Lead times"]}
              rows={data.imports.map((item) => [
                item.fileName,
                new Date(item.createdAt).toLocaleDateString(),
                item.rowCount,
                item.leadTimeSkus > 0 ? (
                  <applyFetcher.Form method="post" key={item.id}>
                    <input type="hidden" name="intent" value="apply-lead-times" />
                    <input type="hidden" name="importId" value={item.id} />
                    <Button size="slim" submit loading={applyFetcher.state !== "idle" && applyFetcher.formData?.get("importId") === String(item.id)}>
                      {`Apply ${item.leadTimeSkus} lead times`}
                    </Button>
                  </applyFetcher.Form>
                ) : (
                  "—"
                ),
              ])}
            />
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
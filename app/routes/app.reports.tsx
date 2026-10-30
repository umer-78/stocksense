import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Box, Button, Card, DataTable, InlineGrid, InlineStack, Layout, Page, Tabs, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, type ReactNode } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { SyncStatus } from "../components/SyncStatus";
import { authenticateAdmin } from "../lib/auth";
import { PLANS, canUseFeature } from "../lib/billing/plans";
import { getForecastContext, isAuthed, syncInfo } from "../lib/context.server";
import { buildRows } from "../lib/dashboard";
import { getPlanningInputs } from "../lib/planning.server";
import {
  abcAnalysis,
  deadStock,
  overstock,
  reportCsv,
  unitsSince,
  type AbcClass,
  type AbcRow,
  type AbcSummary,
  type DeadStockRow,
  type OverstockRow,
  type ReportItem,
} from "../lib/reports";
import { getVariantOverrides } from "../lib/settings.server";
import { salesFor } from "../lib/shopify/adapter";
import type { SyncInfo } from "../lib/sync-info";

/** Rows shown on screen per report (the CSV has them all). */
const SHOWN = 100;

interface LoaderData {
  missingCredentials: boolean;
  error?: string;
  sync: SyncInfo | null;
  windowDays: number;
  targetDays: number;
  overstockDays: number;
  totalRevenue: number;
  missingPrice: number;
  missingCost: number;
  summary: Record<AbcClass, AbcSummary> | null;
  abc: AbcRow[];
  dead: DeadStockRow[];
  over: OverstockRow[];
}

const EMPTY: Omit<LoaderData, "missingCredentials"> = {
  sync: null,
  windowDays: 0,
  targetDays: 30,
  overstockDays: 90,
  totalRevenue: 0,
  missingPrice: 0,
  missingCost: 0,
  summary: null,
  abc: [],
  dead: [],
  over: [],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<LoaderData>({ missingCredentials: true, ...EMPTY });
  }
  try {
    const context = await getForecastContext(auth);
    const snapshot = context.sync.snapshot;
    if (!snapshot) {
      return json<LoaderData>({ missingCredentials: false, ...EMPTY, sync: syncInfo(context.sync) });
    }
    const [overrides, planning] = await Promise.all([getVariantOverrides(context.shop), getPlanningInputs(context.shop)]);
    const locationId = context.settings.locationId && snapshot.locations.some((l) => l.id === context.settings.locationId) ? context.settings.locationId : null;
    const { rows } = buildRows(snapshot, context.settings, overrides, {
      allowSeasonal: canUseFeature(context.plan, "seasonality"),
      locationId,
      limit: PLANS[context.plan].skuLimit,
      planning,
    });
    const items: ReportItem[] = rows.map((row) => ({
      variantId: row.variant.variantId,
      sku: row.variant.sku,
      title: row.variant.variantTitle && row.variant.variantTitle !== "Default Title" ? `${row.variant.productTitle} — ${row.variant.variantTitle}` : row.variant.productTitle,
      available: row.variant.available,
      unitCost: row.variant.unitCost,
      price: row.variant.price,
      unitsSold: unitsSince(salesFor(snapshot, row.variant.variantId), snapshot.windowStart),
      forecastPerDay: row.forecastPerDay,
    }));
    const targetDays = context.settings.targetDays;
    const overstockDays = Math.max(60, targetDays * 3);
    const abc = abcAnalysis(items);
    const windowDays = Math.max(1, Math.round((Date.parse(snapshot.windowEnd) - Date.parse(snapshot.windowStart)) / 86_400_000) + 1);
    return json<LoaderData>({
      missingCredentials: false,
      sync: syncInfo(context.sync),
      windowDays,
      targetDays,
      overstockDays,
      totalRevenue: abc.total,
      missingPrice: items.filter((i) => i.price == null && i.unitsSold > 0).length,
      missingCost: items.filter((i) => i.unitCost == null && i.available > 0).length,
      summary: abc.summary,
      abc: abc.rows,
      dead: deadStock(items),
      over: overstock(items, targetDays, overstockDays),
    });
  } catch (error) {
    console.error("[stocksense] reports loader failed", error);
    return json<LoaderData>({ missingCredentials: false, ...EMPTY, error: error instanceof Error ? error.message : "Failed to build the reports" });
  }
};

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const days = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "No recent sales");

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const productLink = (row: { variantId: string; title: string }) => (
  <Link key={`v-${row.variantId}`} to={`/app/variants/${encodeURIComponent(row.variantId)}`}>
    {row.title}
  </Link>
);

function ReportCard({ title, description, empty, csv, children }: { title: string; description: string; empty: boolean; csv: () => void; children: ReactNode }) {
  return (
    <Card padding="0">
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            <Text as="p" tone="subdued">
              {description}
            </Text>
          </BlockStack>
          {!empty && <Button onClick={csv}>Download CSV</Button>}
        </InlineStack>
      </Box>
      {children}
    </Card>
  );
}

export default function Reports() {
  const data = useLoaderData<LoaderData>();
  const [tab, setTab] = useState(0);
  if (data.missingCredentials) {
    return <MissingCredentials />;
  }
  const period = `the last ${data.windowDays} days`;
  const tabs = [
    { id: "abc", content: "ABC analysis" },
    { id: "dead", content: `Dead stock (${data.dead.length})` },
    { id: "over", content: `Overstock (${data.over.length})` },
  ];
  const deadValue = data.dead.reduce((sum, r) => sum + (r.stockValue ?? 0), 0);
  const overValue = data.over.reduce((sum, r) => sum + (r.excessValue ?? 0), 0);

  return (
    <Page>
      <TitleBar title="Reports" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.sync && <SyncStatus info={data.sync} />}
            {data.error && (
              <Banner tone="critical" title="Could not build the reports">
                <Text as="p">{data.error}</Text>
              </Banner>
            )}
            {data.summary && (
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                {(["A", "B", "C"] as const).map((cls) => (
                  <Card key={cls}>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        Class {cls}
                      </Text>
                      <Text as="p" variant="headingLg">
                        {data.summary![cls].variants} products
                      </Text>
                      <Text as="p" tone="subdued">
                        {pct(data.summary![cls].share)} of revenue · {money(data.summary![cls].stockValue)} in stock at cost
                      </Text>
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            )}
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
            {tab === 0 && (
              <ReportCard
                title="ABC analysis"
                description={`Products ranked by revenue in ${period} (units sold × current price). A products earn the first 80% of revenue: never let them run out. C products earn the last 5%: order them carefully.`}
                empty={!data.abc.length}
                csv={() =>
                  download(
                    "abc-analysis.csv",
                    reportCsv(
                      ["Class", "SKU", "Product", "Units sold", "Revenue", "Share of revenue", "Available", "Unit cost"],
                      data.abc.map((r) => [r.abc, r.sku, r.title, r.unitsSold, r.revenue, Math.round(r.share * 10000) / 100, r.available, r.unitCost]),
                    ),
                  )
                }
              >
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Class", "Product", "Units sold", "Revenue", "Share", "Available"]}
                  rows={data.abc.slice(0, SHOWN).map((r) => [r.abc, productLink(r), r.unitsSold, money(r.revenue), pct(r.share), r.available])}
                  footerContent={data.abc.length > SHOWN ? `Showing the top ${SHOWN} of ${data.abc.length}. Download the CSV for all.` : undefined}
                />
                {data.missingPrice > 0 && (
                  <Box padding="400">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.missingPrice} selling product{data.missingPrice === 1 ? " has" : "s have"} no price, so {data.missingPrice === 1 ? "it counts" : "they count"} as no revenue.
                    </Text>
                  </Box>
                )}
              </ReportCard>
            )}
            {tab === 1 && (
              <ReportCard
                title="Dead stock"
                description={`In stock, but not one unit sold in ${period}: ${money(deadValue)} tied up at cost. Consider a discount, a bundle or returning it to the supplier, and don't reorder it.`}
                empty={!data.dead.length}
                csv={() =>
                  download("dead-stock.csv", reportCsv(["SKU", "Product", "Available", "Unit cost", "Stock value"], data.dead.map((r) => [r.sku, r.title, r.available, r.unitCost, r.stockValue])))
                }
              >
                {data.dead.length ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                    headings={["Product", "Available", "Unit cost", "Stock value"]}
                    rows={data.dead.slice(0, SHOWN).map((r) => [productLink(r), r.available, money(r.unitCost), money(r.stockValue)])}
                  />
                ) : (
                  <Box padding="400" paddingBlockStart="0">
                    <Text as="p">Everything in stock sold at least once in {period}.</Text>
                  </Box>
                )}
              </ReportCard>
            )}
            {tab === 2 && (
              <ReportCard
                title="Overstock"
                description={`Selling, but with more than ${data.overstockDays} days of stock at the forecast rate. The excess is what's above your ${data.targetDays}-day cover target: ${money(overValue)} at cost. Hold off reordering these.`}
                empty={!data.over.length}
                csv={() =>
                  download(
                    "overstock.csv",
                    reportCsv(
                      ["SKU", "Product", "Available", "Forecast per day", "Days of cover", "Excess units", "Excess value"],
                      data.over.map((r) => [r.sku, r.title, r.available, Math.round(r.forecastPerDay * 100) / 100, Number.isFinite(r.daysOfCover) ? Math.round(r.daysOfCover) : null, r.excessUnits, r.excessValue]),
                    ),
                  )
                }
              >
                {data.over.length ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                    headings={["Product", "Available", "Days of cover", "Excess units", "Excess value"]}
                    rows={data.over.slice(0, SHOWN).map((r) => [productLink(r), r.available, days(r.daysOfCover), r.excessUnits, money(r.excessValue)])}
                  />
                ) : (
                  <Box padding="400" paddingBlockStart="0">
                    <Text as="p">No product has more than {data.overstockDays} days of stock.</Text>
                  </Box>
                )}
              </ReportCard>
            )}
            {data.missingCost > 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                {data.missingCost} product{data.missingCost === 1 ? " in stock has" : "s in stock have"} no unit cost in Shopify, so stock values leave {data.missingCost === 1 ? "it" : "them"} out.
              </Text>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

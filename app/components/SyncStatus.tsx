import { useFetcher, useRevalidator } from "@remix-run/react";
import { Banner, BlockStack, Button, InlineStack, ProgressBar, Text } from "@shopify/polaris";
import { useEffect } from "react";

import type { SyncInfo } from "../lib/sync-info";

const STAGE_TEXT: Record<string, { label: string; progress: number }> = {
  starting: { label: "Starting the export from Shopify…", progress: 10 },
  waiting: { label: "Waiting for another Shopify export on your store to finish…", progress: 10 },
  variants: { label: "Exporting your products and stock levels from Shopify…", progress: 30 },
  "processing-variants": { label: "Reading your products and stock levels…", progress: 50 },
  orders: { label: "Exporting your recent orders from Shopify…", progress: 65 },
  "processing-orders": { label: "Reading your orders and building forecasts…", progress: 85 },
};

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/**
 * Shows sync progress (and re-checks every few seconds while a sync runs),
 * the last sync error, and when the data was last refreshed.
 */
export function SyncStatus({ info }: { info: SyncInfo }) {
  const revalidator = useRevalidator();
  const refresh = useFetcher<{ ok?: boolean }>();

  useEffect(() => {
    if (!info.syncing) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [info.syncing, revalidator]);

  useEffect(() => {
    if (refresh.state === "idle" && refresh.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh.state, refresh.data]);

  const refreshButton = (
    <refresh.Form method="post" action="/app/refresh">
      <Button submit size="slim" loading={refresh.state !== "idle"} disabled={info.syncing}>
        Refresh data
      </Button>
    </refresh.Form>
  );

  if (info.syncing && !info.hasData) {
    const stage = STAGE_TEXT[info.stage ?? "starting"] ?? STAGE_TEXT.starting;
    return (
      <Banner tone="info" title="Syncing your store for the first time">
        <BlockStack gap="200">
          <Text as="p">{stage.label}</Text>
          <ProgressBar progress={stage.progress} size="small" />
          <Text as="p" tone="subdued">
            Shopify prepares the export in the background. Small stores take under a minute; large catalogs can take a few. This page updates by itself.
          </Text>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <BlockStack gap="200">
      {info.error && (
        <Banner tone="warning" title="The last data refresh did not finish">
          <BlockStack gap="200">
            <Text as="p">{info.error}</Text>
            {info.hasData && <Text as="p" tone="subdued">Showing the previous data until a refresh succeeds.</Text>}
            <InlineStack>{refreshButton}</InlineStack>
          </BlockStack>
        </Banner>
      )}
      {!info.error && (
        <InlineStack gap="300" blockAlign="center" align="end">
          <Text as="span" tone="subdued">
            {info.syncing
              ? `Refreshing data in the background… ${info.fetchedAt ? `(showing data from ${timeAgo(info.fetchedAt)})` : ""}`
              : info.fetchedAt
                ? `Data from ${timeAgo(info.fetchedAt)}`
                : ""}
          </Text>
          {refreshButton}
        </InlineStack>
      )}
    </BlockStack>
  );
}

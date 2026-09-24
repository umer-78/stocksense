import { Banner, Card, Page, Text } from "@shopify/polaris";
import { MISSING_CREDENTIALS_HINT } from "../lib/env";

/**
 * Friendly fallback shown by every StockSense route when Shopify credentials
 * are not configured (instead of crashing at module load).
 */
export function MissingCredentials() {
  return (
    <Page title="StockSense">
      <Card>
        <Banner tone="warning" title="Shopify credentials are not configured">
          <Text as="p" variant="bodyMd">
            {MISSING_CREDENTIALS_HINT}
          </Text>
        </Banner>
      </Card>
    </Page>
  );
}
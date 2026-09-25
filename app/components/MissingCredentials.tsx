import { AppProvider, Banner, Card, Page, Text } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { MISSING_CREDENTIALS_HINT } from "../lib/env";

/**
 * Friendly fallback shown by every StockSense route when Shopify credentials
 * are not configured (instead of crashing at module load).
 *
 * Self-contained: wraps itself in Polaris' AppProvider because the routes that
 * render it (e.g. /app) skip their normal AppProvider wrapper in this state.
 */
export function MissingCredentials() {
  return (
    <AppProvider i18n={polarisTranslations}>
      <Page title="StockSense">
        <Card>
          <Banner tone="warning" title="Shopify credentials are not configured">
            <Text as="p" variant="bodyMd">
              {MISSING_CREDENTIALS_HINT}
            </Text>
          </Banner>
        </Card>
      </Page>
    </AppProvider>
  );
}
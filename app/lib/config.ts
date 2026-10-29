/**
 * App-wide configuration constants.
 *
 * Privacy policy and terms of service are static files served by this app at
 * `/privacy-policy.html` and `/terms.html`. Both URLs derive from the SINGLE
 * base URL environment variable `SHOPIFY_APP_URL` (the deployed app URL), so
 * after deployment the operator sets one env var and both URLs are correct.
 *
 * The same two URLs must also be entered in the Shopify Partner Dashboard
 * (App setup → App details → Privacy policy URL / Terms of service URL) as
 * `https://<SHOPIFY_APP_URL>/privacy-policy.html` and
 * `https://<SHOPIFY_APP_URL>/terms.html` — see DEPLOY.md step 2.
 */
const baseUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "");

export const PRIVACY_POLICY_URL = baseUrl
  ? `${baseUrl}/privacy-policy.html`
  : "/privacy-policy.html";

export const TERMS_OF_SERVICE_URL = baseUrl
  ? `${baseUrl}/terms.html`
  : "/terms.html";

/**
 * Public marketing site. Visitors who open the app URL directly (not from the
 * Shopify admin) are sent here: App Store requirement 2.3.1 forbids asking
 * merchants to type their myshopify.com domain, so the app shows no login form.
 */
export const MARKETING_SITE_URL =
  process.env.MARKETING_SITE_URL || "https://umer-78.github.io/stocksense/";

/** Contact email shown in the privacy policy / terms pages. */
export const CONTACT_EMAIL = "umerhashmi987@gmail.com";
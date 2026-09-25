import { redirect } from "@remix-run/node";

/**
 * Clean URL for the privacy policy. The static file lives at
 * /privacy-policy.html (served from public/); this route redirects the
 * extension-less path to it.
 */
export const loader = () => redirect("/privacy-policy.html");
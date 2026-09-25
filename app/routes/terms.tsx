import { redirect } from "@remix-run/node";

/**
 * Clean URL for the terms of service. The static file lives at /terms.html
 * (served from public/); this route redirects the extension-less path to it.
 */
export const loader = () => redirect("/terms.html");
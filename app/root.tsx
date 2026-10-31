import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * The last-resort error page. Shopify's boundary in app.tsx handles the
 * responses it needs (re-authentication); anything else lands here, and the
 * merchant sees what happened and what to do, not a stack trace.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (!isRouteErrorResponse(error)) console.error(error);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{notFound ? "Page not found" : "Something went wrong"} · Forelark</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, system-ui, sans-serif", margin: 0, padding: "48px 24px", color: "#303030", background: "#f1f1f1" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{notFound ? "This page does not exist" : "Forelark could not load this page"}</h1>
          <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
            {notFound
              ? "The link may be out of date. Open Forelark from your Shopify admin to start again."
              : "Your store data has not been changed. Reload the page; if it keeps happening, refresh the store data from the dashboard or contact support with the time this happened."}
          </p>
          <a href="/app" style={{ color: "#005bd3" }}>Back to the dashboard</a>
        </main>
        <Scripts />
      </body>
    </html>
  );
}

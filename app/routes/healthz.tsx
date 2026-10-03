import { json, type LoaderFunctionArgs } from "@remix-run/node";

import prisma from "../db.server";

/**
 * Health check endpoint for hosting platforms (Render healthCheckPath,
 * uptime pings). Unauthenticated. The default response is dependency free —
 * it must answer even when Shopify credentials are not configured.
 *
 * `?db=1` also runs `SELECT 1` against Postgres (used by the keep-alive
 * workflow so the free-tier database never idles out). Returns 503 if the
 * database is unreachable.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const checkDb = new URL(request.url).searchParams.get("db") === "1";
  if (!checkDb) return json({ ok: true, service: "stocksense" });

  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, service: "stocksense", db: "ok" });
  } catch {
    return json({ ok: false, service: "stocksense", db: "error" }, { status: 503 });
  }
};

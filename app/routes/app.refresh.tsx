import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { authenticateAdmin } from "../lib/auth";
import { getForecastContext, isAuthed } from "../lib/context.server";

/** POST: start a fresh inventory/sales sync now (the "Refresh data" button). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ ok: false }, { status: 401 });
  }
  await getForecastContext(auth, { force: true });
  return json({ ok: true });
};

export const loader = () => redirect("/app");

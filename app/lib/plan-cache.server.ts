/**
 * The shop's current plan, remembered whenever the merchant opens the app.
 * Webhooks and the AI-assistant endpoint have no billing context of their own,
 * so they read the remembered plan.
 */
import db from "../db.server";
import type { PlanId } from "./billing/plans";

export async function rememberPlan(shop: string, plan: PlanId): Promise<void> {
  try {
    const row = await db.shopPlan.findUnique({ where: { shop } });
    if (row?.plan === plan) {
      return;
    }
    await db.shopPlan.upsert({ where: { shop }, create: { shop, plan }, update: { plan } });
  } catch (error) {
    console.error("[forelark] could not remember plan", error);
  }
}

export async function cachedPlan(shop: string): Promise<PlanId> {
  const row = await db.shopPlan.findUnique({ where: { shop } });
  return row?.plan === "growth" || row?.plan === "pro" ? row.plan : "free";
}

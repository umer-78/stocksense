/**
 * Shared loader plumbing for the forecasting pages: plan, settings, the
 * effective sales lookback and the shop's inventory snapshot.
 */
import type { AdminAuthResult } from "./auth";
import { PAID_PLAN_NAMES, planFromSubscription, type PlanId } from "./billing/plans";
import type { ForecastSettings } from "./settings";
import { getShopSettings } from "./settings.server";
import { effectiveLookbackDays, loadSnapshot, type SnapshotState } from "./shopify/snapshot.server";
import type { SyncInfo } from "./sync-info";

export type AuthedContext = AdminAuthResult & {
  admin: NonNullable<AdminAuthResult["admin"]>;
  session: NonNullable<AdminAuthResult["session"]>;
  billing: NonNullable<AdminAuthResult["billing"]>;
};

export function isAuthed(auth: AdminAuthResult): auth is AuthedContext {
  return !auth.missingCredentials && Boolean(auth.admin && auth.session && auth.billing);
}

export async function currentPlan(auth: AuthedContext): Promise<PlanId> {
  const check = await auth.billing.check({ plans: [...PAID_PLAN_NAMES] });
  const subscription = check.appSubscriptions[0];
  return planFromSubscription(subscription?.name, subscription?.status);
}

export interface ForecastContext {
  shop: string;
  plan: PlanId;
  /** Shop settings with `lookbackDays` set to what the data actually covers. */
  settings: ForecastSettings;
  /** Lookback the merchant asked for (may exceed what Shopify allows). */
  requestedLookbackDays: number;
  /** True when the requested lookback was cut to 60 days by order access. */
  lookbackCapped: boolean;
  sync: SnapshotState;
}

export async function getForecastContext(auth: AuthedContext, options: { force?: boolean } = {}): Promise<ForecastContext> {
  const shop = auth.session.shop;
  const [plan, settings] = await Promise.all([currentPlan(auth), getShopSettings(shop)]);
  const lookbackDays = effectiveLookbackDays(settings.lookbackDays, auth.session.scope);
  const sync = await loadSnapshot(auth.admin, shop, { lookbackDays, force: options.force });
  return {
    shop,
    plan,
    settings: { ...settings, lookbackDays: sync.snapshot?.lookbackDays ?? lookbackDays },
    requestedLookbackDays: settings.lookbackDays,
    lookbackCapped: lookbackDays < settings.lookbackDays,
    sync,
  };
}

export function syncInfo(sync: SnapshotState): SyncInfo {
  return {
    syncing: sync.syncing,
    stage: sync.stage,
    error: sync.error,
    fetchedAt: sync.snapshot?.fetchedAt ?? null,
    hasData: sync.snapshot !== null,
  };
}

/**
 * StockSense billing plans and server-side limit enforcement.
 *
 * Plan names here MUST match the `billing` config keys in
 * `app/shopify.server.ts` (that is what `billing.check()` returns as
 * `appSubscriptions[].name`).
 *
 *   Free   — no subscription, up to 100 SKUs, basic forecast (no seasonality)
 *   Growth — $19/mo, up to 2,000 SKUs, full forecasts + PO builder
 *   Pro    — $49/mo, unlimited SKUs, all features
 *
 * All functions are pure so the enforcement logic is unit-testable.
 */

export type PlanId = "free" | "growth" | "pro";

export type PlanFeature = "seasonality" | "poBuilder" | "stockyImport";

export interface PlanDefinition {
  id: PlanId;
  /** Display name. Also the billing subscription name for paid plans. */
  name: string;
  priceMonthly: number | null;
  /** Max tracked SKUs; null = unlimited. */
  skuLimit: number | null;
  features: Record<PlanFeature, boolean>;
  trialDays: number;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: null,
    skuLimit: 100,
    features: { seasonality: false, poBuilder: false, stockyImport: true },
    trialDays: 0,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMonthly: 19,
    skuLimit: 2000,
    features: { seasonality: true, poBuilder: true, stockyImport: true },
    trialDays: 14,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 49,
    skuLimit: null,
    features: { seasonality: true, poBuilder: true, stockyImport: true },
    trialDays: 14,
  },
};

/** Paid plan names accepted by `billing.check({ plans })`. */
export const PAID_PLAN_NAMES = ["Growth", "Pro"] as const;

/**
 * Map an active subscription name to a plan. Anything unrecognized (or no
 * subscription at all) resolves to the Free plan.
 */
export function planFromSubscription(
  subscriptionName: string | null | undefined,
): PlanId {
  if (subscriptionName === "Growth") {
    return "growth";
  }
  if (subscriptionName === "Pro") {
    return "pro";
  }
  return "free";
}

export interface PlanLimitResult {
  plan: PlanId;
  skuCount: number;
  /** SKU cap for the plan; null when unlimited. */
  limit: number | null;
  overLimit: boolean;
  /** How many SKUs the plan may actually see (min(skuCount, limit)). */
  allowedCount: number;
}

/** Enforce the SKU cap for a plan. Never throws. */
export function enforcePlanLimit(plan: PlanId, skuCount: number): PlanLimitResult {
  const count = Math.max(0, Math.floor(skuCount));
  const limit = PLANS[plan].skuLimit;
  if (limit === null) {
    return { plan, skuCount: count, limit: null, overLimit: false, allowedCount: count };
  }
  return {
    plan,
    skuCount: count,
    limit,
    overLimit: count > limit,
    allowedCount: Math.min(count, limit),
  };
}

export function canUseFeature(plan: PlanId, feature: PlanFeature): boolean {
  return PLANS[plan].features[feature];
}
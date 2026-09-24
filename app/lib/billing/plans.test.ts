import { describe, expect, it } from "vitest";
import {
  PLANS,
  canUseFeature,
  enforcePlanLimit,
  planFromSubscription,
} from "./plans";

describe("planFromSubscription", () => {
  it("maps paid subscription names to plans", () => {
    expect(planFromSubscription("Growth")).toBe("growth");
    expect(planFromSubscription("Pro")).toBe("pro");
  });

  it("falls back to free for no subscription or unknown names", () => {
    expect(planFromSubscription(null)).toBe("free");
    expect(planFromSubscription(undefined)).toBe("free");
    expect(planFromSubscription("Enterprise")).toBe("free");
  });
});

describe("enforcePlanLimit", () => {
  it("free plan caps at 100 SKUs", () => {
    const result = enforcePlanLimit("free", 150);
    expect(result.overLimit).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.allowedCount).toBe(100);
    expect(result.skuCount).toBe(150);
  });

  it("free plan allows exactly 100 SKUs", () => {
    const result = enforcePlanLimit("free", 100);
    expect(result.overLimit).toBe(false);
    expect(result.allowedCount).toBe(100);
  });

  it("growth plan caps at 2,000 SKUs", () => {
    expect(enforcePlanLimit("growth", 2000).overLimit).toBe(false);
    expect(enforcePlanLimit("growth", 2001).overLimit).toBe(true);
    expect(enforcePlanLimit("growth", 2001).allowedCount).toBe(2000);
  });

  it("pro plan is unlimited", () => {
    const result = enforcePlanLimit("pro", 50000);
    expect(result.overLimit).toBe(false);
    expect(result.limit).toBeNull();
    expect(result.allowedCount).toBe(50000);
  });

  it("clamps negative SKU counts to zero", () => {
    const result = enforcePlanLimit("free", -5);
    expect(result.skuCount).toBe(0);
    expect(result.overLimit).toBe(false);
  });
});

describe("canUseFeature", () => {
  it("gates the PO builder to paid plans", () => {
    expect(canUseFeature("free", "poBuilder")).toBe(false);
    expect(canUseFeature("growth", "poBuilder")).toBe(true);
    expect(canUseFeature("pro", "poBuilder")).toBe(true);
  });

  it("gates seasonality to paid plans", () => {
    expect(canUseFeature("free", "seasonality")).toBe(false);
    expect(canUseFeature("growth", "seasonality")).toBe(true);
    expect(canUseFeature("pro", "seasonality")).toBe(true);
  });

  it("keeps Stocky import available on all plans", () => {
    expect(canUseFeature("free", "stockyImport")).toBe(true);
    expect(canUseFeature("pro", "stockyImport")).toBe(true);
  });
});

describe("PLANS", () => {
  it("defines the three plans with the expected pricing", () => {
    expect(PLANS.free.priceMonthly).toBeNull();
    expect(PLANS.growth.priceMonthly).toBe(19);
    expect(PLANS.pro.priceMonthly).toBe(49);
    expect(PLANS.growth.trialDays).toBe(14);
    expect(PLANS.pro.trialDays).toBe(14);
  });
});
import { describe, expect, it } from "vitest";
import { suggestReorderQty } from "./reorder";

describe("suggestReorderQty", () => {
  it("computes reorder point and order quantity", () => {
    const result = suggestReorderQty({
      velocity: 8.2,
      leadTimeDays: 14,
      onHand: 25,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    expect(result.leadTimeDemand).toBeCloseTo(114.8, 1);
    expect(result.safetyStock).toBe(23); // ceil(114.8 × 0.2)
    expect(result.reorderPoint).toBe(138); // ceil(114.8 + 23)
    expect(result.targetLevel).toBe(269); // ceil(8.2 × 30 + 23)
    expect(result.suggestedOrderQty).toBe(244); // 269 − 25
  });

  it("defaults safetyStockPct to 20% and targetDays to 30", () => {
    const result = suggestReorderQty({ velocity: 10, leadTimeDays: 7, onHand: 50 });

    expect(result.safetyStockPct).toBe(0.2);
    expect(result.targetDays).toBe(30);
    expect(result.leadTimeDemand).toBe(70);
    expect(result.safetyStock).toBe(14);
    expect(result.reorderPoint).toBe(84);
    expect(result.targetLevel).toBe(314);
    expect(result.suggestedOrderQty).toBe(264);
  });

  it("returns zero order quantity when on-hand exceeds the target", () => {
    const result = suggestReorderQty({
      velocity: 1,
      leadTimeDays: 7,
      onHand: 500,
      safetyStockPct: 0,
      targetDays: 30,
    });

    expect(result.suggestedOrderQty).toBe(0);
  });

  it("orders the full target level when on-hand is zero", () => {
    const result = suggestReorderQty({
      velocity: 10,
      leadTimeDays: 7,
      onHand: 0,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    expect(result.suggestedOrderQty).toBe(result.targetLevel);
    expect(result.suggestedOrderQty).toBe(314);
  });

  it("clamps negative lead time and on-hand", () => {
    const result = suggestReorderQty({
      velocity: 10,
      leadTimeDays: -5,
      onHand: -20,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    expect(result.leadTimeDays).toBe(0);
    expect(result.onHand).toBe(0);
    expect(result.leadTimeDemand).toBe(0);
    expect(result.safetyStock).toBe(0);
    expect(result.reorderPoint).toBe(0);
    expect(result.targetLevel).toBe(300);
    expect(result.suggestedOrderQty).toBe(300);
  });

  it("handles zero velocity", () => {
    const result = suggestReorderQty({
      velocity: 0,
      leadTimeDays: 14,
      onHand: 10,
      safetyStockPct: 0.2,
      targetDays: 30,
    });

    expect(result.leadTimeDemand).toBe(0);
    expect(result.safetyStock).toBe(0);
    expect(result.reorderPoint).toBe(0);
    expect(result.suggestedOrderQty).toBe(0);
  });

  it("clamps safetyStockPct to the 0–100% range", () => {
    const result = suggestReorderQty({
      velocity: 10,
      leadTimeDays: 10,
      onHand: 0,
      safetyStockPct: 5,
      targetDays: 30,
    });

    expect(result.safetyStockPct).toBe(1);
    expect(result.safetyStock).toBe(100); // ceil(100 × 1)
  });
});
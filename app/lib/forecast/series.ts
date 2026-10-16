/**
 * Daily time-series helpers for the forecasting models.
 *
 * Sales arrive as sparse dated records; the models need a dense series with
 * one value per calendar day (0 on days with no sales). Dates are handled in
 * UTC so the series never shifts with the server's time zone.
 */
import { toFiniteNumber } from "./sanitize";
import type { SalesRecord } from "./types";

export const DAY_MS = 86_400_000;

/** Parse a record date to the start of its UTC day (ms), or null when invalid. */
export function utcDay(value: string | Date): number | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build a dense daily series covering [startDay, endDay] inclusive.
 * Records outside the range are ignored; duplicate dates are summed; invalid
 * dates are skipped; negative or NaN quantities count as 0.
 */
export function toDailySeries(history: SalesRecord[], startDay: number, endDay: number): number[] {
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay < startDay) {
    return [];
  }
  const length = Math.round((endDay - startDay) / DAY_MS) + 1;
  const series = new Array<number>(length).fill(0);
  for (const record of Array.isArray(history) ? history : []) {
    const day = utcDay(record.date);
    if (day === null || day < startDay || day > endDay) {
      continue;
    }
    series[Math.round((day - startDay) / DAY_MS)] += Math.max(0, toFiniteNumber(record.quantity, 0));
  }
  return series;
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}

export function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

import { toFiniteNumber } from "./sanitize";
import type { SalesRecord, VelocityResult } from "./types";

const DAY_MS = 86_400_000;

function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Compute units-per-day velocity from dated sales records.
 *
 * - Zero-sales days and gaps are handled naturally: velocity is total units
 *   divided by the number of *calendar* days covered, so a day with no record
 *   still counts as a zero-sales day.
 * - Duplicate dates are aggregated (summed).
 * - Invalid dates are skipped; negative/NaN quantities are clamped to 0.
 * - Empty history returns a velocity of 0 (never NaN).
 * - `lookbackDays` restricts the window to the most recent N calendar days.
 * - `window.end` (normally today) anchors the window to a real date instead of
 *   the last sale. Without it, a product that sold 5 units once, 50 days ago,
 *   would look like it sells 5 a day. `window.start` (normally the product's
 *   creation date) stops a new product's velocity being diluted by days
 *   before it existed.
 */
export interface VelocityWindow {
  /** Last day of the window, ISO date. */
  end?: string;
  /** Earliest day the item could have sold, ISO date. */
  start?: string;
}

export function computeVelocity(
  salesHistory: SalesRecord[],
  lookbackDays?: number,
  window: VelocityWindow = {},
): VelocityResult {
  const history = Array.isArray(salesHistory) ? salesHistory : [];

  const entries: Array<{ day: number; quantity: number }> = [];
  for (const record of history) {
    const date = parseDate(record.date);
    if (!date) {
      continue;
    }
    const quantity = Math.max(0, toFiniteNumber(record.quantity, 0));
    entries.push({ day: startOfUtcDay(date).getTime(), quantity });
  }

  const windowEnd = window.end ? parseDate(window.end) : null;
  if (windowEnd) {
    return anchoredVelocity(entries, startOfUtcDay(windowEnd).getTime(), lookbackDays, window.start);
  }

  if (entries.length === 0) {
    return {
      velocity: 0,
      totalUnits: 0,
      daysCovered: 0,
      activeDays: 0,
      sampleSize: 0,
      firstDate: "",
      lastDate: "",
    };
  }

  // Aggregate quantities per calendar day so duplicate dates don't double-count.
  const byDay = new Map<number, number>();
  for (const entry of entries) {
    byDay.set(entry.day, (byDay.get(entry.day) ?? 0) + entry.quantity);
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const lastDay = days[days.length - 1];

  // Optional lookback window: only the most recent `lookbackDays` calendar days.
  const windowStart =
    typeof lookbackDays === "number" &&
    Number.isFinite(lookbackDays) &&
    lookbackDays > 0
      ? lastDay - (Math.floor(lookbackDays) - 1) * DAY_MS
      : days[0];

  const inWindow = days.filter((day) => day >= windowStart);
  const firstDay = inWindow[0];

  const daysCovered = Math.round((lastDay - firstDay) / DAY_MS) + 1;
  const totalUnits = inWindow.reduce((sum, day) => sum + (byDay.get(day) ?? 0), 0);
  const activeDays = inWindow.filter((day) => (byDay.get(day) ?? 0) > 0).length;

  return {
    velocity: totalUnits / daysCovered,
    totalUnits,
    daysCovered,
    activeDays,
    sampleSize: inWindow.length,
    firstDate: toIsoDate(new Date(firstDay)),
    lastDate: toIsoDate(new Date(lastDay)),
  };
}
function validLookback(lookbackDays: number | undefined): number | null {
  return typeof lookbackDays === "number" && Number.isFinite(lookbackDays) && lookbackDays > 0
    ? Math.floor(lookbackDays)
    : null;
}

/** Velocity over a window that ends on a fixed date (today), zero-sales days included. */
function anchoredVelocity(
  entries: Array<{ day: number; quantity: number }>,
  endDay: number,
  lookbackDays: number | undefined,
  availableSince: string | undefined,
): VelocityResult {
  const lookback = validLookback(lookbackDays);
  let startDay = lookback
    ? endDay - (lookback - 1) * DAY_MS
    : Math.min(endDay, ...entries.map((e) => e.day));
  const since = availableSince ? parseDate(availableSince) : null;
  if (since) {
    startDay = Math.min(endDay, Math.max(startDay, startOfUtcDay(since).getTime()));
  }

  const byDay = new Map<number, number>();
  for (const entry of entries) {
    if (entry.day >= startDay && entry.day <= endDay) {
      byDay.set(entry.day, (byDay.get(entry.day) ?? 0) + entry.quantity);
    }
  }
  const daysCovered = Math.round((endDay - startDay) / DAY_MS) + 1;
  const totalUnits = [...byDay.values()].reduce((sum, q) => sum + q, 0);

  return {
    velocity: daysCovered > 0 ? totalUnits / daysCovered : 0,
    totalUnits,
    daysCovered,
    activeDays: [...byDay.values()].filter((q) => q > 0).length,
    sampleSize: byDay.size,
    firstDate: toIsoDate(new Date(startDay)),
    lastDate: toIsoDate(new Date(endDay)),
  };
}

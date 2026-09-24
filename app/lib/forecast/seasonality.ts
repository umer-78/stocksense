import { toFiniteNumber } from "./sanitize";
import type { SalesRecord, SeasonalIndex } from "./types";

function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Detect a weekly sales pattern using simple index math — no black-box ML.
 *
 * For each day of the week we compute the average units sold, then express it
 * as a multiplier relative to the overall average (1.0 = an average day).
 * `weekdayUplift` is the ratio of average weekday (Mon–Fri) sales to average
 * weekend (Sat–Sun) sales.
 *
 * The pattern is only marked `reliable` when there are at least 14 records
 * covering every day of the week. With insufficient data the multipliers are
 * all 1.0 (neutral) so callers never have to special-case missing data.
 */
export function applySeasonality(velocity: number, history: SalesRecord[]): SeasonalIndex {
  const v = Math.max(0, toFiniteNumber(velocity, 0));
  const records = Array.isArray(history) ? history : [];

  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  let sampleSize = 0;

  for (const record of records) {
    const date = parseDate(record.date);
    if (!date) {
      continue;
    }
    const quantity = Math.max(0, toFiniteNumber(record.quantity, 0));
    const dow = date.getUTCDay();
    sums[dow] += quantity;
    counts[dow] += 1;
    sampleSize += 1;
  }

  const dayOfWeekAverages = sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));
  const observedAverages = dayOfWeekAverages.filter((avg) => avg > 0);
  const overallAverage =
    observedAverages.length > 0
      ? observedAverages.reduce((a, b) => a + b, 0) / observedAverages.length
      : 0;

  const dayOfWeekMultipliers = dayOfWeekAverages.map((avg) =>
    overallAverage > 0 ? avg / overallAverage : 1,
  );

  let peakDay = 0;
  let troughDay = 0;
  for (let i = 1; i < 7; i += 1) {
    if (dayOfWeekMultipliers[i] > dayOfWeekMultipliers[peakDay]) {
      peakDay = i;
    }
    if (dayOfWeekMultipliers[i] < dayOfWeekMultipliers[troughDay]) {
      troughDay = i;
    }
  }

  const weekdayCount = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
  const weekendCount = counts[0] + counts[6];
  const weekdayAverage =
    weekdayCount > 0 ? (sums[1] + sums[2] + sums[3] + sums[4] + sums[5]) / weekdayCount : 0;
  const weekendAverage = weekendCount > 0 ? (sums[0] + sums[6]) / weekendCount : 0;
  const weekdayUplift = weekendAverage > 0 ? weekdayAverage / weekendAverage : 1;

  const expectedDailySales = dayOfWeekMultipliers.map((multiplier) => v * multiplier);

  const reliable = sampleSize >= 14 && counts.every((count) => count > 0);

  return {
    dayOfWeekMultipliers,
    dayOfWeekAverages,
    peakDay,
    troughDay,
    weekdayUplift,
    weekdayAverage,
    weekendAverage,
    expectedDailySales,
    reliable,
    sampleSize,
  };
}
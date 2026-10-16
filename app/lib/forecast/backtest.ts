/**
 * Model selection by rolling-origin back-testing.
 *
 * For each candidate model we pretend it is a few weeks ago: fit the model on
 * the history up to that point, forecast the following week, and compare the
 * forecast with what actually sold. Repeating this for the last few
 * weeks gives an honest, out-of-sample error for every model; the one with
 * the smallest error wins and is refitted on the full history.
 *
 * Models are ranked by root-mean-square error of their daily forecasts. Squared
 * error is minimized by the true average, so unlike absolute error it does not
 * reward predicting zero for items that sell on few days; and daily (not
 * weekly) error is what reveals a weekday/weekend pattern. The error of weekly
 * totals is reported alongside, as the accuracy figure merchants see.
 */
import { MODELS, type FittedModel, type ModelId, type ModelSpec } from "./models";
import { mean, sum } from "./series";

export interface ModelScore {
  id: ModelId;
  label: string;
  /** Root-mean-square error of daily forecasts, in units/day. Lower is better. */
  rmse: number;
  /** Error of horizon totals: Σ|forecast − actual| ÷ Σ actual over all folds; null when nothing sold. */
  errorPct: number | null;
}

export interface ModelSelection {
  spec: ModelSpec;
  model: FittedModel;
  /** False when the history was too short to back-test (the average is used). */
  tested: boolean;
  folds: number;
  horizon: number;
  scores: ModelScore[];
  /** Error of the chosen model (see ModelScore.errorPct). */
  errorPct: number | null;
  /** Error of the simple average, for comparison. */
  baselineErrorPct: number | null;
  /** How much lower the chosen model's daily error is than the average's (0.4 = 40% lower); null when untested. */
  improvementPct: number | null;
  /** Standard deviation of daily forecast errors, used for statistical safety stock. */
  residualStd: number;
  /** True when the item sells on few enough days to count as intermittent. */
  intermittent: boolean;
}

export interface SelectOptions {
  /** Include the weekly-season model (paid plans). */
  allowSeasonal?: boolean;
  /** Days forecast in each back-test fold. Default 7. */
  horizon?: number;
  /** Maximum number of back-test folds. Default 4. */
  maxFolds?: number;
}

/** Shortest training history a back-test fold may use. */
export const MIN_TRAIN_DAYS = 21;
/**
 * Average days between sales above which demand counts as intermittent
 * (Syntetos-Boylan ADI cut-off).
 */
const INTERMITTENT_ADI = 1.32;
/** A more complex model must beat a simpler one by this margin to be chosen. */
const SIMPLICITY_MARGIN = 0.05;

function std(errors: number[]): number {
  if (errors.length === 0) {
    return 0;
  }
  return Math.sqrt(mean(errors.map((e) => e * e)));
}

export function isIntermittent(series: number[]): boolean {
  const demandDays = series.filter((x) => x > 0).length;
  return demandDays > 0 && series.length / demandDays > INTERMITTENT_ADI;
}

/**
 * Models worth testing for a series. Items that sell on few days only get the
 * averages and Croston: with sparse sales, trend and weekly-pattern models
 * mostly fit noise (confirmed on simulated catalogs).
 */
export function candidateModels(series: number[], allowSeasonal: boolean): ModelSpec[] {
  const ids: ModelId[] = isIntermittent(series)
    ? ["average", "recent", "croston"]
    : ["average", "recent", "ses", "holt", ...(allowSeasonal ? (["seasonal"] as ModelId[]) : [])];
  return ids.map((id) => MODELS[id]).sort((a, b) => a.complexity - b.complexity);
}

export function selectModel(series: number[], options: SelectOptions = {}): ModelSelection {
  const horizon = Math.max(1, Math.floor(options.horizon ?? 7));
  const maxFolds = Math.max(0, Math.floor(options.maxFolds ?? 4));
  const n = series.length;
  const intermittent = isIntermittent(series);

  const offsets: number[] = [];
  for (let k = 1; k <= maxFolds; k += 1) {
    if (n - k * horizon >= MIN_TRAIN_DAYS) {
      offsets.push(k * horizon);
    }
  }

  const average = MODELS.average;
  const averageFit = average.fit(series) ?? { id: "average" as const, params: {}, forecast: () => [], residuals: [] };

  if (offsets.length === 0) {
    return {
      spec: average,
      model: averageFit,
      tested: false,
      folds: 0,
      horizon,
      scores: [],
      errorPct: null,
      baselineErrorPct: null,
      improvementPct: null,
      residualStd: std(averageFit.residuals),
      intermittent,
    };
  }

  const results: Array<ModelScore & { spec: ModelSpec; dailyErrors: number[] }> = [];
  for (const spec of candidateModels(series, options.allowSeasonal === true)) {
    const totalErrors: number[] = [];
    const dailyErrors: number[] = [];
    let actualTotal = 0;
    let failed = false;
    for (const offset of offsets) {
      const train = series.slice(0, n - offset);
      const test = series.slice(n - offset, n - offset + horizon);
      const fitted = train.length >= spec.minLength ? spec.fit(train) : null;
      if (!fitted) {
        failed = true;
        break;
      }
      const forecast = fitted.forecast(test.length);
      totalErrors.push(Math.abs(sum(forecast) - sum(test)));
      actualTotal += sum(test);
      test.forEach((actual, i) => dailyErrors.push(actual - forecast[i]));
    }
    if (failed) {
      continue;
    }
    results.push({
      id: spec.id,
      label: spec.label,
      spec,
      rmse: std(dailyErrors),
      errorPct: actualTotal > 0 ? sum(totalErrors) / actualTotal : null,
      dailyErrors,
    });
  }

  let best = results[0];
  for (const result of results.slice(1)) {
    if (result.rmse < best.rmse * (1 - SIMPLICITY_MARGIN)) {
      best = result;
    }
  }

  const refit = best.spec.fit(series);
  const chosen = refit ? best : results[0];
  const model = refit ?? averageFit;
  const baseline = results.find((r) => r.id === "average");

  return {
    spec: chosen.spec,
    model,
    tested: true,
    folds: offsets.length,
    horizon,
    scores: results.map(({ id, label, rmse, errorPct }) => ({ id, label, rmse, errorPct })),
    errorPct: chosen.errorPct,
    baselineErrorPct: baseline?.errorPct ?? null,
    improvementPct: baseline && baseline.rmse > 0 ? 1 - chosen.rmse / baseline.rmse : null,
    residualStd: std(chosen.dailyErrors),
    intermittent,
  };
}

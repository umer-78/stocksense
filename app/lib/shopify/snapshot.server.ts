/**
 * Inventory + sales snapshot sync, driven by Shopify bulk operations.
 *
 * A sync is two exports in sequence (Shopify runs one bulk query per shop at
 * a time): the catalog with stock at every location, then the orders in the
 * sales window. Progress lives in the `ShopSnapshot` row so it survives
 * restarts and works with several app instances; every page load calls
 * `loadSnapshot`, which advances the sync one step if an export has finished.
 *
 * The last complete snapshot stays readable while a refresh runs, so the
 * dashboard only waits on the very first sync. Snapshots refresh after
 * `STALE_AFTER_MS`, when the lookback setting changes, or on request.
 *
 * Concurrency: each transition is claimed with a conditional `updateMany`, so
 * two simultaneous page loads never start or process the same export twice.
 */
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import db from "../../db.server";
import {
  BulkOperationBusyError,
  getBulkOperation,
  jsonlObjects,
  ordersBulkQuery,
  parseOrdersJsonl,
  parseVariantsJsonl,
  startBulkQuery,
  VARIANTS_BULK_QUERY,
  type GraphqlClient,
} from "./bulk";
import { fetchLocations, isDevelopmentStore } from "./client";
import type { CatalogVariant, LocationInfo, StoredSnapshot } from "./types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const DAY_MS = 86_400_000;
/**
 * Bump when the meaning of stored data changes (2: gift cards skipped, 3PL
 * locations listed, sales dated by processedAt; 3: test orders counted on
 * development stores). Older snapshots re-sync on the next load instead of
 * waiting out STALE_AFTER_MS.
 */
export const SNAPSHOT_VERSION = 4;
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** A running sync with no progress for this long is restarted. */
export const STUCK_AFTER_MS = 20 * 60 * 1000;
/** After a failed sync, wait this long before retrying on its own. */
export const ERROR_RETRY_MS = 10 * 60 * 1000;
/** Without the read_all_orders scope, Shopify only returns the last 60 days of orders. */
export const DEFAULT_ORDER_ACCESS_DAYS = 60;

export type SyncStage = "starting" | "waiting" | "variants" | "orders" | "processing-variants" | "processing-orders";

export interface SnapshotState {
  /** Last complete snapshot, or null before the first sync finishes. */
  snapshot: StoredSnapshot | null;
  syncing: boolean;
  stage: SyncStage | null;
  /** Message from the last failed sync. */
  error: string | null;
}

export interface LoadOptions {
  /** Requested sales lookback (already capped by `effectiveLookbackDays`). */
  lookbackDays: number;
  /** Start a refresh even if the snapshot is fresh. */
  force?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}

/** Lookback the app can actually honor with the shop's granted scopes. */
export function effectiveLookbackDays(requested: number, scope: string | null | undefined): number {
  const days = Math.max(7, Math.min(365, Math.round(Number(requested) || DEFAULT_ORDER_ACCESS_DAYS)));
  const scopes = (scope ?? "").split(",").map((s) => s.trim());
  return scopes.includes("read_all_orders") ? days : Math.min(days, DEFAULT_ORDER_ACCESS_DAYS);
}

/** Sales window for a sync started at `startedAt`: the `lookbackDays` full days before that day. */
export function salesWindow(startedAt: Date, lookbackDays: number): { start: string; end: string } {
  const today = Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate());
  const end = today - DAY_MS;
  const start = end - (Math.max(1, lookbackDays) - 1) * DAY_MS;
  return { start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) };
}

async function encode(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await gzipAsync(Buffer.from(JSON.stringify(value), "utf8")));
}

async function decode<T>(bytes: Uint8Array): Promise<T> {
  const raw = await gunzipAsync(Buffer.from(bytes));
  return JSON.parse(raw.toString("utf8")) as T;
}

const decoded = new Map<string, { completedAt: number; snapshot: StoredSnapshot }>();

async function readSnapshot(shop: string, row: { data: Uint8Array | null; completedAt: Date | null }) {
  if (!row.data) {
    return null;
  }
  const completedAt = row.completedAt?.getTime() ?? 0;
  const cached = decoded.get(shop);
  if (cached && cached.completedAt === completedAt) {
    return cached.snapshot;
  }
  const snapshot = await decode<StoredSnapshot>(row.data);
  decoded.set(shop, { completedAt, snapshot });
  return snapshot;
}

/** Test helper. */
/**
 * The last complete snapshot, read from the database only (no Shopify calls).
 * For webhooks and the AI-assistant endpoint, which have no admin session.
 */
export async function getStoredSnapshot(shop: string): Promise<StoredSnapshot | null> {
  const row = await db.shopSnapshot.findUnique({ where: { shop }, select: { data: true, completedAt: true } });
  return row ? readSnapshot(shop, row) : null;
}

export function clearSnapshotCache(): void {
  decoded.clear();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fail(shop: string, error: string) {
  await db.shopSnapshot.update({
    where: { shop },
    data: { status: "error", stage: null, bulkOperationId: null, pendingVariants: null, error },
  });
}

/** Claim the right to start a sync. False when another request already holds it. */
async function claimStart(shop: string, lookbackDays: number, now: Date): Promise<boolean> {
  await db.shopSnapshot.upsert({ where: { shop }, create: { shop, lookbackDays }, update: {} });
  const result = await db.shopSnapshot.updateMany({
    where: {
      shop,
      OR: [{ status: { not: "running" } }, { updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }],
    },
    data: {
      status: "running",
      stage: "starting",
      bulkOperationId: null,
      pendingVariants: null,
      error: null,
      startedAt: now,
      lookbackDays,
    },
  });
  return result.count === 1;
}

async function launchVariantsExport(client: GraphqlClient, shop: string) {
  try {
    const id = await startBulkQuery(client, VARIANTS_BULK_QUERY);
    await db.shopSnapshot.update({ where: { shop }, data: { stage: "variants", bulkOperationId: id } });
  } catch (error) {
    if (error instanceof BulkOperationBusyError) {
      // Another app process (or a merchant's other tool) holds the shop's bulk
      // slot; try again on a later load.
      await db.shopSnapshot.update({ where: { shop }, data: { stage: "waiting" } });
      return;
    }
    await fail(shop, message(error));
  }
}

async function advance(
  client: GraphqlClient,
  row: {
    shop: string;
    stage: string | null;
    bulkOperationId: string | null;
    pendingVariants: Uint8Array | null;
    startedAt: Date | null;
    lookbackDays: number;
  },
  options: LoadOptions,
) {
  const { shop, stage, bulkOperationId } = row;
  if (!bulkOperationId || (stage !== "variants" && stage !== "orders")) {
    return;
  }
  const operation = await getBulkOperation(client, bulkOperationId);
  if (!operation) {
    await fail(shop, "Shopify could not find the data export. It will be retried.");
    return;
  }
  if (operation.status === "CREATED" || operation.status === "RUNNING" || operation.status === "CANCELING") {
    // Heartbeat, so a long export is not mistaken for a stuck one.
    await db.shopSnapshot.updateMany({ where: { shop, bulkOperationId }, data: { stage } });
    return;
  }
  if (operation.status !== "COMPLETED") {
    await fail(
      shop,
      `Shopify's data export ${operation.status.toLowerCase()}${operation.errorCode ? ` (${operation.errorCode})` : ""}. It will be retried.`,
    );
    return;
  }

  const claimed = await db.shopSnapshot.updateMany({
    where: { shop, bulkOperationId, stage },
    data: { stage: `processing-${stage}` },
  });
  if (claimed.count !== 1) {
    return;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const window = salesWindow(row.startedAt ?? options.now ?? new Date(), row.lookbackDays);
  try {
    if (stage === "variants") {
      const variants = operation.url ? await parseVariantsJsonl(jsonlObjects(operation.url, fetchImpl)) : [];
      const pendingVariants = await encode(variants);
      const ordersId = await startBulkQuery(client, ordersBulkQuery(window.start));
      await db.shopSnapshot.update({
        where: { shop },
        data: { stage: "orders", bulkOperationId: ordersId, pendingVariants },
      });
      return;
    }

    // Development stores (including app reviewers') only have test orders.
    const includeTest = await isDevelopmentStore(client).catch(() => false);
    const sales = operation.url
      ? await parseOrdersJsonl(jsonlObjects(operation.url, fetchImpl), window, { includeTest })
      : {};
    const variants = row.pendingVariants ? await decode<CatalogVariant[]>(row.pendingVariants) : [];
    const locations = mergeLocations(await fetchLocations(client), variants);
    const now = options.now ?? new Date();
    const snapshot: StoredSnapshot = {
      version: SNAPSHOT_VERSION,
      fetchedAt: now.toISOString(),
      windowStart: window.start,
      windowEnd: window.end,
      lookbackDays: row.lookbackDays,
      locations,
      variants,
      sales,
    };
    await db.shopSnapshot.update({
      where: { shop },
      data: {
        status: "idle",
        stage: null,
        bulkOperationId: null,
        pendingVariants: null,
        data: await encode(snapshot),
        completedAt: now,
        error: null,
      },
    });
  } catch (error) {
    console.error(`[stocksense] snapshot ${stage} stage failed`, error);
    await fail(shop, `Could not process Shopify's data export: ${message(error)}`);
  }
}

function toState(
  row: { status: string; stage: string | null; error: string | null } | null,
  snapshot: StoredSnapshot | null,
): SnapshotState {
  return {
    snapshot,
    syncing: row?.status === "running",
    stage: row?.status === "running" ? ((row.stage as SyncStage | null) ?? "starting") : null,
    error: row?.status === "error" ? row.error : null,
  };
}

/**
 * Return the shop's snapshot, advancing or starting a sync as needed.
 * Never throws for Shopify-side problems; they come back as `error`.
 */
export async function loadSnapshot(
  client: GraphqlClient,
  shop: string,
  options: LoadOptions,
): Promise<SnapshotState> {
  const now = options.now ?? new Date();
  let row = await db.shopSnapshot.findUnique({ where: { shop } });

  if (row?.status === "running") {
    const stuck = now.getTime() - row.updatedAt.getTime() > STUCK_AFTER_MS;
    if (!stuck) {
      if (row.stage === "waiting" && now.getTime() - row.updatedAt.getTime() > 30_000) {
        await launchVariantsExport(client, shop);
      } else {
        try {
          await advance(client, row, options);
        } catch (error) {
          console.error("[stocksense] snapshot status check failed", error);
        }
      }
      row = await db.shopSnapshot.findUnique({ where: { shop } });
      return toState(row, row ? await readSnapshot(shop, row) : null);
    }
  }

  const snapshot = row ? await readSnapshot(shop, row) : null;
  const age = row?.completedAt ? now.getTime() - row.completedAt.getTime() : Number.POSITIVE_INFINITY;
  const recentError =
    row?.status === "error" && now.getTime() - row.updatedAt.getTime() < ERROR_RETRY_MS && !options.force;
  const needsRefresh =
    options.force ||
    !snapshot ||
    snapshot.version !== SNAPSHOT_VERSION ||
    row?.status === "running" ||
    age > STALE_AFTER_MS ||
    (row?.lookbackDays ?? options.lookbackDays) !== options.lookbackDays;

  if (needsRefresh && !recentError) {
    if (await claimStart(shop, options.lookbackDays, now)) {
      await launchVariantsExport(client, shop);
    }
    row = await db.shopSnapshot.findUnique({ where: { shop } });
  }
  return toState(row, snapshot);
}

/**
 * Locations from the API plus any location that holds stock in the catalog,
 * so the location filter never misses one the API listing left out.
 */
export function mergeLocations(listed: LocationInfo[], variants: CatalogVariant[]): LocationInfo[] {
  const byId = new Map(listed.map((l) => [l.id, l]));
  for (const variant of variants) {
    for (const level of variant.levels) {
      if (!byId.has(level.locationId)) {
        byId.set(level.locationId, { id: level.locationId, name: level.locationName || "Unnamed location" });
      }
    }
  }
  return [...byId.values()];
}

/** Delete a shop's snapshot (uninstall / shop redact). */
export async function deleteSnapshot(shop: string): Promise<void> {
  decoded.delete(shop);
  await db.shopSnapshot.deleteMany({ where: { shop } });
}

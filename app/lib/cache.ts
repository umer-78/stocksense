/**
 * Minimal in-memory TTL cache for Shopify data snapshots.
 *
 * Purpose: a store with thousands of SKUs must not re-fetch the whole catalog
 * on every page load. The dashboard and detail pages share one snapshot per
 * shop for a short window.
 *
 * LIMITATION: this is a single-process cache. On a multi-instance deployment
 * each instance keeps its own copy (harmless — it only affects freshness, not
 * correctness). Replace with a shared store (Redis/DB) if the app is scaled
 * horizontally.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Test helper. */
export function cacheClear(): void {
  store.clear();
}
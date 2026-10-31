/**
 * A small fixed-window rate limiter, kept in memory per server instance.
 *
 * The MCP endpoint hashes every presented key with scrypt before it knows
 * whether the key is real, so without a limit a stream of made-up keys costs
 * real CPU. Limits are per instance: with several instances behind a load
 * balancer the effective limit is that many times higher, which is fine for
 * abuse protection (it is not a billing meter).
 */
export interface RateLimiter {
  /** Records one request for `key`; returns how long to wait (ms) if over the limit, else 0. */
  hit(key: string): number;
}

export function createRateLimiter(
  { limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number },
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key: string): number {
      const t = now();
      let entry = windows.get(key);
      if (!entry || t - entry.start >= windowMs) {
        // forget expired windows before the map can grow without bound
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        entry = { start: t, count: 0 };
        windows.set(key, entry);
      }
      entry.count += 1;
      return entry.count > limit ? entry.start + windowMs - t : 0;
    },
  };
}

/** The caller's address as the proxy in front of the app reports it. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

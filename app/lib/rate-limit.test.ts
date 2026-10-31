import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit in a window, then asks the caller to wait", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 }, () => t);
    expect([limiter.hit("a"), limiter.hit("a"), limiter.hit("a")]).toEqual([0, 0, 0]);
    expect(limiter.hit("a")).toBe(60_000);
    t += 15_000;
    expect(limiter.hit("a")).toBe(45_000);
    expect(limiter.hit("b")).toBe(0); // keys are independent
    t += 45_000;
    expect(limiter.hit("a")).toBe(0); // a new window
  });

  it("does not grow without bound", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10, maxKeys: 3 }, () => t);
    for (let i = 0; i < 100; i += 1) {
      t += 1;
      limiter.hit(`k${i}`);
    }
    // still answers correctly for a fresh key after many others
    expect(limiter.hit("fresh")).toBe(0);
  });

  it("reads the client address from the proxy headers", () => {
    const req = (headers: Record<string, string>) => new Request("https://x.test/mcp", { headers });
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientAddress(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(req({}))).toBe("unknown");
  });
});

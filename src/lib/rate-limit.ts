// Simple in-memory, per-key rate limiter. Given single-tenant scale this is
// intentionally not distributed/persistent (a cold serverless instance
// resets it) — it slows down casual abuse without pretending to be a real
// WAF. Originally admin-auth.ts's login attempt counter; pulled out here so
// the public testimonial submission endpoint (src/pages/api/testimonials/
// submit.ts) can use the same approach with its own window/limit.
export function createRateLimiter(windowMs: number, limit: number) {
  const attempts = new Map<string, { count: number; windowStart: number }>();

  function isLimited(key: string): boolean {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.windowStart > windowMs) return false;
    return entry.count >= limit;
  }

  function record(key: string): void {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      attempts.set(key, { count: 1, windowStart: now });
    } else {
      entry.count += 1;
    }
  }

  function clear(key: string): void {
    attempts.delete(key);
  }

  return { isLimited, record, clear };
}

/**
 * Minimal in-memory rate limiter, scoped to a single server process. This is
 * a known limitation, not an oversight: apps/landing has no shared store
 * (Redis, etc.) wired up yet, so limits reset on deploy/restart and don't
 * coordinate across multiple instances. Sufficient as a first line of defense
 * against basic abuse; see docs/landing-redesign/phase-3/decision-log.md.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Webhook retry policy (1m, 5m, 15m, 1h, 6h, then 6h) and the cap applied to
// an endpoint's Retry-After, so a hostile endpoint cannot schedule a retry
// years ahead.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export function webhookBackoff(attempt) {
  const schedule = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 1 * HOUR, 6 * HOUR];
  return schedule[Math.min(Math.max(attempt, 1) - 1, schedule.length - 1)];
}

export function boundedRetryAfterMilliseconds(retryAfterSeconds, maxMilliseconds = 6 * HOUR) {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return null;
  return Math.min(retryAfterSeconds * 1_000, maxMilliseconds);
}

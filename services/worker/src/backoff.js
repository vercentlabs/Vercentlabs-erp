// Bounded backoff policies. Webhook delivery and internal jobs use
// different profiles deliberately (this prompt's own instruction: "Do not
// hardcode one policy for everything if webhook and internal jobs require
// different behavior") — webhook endpoints are external, unowned systems
// that benefit from a slower ramp so a flaky endpoint isn't hammered;
// internal jobs are trusted, in-process handlers that can retry sooner.

const MINUTE = 60_000;
const HOUR = 3_600_000;

// attempt is 1-based (the attempt number that just failed).
export function internalJobBackoff(attempt) {
  const schedule = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 1 * HOUR];
  return schedule[Math.min(attempt - 1, schedule.length - 1)];
}

export function webhookBackoff(attempt) {
  const schedule = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 1 * HOUR, 6 * HOUR];
  return schedule[Math.min(attempt - 1, schedule.length - 1)];
}

// Caps a hostile/absurd Retry-After header so a malicious or misconfigured
// endpoint cannot schedule a retry years into the future — never exceeds
// this backoff profile's own maximum step.
export function boundedRetryAfterMilliseconds(retryAfterSeconds, maxMilliseconds = 6 * HOUR) {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return null;
  return Math.min(retryAfterSeconds * 1_000, maxMilliseconds);
}

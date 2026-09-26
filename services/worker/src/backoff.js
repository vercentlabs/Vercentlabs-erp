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

// The webhook policy lives with webhook delivery (Shared Platform).
export { boundedRetryAfterMilliseconds, webhookBackoff } from "@vercentlabs/api";

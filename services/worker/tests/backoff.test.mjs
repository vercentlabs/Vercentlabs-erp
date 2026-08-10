import assert from "node:assert/strict";
import test from "node:test";

import { internalJobBackoff, webhookBackoff, boundedRetryAfterMilliseconds } from "../src/backoff.js";

test("internalJobBackoff: 1m, 5m, 15m, 1h, then caps at 1h", () => {
  assert.equal(internalJobBackoff(1), 60_000);
  assert.equal(internalJobBackoff(2), 5 * 60_000);
  assert.equal(internalJobBackoff(3), 15 * 60_000);
  assert.equal(internalJobBackoff(4), 3_600_000);
  assert.equal(internalJobBackoff(99), 3_600_000, "must never grow unbounded");
});

test("webhookBackoff: has its own, slower-ramping profile distinct from internal jobs", () => {
  assert.equal(webhookBackoff(1), 60_000);
  assert.equal(webhookBackoff(5), 6 * 3_600_000);
  assert.equal(webhookBackoff(99), 6 * 3_600_000, "must never grow unbounded");
  assert.notEqual(webhookBackoff(5), internalJobBackoff(5), "webhook and internal jobs must not share one hardcoded policy");
});

test("boundedRetryAfterMilliseconds: caps a hostile Retry-After header at the profile maximum", () => {
  assert.equal(boundedRetryAfterMilliseconds(30), 30_000);
  assert.equal(boundedRetryAfterMilliseconds(999_999_999), 6 * 3_600_000, "a year-long Retry-After must be capped, not honored literally");
});

test("boundedRetryAfterMilliseconds: rejects invalid values instead of scheduling garbage", () => {
  assert.equal(boundedRetryAfterMilliseconds(NaN), null);
  assert.equal(boundedRetryAfterMilliseconds(-5), null);
});

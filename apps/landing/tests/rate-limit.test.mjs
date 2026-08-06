import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit } from "../lib/rate-limit.ts";

test("allows requests up to the limit, then blocks", () => {
  const key = `test-key-${Date.now()}`;
  for (let i = 0; i < 3; i += 1) {
    const result = checkRateLimit(key, 3, 60_000);
    assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
  }
  const blocked = checkRateLimit(key, 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("different keys have independent buckets", () => {
  const keyA = `test-a-${Date.now()}`;
  const keyB = `test-b-${Date.now()}`;
  checkRateLimit(keyA, 1, 60_000);
  const blockedA = checkRateLimit(keyA, 1, 60_000);
  const allowedB = checkRateLimit(keyB, 1, 60_000);
  assert.equal(blockedA.allowed, false);
  assert.equal(allowedB.allowed, true);
});

test("resets after the window elapses", () => {
  const key = `test-window-${Date.now()}`;
  checkRateLimit(key, 1, 10);
  const blocked = checkRateLimit(key, 1, 10);
  assert.equal(blocked.allowed, false);
  return new Promise((resolve) => {
    setTimeout(() => {
      const allowedAgain = checkRateLimit(key, 1, 10);
      assert.equal(allowedAgain.allowed, true);
      resolve();
    }, 20);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { captureFirstTouchAttribution, getAttribution } from "../lib/attribution.ts";

// This repo has no DOM/jsdom test environment — these confirm the module
// degrades gracefully outside a browser (returns null, never throws) rather
// than exercising real localStorage/window behaviour, which is covered by
// the Playwright e2e suite (tests/e2e/production-smoke.spec.ts) running in a
// real browser instead.

test("captureFirstTouchAttribution returns null outside a browser instead of throwing", () => {
  assert.equal(captureFirstTouchAttribution(), null);
});

test("getAttribution returns null outside a browser instead of throwing", () => {
  assert.equal(getAttribution(), null);
});

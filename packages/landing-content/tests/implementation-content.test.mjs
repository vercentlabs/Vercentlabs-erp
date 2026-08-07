import assert from "node:assert/strict";
import test from "node:test";
import { IMPLEMENTATION_PAGE } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];
const EXPECTED_PHASE_IDS = ["discovery", "solution-design", "configuration", "data-migration", "testing", "training", "launch", "post-launch"];

test("implementation page has exactly 8 phases in the correct order", () => {
  assert.equal(IMPLEMENTATION_PAGE.phases.length, 8);
  assert.deepEqual(IMPLEMENTATION_PAGE.phases.map((p) => p.id), EXPECTED_PHASE_IDS);
});

test("every phase has a non-generic description and at least 2 activities and 1 typical output", () => {
  for (const phase of IMPLEMENTATION_PAGE.phases) {
    assert.ok(phase.description.length > 60, `${phase.id} description is too short/generic`);
    assert.ok(phase.activities.length >= 2, `${phase.id} needs at least 2 activities`);
    assert.ok(phase.typicalOutputs.length >= 1, `${phase.id} needs at least 1 typical output`);
  }
});

test("the data-migration phase has a migration checklist (migration is integrated, not a separate route)", () => {
  const migrationPhase = IMPLEMENTATION_PAGE.phases.find((p) => p.id === "data-migration");
  assert.ok(migrationPhase, "data-migration phase must exist");
  assert.ok(migrationPhase.migrationChecklist && migrationPhase.migrationChecklist.length >= 3, "data-migration needs a real migration checklist");
});

test("no phase claims a specific duration, timeframe, or completion guarantee", () => {
  const durationPattern = /\b\d+\s*(day|week|month|hour)s?\b/i;
  for (const phase of IMPLEMENTATION_PAGE.phases) {
    const haystack = JSON.stringify(phase);
    assert.ok(!durationPattern.test(haystack), `${phase.id} appears to claim a specific duration — CLAUDE.md forbids fabricated migration times`);
  }
});

test("implementation page has at least 3 FAQs and real conversion content", () => {
  assert.ok(IMPLEMENTATION_PAGE.faqs.length >= 3);
  assert.ok(IMPLEMENTATION_PAGE.conversion.heading.length > 10);
  assert.ok(IMPLEMENTATION_PAGE.conversion.ctaLabel.length > 0);
});

test("implementation page content has no banned overclaiming or placeholder phrase", () => {
  const haystack = JSON.stringify(IMPLEMENTATION_PAGE);
  for (const pattern of BANNED_PHRASES) {
    assert.ok(!pattern.test(haystack), `Implementation page contains a banned phrase matching ${pattern}`);
  }
});

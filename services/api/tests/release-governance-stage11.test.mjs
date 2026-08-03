import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEASE_CHECK_KEYS,
  buildReleaseGovernanceSummary,
  evaluateReleaseReadiness,
  releaseContentHash,
} from "../src/release/governance.js";

function passedChecks(now = "2026-08-03T04:30:00.000Z") {
  return RELEASE_CHECK_KEYS.map((checkKey) => ({
    check_key: checkKey,
    status: "passed",
    completed_at: now,
  }));
}

test("complete fresh release evidence produces a ready score", () => {
  const health = evaluateReleaseReadiness(
    { checks: passedChecks(), incidents: [] },
    { backupMaximumAgeHours: 24 },
    new Date("2026-08-03T05:00:00.000Z"),
  );
  assert.equal(health.readiness, "ready");
  assert.equal(health.score, 100);
  assert.equal(health.metrics.passedChecks, RELEASE_CHECK_KEYS.length);
  assert.deepEqual(health.blockers, []);
});

test("missing checks stale backups and high incidents block promotion", () => {
  const checks = passedChecks("2026-08-01T00:00:00.000Z").filter(
    (row) => row.check_key !== "security",
  );
  const health = evaluateReleaseReadiness(
    {
      checks,
      incidents: [{ severity: "high", status: "investigating" }],
    },
    { backupMaximumAgeHours: 24 },
    new Date("2026-08-03T05:00:00.000Z"),
  );
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.some((value) => value.includes("security")));
  assert.ok(health.blockers.some((value) => value.includes("backup")));
  assert.ok(health.blockers.some((value) => value.includes("high-severity")));
});

test("release summaries and evidence hashes are deterministic", () => {
  const health = evaluateReleaseReadiness({
    checks: passedChecks(),
    incidents: [],
  });
  const summary = buildReleaseGovernanceSummary({
    health,
    checks: passedChecks(),
    incidents: [],
    snapshots: [{ id: "snapshot" }],
  });
  assert.equal(summary.readiness, "ready");
  assert.equal(summary.snapshots, 1);
  assert.equal(
    releaseContentHash({ b: 2, a: 1 }),
    releaseContentHash({ a: 1, b: 2 }),
  );
});

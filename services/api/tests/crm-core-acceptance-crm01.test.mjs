import assert from "node:assert/strict";
import test from "node:test";

import {
  CRM_CORE_CHECK_KEYS,
  CRM_CORE_CAPABILITY_IDS,
  CRM_CORE_SURFACE_CHECKS,
  buildCrmCoreAcceptanceSummary,
  crmCoreContentHash,
  evaluateCrmCoreAcceptance,
} from "../src/crm/core-acceptance.js";

const passedChecks = () =>
  CRM_CORE_CHECK_KEYS.map((checkKey) => ({
    check_key: checkKey,
    status: "passed",
    completed_at: "2026-08-03T06:30:00.000Z",
  }));

test("all 17 capabilities and seven surfaces produce a ready CRM-01 gate", () => {
  const health = evaluateCrmCoreAcceptance({ checks: passedChecks() });
  assert.equal(CRM_CORE_CAPABILITY_IDS.length, 17);
  assert.equal(CRM_CORE_SURFACE_CHECKS.length, 7);
  assert.equal(health.readiness, "ready");
  assert.equal(health.score, 100);
  assert.equal(health.metrics.passedChecks, CRM_CORE_CHECK_KEYS.length);
  assert.deepEqual(health.blockers, []);
});

test("missing and failed CRM core checks block acceptance", () => {
  const checks = passedChecks().filter((row) => row.check_key !== "CRM-022");
  checks.find((row) => row.check_key === "surface:tenant-isolation").status =
    "failed";
  const health = evaluateCrmCoreAcceptance({ checks });
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.some((value) => value.includes("CRM-022")));
  assert.ok(
    health.blockers.some((value) => value.includes("tenant-isolation")),
  );
});

test("CRM core evidence hashes and summaries are deterministic", () => {
  const checks = passedChecks();
  const health = evaluateCrmCoreAcceptance({ checks });
  const summary = buildCrmCoreAcceptanceSummary({
    health,
    checks,
    snapshots: [{ id: "snapshot" }],
  });
  assert.equal(summary.readiness, "ready");
  assert.equal(summary.snapshots, 1);
  assert.equal(
    crmCoreContentHash({ b: 2, a: 1 }),
    crmCoreContentHash({ a: 1, b: 2 }),
  );
});

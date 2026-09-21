// Real PostgreSQL integration test -- quality plans (with tolerances), AQL sampling plans, and the
// inspection lifecycle (F308-F320): the server computes pass/fail from each point's own
// tolerance/allowed-values rather than trusting a caller-supplied verdict.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_QUALITY, buildQualityWorld, connectAdmin } from "./quality-test-kit.mjs";

const ROLES = {
  qaA: ALL_QUALITY,
  qaB: ALL_QUALITY,
  author: ["quality.plan.manage", "quality.view"], // can write a plan, but not fast-track approving it (no quality.manage)
  inspector: ["quality.inspect", "quality.release", "quality.view"], // can inspect and release, but not override the self-release block (no quality.manage)
  viewer: ["quality.view"],
};

test("Quality plans and inspections against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildQualityWorld(admin, ROLES, "qlin");
  const { api, run, denied, itemId, supplierId } = w;
  const ids = {};

  try {
    await t.test("F308-311/F318: a plan needs points with real tolerances, and is approved by someone other than its author", async () => {
      await denied("viewer", (c, x) => api.defineQualityPlan(c, x, { code: "P1", name: "Incoming check", planType: "incoming", points: [] }), 403);
      await denied("author", (c, x) => api.defineQualityPlan(c, x, { code: "P1", name: "Incoming check", planType: "incoming", points: [] }), 400, "QUALITY_PLAN_INVALID");
      const plan = await run("author", (c, x) => api.defineQualityPlan(c, x, {
        code: "P1", name: "Incoming check", planType: "incoming", itemId, supplierId, samplingMethod: "full",
        points: [
          { characteristic: "Length", resultType: "numeric", lowerLimit: 9.5, upperLimit: 10.5, critical: true },
          { characteristic: "Cosmetic", resultType: "boolean" },
          { characteristic: "Color", resultType: "selection", allowedValues: ["red", "blue"] },
        ],
      }));
      ids.plan = plan.id;
      assert.equal(plan.points.length, 3);
      assert.equal(plan.status, "draft");
      await denied("author", (c, x) => api.approveQualityPlan(c, x, plan.id), 403, "SELF_APPROVAL_BLOCKED");
      const approved = await run("qaA", (c, x) => api.approveQualityPlan(c, x, plan.id));
      assert.equal(approved.status, "active");
      assert.ok(approved.approved_by);
    });

    await t.test("F315: AQL sampling plans size a sample from the lot, and the plan resolves the right bracket", async () => {
      await run("qaA", (c, x) => api.saveSamplingPlan(c, x, { code: "AQL65", name: "AQL general II", lotSizeFrom: 1, lotSizeTo: 50, sampleSize: 8, acceptanceNumber: 1, rejectionNumber: 2 }));
      await run("qaA", (c, x) => api.saveSamplingPlan(c, x, { code: "AQL65", name: "AQL general II", lotSizeFrom: 51, lotSizeTo: 500, sampleSize: 32, acceptanceNumber: 3, rejectionNumber: 4 }));
      const aqlPlan = await run("qaA", (c, x) => api.defineQualityPlan(c, x, { code: "P2", name: "AQL final", planType: "final", itemId, samplingMethod: "aql", points: [{ characteristic: "Function test", resultType: "boolean", critical: true }] }));
      await run("qaB", (c, x) => api.approveQualityPlan(c, x, aqlPlan.id));
      ids.aqlPlan = aqlPlan.id;
      await denied("qaA", (c, x) => api.createQualityInspection(c, x, { planId: aqlPlan.id, lotQuantity: 30, sourceType: "manual" }), 400, "QUALITY_SAMPLING_REQUIRED");
      const inspection = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: aqlPlan.id, lotQuantity: 30, sourceType: "manual", samplingPlanCode: "AQL65" }));
      assert.equal(Number(inspection.sample_quantity), 8, "a lot of 30 falls in the 1-50 bracket: sample 8");
    });

    await t.test("F312-314/F316/F317/F319: results are checked against tolerance server-side; a critical failure fails the lot", async () => {
      const inspection = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: ids.plan, lotQuantity: 20, sourceType: "manual" }));
      ids.inspection = inspection.id;
      const points = Object.fromEntries(inspection.points.map((p) => [p.characteristic, p.id]));
      await denied("viewer", (c, x) => api.recordInspectionResults(c, x, inspection.id, { results: [{ inspectionPointId: points.Length, numericValue: 10 }] }), 403);
      const recorded = await run("qaA", (c, x) => api.recordInspectionResults(c, x, inspection.id, {
        results: [
          { inspectionPointId: points.Length, numericValue: 10 }, // within 9.5-10.5: pass
          { inspectionPointId: points.Cosmetic, resultStatus: "pass" },
          { inspectionPointId: points.Color, textValue: "green" }, // not in ["red","blue"]: fail, but not critical
        ],
      }));
      assert.equal(recorded.anyFail, true);
      assert.equal(recorded.anyCriticalFail, false);
      const completed = await run("qaA", (c, x) => api.completeQualityInspection(c, x, inspection.id, {}));
      assert.equal(completed.status, "failed", "a non-critical, non-AQL-sampled failure still fails a full-sample lot");
      assert.ok(Number(completed.rejected_quantity) > 0);

      // a second inspection where the critical point itself fails
      const inspection2 = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: ids.plan, lotQuantity: 20, sourceType: "manual" }));
      const points2 = Object.fromEntries(inspection2.points.map((p) => [p.characteristic, p.id]));
      await denied("qaA", (c, x) => api.recordInspectionResults(c, x, inspection2.id, { results: [{ inspectionPointId: points2.Length }] }), 400, "QUALITY_RESULT_INVALID");
      await run("qaA", (c, x) => api.recordInspectionResults(c, x, inspection2.id, {
        results: [{ inspectionPointId: points2.Length, numericValue: 20 }, { inspectionPointId: points2.Cosmetic, resultStatus: "pass" }, { inspectionPointId: points2.Color, textValue: "red" }],
      }));
      const completed2 = await run("qaA", (c, x) => api.completeQualityInspection(c, x, inspection2.id, {}));
      assert.equal(completed2.status, "failed");
      ids.criticalFailInspection = inspection2.id;
    });

    await t.test("F312-314/F319: a clean pass releases, but never by the inspector who ran it", async () => {
      const inspection3 = await run("inspector", (c, x) => api.createQualityInspection(c, x, { planId: ids.plan, lotQuantity: 5, sourceType: "manual" }));
      const p3 = Object.fromEntries(inspection3.points.map((p) => [p.characteristic, p.id]));
      await run("inspector", (c, x) => api.recordInspectionResults(c, x, inspection3.id, { results: [{ inspectionPointId: p3.Length, numericValue: 10 }, { inspectionPointId: p3.Cosmetic, resultStatus: "pass" }, { inspectionPointId: p3.Color, textValue: "red" }] }));
      const completed3 = await run("inspector", (c, x) => api.completeQualityInspection(c, x, inspection3.id, {}));
      assert.equal(completed3.status, "passed");
      await denied("inspector", (c, x) => api.releaseQualityInspection(c, x, inspection3.id, {}), 403, "SELF_APPROVAL_BLOCKED");
      const released = await run("qaB", (c, x) => api.releaseQualityInspection(c, x, inspection3.id, {}));
      assert.ok(released.released_by);
      ids.releasedInspection = inspection3.id;
    });

    await t.test("plan revision keeps history; retiring needs a reason", async () => {
      const revised = await run("qaA", (c, x) => api.reviseQualityPlan(c, x, ids.plan));
      assert.equal(revised.version, 2);
      assert.equal(revised.status, "draft");
      await denied("qaA", (c, x) => api.retireQualityPlan(c, x, ids.plan, ""), 400, "QUALITY_REASON_REQUIRED");
      const retired = await run("qaA", (c, x) => api.retireQualityPlan(c, x, ids.plan, "Superseded by v2"));
      assert.equal(retired.status, "obsolete");
    });

    await t.test("cancel an inspection with a reason", async () => {
      const inspection4 = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: ids.aqlPlan, lotQuantity: 10, sourceType: "manual", samplingPlanCode: "AQL65" }));
      await denied("qaA", (c, x) => api.cancelQualityInspection(c, x, inspection4.id, ""), 400, "QUALITY_REASON_REQUIRED");
      const cancelled = await run("qaA", (c, x) => api.cancelQualityInspection(c, x, inspection4.id, "Wrong lot"));
      assert.equal(cancelled.status, "cancelled");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

// F025 sales forecast against real PostgreSQL on the runtime role:
// hierarchy rollup without double counting, submit/review/adjust with
// versions and reasons, immutable snapshots that are never recalculated,
// snapshot visibility, period lifecycle locks (code and database), scheduled
// capture idempotency, and accuracy/backtesting.
import assert from "node:assert/strict";
import test from "node:test";

import {
  captureForecastPeriodSnapshot,
  captureScheduledForecastSnapshots,
  getForecastAccuracy,
  getForecastSnapshot,
  getForecastWorkspace,
  listForecastSubmissionEvents,
  reviewForecast,
  setForecastPeriodStatus,
  submitForecast,
} from "../../../services/api/src/modules/crm/pipeline-analytics-and-forecasting/forecast-service.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";
import { ADMIN, crmFixtures, MANAGER, REP } from "./crm-fixtures.mjs";

const SELLER = [...REP, "crm.forecast.submit"];
const REVIEWER = [...MANAGER, "crm.forecast.submit", "crm.forecast.review"];
const HEAD = [...ADMIN, "crm.forecast.submit", "crm.forecast.review", "crm.forecast.manage"];
const Q3 = ["2026-07-01", "2026-09-30"];

test("F025 sales forecast", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["head", "alice", "bob", "carol", "manny"]);
    const fx = crmFixtures(kit, org);
    const { alice, bob, carol, manny } = org.ids;
    const pipe = await fx.pipeline();
    const india = await fx.team("India");
    const west = await fx.team("West", { managerId: manny, parentId: india });
    const south = await fx.team("South", { parentId: india });
    await fx.member(west, alice);
    await fx.member(west, bob);
    await fx.member(south, carol);
    const q3 = await fx.period("Q3 2026", ...Q3);
    const aliceDeal = await fx.opportunity(pipe, { ownerId: alice, amount: 1000, probability: 60, expectedClose: "2026-08-15", category: "committed" });
    await fx.opportunity(pipe, { ownerId: alice, amount: 2000, probability: 30, expectedClose: "2026-09-01", category: "best_case" });
    await fx.opportunity(pipe, { ownerId: bob, amount: 500, probability: 80, expectedClose: "2026-07-20", category: "committed" });
    await fx.opportunity(pipe, { ownerId: carol, amount: 4000, probability: 40, expectedClose: "2026-09-10", category: "pipeline" });
    await fx.opportunity(pipe, { ownerId: carol, amount: 700, status: "won", actualClose: "2026-07-05", probability: 100, category: "closed" });

    const head = org.session("head", HEAD);
    const aliceCtx = org.session("alice", SELLER);
    const carolCtx = org.session("carol", SELLER);
    const manager = org.session("manny", REVIEWER);
    const run = (session, work) => kit.tenant(org.organizationId, (client) => work(client, session));
    const workspace = (session) => run(session, (client, ctx) => getForecastWorkspace(client, ctx, { periodId: q3 }));

    let aliceSubmission;

    await t.test("rollup: rep -> team -> parent -> organisation, each owner counted once", async () => {
      const view = await workspace(head);
      const westNode = view.rollup.teams[0].children.find((node) => node.id === west);
      assert.deepEqual(westNode.rollup.figures, { pipeline: 3500, bestCase: 3500, commit: 1500, weighted: 1600, won: 0, deals: 3 });
      const indiaNode = view.rollup.teams.find((node) => node.id === india);
      assert.equal(indiaNode.rollup.figures.pipeline, 7500, "West 3500 + South 4000");
      assert.equal(indiaNode.rollup.figures.won, 700);
      assert.deepEqual(view.rollup.total.figures, indiaNode.rollup.figures, "the organisation equals the single root — nothing counted twice");
      assert.equal(view.owners.length, 3);
    });

    await t.test("a seller submits their own forecast; replays are no-ops; stale and inconsistent input is refused", async () => {
      const first = await run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1500, bestCaseAmount: 2500, notes: "Two deals" }));
      aliceSubmission = first.submission;
      assert.equal(aliceSubmission.status, "submitted");
      assert.equal(aliceSubmission.version, 1);
      assert.equal(aliceSubmission.baseline.commit, 1000, "the system figure at submission time is kept");
      const replay = await run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1500, bestCaseAmount: 2500, notes: "Two deals" }));
      assert.equal(replay.replayed, true);
      await assert.rejects(run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1600, expectedVersion: 99 })), expectCode("CRM_FORECAST_STALE_WRITE"));
      await assert.rejects(run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 3000, bestCaseAmount: 1000 })), expectCode("CRM_FORECAST_BEST_CASE_BELOW_COMMIT"));
      await assert.rejects(run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 10.001 })), expectCode("CRM_FORECAST_AMOUNT_INVALID"));
      await assert.rejects(run(org.session("alice", REP), (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1 })), expectCode("CRM_PERMISSION_REQUIRED"));
      await run(carolCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 900 }));
    });

    await t.test("a manager adjusts a team member with a reason; the seller's own number is untouched", async () => {
      await assert.rejects(run(manager, (client, ctx) => reviewForecast(client, ctx, { submissionId: aliceSubmission.id, decision: "adjust", managerAdjustment: 500 })), expectCode("CRM_FORECAST_REASON_REQUIRED"));
      const adjusted = await run(manager, (client, ctx) => reviewForecast(client, ctx, { submissionId: aliceSubmission.id, decision: "adjust", managerAdjustment: 500, reason: "Renewal pulled in", expectedVersion: 1 }));
      assert.equal(Number(adjusted.submission.managerAdjustment), 500);
      assert.equal(Number(adjusted.submission.commitAmount), 1500);
      await assert.rejects(run(manager, (client, ctx) => reviewForecast(client, ctx, { submissionId: aliceSubmission.id, decision: "approve", expectedVersion: 1 })), expectCode("CRM_FORECAST_STALE_WRITE"));
      const carolSubmission = (await workspace(head)).owners.find((owner) => owner.ownerUserId === carol).submission;
      await assert.rejects(run(manager, (client, ctx) => reviewForecast(client, ctx, { submissionId: carolSubmission.id, decision: "approve" })), expectCode("CRM_FORECAST_SUBMISSION_NOT_FOUND"), "carol is not in the manager's team");
      await assert.rejects(run(aliceCtx, (client, ctx) => reviewForecast(client, ctx, { submissionId: aliceSubmission.id, decision: "approve" })), expectCode("CRM_PERMISSION_REQUIRED"));
      const view = await workspace(head);
      const aliceRow = view.owners.find((owner) => owner.ownerUserId === alice);
      assert.equal(aliceRow.adjustedCommit, 2000, "submitted 1500 + adjustment 500");
      const westNode = view.rollup.teams[0].children.find((node) => node.id === west);
      assert.equal(westNode.rollup.adjustedCommit, 2500, "alice 2000 + bob system commit 500");
      const events = await run(aliceCtx, (client, ctx) => listForecastSubmissionEvents(client, ctx, aliceSubmission.id));
      assert.deepEqual(events.map((event) => event.eventType), ["submitted", "adjusted"]);
      assert.equal(events[1].reason, "Renewal pulled in");
      await assert.rejects(run(carolCtx, (client, ctx) => listForecastSubmissionEvents(client, ctx, aliceSubmission.id)), expectCode("CRM_FORECAST_SUBMISSION_NOT_FOUND"));
    });

    let firstCapture;
    await t.test("snapshots are immutable, idempotent on their key and never recalculated", async () => {
      firstCapture = (await run(head, (client, ctx) => captureForecastPeriodSnapshot(client, ctx, { periodId: q3, source: "manual", captureKey: "manual:1" }))).capture;
      const again = await run(head, (client, ctx) => captureForecastPeriodSnapshot(client, ctx, { periodId: q3, source: "manual", captureKey: "manual:1" }));
      assert.equal(again.replayed, true);
      assert.equal(again.capture.id, firstCapture.id);
      const snapshot = await run(head, (client, ctx) => getForecastSnapshot(client, ctx, firstCapture.id));
      const organization = snapshot.rows.find((row) => row.scopeType === "organization");
      assert.equal(Number(organization.commitAmount), 1500);
      assert.equal(Number(organization.totals.adjustedCommit), 3400, "alice 1500+500 adjusted, bob system commit 500, carol submitted 900");
      const aliceRow = snapshot.rows.find((row) => row.scopeType === "owner" && row.ownerUserId === alice);
      assert.equal(aliceRow.opportunitySnapshot.length, 2, "the deals behind the owner row are kept");

      await kit.owner.query(`UPDATE tenant.crm_opportunities SET amount=9999 WHERE id=$1`, [aliceDeal]);
      const later = await run(head, (client, ctx) => getForecastSnapshot(client, ctx, firstCapture.id));
      assert.equal(Number(later.rows.find((row) => row.scopeType === "organization").commitAmount), 1500, "an old snapshot does not follow today's opportunity");
      await assert.rejects(kit.tenant(org.organizationId, (client) => client.query(`UPDATE tenant.crm_forecast_snapshots SET commit_amount=1 WHERE capture_id=$1`, [firstCapture.id])), /immutable/);
      await assert.rejects(kit.tenant(org.organizationId, (client) => client.query(`DELETE FROM tenant.crm_forecast_snapshot_captures WHERE id=$1`, [firstCapture.id])), /immutable/);
      await kit.owner.query(`UPDATE tenant.crm_opportunities SET amount=1000 WHERE id=$1`, [aliceDeal]);
    });

    await t.test("snapshot visibility: sellers see their own rows, managers their team, forecast governors everything", async () => {
      const mine = await run(aliceCtx, (client, ctx) => getForecastSnapshot(client, ctx, firstCapture.id));
      assert.deepEqual(mine.rows.map((row) => `${row.scopeType}:${row.ownerUserId ?? row.teamId}`), [`owner:${alice}`]);
      const team = await run(manager, (client, ctx) => getForecastSnapshot(client, ctx, firstCapture.id));
      const scopes = team.rows.map((row) => `${row.scopeType}:${row.scopeId}`).sort();
      assert.deepEqual(scopes, [`owner:${alice}`, `owner:${bob}`, `team:${west}`].sort());
    });

    await t.test("scheduled capture runs once per day per open period", async () => {
      const first = await run(head, (client) => captureScheduledForecastSnapshots(client, org.organizationId, { date: "2026-08-01" }));
      assert.deepEqual(first, { periods: 1, captured: 1 });
      const second = await run(head, (client) => captureScheduledForecastSnapshots(client, org.organizationId, { date: "2026-08-01" }));
      assert.deepEqual(second, { periods: 1, captured: 0 });
    });

    await t.test("lifecycle: freeze locks submissions (code and database), reopen, then freeze and close is final", async () => {
      await assert.rejects(run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "closed" })), expectCode("CRM_FORECAST_PERIOD_TRANSITION_INVALID"));
      await assert.rejects(run(manager, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "frozen" })), expectCode("CRM_PERMISSION_REQUIRED"));
      const frozen = await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "frozen" }));
      assert.equal(frozen.period.status, "frozen");
      assert.equal(frozen.capture.source, "freeze");
      await assert.rejects(run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1700 })), expectCode("CRM_FORECAST_PERIOD_LOCKED"));
      await assert.rejects(kit.tenant(org.organizationId, (client) => client.query(`UPDATE tenant.crm_forecast_submissions SET commit_amount=1 WHERE id=$1`, [aliceSubmission.id])), /frozen/);
      await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "open" }));
      await run(aliceCtx, (client, ctx) => submitForecast(client, ctx, { periodId: q3, commitAmount: 1700, bestCaseAmount: 2500 }));
      await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "frozen" }));
      const closed = await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "closed" }));
      assert.equal(closed.capture.source, "close");
      await assert.rejects(run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q3, status: "open" })), expectCode("CRM_FORECAST_PERIOD_TRANSITION_INVALID"));
      await assert.rejects(kit.tenant(org.organizationId, (client) => client.query(`UPDATE tenant.crm_forecast_periods SET status='open' WHERE id=$1`, [q3])), /cannot be reopened/);
    });

    await t.test("accuracy: the horizon snapshot against what actually closed won, with commit conversion", async () => {
      const q2 = await fx.period("Q2 2026", "2026-04-01", "2026-06-30");
      const won = await fx.opportunity(pipe, { ownerId: alice, amount: 1000, expectedClose: "2026-05-01", category: "committed" });
      const lost = await fx.opportunity(pipe, { ownerId: bob, amount: 3000, expectedClose: "2026-06-10", category: "committed" });
      await run(head, (client, ctx) => captureForecastPeriodSnapshot(client, ctx, { periodId: q2, source: "manual", captureKey: "start", asOf: "2026-04-01" }));
      await kit.owner.query(`UPDATE tenant.crm_opportunities SET status='won', actual_close_date='2026-05-02', forecast_category='closed', probability=100 WHERE id=$1`, [won]);
      await kit.owner.query(`UPDATE tenant.crm_opportunities SET status='lost', actual_close_date='2026-06-12', forecast_category='omitted', probability=0 WHERE id=$1`, [lost]);
      await fx.opportunity(pipe, { ownerId: carol, amount: 500, status: "won", actualClose: "2026-06-20", probability: 100, category: "closed" });
      await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q2, status: "frozen" }));
      await run(head, (client, ctx) => setForecastPeriodStatus(client, ctx, { periodId: q2, status: "closed" }));
      const accuracy = await run(head, (client, ctx) => getForecastAccuracy(client, ctx, { limit: 6 }));
      const q2Row = accuracy.periods.find((row) => row.periodId === q2);
      assert.equal(q2Row.capturedAsOf, "2026-04-01", "the horizon snapshot, not the close capture");
      assert.equal(q2Row.forecastCommit, 4000);
      assert.equal(q2Row.actualWon, 1500);
      assert.equal(q2Row.errorAmount, -2500);
      assert.equal(q2Row.errorPercent, -62.5);
      assert.equal(q2Row.commitDeals, 2);
      assert.equal(q2Row.commitDealsWon, 1);
      assert.equal(q2Row.commitConversionPercent, 50);
      assert.ok(accuracy.calibration.periods >= 1);
      const own = await run(aliceCtx, (client, ctx) => getForecastAccuracy(client, ctx, {}));
      assert.deepEqual(own.scope, { ownerUserId: alice });
      assert.equal(own.periods.find((row) => row.periodId === q2).actualWon, 1000, "a seller measures only their own forecast");
      await assert.rejects(run(aliceCtx, (client, ctx) => getForecastAccuracy(client, ctx, { ownerUserId: bob })), expectCode("CRM_PERMISSION_REQUIRED"));
    });
  } finally {
    await kit.close();
  }
});

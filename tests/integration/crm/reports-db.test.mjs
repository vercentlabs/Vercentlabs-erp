// F030 CRM reports against real PostgreSQL on the runtime role: saved
// definitions over CRM datasets computed by the canonical metric layer
// (grouping, sorting, columns, filters), background runs with formula-safe
// CSV, and scheduled delivery where every recipient's copy is generated with
// that recipient's own authority, idempotently, with delivery status.
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryObjectStorage } from "../../../packages/document-engine/src/index.js";
import { buildWorkspaceAccessSnapshot } from "../../../services/api/src/core/access/index.js";
import { setObjectStorageForTests } from "../../../services/api/src/core/platform/files/index.js";
import { getPipelineMetrics } from "../../../services/api/src/modules/crm/analytics/pipeline-metrics.js";
import { createReportSchedule, enqueueDueReportSchedules, listReportSchedules, nextScheduleOccurrence, setReportScheduleStatus } from "../../../services/api/src/orchestration/reporting/schedules.js";
import { createReportDefinition, executeReportRun, readReportRunOutput, requestReportRun } from "../../../services/api/src/orchestration/reporting/service.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";
import { crmFixtures } from "./crm-fixtures.mjs";

const ENV = { BILLING_ENFORCEMENT_MODE: "observe" };
const MANAGER = ["crm.view", "crm.reports.view", "crm.reports.schedule", "crm.opportunities.manage"];
const SELLER = ["crm.view", "crm.reports.view", "crm.opportunities.manage"];
const NO_REPORTS = ["crm.view"];

test("F030 CRM reports", async (t) => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  setObjectStorageForTests(storage);
  try {
    const org = await kit.organization(["manny", "alice", "bob", "carol"]);
    const fx = crmFixtures(kit, org);
    const { manny, alice, bob, carol } = org.ids;
    await kit.owner.query(`INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1,'crm','crm','enabled',now()) ON CONFLICT (organization_id, module_key) DO UPDATE SET status='enabled'`, [org.organizationId]);
    await fx.crmRole([manny], MANAGER);
    await fx.crmRole([alice, bob], SELLER);
    await fx.crmRole([carol], NO_REPORTS);
    const west = await fx.team("West", { managerId: manny });
    await fx.member(west, alice);
    await fx.member(west, bob);
    const pipe = await fx.pipeline();
    await fx.opportunity(pipe, { ownerId: alice, amount: 1000, expectedClose: "2026-09-10", category: "committed" });
    await fx.opportunity(pipe, { ownerId: bob, amount: 3000, expectedClose: "2026-09-20" });
    await fx.opportunity(pipe, { ownerId: alice, amount: 500, status: "won", actualClose: "2026-09-02", probability: 100, category: "closed", name: "=HYPERLINK(\"http://evil\")" });

    const session = (label, permissions) => ({ ...org.session(label, permissions), allowAllCompanies: false });
    const manager = session("manny", MANAGER);
    const seller = session("alice", SELLER);
    const modules = async (who) => [...(await kit.tenant(org.organizationId, (client) => buildWorkspaceAccessSnapshot(client, who, { env: ENV }))).accessibleModules];
    const run = async (who, definitionId) => {
      const queued = await kit.tenant(org.organizationId, async (client) => requestReportRun(client, who, await modules(who), { definitionId }));
      await kit.tenant(org.organizationId, (client) => executeReportRun(client, org.organizationId, { reportRunId: queued.id, activeCompanyId: org.companyId, activeBranchId: org.branchId }, { env: ENV, storage }));
      const file = await kit.tenant(org.organizationId, (client) => readReportRunOutput(client, who, queued.id, { storage }));
      return { id: queued.id, csv: Buffer.from(file.content ?? file.bytes ?? file.body ?? "").toString("utf8") };
    };

    let definition;
    await t.test("a saved pipeline analysis groups, sorts and filters with the dashboard's own numbers", async () => {
      const available = await modules(manager);
      definition = await kit.tenant(org.organizationId, (client) =>
        createReportDefinition(client, manager, available, {
          name: "Team pipeline by owner",
          datasetKey: "crm.pipeline_analysis",
          columns: ["group", "open_pipeline", "won_amount", "commit"],
          filters: { groupBy: "owner", sortBy: "open_pipeline", sortDirection: "desc", from: "2026-09-01", to: "2026-09-30" },
        }),
      );
      const output = await run(manager, definition.id);
      const lines = output.csv.replace(/^﻿/, "").trim().split("\r\n");
      assert.equal(lines[0], "Group,Open pipeline,Won,Commit");
      assert.ok(lines[1].startsWith(`RT bob,3000`), "sorted by open pipeline, largest first");
      const kpi = await kit.tenant(org.organizationId, (client) => getPipelineMetrics(client, manager, { from: "2026-09-01", to: "2026-09-30" }));
      const total = lines.slice(1).reduce((sum, line) => sum + Number(line.split(",")[1]), 0);
      assert.equal(total, kpi.metrics.open_pipeline, "report rows add up to the dashboard KPI");
      await assert.rejects(
        kit.tenant(org.organizationId, async (client) => createReportDefinition(client, manager, available, { name: "Bad", datasetKey: "crm.pipeline_analysis", filters: { groupBy: "owner", favouriteColour: "blue" } })),
        expectCode("REPORT_FILTER_UNKNOWN"),
      );
    });

    await t.test("the records behind a measure export with formula-neutralised cells", async () => {
      const available = await modules(manager);
      const records = await kit.tenant(org.organizationId, (client) => createReportDefinition(client, manager, available, { name: "Won deals", datasetKey: "crm.opportunity_records", columns: ["name", "amountReporting"], filters: { metric: "won_amount", from: "2026-09-01", to: "2026-09-30" } }));
      const output = await run(manager, records.id);
      assert.match(output.csv, /'=HYPERLINK/);
    });

    let schedule;
    await t.test("scheduling needs the schedule permission, report ownership and recipients who can run it", async () => {
      const available = await modules(manager);
      const input = { definitionId: definition.id, frequency: "weekly", weekday: 1, timeOfDay: "08:30", timezone: "Asia/Kolkata", recipients: [manny, alice] };
      await assert.rejects(kit.tenant(org.organizationId, async (client) => createReportSchedule(client, seller, await modules(seller), input, { env: ENV })), expectCode("REPORT_SCHEDULE_FORBIDDEN"));
      await assert.rejects(kit.tenant(org.organizationId, (client) => createReportSchedule(client, manager, available, { ...input, recipients: [manny, carol] }, { env: ENV })), expectCode("REPORT_SCHEDULE_RECIPIENTS_INVALID"));
      await assert.rejects(kit.tenant(org.organizationId, (client) => createReportSchedule(client, manager, available, { ...input, timezone: "Mars/Base" }, { env: ENV })), expectCode("REPORT_SCHEDULE_TIMEZONE_INVALID"));
      schedule = await kit.tenant(org.organizationId, (client) => createReportSchedule(client, manager, available, input, { env: ENV, now: new Date("2026-09-29T10:00:00Z") }));
      assert.equal(new Date(schedule.nextRunAt).toISOString(), "2026-10-05T03:00:00.000Z", "next Monday 08:30 in Kolkata");
    });

    await t.test("occurrences are time-zone aware across DST", () => {
      const ny = { frequency: "daily", timeOfDay: "09:00", timezone: "America/New_York" };
      assert.equal(nextScheduleOccurrence(ny, new Date("2026-11-01T12:00:00Z")).toISOString(), "2026-11-01T14:00:00.000Z", "after the fall-back change: UTC-5");
      assert.equal(nextScheduleOccurrence(ny, new Date("2026-10-31T12:00:00Z")).toISOString(), "2026-10-31T13:00:00.000Z", "before it: UTC-4");
      assert.equal(nextScheduleOccurrence({ frequency: "monthly", monthDay: 28, timeOfDay: "06:00", timezone: "UTC" }, new Date("2026-02-28T07:00:00Z")).toISOString(), "2026-03-28T06:00:00.000Z");
    });

    await t.test("each recipient gets their own run with their own authority; a re-run of the tick queues nothing twice", async () => {
      const due = new Date(new Date(schedule.nextRunAt).getTime() + 60_000);
      const first = await kit.tenant(org.organizationId, (client) => enqueueDueReportSchedules(client, org.organizationId, { now: due, env: ENV }));
      assert.deepEqual(first, { schedules: 1, queued: 2, skipped: 0 });
      const again = await kit.tenant(org.organizationId, (client) => enqueueDueReportSchedules(client, org.organizationId, { now: due, env: ENV }));
      assert.deepEqual(again, { schedules: 0, queued: 0, skipped: 0 }, "next_run_at moved on");
      const runs = (await kit.owner.query(`SELECT id, requested_by FROM report_runs WHERE schedule_id=$1 ORDER BY requested_by`, [schedule.id])).rows;
      assert.equal(runs.length, 2);
      for (const scheduled of runs)
        await kit.tenant(org.organizationId, (client) => executeReportRun(client, org.organizationId, { reportRunId: scheduled.id, activeCompanyId: org.companyId, activeBranchId: org.branchId }, { env: ENV, storage }));
      const aliceRun = runs.find((row) => row.requested_by === alice);
      const aliceFile = await kit.tenant(org.organizationId, (client) => readReportRunOutput(client, seller, aliceRun.id, { storage }));
      const aliceCsv = Buffer.from(aliceFile.content ?? aliceFile.bytes ?? aliceFile.body ?? "").toString("utf8");
      assert.doesNotMatch(aliceCsv, /RT bob/, "Alice's copy holds only what Alice can see, never the manager's team view");
      const deliveries = (await kit.owner.query(`SELECT recipient_user_id, status FROM report_deliveries WHERE schedule_id=$1`, [schedule.id])).rows;
      assert.deepEqual(deliveries.map((row) => row.status).sort(), ["delivered", "delivered"]);
      const notified = await kit.owner.query(`SELECT count(*)::int AS n FROM notifications WHERE organization_id=$1 AND category='report_delivered' AND user_id=$2`, [org.organizationId, alice]);
      assert.equal(notified.rows[0].n, 1);
      await assert.rejects(kit.tenant(org.organizationId, (client) => readReportRunOutput(client, session("bob", SELLER), aliceRun.id, { storage })), expectCode("REPORT_RUN_NOT_FOUND"));
    });

    await t.test("a recipient who lost access is skipped with a reason, never sent data", async () => {
      await kit.owner.query(`DELETE FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2`, [org.organizationId, alice]);
      const current = (await kit.owner.query(`SELECT next_run_at FROM report_schedules WHERE id=$1`, [schedule.id])).rows[0];
      const due = new Date(new Date(current.next_run_at).getTime() + 60_000);
      const result = await kit.tenant(org.organizationId, (client) => enqueueDueReportSchedules(client, org.organizationId, { now: due, env: ENV }));
      assert.deepEqual(result, { schedules: 1, queued: 1, skipped: 1 });
      const skipped = (await kit.owner.query(`SELECT reason FROM report_deliveries WHERE schedule_id=$1 AND recipient_user_id=$2 AND status='skipped'`, [schedule.id, alice])).rows[0];
      assert.match(skipped.reason, /permission|access/i);
      await fx.crmRole([alice], SELLER);
    });

    await t.test("pause, resume and cancel are owner-only and audited; listings show deliveries", async () => {
      await assert.rejects(kit.tenant(org.organizationId, (client) => setReportScheduleStatus(client, seller, schedule.id, "paused")), expectCode("REPORT_SCHEDULE_NOT_FOUND"));
      const paused = await kit.tenant(org.organizationId, (client) => setReportScheduleStatus(client, manager, schedule.id, "paused"));
      assert.equal(paused.nextRunAt, null);
      const resumed = await kit.tenant(org.organizationId, (client) => setReportScheduleStatus(client, manager, schedule.id, "active"));
      assert.ok(resumed.nextRunAt);
      const received = await kit.tenant(org.organizationId, (client) => listReportSchedules(client, seller));
      assert.equal(received.length, 1, "a recipient sees the schedule");
      assert.ok(received[0].deliveries.every((delivery) => delivery.recipientUserId === alice), "and only their own deliveries");
      await kit.tenant(org.organizationId, (client) => setReportScheduleStatus(client, manager, schedule.id, "cancelled"));
      const audits = await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND event_type LIKE 'report.schedule_%'`, [org.organizationId]);
      assert.ok(audits.rows[0].n >= 4);
    });
  } finally {
    await kit.close();
  }
});

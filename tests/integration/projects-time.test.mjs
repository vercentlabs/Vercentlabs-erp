// Real PostgreSQL integration test -- time (F209-F210): entries logged by the team into weekly timesheets with
// a governed approval.
import assert from "node:assert/strict";
import test from "node:test";

import { MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, pmo2: PMO, dev1: MEMBER, dev2: MEMBER, outsider: MEMBER, lead: [...MEMBER, "projects.time.approve"] };

test("Project time and timesheets against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjtc");
  const { api, run, denied, sql, users } = w;
  const ids = {};
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const mondayOfToday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  try {
    const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Field service", customerId: w.customerId, projectManagerId: users.pm, plannedStartDate: "2026-01-05" }));
    ids.p = p.id;
    await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.dev1, roleName: "Engineer", allocationPercent: 50 }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    const early = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 2 })).catch((e) => e);
    assert.equal(early.code, "PROJECT_NOT_ACTIVE", "time is only logged against an active project");
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));
    const leaf = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Install", billable: true, assigneeUserId: users.dev1, estimatedHours: 20 }));
    const summary = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Phase" }));
    await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Child", parentTaskId: summary.id }));
    ids.leaf = leaf.id; ids.summary = summary.id;

    await t.test("F210: time is logged by team members only and respects the day cap and summary tasks", async () => {
      await denied("outsider", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 }), 404);
      const notMember = await run("dev2", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(notMember.status, 404, "a non-member cannot even see the project");
      const e1 = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, taskId: leaf.id, workDate: day(1), hours: 6, description: "Site install" }));
      assert.equal(e1.status, "draft");
      const future = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: "2999-01-01", hours: 1 })).catch((e) => e);
      assert.equal(future.status, 400);
      const summaryTask = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, taskId: summary.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(summaryTask.code, "PROJECT_TASK_SUMMARY");
      const cap = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 20 })).catch((e) => e);
      assert.equal(cap.code, "PROJECT_DAY_EXCEEDED", "6 + 20 hours would exceed 24 on the day");
      const zero = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 0 })).catch((e) => e);
      assert.equal(zero.status, 400);
      ids.entry = e1.id;
    });

    await t.test("F210: a week is submitted, approved by someone else, and approved time is locked", async () => {
      const week = mondayOfToday();
      const sheet = await run("dev1", (c, x) => api.submitTimesheet(c, x, { weekStart: day(1) }));
      assert.equal(sheet.status, "submitted");
      assert.ok(Number(sheet.total_hours) >= 6);
      const locked = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(locked.code, "PROJECT_TIMESHEET_LOCKED", "a submitted week takes no new time");
      const edit = await run("dev1", (c, x) => api.updateTimeEntryRecord(c, x, ids.entry, { hours: 7 })).catch((e) => e);
      assert.equal(edit.code, "PROJECT_LOCKED");
      await denied("dev1", (c, x) => api.reviewTimesheet(c, x, sheet.id, true), 403);
      const reject = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, false, "")).catch((e) => e);
      assert.equal(reject.status, 400, "a rejection needs a reason");
      const rejected = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, false, "Wrong task"));
      assert.equal(rejected.status, "rejected");
      const fixed = await run("dev1", (c, x) => api.updateTimeEntryRecord(c, x, ids.entry, { hours: 7 }));
      assert.equal(Number(fixed.hours), 7, "a rejected entry can be corrected");
      await run("dev1", (c, x) => api.submitTimesheet(c, x, { weekStart: day(1) }));
      const again = await run("pmo", (c, x) => api.listTimesheets(c, x, { status: "submitted" }));
      assert.ok(again.length >= 1);
      const approved = await run("pmo", (c, x) => api.reviewTimesheet(c, x, again[0].id, true));
      assert.equal(approved.status, "approved");
      const [row] = await sql(`SELECT status FROM tenant.project_time_entries WHERE id=$1`, [ids.entry]);
      assert.equal(row.status, "approved");
      const del = await run("dev1", (c, x) => api.deleteTimeEntryRecord(c, x, ids.entry)).catch((e) => e);
      assert.equal(del.code, "PROJECT_LOCKED");
      const reopened = await run("pmo", (c, x) => api.reopenApprovedTime(c, x, ids.entry, "Hours were 6.5"));
      assert.equal(reopened.ok, true);
      void week;
    });

    await t.test("F210: an approver cannot approve their own timesheet", async () => {
      await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.lead, roleName: "Lead", allocationPercent: 10, costRate: 300, billRate: 0 }));
      await run("lead", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(3), hours: 2 }));
      const sheet = await run("lead", (c, x) => api.submitTimesheet(c, x, { weekStart: day(3) }));
      const self = await run("lead", (c, x) => api.reviewTimesheet(c, x, sheet.id, true)).catch((e) => e);
      assert.equal(self.code, "SELF_APPROVAL_BLOCKED");
      const other = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, true));
      assert.equal(other.status, "approved");
    });

  } finally {
    await w.cleanup();
    await admin.end();
  }
});

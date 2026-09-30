// Real PostgreSQL integration test -- project setup (F193-F195, F202-F204): types, the lifecycle with approval
// and close checks, the team with allocation conflicts, and scoped visibility.
import assert from "node:assert/strict";
import test from "node:test";

import { MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, dev1: MEMBER, dev2: MEMBER, outsider: ["projects.view"] };

test("Project setup, lifecycle and team against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjst");
  const { api, run, denied, sql, users } = w;
  const ids = {};

  try {

    await t.test("F194/F195: an internal project cannot have a customer; a customer project carries one", async () => {
      await denied("dev1", (c, x) => api.createProjectRecord(c, x, { name: "x" }), 403);
      const internalWithCustomer = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Internal", projectType: "internal", customerId: w.customerId })).catch((e) => e);
      assert.equal(internalWithCustomer.status, 400);
      const internal = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Office move", projectType: "internal", projectManagerId: users.pm, plannedStartDate: "2026-02-02", plannedEndDate: "2026-03-30" }));
      assert.equal(internal.customer_id, null);
      ids.internal = internal.id;
      const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "ERP rollout", customerId: w.customerId, plannedStartDate: "2026-03-02", projectManagerId: users.pm }));
      assert.equal(p.status, "draft");
      assert.equal(p.customer_id, w.customerId);
      ids.p = p.id;
      const design = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Design" }));
      await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Wireframes", parentTaskId: design.id }));
      await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Build" }));
      const wbs = await run("pm", (c, x) => api.getProjectWbs(c, x, p.id));
      assert.equal(wbs.taskCount, 3);
      assert.deepEqual(wbs.tree.map((n) => n.wbs_code), ["1", "2"]);
      assert.equal(wbs.tree[0].children[0].wbs_code, "1.1", "the sub-task is numbered under its parent");
    });

    await t.test("F204: approval needs someone other than the creator, and a project cannot start unapproved", async () => {
      await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "plan"));
      const early = await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "activate")).catch((e) => e);
      assert.equal(early.code, "PROJECT_NOT_APPROVED");
      await denied("pm", (c, x) => api.approveProjectRecord(c, x, ids.p), 403);
      await run("pmo", (c, x) => api.approveProjectRecord(c, x, ids.p));
      const active = await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "activate"));
      assert.equal(active.status, "active");
      assert.ok(active.actual_start_date);
      const noReason = await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "hold", {})).catch((e) => e);
      assert.equal(noReason.status, 400, "holding needs a reason");
      await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "hold", { reason: "Waiting for customer data" }));
      const resumed = await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p, "resume"));
      assert.equal(resumed.status, "active");
      await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.internal, "plan"));
    });

    await t.test("F204: completion is blocked by open work; the blockers are itemised; a completed project can be reopened with a reason", async () => {
      const blockers = await run("pmo", (c, x) => api.getCloseBlockers(c, x, ids.p));
      assert.equal(blockers.canClose, false);
      assert.ok(blockers.blockers.some((b) => b.code === "open_tasks" && b.count === 3));
      const blocked = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "complete")).catch((e) => e);
      assert.equal(blocked.code, "PROJECT_CLOSE_BLOCKED");
      assert.ok(Array.isArray(blocked.details) && blocked.details.length >= 1);
      await sql(`UPDATE tenant.project_tasks SET status='done',percent_complete=100 WHERE project_id=$1`, [ids.p]);
      await sql(`UPDATE tenant.project_milestones SET status='completed' WHERE project_id=$1`, [ids.p]);
      const done = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "complete", { reason: "Delivered" }));
      assert.equal(done.status, "completed");
      assert.equal(Number(done.percent_complete), 100);
      const edit = await run("pm", (c, x) => api.updateProjectRecord(c, x, ids.p, { name: "renamed" })).catch((e) => e);
      assert.equal(edit.code, "PROJECT_CLOSED", "a completed project is frozen");
      const noWhy = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "reopen", {})).catch((e) => e);
      assert.equal(noWhy.status, 400);
      const reopened = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "reopen", { reason: "Customer found a defect" }));
      assert.equal(reopened.status, "active");
      assert.equal(reopened.reopened_count, 1);
    });

    await t.test("F202: the team carries allocation; over-allocation across projects is refused unless confirmed", async () => {
      await denied("dev1", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: users.dev1 }), 403);
      const m = await run("pm", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: users.dev1, roleName: "Developer", allocationPercent: 60, startDate: "2026-03-01", endDate: "2026-06-30" }));
      assert.equal(m.over_allocated, false);
      const p2 = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Second project", projectType: "internal", plannedStartDate: "2026-03-01" }));
      ids.p2 = p2.id;
      const over = await run("pm", (c, x) => api.saveProjectMember(c, x, p2.id, { userId: users.dev1, allocationPercent: 60, startDate: "2026-04-01", endDate: "2026-05-31" })).catch((e) => e);
      assert.equal(over.code, "PROJECT_OVER_ALLOCATED");
      const confirmed = await run("pm", (c, x) => api.saveProjectMember(c, x, p2.id, { userId: users.dev1, allocationPercent: 60, startDate: "2026-04-01", endDate: "2026-05-31", allowOverAllocation: true }));
      assert.equal(confirmed.over_allocated, true);
      const tooMuch = await run("pm", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: users.dev2, allocationPercent: 150 })).catch((e) => e);
      assert.equal(tooMuch.status, 400);
      const stranger = await run("pm", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: "00000000-0000-4000-8000-000000000000" })).catch((e) => e);
      assert.equal(stranger.status, 409, "the person must belong to the organization");
    });

    await t.test("scope: a team member sees only their own projects; an outsider sees none", async () => {
      const mine = await run("dev1", (c, x) => api.listProjectsDesk(c, x, {}));
      assert.equal(mine.length, 2, "dev1 is on both projects");
      const none = await run("outsider", (c, x) => api.listProjectsDesk(c, x, {}));
      assert.equal(none.length, 0);
      const hidden = await run("outsider", (c, x) => api.getProjectDesk(c, x, ids.p)).catch((e) => e);
      assert.equal(hidden.status, 404, "a project you are not on does not exist to you");
      const desk = await run("dev1", (c, x) => api.getProjectDesk(c, x, ids.p));
      assert.ok(desk.members.some((m) => m.user_id === users.dev1));
    });

    await t.test("F204: cancellation needs approval rights and a reason, and is refused once there are actuals", async () => {
      const p3 = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Abandoned", projectType: "internal" }));
      await denied("pm", (c, x) => api.changeProjectStatus(c, x, p3.id, "cancel", { reason: "x" }), 403);
      const noReason = await run("pmo", (c, x) => api.changeProjectStatus(c, x, p3.id, "cancel", {})).catch((e) => e);
      assert.equal(noReason.status, 400);
      const cancelled = await run("pmo", (c, x) => api.changeProjectStatus(c, x, p3.id, "cancel", { reason: "Cancelled by sponsor" }));
      assert.equal(cancelled.status, "cancelled");
      const noEdit = await run("pm", (c, x) => api.saveProjectMember(c, x, p3.id, { userId: users.dev2 })).catch((e) => e);
      assert.equal(noEdit.code, "PROJECT_CLOSED");
      await sql(`INSERT INTO tenant.project_time_entries(organization_id,company_id,project_id,user_id,work_date,hours,status) VALUES($1,$2,$3,$4,'2026-03-03',4,'approved')`, [w.orgId, w.companyId, ids.internal, users.dev1]);
      const withActuals = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.internal, "cancel", { reason: "Stopped" })).catch((e) => e);
      assert.equal(withActuals.code, "PROJECT_HAS_ACTUALS");
    });

    await t.test("settings: only settings managers change the approval and default rules", async () => {
      await denied("pm", (c, x) => api.saveProjectSettings(c, x, { requireTimeApproval: false }), 403);
      const s = await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 7.5 }));
      assert.equal(Number(s.hours_per_day), 7.5);
      const bad = await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 30 })).catch((e) => e);
      assert.equal(bad.status, 400);
      await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 8 }));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

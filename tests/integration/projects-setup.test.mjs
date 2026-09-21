// Real PostgreSQL integration test -- project setup (F193-F196, F202-F204, F208-F209): types, templates that
// instantiate a cycle-safe WBS, the lifecycle with approval and close checks, the team with allocation
// conflicts and availability, and scoped visibility.
import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLER, MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, controller: CONTROLLER, dev1: MEMBER, dev2: MEMBER, outsider: ["projects.view"] };

test("Project setup, templates, lifecycle and team against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjst");
  const { api, run, denied, sql, users } = w;
  const ids = {};

  try {
    await t.test("F196: a template refuses a dependency loop and a parent loop, and stores a valid structure", async () => {
      await denied("dev1", (c, x) => api.saveProjectTemplate(c, x, { code: "impl", name: "Implementation", items: [{ name: "x" }] }), 403);
      const loop = await run("pmo", (c, x) => api.saveProjectTemplate(c, x, { code: "bad", name: "Bad", items: [{ sequence: 1, name: "A", predecessorSequences: [2] }, { sequence: 2, name: "B", predecessorSequences: [1] }] })).catch((e) => e);
      assert.equal(loop.code, "PROJECT_TEMPLATE_CYCLE");
      const parentLoop = await run("pmo", (c, x) => api.saveProjectTemplate(c, x, { code: "bad2", name: "Bad2", items: [{ sequence: 1, name: "A", parentSequence: 2 }, { sequence: 2, name: "B", parentSequence: 1 }] })).catch((e) => e);
      assert.equal(parentLoop.code, "PROJECT_TEMPLATE_CYCLE");
      const t1 = await run("pmo", (c, x) => api.saveProjectTemplate(c, x, {
        code: "impl", name: "Implementation", projectType: "customer", billingMethod: "milestone",
        items: [
          { sequence: 1, name: "Design", durationDays: 5, estimatedHours: 40 },
          { sequence: 2, name: "Design review", parentSequence: 1, durationDays: 2, estimatedHours: 8 },
          { sequence: 3, name: "Build", offsetDays: 7, durationDays: 10, estimatedHours: 80, predecessorSequences: [1] },
          { sequence: 4, itemType: "milestone", name: "Go live", offsetDays: 21, billingPercent: 50 },
        ],
      }));
      ids.template = t1.id;
      const got = await run("pm", (c, x) => api.getProjectTemplate(c, x, t1.id));
      assert.equal(got.items.length, 4);
    });

    await t.test("F194/F195: a customer project needs a customer to bill; an internal project cannot have one; the template builds the WBS", async () => {
      await denied("dev1", (c, x) => api.createProjectRecord(c, x, { name: "x" }), 403);
      const noCustomer = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Billable", billingMethod: "fixed_price" })).catch((e) => e);
      assert.equal(noCustomer.code, "PROJECT_FIELD_REQUIRED");
      const internalWithCustomer = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Internal", projectType: "internal", customerId: w.customerId })).catch((e) => e);
      assert.equal(internalWithCustomer.status, 400);
      const internal = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Office move", projectType: "internal", contractedRevenue: 5000, plannedStartDate: "2026-02-02", plannedEndDate: "2026-03-30" }));
      assert.equal(internal.billing_method, "non_billable");
      assert.equal(internal.billable, false);
      assert.equal(Number((await sql(`SELECT contracted_revenue FROM tenant.projects WHERE id=$1`, [internal.id]))[0].contracted_revenue), 0, "an internal project earns nothing");
      ids.internal = internal.id;
      const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "ERP rollout", customerId: w.customerId, templateId: ids.template, plannedStartDate: "2026-03-02", contractedRevenue: 100000, projectManagerId: users.pm }));
      assert.equal(p.status, "draft");
      ids.p = p.id;
      const wbs = await run("pm", (c, x) => api.getProjectWbs(c, x, p.id));
      assert.equal(wbs.taskCount, 3);
      assert.deepEqual(wbs.tree.map((n) => n.wbs_code), ["1", "2"]);
      assert.equal(wbs.tree[0].children[0].wbs_code, "1.1", "the sub-task is numbered under its parent");
      const ms = await run("pm", (c, x) => api.listProjectMilestones(c, x, { projectId: p.id }));
      assert.equal(ms.length, 1);
      assert.equal(Number(ms[0].billing_amount), 50000, "the template's 50% billing milestone is priced from the contract");
      const deps = await sql(`SELECT count(*)::int AS n FROM tenant.project_task_dependencies WHERE project_id=$1`, [p.id]);
      assert.equal(deps[0].n, 1);
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

    await t.test("F202/F208: the team carries rates and allocation; over-allocation across projects is refused unless confirmed", async () => {
      await denied("dev1", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: users.dev1 }), 403);
      const m = await run("pm", (c, x) => api.saveProjectMember(c, x, ids.p, { userId: users.dev1, roleName: "Developer", allocationPercent: 60, costRate: 500, billRate: 1200, startDate: "2026-03-01", endDate: "2026-06-30" }));
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

    await t.test("F209: availability subtracts every commitment and approved leave from capacity", async () => {
      await run("pm", (c, x) => api.changeProjectStatus(c, x, ids.p2, "plan"));
      const avail = await run("pm", (c, x) => api.getResourceAvailability(c, x, { from: "2026-04-06", to: "2026-04-10" }));
      const dev = avail.rows.find((r) => r.userId === users.dev1);
      assert.equal(dev.capacityHours, 40, "five working days at 8 hours");
      assert.equal(dev.allocatedHours, 48, "60% plus 60% of 40 hours");
      assert.equal(dev.overAllocated, true);
      assert.equal(dev.projects.length, 2);
      const hr = await sql(`INSERT INTO tenant.hr_employees(organization_id,company_id,employee_number,first_name,last_name,employment_type,joining_date,status,user_id,created_by) VALUES($1,$2,'E1','D','Ev','permanent','2025-01-01','active',$3,$3) RETURNING id`, [w.orgId, w.companyId, users.dev1]);
      const type = await sql(`INSERT INTO tenant.hr_leave_types(organization_id,company_id,code,name,created_by) VALUES($1,$2,'AL','Annual',$3) RETURNING id`, [w.orgId, w.companyId, users.dev1]);
      {
        await sql(`INSERT INTO tenant.hr_leave_requests(organization_id,company_id,employee_id,leave_type_id,start_date,end_date,days,status,created_by) VALUES($1,$2,$3,$4,'2026-04-08','2026-04-09',2,'approved',$5)`, [w.orgId, w.companyId, hr[0].id, type[0].id, users.dev1]);
        const after = await run("pm", (c, x) => api.getResourceAvailability(c, x, { from: "2026-04-06", to: "2026-04-10" }));
        assert.equal(after.rows.find((r) => r.userId === users.dev1).leaveHours, 16, "two approved leave days at 8 hours");
      }
    });

    await t.test("scope: a team member sees only their own projects; an outsider sees none; rates and money are masked", async () => {
      const mine = await run("dev1", (c, x) => api.listProjectsDesk(c, x, {}));
      assert.equal(mine.length, 2, "dev1 is on both projects");
      assert.equal(mine[0].contracted_revenue, null, "a member does not see contract value");
      assert.equal(mine[0].approved_budget, null);
      const none = await run("outsider", (c, x) => api.listProjectsDesk(c, x, {}));
      assert.equal(none.length, 0);
      const hidden = await run("outsider", (c, x) => api.getProjectDesk(c, x, ids.p)).catch((e) => e);
      assert.equal(hidden.status, 404, "a project you are not on does not exist to you");
      const desk = await run("dev1", (c, x) => api.getProjectDesk(c, x, ids.p));
      assert.equal(desk.members.find((m) => m.user_id === users.dev1).bill_rate, null, "a member does not see rates");
      const pmView = await run("pm", (c, x) => api.getProjectDesk(c, x, ids.p));
      assert.equal(Number(pmView.members.find((m) => m.user_id === users.dev1).bill_rate), 1200);
      const finance = await run("controller", (c, x) => api.listProjectsDesk(c, x, {}));
      assert.equal(Number(finance.find((p) => p.id === ids.p).contracted_revenue), 100000);
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
      const s = await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 7.5, defaultBillingMethod: "time_and_material" }));
      assert.equal(Number(s.hours_per_day), 7.5);
      const bad = await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 30 })).catch((e) => e);
      assert.equal(bad.status, 400);
      await run("pmo", (c, x) => api.saveProjectSettings(c, x, { hoursPerDay: 8, defaultBillingMethod: "non_billable" }));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

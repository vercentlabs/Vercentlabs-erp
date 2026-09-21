// Real PostgreSQL integration test -- planning and delivery (F197-F201, F203, F205-F207, F228): the WBS and
// sub-tasks, cycle-safe dependencies, the task state machine behind the Kanban board, milestones, critical-path
// scheduling, the Gantt / Kanban / calendar views, progress roll-up and approved baselines.
import assert from "node:assert/strict";
import test from "node:test";

import { MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, dev1: MEMBER, dev2: MEMBER, outsider: ["projects.view"] };

test("Project planning, scheduling and baselines against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjpl");
  const { api, run, denied, sql, users } = w;
  const ids = {};
  const task = (input) => run("pm", (c, x) => api.createProjectTaskRecord(c, x, ids.p, input));

  try {
    const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Website build", projectType: "internal", plannedStartDate: "2026-03-02", plannedEndDate: "2026-06-30", projectManagerId: users.pm }));
    ids.p = p.id;
    await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.dev1, roleName: "Dev", allocationPercent: 50 }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));

    await t.test("F197/F199/F200: tasks and sub-tasks get WBS codes; assignment is limited to the team; depth and loops are bounded", async () => {
      await denied("dev1", (c, x) => api.createProjectTaskRecord(c, x, ids.p, { name: "x" }), 403);
      const design = await task({ name: "Design", estimatedHours: 20, plannedStartDate: "2026-03-02", durationDays: 3 });
      const build = await task({ name: "Build", estimatedHours: 60, plannedStartDate: "2026-03-09", durationDays: 5 });
      const homepage = await task({ name: "Homepage", parentTaskId: build.id, estimatedHours: 30, assigneeUserId: users.dev1, durationDays: 3 });
      const checkout = await task({ name: "Checkout", parentTaskId: build.id, estimatedHours: 30, durationDays: 4 });
      Object.assign(ids, { design: design.id, build: build.id, homepage: homepage.id, checkout: checkout.id });
      const wbs = await run("pm", (c, x) => api.getProjectWbs(c, x, ids.p));
      assert.deepEqual(wbs.tree.map((n) => n.wbs_code), ["1", "2"]);
      assert.deepEqual(wbs.tree[1].children.map((n) => n.wbs_code), ["2.1", "2.2"]);
      assert.equal(wbs.tree[1].rollup_hours, 60, "a summary task rolls up its sub-tasks");
      const stranger = await task({ name: "x", assigneeUserId: users.dev2 }).catch((e) => e);
      assert.equal(stranger.code, "PROJECT_ASSIGNEE_INVALID");
      const underSelf = await run("pm", (c, x) => api.updateProjectTaskRecord(c, x, ids.build, { parentTaskId: ids.homepage })).catch((e) => e);
      assert.equal(underSelf.code, "PROJECT_WBS_CYCLE", "a task cannot be moved beneath its own sub-task");
      let parent = ids.checkout;
      let deep;
      const chain = [];
      for (let i = 0; i < 10 && !deep; i += 1) {
        const r = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, ids.p, { name: `level ${i}`, parentTaskId: parent })).catch((e) => e);
        if (r.code === "PROJECT_WBS_TOO_DEEP") deep = r; else { parent = r.id; chain.push(r.id); }
      }
      assert.ok(deep, "the WBS depth is capped");
      for (const id of chain.reverse()) await run("pm", (c, x) => api.deleteProjectTask(c, x, id));
    });

    await t.test("F201: dependencies refuse loops, self-links and parent/child links, and repeat links", async () => {
      const ok = await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.design, successorTaskId: ids.homepage }));
      assert.equal(ok.dependencyType, "finish_to_start");
      await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.homepage, successorTaskId: ids.checkout, dependencyType: "finish_to_start", lagDays: 1 }));
      const loop = await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.checkout, successorTaskId: ids.design })).catch((e) => e);
      assert.equal(loop.code, "PROJECT_DEPENDENCY_CYCLE", "design -> homepage -> checkout -> design would loop");
      const self = await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.design, successorTaskId: ids.design })).catch((e) => e);
      assert.equal(self.code, "PROJECT_DEPENDENCY_CYCLE");
      const hierarchy = await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.build, successorTaskId: ids.homepage })).catch((e) => e);
      assert.equal(hierarchy.code, "PROJECT_DEPENDENCY_HIERARCHY");
      const dup = await run("pm", (c, x) => api.addProjectTaskDependency(c, x, { predecessorTaskId: ids.design, successorTaskId: ids.homepage })).catch((e) => e);
      assert.equal(dup.status, 409);
    });

    await t.test("F206: the Kanban move is a state machine; a task cannot start before its predecessor finishes, or finish before its sub-tasks", async () => {
      const blocked = await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "in_progress" })).catch((e) => e);
      assert.equal(blocked.code, "PROJECT_DEPENDENCY_OPEN");
      await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.design, { status: "in_progress" }));
      const skip = await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.design, { status: "review" }));
      assert.equal(skip.status, "review");
      const reopenTodo = await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.design, { status: "todo" })).catch((e) => e);
      assert.equal(reopenTodo.status, 409, "review cannot go back to todo");
      const done = await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.design, { status: "done" }));
      assert.equal(Number(done.percent_complete), 100);
      assert.ok(done.completed_at);
      await denied("dev2", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "in_progress" }), 404);
      const started = await run("dev1", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "in_progress" }));
      assert.equal(started.status, "in_progress", "an assignee can move their own task");
      const noReason = await run("dev1", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "blocked" })).catch((e) => e);
      assert.equal(noReason.status, 400, "blocking needs a reason");
      const blockedOk = await run("dev1", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "blocked", reason: "Waiting for brand assets" }));
      assert.equal(blockedOk.blocked_reason, "Waiting for brand assets");
      await run("dev1", (c, x) => api.changeTaskStatus(c, x, ids.homepage, { status: "in_progress" }));
      const parentEarly = await run("pm", (c, x) => api.changeTaskStatus(c, x, ids.build, { status: "done" })).catch((e) => e);
      assert.equal(parentEarly.code, "PROJECT_CHILDREN_OPEN");
      const board = await run("pm", (c, x) => api.getKanbanBoard(c, x, ids.p));
      assert.equal(board.columns.find((col) => col.status === "in_progress").tasks.length, 1);
      assert.ok(!board.columns.some((col) => col.tasks.some((tk) => tk.id === ids.build)), "summary tasks are not cards");
    });

    await t.test("F228: progress rolls up from sub-tasks weighted by estimate to the project", async () => {
      await run("dev1", (c, x) => api.setTaskProgress(c, x, ids.homepage, 50));
      let pr = await run("pm", (c, x) => api.getProjectProgress(c, x, ids.p));
      // design 100% (20h), homepage 50% (30h), checkout 0% (30h): (20*100 + 30*50 + 30*0) / 80 = 43.75
      assert.equal(pr.percentComplete, 43.75);
      const summary = await run("pm", (c, x) => api.getProjectTask(c, x, ids.build));
      assert.equal(Number(summary.task.percent_complete), 25, "the summary task follows its sub-tasks");
      const rejected = await run("pm", (c, x) => api.setTaskProgress(c, x, ids.build, 80)).catch((e) => e);
      assert.equal(rejected.status, 409, "a summary task's progress is not typed in");
      const over = await run("dev1", (c, x) => api.setTaskProgress(c, x, ids.homepage, 120)).catch((e) => e);
      assert.equal(over.status, 400);
      const report = await run("pm", (c, x) => api.saveStatusReport(c, x, ids.p, { health: "at_risk", summary: "Brand assets late" }));
      assert.equal(report.health, "at_risk");
      pr = await run("pm", (c, x) => api.getProjectProgress(c, x, ids.p));
      assert.equal(pr.project.health, "at_risk");
      assert.equal(pr.reports.length, 1);
    });

    await t.test("F198: a milestone completes only when its tasks are finished; a cancelled milestone releases its tasks", async () => {
      const m = await run("pm", (c, x) => api.saveProjectMilestone(c, x, ids.p, { name: "Beta", plannedDate: "2026-04-30" }));
      await run("pm", (c, x) => api.updateProjectTaskRecord(c, x, ids.checkout, { milestoneId: m.id }));
      const open = await run("pm", (c, x) => api.setMilestoneStatus(c, x, m.id, "complete")).catch((e) => e);
      assert.equal(open.code, "PROJECT_MILESTONE_OPEN_WORK");
      const cancelled = await run("pm", (c, x) => api.setMilestoneStatus(c, x, m.id, "cancel", { reason: "Descoped" }));
      assert.equal(cancelled.status, "cancelled");
      const [tk] = await sql(`SELECT milestone_id FROM tenant.project_tasks WHERE id=$1`, [ids.checkout]);
      assert.equal(tk.milestone_id, null);
      const m2 = await run("pm", (c, x) => api.saveProjectMilestone(c, x, ids.p, { name: "Launch", plannedDate: "2026-06-15" }));
      const done = await run("pm", (c, x) => api.setMilestoneStatus(c, x, m2.id, "complete"));
      assert.equal(done.status, "completed");
      ids.milestone = m2.id;
      const billingOnInternal = await run("pm", (c, x) => api.saveProjectMilestone(c, x, ids.p, { name: "Pay", billingTrigger: true, billingAmount: 100 })).catch((e) => e);
      assert.equal(billingOnInternal.status, 400, "an internal project has nothing to bill");
    });

    await t.test("F197/F205: critical-path scheduling honours dependency types and lags, and applies only on request", () => {
      const tasks = [
        { id: "a", task_number: "A", duration_days: 3 },
        { id: "b", task_number: "B", duration_days: 2 },
        { id: "c", task_number: "C", duration_days: 4 },
        { id: "d", task_number: "D", duration_days: 1 },
      ];
      const deps = [
        { predecessor_task_id: "a", successor_task_id: "b", dependency_type: "finish_to_start", lag_days: 0 },
        { predecessor_task_id: "a", successor_task_id: "c", dependency_type: "finish_to_start", lag_days: 1 },
        { predecessor_task_id: "b", successor_task_id: "d", dependency_type: "finish_to_start", lag_days: 0 },
        { predecessor_task_id: "c", successor_task_id: "d", dependency_type: "finish_to_start", lag_days: 0 },
      ];
      const s = api.computeSchedule({ tasks, deps, projectStart: "2026-03-02" });
      const by = Object.fromEntries(s.rows.map((r) => [r.taskNumber, r]));
      assert.equal(by.A.start, "2026-03-02");
      assert.equal(by.A.finish, "2026-03-04");
      assert.equal(by.B.start, "2026-03-05", "finish-to-start: the next working day");
      assert.equal(by.C.start, "2026-03-06", "a one-day lag pushes it out");
      assert.equal(by.D.start, "2026-03-12", "D waits for the slower path (Mon 9-Thu 12 is C's finish + 1)");
      assert.deepEqual(s.criticalPath, ["A", "C", "D"], "B has float, so it is off the critical path");
      assert.ok(by.B.floatDays > 0);
      const weekend = api.computeSchedule({ tasks: [{ id: "x", task_number: "X", duration_days: 4 }], deps: [], projectStart: "2026-03-05" });
      assert.equal(weekend.rows[0].finish, "2026-03-10", "Thursday + 4 working days skips the weekend");
      assert.throws(() => api.computeSchedule({ tasks: tasks.slice(0, 2), deps: [{ predecessor_task_id: "a", successor_task_id: "b", dependency_type: "finish_to_start", lag_days: 0 }, { predecessor_task_id: "b", successor_task_id: "a", dependency_type: "finish_to_start", lag_days: 0 }], projectStart: "2026-03-02" }), /loop/);
    });

    await t.test("F205: scheduling a real project proposes dates, applies them for a manager only, and summary tasks span their children", async () => {
      const preview = await run("dev1", (c, x) => api.scheduleProject(c, x, ids.p, {}));
      assert.ok(preview.rows.length >= 3);
      assert.equal(preview.applied, 0, "a preview changes nothing");
      await denied("dev1", (c, x) => api.scheduleProject(c, x, ids.p, { apply: true }), 403);
      const applied = await run("pm", (c, x) => api.scheduleProject(c, x, ids.p, { apply: true }));
      assert.ok(applied.applied >= 2);
      const [summary] = await sql(`SELECT planned_start_date,planned_end_date FROM tenant.project_tasks WHERE id=$1`, [ids.build]);
      const [kids] = await sql(`SELECT min(planned_start_date) AS s,max(planned_end_date) AS e FROM tenant.project_tasks WHERE parent_task_id=$1`, [ids.build]);
      assert.equal(String(summary.planned_start_date).slice(0, 10), String(kids.s).slice(0, 10));
      assert.equal(String(summary.planned_end_date).slice(0, 10), String(kids.e).slice(0, 10));
    });

    await t.test("F205-F207: the Gantt, calendar and conflict views are read over the same task state", async () => {
      const gantt = await run("pm", (c, x) => api.getGanttData(c, x, ids.p));
      assert.ok(gantt.tasks.length >= 4 && gantt.dependencies.length === 2);
      assert.ok(gantt.tasks.some((tk) => tk.critical));
      assert.equal(gantt.milestones.length, 2);
      const cal = await run("pm", (c, x) => api.getProjectCalendar(c, x, { projectId: ids.p, from: "2026-03-01", to: "2026-04-30" }));
      assert.ok(cal.tasks.length >= 2);
      const mine = await run("dev1", (c, x) => api.getProjectCalendar(c, x, { from: "2026-03-01", to: "2026-04-30" }));
      assert.ok(mine.tasks.length >= 1, "a team member's calendar covers the project they are on");
      const out = await run("outsider", (c, x) => api.getProjectCalendar(c, x, { from: "2026-03-01", to: "2026-04-30" }));
      assert.equal(out.tasks.length, 0);
      await sql(`UPDATE tenant.project_tasks SET planned_start_date='2026-03-02',planned_end_date='2026-03-03' WHERE id=$1`, [ids.checkout]);
      const conflicts = await run("pm", (c, x) => api.getScheduleConflicts(c, x, ids.p));
      assert.ok(conflicts.conflicts.some((cf) => cf.type === "dependency"), "checkout starts before homepage finishes");
    });

    await t.test("baselines: a baseline is proposed, approved by someone else, freezes the plan, and variance is reported against it", async () => {
      const none = await run("pm", (c, x) => api.getScheduleVariance(c, x, ids.p)).catch((e) => e);
      assert.equal(none.code, "PROJECT_NO_BASELINE");
      const b1 = await run("pm", (c, x) => api.createProjectBaseline(c, x, ids.p, { reason: "Initial plan" }));
      assert.equal(b1.status, "pending_approval");
      const again = await run("pm", (c, x) => api.createProjectBaseline(c, x, ids.p, {})).catch((e) => e);
      assert.equal(again.code, "PROJECT_BASELINE_PENDING");
      await denied("pm", (c, x) => api.approveProjectBaseline(c, x, b1.id), 403);
      const approved = await run("pmo", (c, x) => api.approveProjectBaseline(c, x, b1.id));
      assert.equal(approved.status, "approved");
      await sql(`UPDATE tenant.project_tasks SET planned_end_date=planned_end_date+5 WHERE id=$1`, [ids.homepage]);
      const variance = await run("pm", (c, x) => api.getScheduleVariance(c, x, ids.p));
      assert.equal(variance.baselineVersion, 1);
      assert.equal(variance.rows.find((r) => r.task_number && r.name === "Homepage").finishVarianceDays, 5);
      assert.ok(variance.slipped >= 1);
      const b2 = await run("pm", (c, x) => api.createProjectBaseline(c, x, ids.p, { reason: "Rebaseline" }));
      await run("pmo", (c, x) => api.approveProjectBaseline(c, x, b2.id));
      const list = await run("pm", (c, x) => api.listProjectBaselines(c, x, ids.p));
      assert.deepEqual(list.map((b) => b.status), ["approved", "superseded"], "the earlier baseline is superseded, never overwritten");
    });

    await t.test("F199: a task with sub-tasks or time cannot be deleted; a closed project accepts no new work", async () => {
      const inUse = await run("pm", (c, x) => api.deleteProjectTask(c, x, ids.build)).catch((e) => e);
      assert.equal(inUse.code, "PROJECT_TASK_IN_USE");
      const leaf = await task({ name: "Scratch" });
      const gone = await run("pm", (c, x) => api.deleteProjectTask(c, x, leaf.id));
      assert.equal(gone.ok, true);
      await sql(`UPDATE tenant.project_tasks SET status='done',percent_complete=100 WHERE project_id=$1`, [ids.p]);
      await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "complete", { reason: "Done" }));
      const closed = await task({ name: "Late" }).catch((e) => e);
      assert.equal(closed.code, "PROJECT_CLOSED");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

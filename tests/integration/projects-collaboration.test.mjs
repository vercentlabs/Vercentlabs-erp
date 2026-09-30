// Real PostgreSQL integration test -- comments with mentions (F227), the Projects dashboard and closing a
// project once its work is done.
import assert from "node:assert/strict";
import test from "node:test";

import { MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, dev1: MEMBER, dev2: MEMBER, outsider: MEMBER };

test("Project comments, dashboard and completion against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjcr");
  const { api, run, denied, sql, users } = w;
  const ids = {};

  try {
    const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Data migration", customerId: w.customerId, projectManagerId: users.pm, plannedStartDate: "2026-01-05", plannedEndDate: "2026-02-27" }));
    ids.p = p.id;
    for (const u of ["dev1", "dev2"]) await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users[u], roleName: "Engineer", allocationPercent: 30 }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));
    const task = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Extract", assigneeUserId: users.dev1, estimatedHours: 10 }));
    ids.task = task.id;

    await t.test("F227: comments mention only team members, are visible to the project, and are removed by the author or a manager", async () => {
      const c1 = await run("dev1", (c, x) => api.addProjectComment(c, x, { entityType: "task", entityId: ids.task, body: "Extract is 60% done", mentions: [users.pm] }));
      const badMention = await run("dev1", (c, x) => api.addProjectComment(c, x, { entityType: "task", entityId: ids.task, body: "hi", mentions: [users.outsider] })).catch((e) => e);
      assert.equal(badMention.code, "PROJECT_MENTION_INVALID");
      await denied("outsider", (c, x) => api.addProjectComment(c, x, { entityType: "task", entityId: ids.task, body: "spam" }), 404);
      const inbox = await run("pm", (c, x) => api.listMyMentions(c, x));
      assert.equal(inbox.length, 1);
      const thread = await run("dev2", (c, x) => api.listProjectComments(c, x, { entityType: "task", entityId: ids.task }));
      assert.equal(thread.length, 1);
      const noDelete = await run("dev2", (c, x) => api.deleteProjectComment(c, x, c1.id)).catch((e) => e);
      assert.equal(noDelete.status, 403);
      await run("pm", (c, x) => api.deleteProjectComment(c, x, c1.id));
      const after = await run("dev2", (c, x) => api.listProjectComments(c, x, { entityType: "task", entityId: ids.task }));
      assert.equal(after.length, 0);
      const t2 = await run("pm", (c, x) => api.getProjectTask(c, x, ids.task));
      assert.equal(t2.comments.length, 0);
    });

    await t.test("F229: the dashboard scopes to the caller", async () => {
      await sql(`UPDATE tenant.project_tasks SET planned_end_date=current_date-3 WHERE id=$1`, [ids.task]);
      const pm = await run("pm", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(pm.projectsByStatus.active, 1);
      assert.ok(pm.overdueTasks >= 1);
      const dev = await run("dev1", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(dev.myOpenTasks, 1);
      assert.equal(dev.pendingApprovals, undefined, "a team member sees no approval queue");
      const none = await run("outsider", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(none.projectsByStatus.active, undefined, "an outsider sees no projects");
      const approver = await run("pmo", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.ok(approver.pendingApprovals);
    });

    await t.test("F229: a project completes once its work is done and then accepts no new work", async () => {
      await sql(`UPDATE tenant.project_tasks SET status='done',percent_complete=100 WHERE project_id=$1`, [ids.p]);
      const done = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "complete", { reason: "Migrated" }));
      assert.equal(done.status, "completed");
      const late = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, ids.p, { name: "post-close" })).catch((e) => e);
      assert.equal(late.code, "PROJECT_CLOSED");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

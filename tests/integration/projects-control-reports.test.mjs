// Real PostgreSQL integration test -- issues, risks, documents and comments (F224-F227) and the dashboard and
// reports (F229-F230), including the permission boundaries that keep confidential documents and money out of
// reach of the wrong people.
import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLER, MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, controller: CONTROLLER, dev1: MEMBER, dev2: MEMBER, outsider: MEMBER };

test("Project issues, risks, documents, comments and reports against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjcr");
  const { api, run, denied, sql, users } = w;
  const ids = {};

  try {
    const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Data migration", customerId: w.customerId, billingMethod: "time_and_material", projectManagerId: users.pm, plannedStartDate: "2026-01-05", plannedEndDate: "2026-02-27" }));
    ids.p = p.id;
    for (const u of ["dev1", "dev2"]) await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users[u], roleName: "Engineer", allocationPercent: 30, costRate: 300, billRate: 900 }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));
    const task = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Extract", assigneeUserId: users.dev1, estimatedHours: 10 }));
    ids.task = task.id;

    await t.test("F224: team members raise issues; outsiders cannot; a resolution is required; only a manager closes", async () => {
      await denied("outsider", (c, x) => api.createProjectIssue(c, x, ids.p, { title: "x" }), 404);
      const issue = await run("dev1", (c, x) => api.createProjectIssue(c, x, ids.p, { title: "Source system times out", severity: "critical", taskId: ids.task, ownerUserId: users.dev1, dueDate: "2026-01-30" }));
      assert.equal(issue.status, "open");
      assert.match(issue.issue_number, /^ISS-/);
      ids.issue = issue.id;
      const badOwner = await run("dev1", (c, x) => api.createProjectIssue(c, x, ids.p, { title: "y", ownerUserId: users.outsider })).catch((e) => e);
      assert.equal(badOwner.code, "PROJECT_ASSIGNEE_INVALID");
      const noResolution = await run("dev1", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "resolved" })).catch((e) => e);
      assert.equal(noResolution.status, 400);
      const other = await run("dev2", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "in_progress" })).catch((e) => e);
      assert.equal(other.status, 403, "only the owner or a manager changes an issue");
      await run("dev1", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "in_progress" }));
      const blocked = await run("pmo", (c, x) => api.getCloseBlockers(c, x, ids.p));
      assert.ok(blocked.blockers.some((b) => b.code === "critical_issues"), "an unresolved critical issue blocks project close");
      await run("dev1", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "resolved", resolution: "Raised the timeout and batched the extract" }));
      const noClose = await run("dev1", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "closed" })).catch((e) => e);
      assert.equal(noClose.status, 403);
      const closed = await run("pm", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "closed" }));
      assert.equal(closed.status, "closed");
      const final = await run("pm", (c, x) => api.updateProjectIssue(c, x, issue.id, { status: "open" })).catch((e) => e);
      assert.equal(final.status, 409, "a closed issue is final");
    });

    await t.test("F225: a risk is scored probability x impact; a high risk needs an owner and mitigation; a realised risk becomes a linked issue", async () => {
      const bad = await run("dev1", (c, x) => api.createProjectRisk(c, x, ids.p, { title: "x", probability: 9, impact: 2 })).catch((e) => e);
      assert.equal(bad.status, 400);
      const risk = await run("dev1", (c, x) => api.createProjectRisk(c, x, ids.p, { title: "Customer data quality poor", probability: 4, impact: 5 }));
      assert.equal(risk.score, 20, "the score is computed, never typed");
      ids.risk = risk.id;
      const incomplete = await run("pm", (c, x) => api.updateProjectRisk(c, x, risk.id, { status: "assessed" })).catch((e) => e);
      assert.equal(incomplete.code, "PROJECT_RISK_INCOMPLETE", "a score of 20 needs an owner and a mitigation plan");
      const assessed = await run("pm", (c, x) => api.updateProjectRisk(c, x, risk.id, { status: "assessed", ownerUserId: users.dev1, mitigation: "Profile the data in week 1" }));
      assert.equal(assessed.status, "assessed");
      const rescored = await run("dev1", (c, x) => api.updateProjectRisk(c, x, risk.id, { probability: 2 }));
      assert.equal(rescored.score, 10);
      const stranger = await run("dev2", (c, x) => api.updateProjectRisk(c, x, risk.id, { title: "hijack" })).catch((e) => e);
      assert.equal(stranger.status, 403);
      const issue = await run("dev1", (c, x) => api.realizeProjectRisk(c, x, risk.id, {}));
      assert.equal(issue.risk_id, risk.id);
      assert.equal(issue.severity, "medium");
      const [row] = await sql(`SELECT status,realized_issue_id FROM tenant.project_risks WHERE id=$1`, [risk.id]);
      assert.equal(row.status, "realized");
      assert.equal(row.realized_issue_id, issue.id, "linked both ways");
      const again = await run("dev1", (c, x) => api.realizeProjectRisk(c, x, risk.id, {})).catch((e) => e);
      assert.equal(again.status, 409);
      const list = await run("pm", (c, x) => api.listProjectRisks(c, x, { projectId: ids.p }));
      assert.equal(list[0].rating, "medium");
    });

    await t.test("F226: a confidential document is invisible to team members who did not write it", async () => {
      await run("pm", (c, x) => api.addProjectDocument(c, x, ids.p, { title: "Master services agreement", documentType: "contract", referenceUrl: "https://example.test/msa.pdf", confidential: true }));
      const own = await run("dev1", (c, x) => api.addProjectDocument(c, x, ids.p, { title: "Extract runbook", documentType: "plan", confidential: true }));
      await run("dev1", (c, x) => api.addProjectDocument(c, x, ids.p, { title: "Kickoff minutes", documentType: "minutes" }));
      const forDev2 = await run("dev2", (c, x) => api.listProjectDocuments(c, x, { projectId: ids.p }));
      assert.deepEqual(forDev2.map((d) => d.title), ["Kickoff minutes"], "confidential documents are not listed for other members");
      const forDev1 = await run("dev1", (c, x) => api.listProjectDocuments(c, x, { projectId: ids.p }));
      assert.equal(forDev1.length, 2, "the author sees their own confidential document");
      const forPm = await run("pm", (c, x) => api.listProjectDocuments(c, x, { projectId: ids.p }));
      assert.equal(forPm.length, 3);
      const noDelete = await run("dev2", (c, x) => api.removeProjectDocument(c, x, own.id)).catch((e) => e);
      assert.equal(noDelete.status, 404, "an unseen document does not exist to dev2... or is forbidden");
      const removed = await run("dev1", (c, x) => api.removeProjectDocument(c, x, own.id));
      assert.equal(removed.ok, true);
    });

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

    await t.test("F229: the dashboard scopes to the caller and shows money only to those with financial rights", async () => {
      await sql(`UPDATE tenant.project_tasks SET planned_end_date=current_date-3 WHERE id=$1`, [ids.task]);
      const pm = await run("pm", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(pm.projectsByStatus.active, 1);
      assert.ok(pm.overdueTasks >= 1);
      assert.equal(pm.activeContractedRevenue, undefined, "a project manager without financial rights sees no money");
      const fin = await run("controller", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.ok(fin.activeContractedRevenue !== undefined && fin.invoiced !== undefined);
      const dev = await run("dev1", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(dev.myOpenTasks, 1);
      assert.equal(dev.pendingApprovals, undefined, "a team member sees no approval queue");
      const none = await run("outsider", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.equal(none.projectsByStatus.active, undefined, "an outsider sees no projects");
      const approver = await run("pmo", (c, x) => api.getProjectsDeskDashboard(c, x));
      assert.ok(approver.pendingApprovals);
    });

    await t.test("F230: reports respect their permission, and the portfolio hides money without financial rights", async () => {
      await denied("dev1", (c, x) => api.getProjectReport(c, x, "portfolio", {}), 403);
      const missing = await run("pmo", (c, x) => api.getProjectReport(c, x, "nope", {})).catch((e) => e);
      assert.equal(missing.status, 404);
      const pf = await run("pmo", (c, x) => api.getProjectReport(c, x, "portfolio", {}));
      assert.equal(pf.rows.length, 1);
      const financial = await run("controller", (c, x) => api.getProjectReport(c, x, "portfolio", {}));
      assert.ok("actual_cost" in financial.rows[0] && "margin" in financial.rows[0]);
      assert.ok("actual_cost" in pf.rows[0], "an approver holds financial rights");
      const memberPortfolio = await run("pm", (c, x) => api.getProjectReport(c, x, "portfolio", {})).catch((e) => e);
      assert.equal(memberPortfolio.status, 403, "a manager without reports.view cannot run the portfolio report");
      const overdue = await run("pmo", (c, x) => api.getProjectReport(c, x, "overdue-work", {}));
      assert.equal(overdue.rows.length, 1);
      const risks = await run("pmo", (c, x) => api.getProjectReport(c, x, "risk-register", {}));
      assert.ok(Array.isArray(risks.rows));
      const util = await run("pmo", (c, x) => api.getProjectReport(c, x, "utilization", { from: "2026-01-05", to: "2026-01-09" }));
      assert.equal(util.capacityHours, 40);
      await denied("controller", (c, x) => api.getProjectReport(c, x, "audit-trail", {}), 403);
      const audit = await run("pmo", (c, x) => api.getProjectReport(c, x, "audit-trail", {}));
      assert.ok(audit.rows.some((r) => r.event_type === "project.created"));
    });

    await t.test("F229: a project completes only when critical issues are resolved and everything is approved", async () => {
      await sql(`UPDATE tenant.project_tasks SET status='done',percent_complete=100 WHERE project_id=$1`, [ids.p]);
      const done = await run("pmo", (c, x) => api.changeProjectStatus(c, x, ids.p, "complete", { reason: "Migrated" }));
      assert.equal(done.status, "completed");
      const late = await run("dev1", (c, x) => api.createProjectIssue(c, x, ids.p, { title: "post-close" })).catch((e) => e);
      assert.equal(late.code, "PROJECT_CLOSED");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

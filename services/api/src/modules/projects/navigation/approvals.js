// Projects — the central Approvals queue. One place where a person sees every decision waiting for them across Projects: task reviews,
// milestone approvals and customer acceptance, timesheets, expenses, project approval, billing requests and cost budgets. It keeps no
// approval state of its own: each queue is read through its owning workflow, with that workflow's permissions and visibility, and each row
// opens the record where the decision is made. A queue the person may not act on is simply absent.
import { has, userNames, visibilitySql } from "../project-core.js";
import { listTaskQueue } from "../project-task-read.js";
import { listMilestoneQueue } from "../project-milestone-read.js";
import { getTimesheetApprovalQueue } from "../timesheets/time-read.js";
import { listProjectExpenses } from "../expenses/expense-read.js";

const DENIED = new Set([401, 403]);
// A queue read through its owner; a refusal means the person has no part in that queue.
async function readQueue(client, read) {
  await client.query("SAVEPOINT approvals_queue");
  try { const rows = await read(); await client.query("RELEASE SAVEPOINT approvals_queue"); return rows; }
  catch (failure) {
    await client.query("ROLLBACK TO SAVEPOINT approvals_queue");
    if (DENIED.has(failure?.status ?? failure?.statusCode)) return null;
    throw failure;
  }
}
const waited = (at) => (at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 864e5)) : null);

export async function getProjectApprovals(client, c) {
  const queues = [];
  const push = (key, label, rows) => { if (rows) queues.push({ key, label, count: rows.length, rows: rows.slice(0, 100) }); };
  push("task-reviews", "Task reviews", await readQueue(client, async () => (await listTaskQueue(client, c, { view: "my_reviews", pageSize: 200 })).rows.map((row) => ({
    id: row.id, title: `${row.code} · ${row.title}`, project: row.projectCode ?? null, projectId: row.projectId, by: row.assignee, since: row.updatedAt, waitingDays: waited(row.updatedAt), href: `/projects/tasks/${row.id}` }))));
  push("milestone-reviews", "Milestone approvals", await readQueue(client, async () => (await listMilestoneQueue(client, c, { view: "pending_approval", pageSize: 200 })).rows.map((row) => ({
    id: row.id, title: `${row.code} · ${row.name}`, project: row.projectCode ?? null, projectId: row.projectId, by: row.owner, since: null, waitingDays: null, href: `/projects/milestones/${row.id}` }))));
  push("customer-acceptance", "Customer acceptance", await readQueue(client, async () => (await listMilestoneQueue(client, c, { view: "pending_customer", pageSize: 200 })).rows.map((row) => ({
    id: row.id, title: `${row.code} · ${row.name}`, project: row.projectCode ?? null, projectId: row.projectId, by: row.owner, since: null, waitingDays: null, href: `/projects/milestones/${row.id}` }))));
  push("timesheets", "Timesheet approvals", await readQueue(client, async () => (await getTimesheetApprovalQueue(client, c, {})).rows.map((row) => ({
    id: row.id, title: `${row.number} · ${row.employee ?? "Former user"} · week of ${row.weekStart} · ${row.total}`, project: row.project, projectId: row.projectId, by: row.employee,
    since: row.submittedAt, waitingDays: row.waitingDays, href: `/projects/timesheets/${row.id}` }))));
  push("expenses", "Expense approvals", await readQueue(client, async () => (await listProjectExpenses(client, c, { view: "approvals", pageSize: 200 })).items.map((row) => ({
    id: row.id, title: `${row.code ?? "Expense"} · ${row.description ?? row.category ?? ""}`, project: row.projectCode ?? null, projectId: row.projectId ?? null, by: row.claimant ?? null,
    since: row.submittedAt ?? null, waitingDays: waited(row.submittedAt), href: `/projects/expenses/${row.id}` }))));
  if (has(c, "projects.expenses.finance_review")) push("expense-finance", "Expense finance review", await readQueue(client, async () => (await listProjectExpenses(client, c, { view: "finance", pageSize: 200 })).items.map((row) => ({
    id: row.id, title: `${row.code ?? "Expense"} · ${row.description ?? row.category ?? ""}`, project: row.projectCode ?? null, projectId: row.projectId ?? null, by: row.claimant ?? null,
    since: row.approvedAt ?? null, waitingDays: waited(row.approvedAt), href: `/projects/expenses/${row.id}` }))));
  if (has(c, "projects.approve")) {
    const rows = (await client.query(`SELECT project.id, project.project_code, project.name, project.approval_requested_by, project.approval_requested_at FROM tenant.projects project
        WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.approval_status = 'PENDING' AND project.approval_requested_by IS DISTINCT FROM $2 AND ${visibilitySql(c, "project", "$2")}
        ORDER BY project.approval_requested_at LIMIT 200`, [c.organizationId, c.userId ?? null])).rows;
    const names = await userNames(client, rows.map((row) => row.approval_requested_by));
    push("project-approvals", "Project approvals", rows.map((row) => ({ id: row.id, title: `${row.project_code} · ${row.name ?? "Untitled draft"}`, project: row.project_code, projectId: row.id,
      by: names.get(row.approval_requested_by) ?? null, since: row.approval_requested_at, waitingDays: waited(row.approval_requested_at), href: `/projects/${row.id}` })));
  }
  if (has(c, "projects.time.billing_approve")) {
    const rows = (await client.query(`SELECT request.id, request.request_number, request.created_by, request.created_at, request.total_minutes, project.project_code, project.id AS project_id
        FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
       WHERE request.organization_id = $1 AND request.status = 'DRAFT' AND request.created_by IS DISTINCT FROM $2 AND project.deleted_at IS NULL ORDER BY request.created_at LIMIT 200`, [c.organizationId, c.userId ?? null])).rows;
    const names = await userNames(client, rows.map((row) => row.created_by));
    push("billing", "Billing requests to authorize", rows.map((row) => ({ id: row.id, title: `BR-${row.request_number} · ${Math.round(row.total_minutes / 6) / 10} h`, project: row.project_code, projectId: row.project_id,
      by: names.get(row.created_by) ?? null, since: row.created_at, waitingDays: waited(row.created_at), href: `/projects/timesheets/billing/${row.id}` })));
  }
  if (has(c, "projects.cost.approve_allocation")) {
    const rows = (await client.query(`SELECT budget.id, budget.version, budget.total_amount, budget.proposed_by, budget.proposed_at, project.project_code, project.id AS project_id
        FROM tenant.project_cost_budgets budget JOIN tenant.projects project ON project.id = budget.project_id
       WHERE budget.organization_id = $1 AND budget.status = 'PROPOSED' AND budget.proposed_by IS DISTINCT FROM $2 AND project.deleted_at IS NULL ORDER BY budget.proposed_at LIMIT 200`, [c.organizationId, c.userId ?? null])).rows;
    const names = await userNames(client, rows.map((row) => row.proposed_by));
    push("budgets", "Cost budgets to approve", rows.map((row) => ({ id: row.id, title: `Budget v${row.version} · ${String(row.total_amount)}`, project: row.project_code, projectId: row.project_id,
      by: names.get(row.proposed_by) ?? null, since: row.proposed_at, waitingDays: waited(row.proposed_at), href: `/projects/${row.project_id}?tab=financials&section=budget` })));
  }
  return { queues, total: queues.reduce((sum, queue) => sum + queue.count, 0) };
}

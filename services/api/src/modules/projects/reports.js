// Project intelligence (F229, F230): the dashboard and a set of reports that reconcile to source records.
// A person holding only view/time/expense rights sees only the projects they belong to, and no financial
// figure appears unless the caller holds a financial permission.
import { computeActuals } from "./finance.js";
import { canSeeFinance, dateOrNull, fromCents, has, isBroad, need, needAny, ProjectError, qx, today, addDays, workingDaysBetween, loadSettings } from "./common.js";

function scope(c, values, alias = "p") {
  if (isBroad(c)) return "";
  values.push(c.userId);
  return ` AND (${alias}.project_manager_id=$${values.length} OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=${alias}.id AND m.user_id=$${values.length} AND m.active=true))`;
}

export async function getProjectsDeskDashboard(client, c) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const projects = await client.query(`SELECT p.status,p.health,count(*)::int AS n,count(*) FILTER (WHERE p.status IN ('planned','active') AND p.planned_end_date<current_date)::int AS overdue FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2${s} GROUP BY p.status,p.health`, values);
  const byStatus = {}; const byHealth = {}; let overdueProjects = 0;
  for (const r of projects.rows) { byStatus[r.status] = (byStatus[r.status] || 0) + r.n; if (["planned", "active", "on_hold"].includes(r.status)) byHealth[r.health] = (byHealth[r.health] || 0) + r.n; overdueProjects += r.overdue; }
  const tv = [c.organizationId, c.companyId, c.userId];
  const mine = await client.query(`SELECT count(*) FILTER (WHERE t.status NOT IN ('done','cancelled'))::int AS open,count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date)::int AS overdue FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.assignee_user_id=$3`, tv);
  const v2 = [c.organizationId, c.companyId];
  const s2 = scope(c, v2);
  const work = await client.query(`SELECT count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date)::int AS overdue_tasks,count(*) FILTER (WHERE t.status='blocked')::int AS blocked_tasks FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2${s2}`, v2);
  const v3 = [c.organizationId, c.companyId];
  const s3 = scope(c, v3);
  const control = await client.query(`SELECT (SELECT count(*) FROM tenant.project_issues i JOIN tenant.projects p ON p.id=i.project_id WHERE i.organization_id=$1 AND i.company_id=$2 AND i.status IN ('open','in_progress')${s3})::int AS open_issues,(SELECT count(*) FROM tenant.project_issues i JOIN tenant.projects p ON p.id=i.project_id WHERE i.organization_id=$1 AND i.company_id=$2 AND i.status IN ('open','in_progress') AND i.severity IN ('critical','high')${s3})::int AS serious_issues,(SELECT count(*) FROM tenant.project_risks r JOIN tenant.projects p ON p.id=r.project_id WHERE r.organization_id=$1 AND r.company_id=$2 AND r.status IN ('identified','assessed','mitigating') AND r.score>=15${s3})::int AS high_risks`, v3);
  const w0 = work.rows[0]; const c0 = control.rows[0];
  const out = { projectsByStatus: byStatus, activeByHealth: byHealth, overdueProjects, myOpenTasks: mine.rows[0].open, myOverdueTasks: mine.rows[0].overdue, overdueTasks: w0.overdue_tasks, blockedTasks: w0.blocked_tasks, openIssues: c0.open_issues, seriousIssues: c0.serious_issues, highRisks: c0.high_risks };
  if (has(c, "projects.time.approve") || isBroad(c)) {
    const a = await client.query(`SELECT (SELECT count(*) FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND status='submitted')::int AS timesheets,(SELECT count(*) FROM tenant.project_expenses WHERE organization_id=$1 AND company_id=$2 AND status='submitted')::int AS expenses,(SELECT count(*) FROM tenant.project_budgets WHERE organization_id=$1 AND company_id=$2 AND status='pending_approval')::int AS budgets,(SELECT count(*) FROM tenant.project_baselines WHERE organization_id=$1 AND company_id=$2 AND status='pending_approval')::int AS baselines,(SELECT count(*) FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2 AND status='ready')::int AS billing`, [c.organizationId, c.companyId]);
    out.pendingApprovals = a.rows[0];
  }
  const v4 = [c.organizationId, c.companyId];
  const s4 = scope(c, v4);
  const upcoming = await qx(client, `SELECT m.id,m.name,m.planned_date,p.project_number FROM tenant.project_milestones m JOIN tenant.projects p ON p.id=m.project_id WHERE m.organization_id=$1 AND p.company_id=$2 AND m.status IN ('planned','in_progress') AND m.planned_date BETWEEN current_date AND current_date+14${s4} ORDER BY m.planned_date LIMIT 10`, v4);
  out.upcomingMilestones = upcoming.rows;
  if (canSeeFinance(c)) {
    const v5 = [c.organizationId, c.companyId];
    const f = await client.query(`SELECT COALESCE(sum(p.contracted_revenue),0)::text AS contracted,COALESCE(sum(p.approved_budget),0)::text AS budget FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2 AND p.status IN ('planned','active','on_hold')`, v5);
    const b = await client.query(`SELECT COALESCE(sum(amount) FILTER (WHERE status='invoiced'),0)::text AS invoiced,COALESCE(sum(amount) FILTER (WHERE status IN ('ready','requested')),0)::text AS queued FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2`, v5);
    out.activeContractedRevenue = f.rows[0].contracted; out.activeBudget = f.rows[0].budget; out.invoiced = b.rows[0].invoiced; out.queuedForBilling = b.rows[0].queued;
  }
  return out;
}

const needFinance = (c) => needAny(c, ["projects.profitability.view", "projects.budget.manage", "projects.billing.manage", "projects.approve"]);

async function portfolio(client, c, f) {
  need(c, "projects.reports.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  let where = "";
  if (f.status) { values.push(String(f.status)); where += ` AND p.status=$${values.length}`; }
  const res = await qx(client, `SELECT p.id,p.project_number,p.name,p.status,p.health,p.project_type,p.billing_method,p.percent_complete,p.planned_start_date,p.planned_end_date,u.full_name AS manager_name FROM tenant.projects p LEFT JOIN public.users u ON u.id=p.project_manager_id WHERE p.organization_id=$1 AND p.company_id=$2${s}${where} ORDER BY p.project_number`, values);
  if (!canSeeFinance(c)) return { rows: res.rows };
  const rows = [];
  for (const r of res.rows) {
    const p = (await qx(client, `SELECT * FROM tenant.projects WHERE id=$1`, [r.id])).rows[0];
    const a = await computeActuals(client, c, p);
    rows.push({ ...r, contracted_revenue: p.contracted_revenue, approved_budget: p.approved_budget, actual_cost: fromCents(a.totalCost), recognized_revenue: fromCents(a.recognizedRevenue), margin: fromCents(a.recognizedRevenue - a.totalCost) });
  }
  return { rows };
}

async function scheduleVariance(client, c) {
  need(c, "projects.reports.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const res = await qx(client, `SELECT p.project_number,t.task_number,t.name,t.baseline_end,t.planned_end_date,(t.planned_end_date-t.baseline_end) AS slip_days,t.status FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.baseline_end IS NOT NULL AND t.planned_end_date>t.baseline_end AND t.status NOT IN ('done','cancelled')${s} ORDER BY (t.planned_end_date-t.baseline_end) DESC LIMIT 300`, values);
  return { rows: res.rows };
}

async function timeByProject(client, c, f) {
  need(c, "projects.reports.view");
  const from = dateOrNull(f.from, "From"); const to = dateOrNull(f.to, "To");
  const values = [c.organizationId, c.companyId, from, to];
  const s = scope(c, values);
  const res = await qx(client, `SELECT p.project_number,p.name,u.full_name AS person,sum(e.hours)::float AS hours,sum(e.hours) FILTER (WHERE e.billable)::float AS billable_hours,sum(e.hours) FILTER (WHERE e.status='approved')::float AS approved_hours FROM tenant.project_time_entries e JOIN tenant.projects p ON p.id=e.project_id LEFT JOIN public.users u ON u.id=e.user_id WHERE e.organization_id=$1 AND e.company_id=$2 AND ($3::date IS NULL OR e.work_date>=$3) AND ($4::date IS NULL OR e.work_date<=$4) AND e.status<>'rejected'${s} GROUP BY p.project_number,p.name,u.full_name ORDER BY p.project_number,u.full_name`, values);
  return { rows: res.rows };
}

async function utilization(client, c, f) {
  needAny(c, ["projects.resources.manage", "projects.reports.view"]);
  const from = dateOrNull(f.from, "From") || addDays(today(), -28);
  const to = dateOrNull(f.to, "To") || today();
  const settings = await loadSettings(client, c);
  const capacityPerPerson = workingDaysBetween(from, to) * Number(settings.hours_per_day);
  const res = await qx(client, `SELECT e.user_id,u.full_name AS person,sum(e.hours)::float AS logged,sum(e.hours) FILTER (WHERE e.billable)::float AS billable FROM tenant.project_time_entries e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.organization_id=$1 AND e.company_id=$2 AND e.work_date BETWEEN $3::date AND $4::date AND e.status IN ('submitted','approved') GROUP BY e.user_id,u.full_name ORDER BY u.full_name`, [c.organizationId, c.companyId, from, to]);
  return { from, to, capacityHours: capacityPerPerson, rows: res.rows.map((r) => ({ ...r, billable: r.billable ?? 0, utilizationPercent: capacityPerPerson > 0 ? Math.round((r.logged / capacityPerPerson) * 1000) / 10 : 0, billablePercent: r.logged > 0 ? Math.round(((r.billable ?? 0) / r.logged) * 1000) / 10 : 0 })) };
}

async function budgetVsActual(client, c) {
  needFinance(c);
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const projects = await qx(client, `SELECT p.* FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2 AND p.status IN ('planned','active','on_hold','completed')${s} ORDER BY p.project_number`, values);
  const rows = [];
  for (const p of projects.rows) {
    const a = await computeActuals(client, c, p);
    const b = (await qx(client, `SELECT (labor_budget+expense_budget+procurement_budget+contingency_budget)::text AS total FROM tenant.project_budgets WHERE project_id=$1 AND status='active'`, [p.id])).rows[0];
    const budget = b ? b.total : p.approved_budget;
    const bc = BigInt(Math.round(Number(budget) * 100));
    rows.push({ project_number: p.project_number, name: p.name, budget, actual: fromCents(a.totalCost), committed: fromCents(a.outstandingCommitment), variance: fromCents(bc - a.totalCost), over_budget: bc > 0n && a.totalCost > bc });
  }
  return { rows };
}

async function billingStatus(client, c) {
  needAny(c, ["projects.billing.manage", "projects.profitability.view", "projects.approve", "projects.reports.view"]);
  const byStatus = await qx(client, `SELECT status,count(*)::int AS lines,COALESCE(sum(amount),0)::text AS amount FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2 GROUP BY status ORDER BY status`, [c.organizationId, c.companyId]);
  const wip = await qx(client, `SELECT p.project_number,p.name,COALESCE((SELECT sum(e.hours*e.bill_rate) FROM tenant.project_time_entries e WHERE e.project_id=p.id AND e.status='approved' AND e.billable AND e.billed_billing_id IS NULL),0)::text AS unbilled_time,COALESCE((SELECT sum(x.base_amount) FROM tenant.project_expenses x WHERE x.project_id=p.id AND x.status IN ('approved','reimbursed') AND x.billable AND x.billed_billing_id IS NULL),0)::text AS unbilled_expenses FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2 AND p.billing_method='time_and_material' AND p.status IN ('active','on_hold','completed') ORDER BY p.project_number`, [c.organizationId, c.companyId]);
  return { byStatus: byStatus.rows, unbilledWork: wip.rows };
}

async function riskRegister(client, c) {
  need(c, "projects.reports.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const res = await qx(client, `SELECT p.project_number,r.risk_number,r.title,r.probability,r.impact,r.score,r.status,u.full_name AS owner,r.review_date FROM tenant.project_risks r JOIN tenant.projects p ON p.id=r.project_id LEFT JOIN public.users u ON u.id=r.owner_user_id WHERE r.organization_id=$1 AND r.company_id=$2 AND r.status IN ('identified','assessed','mitigating')${s} ORDER BY r.score DESC,r.review_date NULLS LAST LIMIT 300`, values);
  return { rows: res.rows };
}

async function expenseSummary(client, c, f) {
  need(c, "projects.reports.view");
  const from = dateOrNull(f.from, "From"); const to = dateOrNull(f.to, "To");
  const values = [c.organizationId, c.companyId, from, to];
  const s = scope(c, values);
  const res = await qx(client, `SELECT x.category,count(*)::int AS expenses,sum(x.base_amount)::text AS amount,sum(x.base_amount) FILTER (WHERE x.status IN ('approved','reimbursed'))::text AS approved FROM tenant.project_expenses x JOIN tenant.projects p ON p.id=x.project_id WHERE x.organization_id=$1 AND x.company_id=$2 AND ($3::date IS NULL OR x.expense_date>=$3) AND ($4::date IS NULL OR x.expense_date<=$4) AND x.status<>'rejected'${s} GROUP BY x.category ORDER BY sum(x.base_amount) DESC`, values);
  return { rows: res.rows };
}

async function overdueWork(client, c) {
  need(c, "projects.reports.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const res = await qx(client, `SELECT p.project_number,t.task_number,t.name,t.planned_end_date,(current_date-t.planned_end_date) AS days_overdue,t.status,u.full_name AS assignee FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id LEFT JOIN public.users u ON u.id=t.assignee_user_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date${s} ORDER BY (current_date-t.planned_end_date) DESC LIMIT 300`, values);
  return { rows: res.rows };
}

async function auditTrail(client, c, f) {
  need(c, "projects.audit.view");
  const from = dateOrNull(f.from, "From"); const to = dateOrNull(f.to, "To");
  const res = await qx(client, `SELECT ev.occurred_at,ev.aggregate_type,ev.event_type,ev.payload,u.full_name AS actor FROM tenant.project_events ev LEFT JOIN public.users u ON u.id=ev.actor_user_id WHERE ev.organization_id=$1 AND ev.company_id=$2 AND ($3::date IS NULL OR ev.occurred_at::date>=$3) AND ($4::date IS NULL OR ev.occurred_at::date<=$4) ORDER BY ev.occurred_at DESC LIMIT 500`, [c.organizationId, c.companyId, from, to]);
  return { rows: res.rows };
}

const REPORTS = { portfolio, "schedule-variance": scheduleVariance, "time-by-project": timeByProject, utilization, "budget-vs-actual": budgetVsActual, "billing-status": billingStatus, "risk-register": riskRegister, "expense-summary": expenseSummary, "overdue-work": overdueWork, "audit-trail": auditTrail };

export async function getProjectReport(client, c, key, filters = {}) {
  const fn = REPORTS[key];
  if (!fn) throw new ProjectError(404, "Project report was not found.", "PROJECT_NOT_FOUND");
  return fn(client, c, filters);
}

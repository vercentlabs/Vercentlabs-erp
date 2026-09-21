// Project money (F214-F223): budgets and revisions, cost tracking, revenue, billing lines (fixed price, time
// and material, milestone) with an approval step and an idempotent handoff to a draft Accounting invoice,
// and profitability with variance and estimate at completion. Actuals always come from source records
// (approved time, approved expenses, issued materials, linked procurement), never from typed-in totals.
import { createCustomerInvoice } from "../accounting/receivables.js";
import {
  assertOpen, canSeeFinance, dateOrNull, fromCents, has, loadProject, loadSettings, need, needAny, nextNumber, nonNegative, oneOf, positive, ProjectError, qx, recordEvent, requiredText, textOrNull,
  toCents, today, uuid, uuidOrNull,
} from "./common.js";

const cents = (v) => toCents(String(v ?? 0));

// ------------------------------------------------------------------ actuals (F216) and revenue (F217)
export async function computeActuals(client, c, project) {
  const one = async (sql) => (await client.query(sql, [c.organizationId, project.id])).rows[0];
  const labor = await one(`SELECT COALESCE(sum(hours*cost_rate),0)::text AS v,COALESCE(sum(hours),0)::text AS h FROM tenant.project_time_entries WHERE organization_id=$1 AND project_id=$2 AND status='approved'`);
  const expense = await one(`SELECT COALESCE(sum(base_amount),0)::text AS v FROM tenant.project_expenses WHERE organization_id=$1 AND project_id=$2 AND status IN ('approved','reimbursed')`);
  const material = await one(`SELECT COALESCE(sum(total_cost),0)::text AS v FROM tenant.project_materials WHERE organization_id=$1 AND project_id=$2 AND status='issued'`);
  const proc = await one(`SELECT COALESCE(sum(actual_amount),0)::text AS a,COALESCE(sum(committed_amount),0)::text AS c FROM tenant.project_procurement_links WHERE organization_id=$1 AND project_id=$2`);
  const billed = await one(`SELECT COALESCE(sum(amount) FILTER (WHERE status='invoiced'),0)::text AS invoiced,COALESCE(sum(amount) FILTER (WHERE status IN ('ready','requested')),0)::text AS queued FROM tenant.project_billing_milestones WHERE organization_id=$1 AND project_id=$2`);
  const unbilledTime = await one(`SELECT COALESCE(sum(hours*bill_rate),0)::text AS v FROM tenant.project_time_entries WHERE organization_id=$1 AND project_id=$2 AND status='approved' AND billable=true AND billed_billing_id IS NULL`);
  const unbilledExp = await one(`SELECT COALESCE(sum(base_amount),0)::text AS v FROM tenant.project_expenses WHERE organization_id=$1 AND project_id=$2 AND status IN ('approved','reimbursed') AND billable=true AND billed_billing_id IS NULL`);
  const unbilledMat = await one(`SELECT COALESCE(sum(total_cost),0)::text AS v FROM tenant.project_materials WHERE organization_id=$1 AND project_id=$2 AND status='issued' AND billable=true AND billed_billing_id IS NULL`);
  const recognized = await recognizedRevenue(client, c, project, unbilledTime.v, unbilledExp.v, unbilledMat.v);
  const laborC = cents(labor.v); const expenseC = cents(expense.v); const materialC = cents(material.v); const procC = cents(proc.a);
  const committedC = cents(proc.c);
  return {
    laborCost: laborC, expenseCost: expenseC, materialCost: materialC, procurementCost: procC,
    totalCost: laborC + expenseC + materialC + procC, committedProcurement: committedC,
    outstandingCommitment: committedC > procC ? committedC - procC : 0n,
    approvedHours: Number(labor.h), invoicedRevenue: cents(billed.invoiced), queuedBilling: cents(billed.queued), recognizedRevenue: recognized,
    unbilled: cents(unbilledTime.v) + cents(unbilledExp.v) + cents(unbilledMat.v),
  };
}

async function recognizedRevenue(client, c, p, unbilledTime, unbilledExp, unbilledMat) {
  if (p.project_type === "internal" || p.billing_method === "non_billable") return 0n;
  if (p.billing_method === "fixed_price") return (cents(p.contracted_revenue) * BigInt(Math.round(Number(p.percent_complete) * 100))) / 10000n;
  if (p.billing_method === "milestone") {
    const r = await client.query(`SELECT COALESCE(sum(billing_amount),0)::text AS v FROM tenant.project_milestones WHERE project_id=$1 AND billing_trigger=true AND status='completed'`, [p.id]);
    return cents(r.rows[0].v);
  }
  const billedTM = await client.query(`SELECT COALESCE(sum(amount),0)::text AS v FROM tenant.project_billing_milestones WHERE project_id=$1 AND billing_type='time_material' AND status='invoiced'`, [p.id]);
  return cents(billedTM.rows[0].v) + cents(unbilledTime) + cents(unbilledExp) + cents(unbilledMat);
}

// ------------------------------------------------------------------ budgets and revisions (F214, F215)
const BUDGET_FIELDS = [["laborBudget", "labor_budget"], ["expenseBudget", "expense_budget"], ["procurementBudget", "procurement_budget"], ["contingencyBudget", "contingency_budget"], ["revenueBudget", "revenue_budget"]];
const budgetTotal = (b) => cents(b.labor_budget) + cents(b.expense_budget) + cents(b.procurement_budget) + cents(b.contingency_budget);

export async function listProjectBudgets(client, c, filters = {}) {
  needAny(c, ["projects.budget.manage", "projects.approve", "projects.profitability.view", "projects.reports.view"]);
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); where += ` AND b.project_id=$${values.length}`; }
  const res = await qx(client, `SELECT b.*,p.project_number,p.name AS project_name FROM tenant.project_budgets b JOIN tenant.projects p ON p.id=b.project_id WHERE b.organization_id=$1 AND b.company_id=$2${where} ORDER BY p.project_number,b.version DESC LIMIT 300`, values);
  const byProject = new Map();
  for (const r of res.rows) { if (!byProject.has(r.project_id)) byProject.set(r.project_id, []); byProject.get(r.project_id).push(r); }
  return res.rows.map((r) => {
    const prior = byProject.get(r.project_id).find((x) => x.version === (r.base_version ?? r.version - 1));
    return { ...r, total_cost_budget: fromCents(budgetTotal(r)), change_from_base: prior ? fromCents(budgetTotal(r) - budgetTotal(prior)) : null };
  });
}

export async function createProjectBudget(client, c, projectId, input) {
  need(c, "projects.budget.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  assertOpen(p, "budget");
  const open = await client.query(`SELECT 1 FROM tenant.project_budgets WHERE project_id=$1 AND status IN ('draft','pending_approval')`, [p.id]);
  if (open.rows[0]) throw new ProjectError(409, "There is already a budget draft or revision awaiting approval.", "PROJECT_BUDGET_OPEN");
  const active = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE project_id=$1 AND status='active'`, [p.id])).rows[0];
  const version = Number((await client.query(`SELECT COALESCE(max(version),0)+1 AS v FROM tenant.project_budgets WHERE project_id=$1`, [p.id])).rows[0].v);
  if (version > 1 && !textOrNull(input.reason, 500)) throw new ProjectError(400, "A budget revision needs a reason.", "PROJECT_FIELD_REQUIRED");
  const vals = BUDGET_FIELDS.map(([k, col]) => String(nonNegative(input[k], k, active ? Number(active[col]) : 0)));
  if (vals.slice(0, 4).every((v) => Number(v) === 0)) throw new ProjectError(400, "A budget needs at least one cost amount.", "PROJECT_NUMBER_INVALID");
  const res = await qx(client, `INSERT INTO tenant.project_budgets(organization_id,company_id,project_id,version,status,labor_budget,expense_budget,procurement_budget,contingency_budget,revenue_budget,notes,created_by,reason,base_version) VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, p.id, version, ...vals, textOrNull(input.notes, 1000), c.userId, textOrNull(input.reason, 500), active?.version ?? null]);
  await recordEvent(client, c, "project", p.id, "project.budget.drafted", { version });
  return res.rows[0];
}

export async function submitProjectBudget(client, c, budgetId) {
  need(c, "projects.budget.manage");
  const b = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(budgetId, "Budget")])).rows[0];
  if (!b) throw new ProjectError(404, "Budget was not found.", "PROJECT_NOT_FOUND");
  if (b.status !== "draft") throw new ProjectError(409, "Only a draft budget can be submitted.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  const res = await qx(client, `UPDATE tenant.project_budgets SET status='pending_approval',submitted_by=$2 WHERE id=$1 RETURNING *`, [b.id, c.userId]);
  if (!settings.require_budget_approval) return activateBudget(client, { ...c, permissions: [...(c.permissions || []), "projects.approve"] }, b.id, true);
  return res.rows[0];
}

async function activateBudget(client, c, budgetId, auto = false) {
  const b = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE id=$1 FOR UPDATE`, [budgetId])).rows[0];
  const p = await loadProject(client, c, b.project_id, { lock: true });
  const actuals = await computeActuals(client, c, p);
  if (budgetTotal(b) < actuals.totalCost) throw new ProjectError(409, `The budget (${fromCents(budgetTotal(b))}) is below the cost already incurred (${fromCents(actuals.totalCost)}).`, "PROJECT_BUDGET_BELOW_ACTUALS");
  await client.query(`UPDATE tenant.project_budgets SET status='superseded' WHERE project_id=$1 AND status='active'`, [p.id]);
  const res = await qx(client, `UPDATE tenant.project_budgets SET status='active',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *`, [b.id, c.userId]);
  await client.query(`UPDATE tenant.projects SET approved_budget=$2,updated_at=now() WHERE id=$1`, [p.id, fromCents(budgetTotal(b))]);
  await recordEvent(client, c, "project", p.id, "project.budget.activated", { version: b.version, total: fromCents(budgetTotal(b)), auto });
  return res.rows[0];
}

export async function approveProjectBudget(client, c, budgetId) {
  need(c, "projects.approve");
  const b = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(budgetId, "Budget")])).rows[0];
  if (!b) throw new ProjectError(404, "Budget was not found.", "PROJECT_NOT_FOUND");
  if (b.status !== "pending_approval") throw new ProjectError(409, "Only a budget awaiting approval can be approved.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && (b.created_by === c.userId || b.submitted_by === c.userId)) throw new ProjectError(409, "The person who prepared a budget cannot approve it.", "SELF_APPROVAL_BLOCKED");
  return activateBudget(client, c, b.id);
}

export async function rejectProjectBudget(client, c, budgetId, reason) {
  need(c, "projects.approve");
  const res = await qx(client, `UPDATE tenant.project_budgets SET status='rejected',rejected_reason=$4,approved_by=$3,approved_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$5 AND status='pending_approval' RETURNING *`, [c.organizationId, c.companyId, c.userId, requiredText(reason, "Reason", 500), uuid(budgetId, "Budget")]);
  if (!res.rows[0]) throw new ProjectError(409, "Only a budget awaiting approval can be rejected.", "PROJECT_STATE_INVALID");
  return res.rows[0];
}

// Budget against actual and committed, by category (F216, F223).
export async function getCostVariance(client, c, projectId) {
  needAny(c, ["projects.budget.manage", "projects.profitability.view", "projects.reports.view", "projects.approve"]);
  const p = await loadProject(client, c, projectId);
  const b = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE project_id=$1 AND status='active'`, [p.id])).rows[0];
  const a = await computeActuals(client, c, p);
  const proc = a.procurementCost + a.materialCost;
  const row = (name, budget, actual, committed = 0n) => ({ category: name, budget: fromCents(budget), actual: fromCents(actual), committed: fromCents(committed), variance: fromCents(budget - actual - committed), remaining: fromCents(budget - actual), usedPercent: budget > 0n ? Math.round(Number((actual * 1000n) / budget)) / 10 : null, overBudget: budget > 0n && actual > budget });
  const rows = [
    row("labor", b ? cents(b.labor_budget) : 0n, a.laborCost),
    row("expense", b ? cents(b.expense_budget) : 0n, a.expenseCost),
    row("procurement and materials", b ? cents(b.procurement_budget) : 0n, proc, a.outstandingCommitment),
    row("contingency", b ? cents(b.contingency_budget) : 0n, 0n),
  ];
  const totalBudget = b ? budgetTotal(b) : 0n;
  return { project: { id: p.id, project_number: p.project_number, name: p.name }, budgetVersion: b?.version ?? null, rows, total: row("total", totalBudget, a.totalCost, a.outstandingCommitment), asOf: today(), sources: ["approved time x rate", "approved expenses", "issued materials", "linked procurement actuals and commitments"] };
}

export async function getCostBreakdown(client, c, projectId) {
  needAny(c, ["projects.budget.manage", "projects.profitability.view", "projects.reports.view", "projects.approve"]);
  const p = await loadProject(client, c, projectId);
  const byTask = await qx(client,
    `SELECT t.id,t.task_number,t.name,t.wbs_code,
       COALESCE((SELECT sum(e.hours*e.cost_rate) FROM tenant.project_time_entries e WHERE e.task_id=t.id AND e.status='approved'),0)::text AS labor,
       COALESCE((SELECT sum(x.base_amount) FROM tenant.project_expenses x WHERE x.task_id=t.id AND x.status IN ('approved','reimbursed')),0)::text AS expense,
       COALESCE((SELECT sum(m.total_cost) FROM tenant.project_materials m WHERE m.task_id=t.id AND m.status='issued'),0)::text AS materials
     FROM tenant.project_tasks t WHERE t.organization_id=$1 AND t.project_id=$2 ORDER BY t.sort_order`, [c.organizationId, p.id]);
  const rows = byTask.rows.map((r) => ({ ...r, total: fromCents(cents(r.labor) + cents(r.expense) + cents(r.materials)) })).filter((r) => Number(r.total) > 0);
  const byPerson = await qx(client, `SELECT e.user_id,u.full_name,sum(e.hours)::float AS hours,sum(e.hours*e.cost_rate)::text AS cost FROM tenant.project_time_entries e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.status='approved' GROUP BY e.user_id,u.full_name ORDER BY 4 DESC`, [c.organizationId, p.id]);
  return { project: { id: p.id, project_number: p.project_number }, byTask: rows, byPerson: byPerson.rows };
}

// ------------------------------------------------------------------ profitability (F222, F223)
export async function getProjectProfitabilityDesk(client, c, projectId) {
  needAny(c, ["projects.profitability.view", "projects.approve"]);
  const p = await loadProject(client, c, projectId);
  const a = await computeActuals(client, c, p);
  const b = (await qx(client, `SELECT * FROM tenant.project_budgets WHERE project_id=$1 AND status='active'`, [p.id])).rows[0];
  const bac = b ? budgetTotal(b) : cents(p.approved_budget);
  const pct = Number(p.percent_complete);
  const ev = (bac * BigInt(Math.round(pct * 100))) / 10000n;
  const ac = a.totalCost;
  let eac = bac;
  let cpi = null;
  if (ac > 0n && ev > 0n) { cpi = Number(ev) / Number(ac); eac = ac + BigInt(Math.round(Number(bac - ev) / cpi)); }
  else if (ac > 0n && bac === 0n) eac = ac;
  else if (ac > 0n) eac = ac > bac ? ac : bac;
  const contracted = cents(p.contracted_revenue);
  const revenueBasis = a.recognizedRevenue;
  const margin = revenueBasis - ac;
  const forecastRevenue = p.billing_method === "time_and_material" ? (revenueBasis > contracted && contracted > 0n ? revenueBasis : (contracted > 0n ? contracted : revenueBasis)) : contracted;
  const forecastMargin = forecastRevenue - eac;
  return {
    project: { id: p.id, project_number: p.project_number, name: p.name, billing_method: p.billing_method, percent_complete: pct },
    revenue: { contracted: fromCents(contracted), recognized: fromCents(revenueBasis), invoiced: fromCents(a.invoicedRevenue), queuedForBilling: fromCents(a.queuedBilling), unbilled: fromCents(a.unbilled) },
    cost: { labor: fromCents(a.laborCost), expense: fromCents(a.expenseCost), materials: fromCents(a.materialCost), procurement: fromCents(a.procurementCost), total: fromCents(ac), outstandingCommitments: fromCents(a.outstandingCommitment) },
    margin: { grossMargin: fromCents(margin), grossMarginPercent: revenueBasis > 0n ? Math.round(Number((margin * 10000n) / revenueBasis)) / 100 : null },
    forecast: { budgetAtCompletion: fromCents(bac), earnedValue: fromCents(ev), actualCost: fromCents(ac), costPerformanceIndex: cpi === null ? null : Math.round(cpi * 1000) / 1000, estimateAtCompletion: fromCents(eac), varianceAtCompletion: fromCents(bac - eac), forecastRevenue: fromCents(forecastRevenue), forecastMargin: fromCents(forecastMargin), forecastMarginPercent: forecastRevenue > 0n ? Math.round(Number((forecastMargin * 10000n) / forecastRevenue)) / 100 : null },
    asOf: today(),
    basis: { recognition: p.billing_method, note: "Costs are approved time at each entry's cost rate, approved expenses, issued materials and linked procurement actuals; committed procurement is shown separately and is not yet cost." },
  };
}

export async function captureProfitabilitySnapshot(client, c, projectId) {
  need(c, "projects.profitability.view");
  const d = await getProjectProfitabilityDesk(client, c, projectId);
  const res = await qx(client,
    `INSERT INTO tenant.project_profitability_snapshots(organization_id,company_id,project_id,snapshot_date,contracted_revenue,billed_revenue,recognized_revenue,labor_cost,expense_cost,procurement_cost,total_cost,gross_margin,gross_margin_percent,estimate_at_completion,variance_at_completion)
     VALUES($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (project_id,snapshot_date) DO UPDATE SET contracted_revenue=EXCLUDED.contracted_revenue,billed_revenue=EXCLUDED.billed_revenue,recognized_revenue=EXCLUDED.recognized_revenue,labor_cost=EXCLUDED.labor_cost,expense_cost=EXCLUDED.expense_cost,procurement_cost=EXCLUDED.procurement_cost,total_cost=EXCLUDED.total_cost,gross_margin=EXCLUDED.gross_margin,gross_margin_percent=EXCLUDED.gross_margin_percent,estimate_at_completion=EXCLUDED.estimate_at_completion,variance_at_completion=EXCLUDED.variance_at_completion RETURNING *`,
    [c.organizationId, c.companyId, d.project.id, d.revenue.contracted, d.revenue.invoiced, d.revenue.recognized, d.cost.labor, d.cost.expense, String(Number(d.cost.procurement) + Number(d.cost.materials)), d.cost.total, d.margin.grossMargin, d.margin.grossMarginPercent ?? 0, d.forecast.estimateAtCompletion, d.forecast.varianceAtCompletion]);
  return res.rows[0];
}

// ------------------------------------------------------------------ billing (F218-F221)
export async function listBillingLines(client, c, filters = {}) {
  needAny(c, ["projects.billing.manage", "projects.approve", "projects.profitability.view", "projects.reports.view"]);
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("b.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.status && filters.status !== "all") add("b.status=?", oneOf(filters.status, ["planned", "ready", "requested", "invoiced", "cancelled"], "Status"));
  const res = await qx(client,
    `SELECT b.*,p.project_number,p.name AS project_name,ci.status AS invoice_status,ci.grand_total AS invoice_total,ci.outstanding_amount AS invoice_outstanding
     FROM tenant.project_billing_milestones b JOIN tenant.projects p ON p.id=b.project_id LEFT JOIN tenant.accounting_customer_invoices ci ON ci.id=b.accounting_customer_invoice_id
     WHERE b.organization_id=$1 AND b.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY b.created_at DESC LIMIT 500`, values);
  return res.rows;
}

async function newBillingLine(client, c, p, fields) {
  const key = textOrNull(fields.idempotencyKey, 160) || `billing:${p.id}:${fields.billingType}:${fields.milestoneId ?? fields.description}:${today()}`;
  const existing = (await qx(client, `SELECT * FROM tenant.project_billing_milestones WHERE organization_id=$1 AND idempotency_key=$2`, [c.organizationId, key])).rows[0];
  if (existing) return { ...existing, replayed: true };
  const settings = await loadSettings(client, c);
  const number = await nextNumber(client, c, "project_billing", "PBL");
  const res = await qx(client,
    `INSERT INTO tenant.project_billing_milestones(organization_id,company_id,project_id,milestone_id,billing_number,description,amount,currency_code,due_date,status,idempotency_key,created_by,billing_type,period_start,period_end,detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$11,$12,$13,$14,$15::jsonb) RETURNING *`,
    [c.organizationId, c.companyId, p.id, fields.milestoneId ?? null, number, fields.description, fields.amount, p.currency_code, fields.dueDate ?? null, key, c.userId, fields.billingType, fields.periodStart ?? null, fields.periodEnd ?? null, JSON.stringify(fields.detail ?? {})]);
  void settings;
  return res.rows[0];
}

async function requireBillable(p) {
  if (p.project_type === "internal" || p.billing_method === "non_billable") throw new ProjectError(409, "This project is not billable.", "PROJECT_NOT_BILLABLE");
  if (!p.customer_id) throw new ProjectError(409, "A billable project needs a customer before it can be billed.", "PROJECT_FIELD_REQUIRED");
  if (["draft", "cancelled"].includes(p.status)) throw new ProjectError(409, `A ${p.status} project cannot be billed.`, "PROJECT_STATE_INVALID");
}

export async function createFixedPriceBilling(client, c, projectId, input) {
  need(c, "projects.billing.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  await requireBillable(p);
  if (p.billing_method !== "fixed_price") throw new ProjectError(409, "Scheduled amounts are for fixed-price projects.", "PROJECT_BILLING_METHOD");
  const amount = positive(input.amount, "Amount");
  const planned = (await client.query(`SELECT COALESCE(sum(amount),0)::text AS s FROM tenant.project_billing_milestones WHERE project_id=$1 AND status<>'cancelled'`, [p.id])).rows[0].s;
  if (cents(planned) + toCents(String(amount)) > cents(p.contracted_revenue)) throw new ProjectError(409, `Billing would exceed the contracted revenue (${p.contracted_revenue}); ${fromCents(cents(p.contracted_revenue) - cents(planned))} remains.`, "PROJECT_BILLING_EXCEEDS_CONTRACT");
  return newBillingLine(client, c, p, { billingType: "fixed", description: requiredText(input.description, "Description", 500), amount: String(amount), dueDate: dateOrNull(input.dueDate, "Due date"), idempotencyKey: input.idempotencyKey });
}

export async function createMilestoneBilling(client, c, milestoneId, input = {}) {
  need(c, "projects.billing.manage");
  const m = (await qx(client, `SELECT * FROM tenant.project_milestones WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(milestoneId, "Milestone")])).rows[0];
  if (!m) throw new ProjectError(404, "Milestone was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, m.project_id, { lock: true });
  await requireBillable(p);
  if (p.billing_method !== "milestone") throw new ProjectError(409, "Milestone billing is for milestone-billed projects.", "PROJECT_BILLING_METHOD");
  if (!m.billing_trigger || Number(m.billing_amount) <= 0) throw new ProjectError(409, "This milestone does not trigger billing.", "PROJECT_MILESTONE_NOT_BILLING");
  if (m.status !== "completed") throw new ProjectError(409, "A milestone can be billed only once it is completed.", "PROJECT_MILESTONE_NOT_COMPLETE");
  const dup = await client.query(`SELECT billing_number FROM tenant.project_billing_milestones WHERE milestone_id=$1 AND status<>'cancelled'`, [m.id]);
  if (dup.rows[0]) throw new ProjectError(409, `This milestone is already billed on ${dup.rows[0].billing_number}.`, "PROJECT_MILESTONE_BILLED");
  return newBillingLine(client, c, p, { billingType: "milestone", milestoneId: m.id, description: `Milestone ${m.sequence}: ${m.name}`, amount: m.billing_amount, idempotencyKey: input.idempotencyKey || `billing:milestone:${m.id}` });
}

// T&M: everything approved, billable and not yet billed in the period, priced at each entry's own bill rate.
export async function createTimeMaterialBilling(client, c, projectId, input) {
  need(c, "projects.billing.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  await requireBillable(p);
  if (p.billing_method !== "time_and_material") throw new ProjectError(409, "Time and material billing is for T&M projects.", "PROJECT_BILLING_METHOD");
  const from = dateOrNull(input.periodStart, "Period start"); const to = dateOrNull(input.periodEnd, "Period end") || today();
  if (from && to < from) throw new ProjectError(400, "The period end cannot be before its start.", "PROJECT_DATE_INVALID");
  const key = textOrNull(input.idempotencyKey, 160);
  if (key) { const dup = (await qx(client, `SELECT * FROM tenant.project_billing_milestones WHERE organization_id=$1 AND idempotency_key=$2`, [c.organizationId, key])).rows[0]; if (dup) return { ...dup, replayed: true }; }
  const time = await qx(client, `SELECT id,hours,bill_rate,user_id,work_date FROM tenant.project_time_entries WHERE organization_id=$1 AND project_id=$2 AND status='approved' AND billable=true AND billed_billing_id IS NULL AND ($3::date IS NULL OR work_date>=$3) AND work_date<=$4 FOR UPDATE`, [c.organizationId, p.id, from, to]);
  const exp = await qx(client, `SELECT id,base_amount FROM tenant.project_expenses WHERE organization_id=$1 AND project_id=$2 AND status IN ('approved','reimbursed') AND billable=true AND billed_billing_id IS NULL AND ($3::date IS NULL OR expense_date>=$3) AND expense_date<=$4 FOR UPDATE`, [c.organizationId, p.id, from, to]);
  const mat = await qx(client, `SELECT id,total_cost FROM tenant.project_materials WHERE organization_id=$1 AND project_id=$2 AND status='issued' AND billable=true AND billed_billing_id IS NULL AND ($3::date IS NULL OR consumed_on>=$3) AND consumed_on<=$4 FOR UPDATE`, [c.organizationId, p.id, from, to]);
  const timeAmount = time.rows.reduce((s, r) => s + (toCents(String(r.hours)) * toCents(String(r.bill_rate))) / 100n, 0n);
  const total = timeAmount + exp.rows.reduce((s, r) => s + cents(r.base_amount), 0n) + mat.rows.reduce((s, r) => s + cents(r.total_cost), 0n);
  if (total <= 0n) throw new ProjectError(409, "There is no approved, billable, unbilled work in that period.", "PROJECT_NOTHING_TO_BILL");
  const line = await newBillingLine(client, c, p, { billingType: "time_material", description: textOrNull(input.description, 500) || `Time and materials to ${to}`, amount: fromCents(total), periodStart: from, periodEnd: to, idempotencyKey: key || `billing:tm:${p.id}:${time.rows.map((r) => r.id).concat(exp.rows.map((r) => r.id)).sort().join(",").length}:${to}:${total}`, detail: { timeEntries: time.rows.length, hours: time.rows.reduce((s, r) => s + Number(r.hours), 0), expenses: exp.rows.length, materials: mat.rows.length, timeAmount: fromCents(timeAmount) } });
  if (line.replayed) return line;
  if (time.rows.length) await client.query(`UPDATE tenant.project_time_entries SET billed_billing_id=$2 WHERE id=ANY($1::uuid[])`, [time.rows.map((r) => r.id), line.id]);
  if (exp.rows.length) await client.query(`UPDATE tenant.project_expenses SET billed_billing_id=$2 WHERE id=ANY($1::uuid[])`, [exp.rows.map((r) => r.id), line.id]);
  if (mat.rows.length) await client.query(`UPDATE tenant.project_materials SET billed_billing_id=$2 WHERE id=ANY($1::uuid[])`, [mat.rows.map((r) => r.id), line.id]);
  await recordEvent(client, c, "project", p.id, "project.billing.prepared", { billing: line.billing_number, amount: fromCents(total) });
  return line;
}

export async function approveBillingLine(client, c, billingId) {
  need(c, "projects.approve");
  const b = (await qx(client, `SELECT * FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(billingId, "Billing line")])).rows[0];
  if (!b) throw new ProjectError(404, "Billing line was not found.", "PROJECT_NOT_FOUND");
  if (b.status !== "ready") throw new ProjectError(409, "Only a prepared billing line can be approved.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && b.created_by === c.userId) throw new ProjectError(409, "The person who prepared a billing line cannot approve it.", "SELF_APPROVAL_BLOCKED");
  return (await qx(client, `UPDATE tenant.project_billing_milestones SET status='requested',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [b.id, c.userId])).rows[0];
}

function accountingContext(c) {
  return { organizationId: c.organizationId, userId: c.userId, activeCompanyId: c.companyId, activeBranchId: null, allowAllCompanies: false, permissions: ["accounting.view"], roleSlugs: [] };
}

// The handoff: one draft Accounting customer invoice per billing line, once. Accounting owns the invoice from here.
export async function invoiceBillingLine(client, c, billingId) {
  need(c, "projects.billing.manage");
  const b = (await qx(client, `SELECT * FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(billingId, "Billing line")])).rows[0];
  if (!b) throw new ProjectError(404, "Billing line was not found.", "PROJECT_NOT_FOUND");
  if (b.status === "invoiced") return b;
  const settings = await loadSettings(client, c);
  if (settings.require_billing_approval ? b.status !== "requested" : !["ready", "requested"].includes(b.status)) throw new ProjectError(409, settings.require_billing_approval ? "A billing line must be approved before it is invoiced." : "Only a prepared billing line can be invoiced.", "PROJECT_STATE_INVALID");
  const p = await loadProject(client, c, b.project_id, { lock: true });
  await requireBillable(p);
  if (p.status === "cancelled") throw new ProjectError(409, "A cancelled project cannot be invoiced.", "PROJECT_STATE_INVALID");
  let invoice;
  try {
    invoice = await createCustomerInvoice(client, accountingContext(c), {
      companyId: c.companyId, partyId: p.customer_id, currencyCode: b.currency_code, invoiceDate: today(), dueDate: b.due_date ?? undefined,
      notes: `Project ${p.project_number} ${p.name}: ${b.billing_number}`,
      lines: [{ description: `${p.project_number} ${b.description}`.slice(0, 900), quantity: 1, unitPrice: b.amount }],
    }, { internal: true });
  } catch (error) {
    if (error?.status) throw new ProjectError(error.status === 403 ? 409 : error.status, error.message, "PROJECT_ACCOUNTING_REJECTED");
    throw error;
  }
  const res = await qx(client, `UPDATE tenant.project_billing_milestones SET status='invoiced',accounting_customer_invoice_id=$2,invoice_number=$3,invoiced_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [b.id, invoice.invoice.id, invoice.invoice.invoice_number]);
  await recordEvent(client, c, "project", p.id, "project.billing.invoiced", { billing: b.billing_number, invoice: invoice.invoice.invoice_number });
  return res.rows[0];
}

export async function cancelBillingLine(client, c, billingId, reason) {
  need(c, "projects.billing.manage");
  const b = (await qx(client, `SELECT * FROM tenant.project_billing_milestones WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(billingId, "Billing line")])).rows[0];
  if (!b) throw new ProjectError(404, "Billing line was not found.", "PROJECT_NOT_FOUND");
  if (["invoiced", "cancelled"].includes(b.status)) throw new ProjectError(409, b.status === "invoiced" ? "An invoiced line is corrected in Accounting with a credit note, not cancelled here." : "That line is already cancelled.", "PROJECT_STATE_INVALID");
  await client.query(`UPDATE tenant.project_time_entries SET billed_billing_id=NULL WHERE billed_billing_id=$1`, [b.id]);
  await client.query(`UPDATE tenant.project_expenses SET billed_billing_id=NULL WHERE billed_billing_id=$1`, [b.id]);
  await client.query(`UPDATE tenant.project_materials SET billed_billing_id=NULL WHERE billed_billing_id=$1`, [b.id]);
  return (await qx(client, `UPDATE tenant.project_billing_milestones SET status='cancelled',cancelled_reason=$2,idempotency_key=idempotency_key||':cancelled:'||id::text,updated_at=now() WHERE id=$1 RETURNING *`, [b.id, requiredText(reason, "Reason", 500)])).rows[0];
}

void has; void canSeeFinance; void uuidOrNull;

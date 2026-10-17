// Projects — Project Cost, the reads: every cost line of a project from its authoritative source (approved time costed at the rate that
// applied, recognized expense / supplier bill / material allocations, overhead allocations), the summary — actual cost, budget, remaining,
// commitments, pending claims, estimate to complete and at completion, profitability — the breakdowns, the exceptions, a reconciliation
// that rechecks every line against its source, and the reports. All derived on read; nothing here is a ledger.
import { has, isoDay, userNames, uuid, visibilitySql } from "../project-core.js";
import { addMoney, cmpMoney, moneyOut, subMoney } from "../expenses/expense-rules.js";
import { CATEGORIES, COST, SOURCE_LABEL, costCategoryOf, costError, costScope, pct, requireSummary } from "./cost-rules.js";
import { projectRevenueMeasures } from "../revenue/revenue-read.js";

const BILL_RECOGNIZED = ["approved", "posted", "partially_paid", "paid", "overdue", "disputed"];
const day = (value) => (value ? isoDay(value) : null);
const currencyOf = async (client, c) => (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR";

// ------------------------------------------------------------------ the cost lines
// filters: { from?, to?, category?, source?, taskId?, milestoneId? }
export async function projectCostLines(client, c, project, can, filters = {}) {
  const lines = [];
  const labor = (await client.query(`SELECT entry.id, entry.entry_number, to_char(entry.work_date, 'YYYY-MM-DD') AS d, entry.employee_user_id, entry.duration_minutes, entry.cost_rate, entry.cost_amount,
        entry.cost_currency, entry.billable, entry.task_id, task.task_code, task.title AS task_title, task.milestone_id, milestone.milestone_code, milestone.name AS milestone_name
      FROM tenant.project_time_entries entry LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id LEFT JOIN tenant.project_milestones milestone ON milestone.id = task.milestone_id
     WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status = 'APPROVED'`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, labor.map((row) => row.employee_user_id));
  for (const row of labor) {
    lines.push({ id: `TE:${row.id}`, sourceModule: "TIMESHEET", sourceRef: `TE-${row.entry_number}`, date: row.d, category: "LABOR", costType: "DIRECT", basis: "MANAGERIAL",
      amount: row.cost_amount === null ? null : moneyOut(Number(row.cost_amount).toFixed(2)), currency: row.cost_currency, minutes: row.duration_minutes, billable: row.billable,
      person: names.get(row.employee_user_id) ?? null, ...(can.laborRate ? { rate: row.cost_rate === null ? null : String(row.cost_rate) } : {}),
      taskId: row.task_id, task: row.task_code ? `${row.task_code} · ${row.task_title}` : null, milestoneId: row.milestone_id, milestone: row.milestone_code ? `${row.milestone_code} · ${row.milestone_name}` : null,
      href: `/projects/timesheets?entry=${row.id}`, missingRate: row.cost_amount === null });
  }
  const allocations = (await client.query(`SELECT allocation.*, to_char(allocation.recognition_date, 'YYYY-MM-DD') AS d, category.code AS category_code, expense.expense_number, expense.billing_classification,
        bill.status AS bill_status, bill.bill_number, issue.document_number, issue.status AS issue_status, task.task_code, task.title AS task_title, task.milestone_id, milestone.milestone_code, milestone.name AS milestone_name
      FROM tenant.project_expense_cost_allocations allocation LEFT JOIN tenant.project_expense_categories category ON category.id = allocation.category_id
      LEFT JOIN tenant.project_expenses expense ON expense.id = allocation.expense_id
      LEFT JOIN tenant.accounting_vendor_bills bill ON allocation.source_module = 'SUPPLIER_BILL' AND bill.id = allocation.source_id
      LEFT JOIN tenant.goods_issues issue ON allocation.source_module = 'GOODS_ISSUE' AND issue.id = allocation.source_id
      LEFT JOIN tenant.project_tasks task ON task.id = allocation.task_id LEFT JOIN tenant.project_milestones milestone ON milestone.id = task.milestone_id
     WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status <> 'REVERSED'`, [c.organizationId, project.id])).rows;
  for (const row of allocations) {
    // A supplier bill is cost once Finance approved it; a draft or cancelled bill is not.
    const recognized = row.source_module !== "SUPPLIER_BILL" || BILL_RECOGNIZED.includes(row.bill_status);
    const ref = row.source_module === "SUPPLIER_BILL" ? row.bill_number : row.source_module === "GOODS_ISSUE" ? row.document_number : `EXP-${String(row.expense_number).padStart(6, "0")}`;
    lines.push({ id: `AL:${row.id}`, sourceModule: row.source_module, sourceRef: ref, date: row.d, category: costCategoryOf(row.category_code, row.source_module), costType: "DIRECT", basis: "FINANCE_SOURCE",
      amount: moneyOut(row.amount), currency: row.currency, billable: row.billing_classification ? row.billing_classification === "RECHARGE_ELIGIBLE" : null, recognized,
      taskId: row.task_id, task: row.task_code ? `${row.task_code} · ${row.task_title}` : null, milestoneId: row.milestone_id, milestone: row.milestone_code ? `${row.milestone_code} · ${row.milestone_name}` : null,
      href: row.expense_id ? `/projects/expenses/${row.expense_id}` : null, sourceStatus: row.bill_status ?? row.issue_status ?? null });
  }
  const overhead = (await client.query(`SELECT allocation.*, to_char(allocation.period_start, 'YYYY-MM-DD') AS d, to_char(allocation.period_end, 'YYYY-MM-DD') AS e, policy.method, policy.policy_number
      FROM tenant.project_overhead_allocations allocation JOIN tenant.project_overhead_policies policy ON policy.id = allocation.policy_id
     WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status = 'RECOGNIZED'`, [c.organizationId, project.id])).rows;
  for (const row of overhead) {
    lines.push({ id: `OH:${row.id}`, sourceModule: "OVERHEAD", sourceRef: `OH-${row.policy_number} ${row.d}…${row.e}`, date: row.e, category: "OVERHEAD", costType: "ALLOCATED_OVERHEAD", basis: "MANAGERIAL",
      amount: moneyOut(row.amount), currency: row.currency, billable: null, recognized: true, taskId: null, task: null, milestoneId: null, milestone: null, href: null, method: row.method });
  }
  return lines.filter((line) => (!filters.from || line.date >= isoDay(filters.from)) && (!filters.to || line.date <= isoDay(filters.to)) && (!filters.category || line.category === filters.category)
    && (!filters.source || line.sourceModule === filters.source) && (!filters.taskId || line.taskId === filters.taskId) && (!filters.milestoneId || line.milestoneId === filters.milestoneId))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
const sum = (lines) => addMoney("0", ...lines.map((line) => line.amount ?? "0"));
const groupSum = (lines, key, label) => {
  const map = new Map();
  for (const line of lines) {
    const k = line[key] ?? "—";
    const entry = map.get(k) ?? { key: k, label: label(line), amount: "0", lines: 0 };
    entry.amount = addMoney(entry.amount, line.amount ?? "0");
    entry.lines += 1;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => cmpMoney(b.amount, a.amount));
};

// ------------------------------------------------------------------ budget, commitments, forecast, revenue
export async function approvedBudget(client, c, projectId) {
  const budget = (await client.query(`SELECT * FROM tenant.project_cost_budgets WHERE organization_id = $1 AND project_id = $2 AND status = 'APPROVED'`, [c.organizationId, projectId])).rows[0];
  if (!budget) return null;
  const lines = (await client.query(`SELECT category, amount FROM tenant.project_cost_budget_lines WHERE budget_id = $1`, [budget.id])).rows;
  return { id: budget.id, version: budget.version, total: moneyOut(budget.total_amount), currency: budget.currency, approvedAt: budget.decided_at, reason: budget.reason,
    lines: Object.fromEntries(lines.map((row) => [row.category, moneyOut(row.amount)])) };
}
// Confirmed purchase orders linked to the project, less what their bills have already brought in as cost (net of tax, as bills are).
export async function projectCommitments(client, c, projectId) {
  const rows = (await client.query(`SELECT po.id, po.purchase_order_number, po.taxable_total,
      COALESCE((SELECT sum(allocation.amount) FROM tenant.project_expense_cost_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.id = allocation.source_id
        WHERE allocation.source_module = 'SUPPLIER_BILL' AND allocation.project_id = $2 AND allocation.status <> 'REVERSED' AND bill.source_purchase_order_id = po.id), 0) AS billed
     FROM tenant.project_links link JOIN tenant.purchase_orders po ON po.id = link.source_id AND po.status = 'confirmed'
    WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'PURCHASE_ORDER' AND link.removed_at IS NULL`, [c.organizationId, projectId])).rows;
  const items = rows.map((row) => {
    const open = subMoney(row.taxable_total, row.billed);
    return { id: row.id, number: row.purchase_order_number, total: moneyOut(row.taxable_total), billed: moneyOut(row.billed), open: cmpMoney(open, "0") > 0 ? open : "0.00", href: `/procurement/purchase-orders/${row.id}` };
  });
  return { total: addMoney("0", ...items.map((row) => row.open)), items };
}
async function pendingClaims(client, c, projectId) {
  const row = (await client.query(`SELECT COALESCE(sum(base_amount) FILTER (WHERE status = 'SUBMITTED'), 0) AS submitted,
      COALESCE(sum(base_amount) FILTER (WHERE status IN ('APPROVED', 'CORRECTION_REQUIRED') AND finance_status <> 'VERIFIED' AND payment_source <> 'SUPPLIER'), 0) AS approved
     FROM tenant.project_expenses WHERE organization_id = $1 AND project_id = $2`, [c.organizationId, projectId])).rows[0];
  return { awaitingApproval: moneyOut(row.submitted), awaitingRecognition: moneyOut(row.approved), total: addMoney(row.submitted, row.approved) };
}
export async function latestForecast(client, c, projectId) {
  const row = (await client.query(`SELECT * FROM tenant.project_cost_forecasts WHERE organization_id = $1 AND project_id = $2 ORDER BY version DESC LIMIT 1`, [c.organizationId, projectId])).rows[0];
  if (!row) return null;
  const names = await userNames(client, [row.created_by]);
  return { version: row.version, estimateToComplete: moneyOut(row.estimate_to_complete), asOf: day(row.as_of_date), commitmentTreatment: row.commitment_treatment, notes: row.notes,
    by: names.get(row.created_by) ?? null, at: row.created_at };
}
// What the project earned, from Project Revenue's measures (the same figures its Revenue panel shows): net invoiced excluding tax, and the
// revenue Finance recognized when it has. Contract value is a commercial reference, never revenue.
export async function projectRevenue(client, c, projectId) {
  const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, projectId])).rows[0];
  const r = await projectRevenueMeasures(client, c, project);
  return { contractValue: r.contractValue ?? "0.00", invoicedNet: r.netInvoiced, recognized: r.recognized, invoices: r.invoices,
    note: r.recognized === null ? "Invoiced value net of credit notes (excluding tax); Finance has not recognized revenue for these invoices yet. Contract value is a commercial reference, not revenue."
      : "Invoiced value net of credit notes (excluding tax), with the revenue Finance recognized. Contract value is a commercial reference, not revenue." };
}

// ------------------------------------------------------------------ the summary
export async function getProjectCostSummary(client, c, projectId, filters = {}) {
  const { project, can } = await costScope(client, c, projectId);
  requireSummary(can);
  return costSummaryFor(client, c, project, can, filters);
}
// The summary for a project already in scope, with the rights given (Project Profitability reads it with its own).
export async function costSummaryFor(client, c, project, can, filters = {}) {
  const currency = await currencyOf(client, c);
  const all = await projectCostLines(client, c, project, can, filters);
  const recognized = all.filter((line) => line.recognized !== false && line.amount !== null);
  const actual = sum(recognized);
  const budget = await approvedBudget(client, c, project.id);
  const proposalRow = (await client.query(`SELECT * FROM tenant.project_cost_budgets WHERE organization_id = $1 AND project_id = $2 AND status = 'PROPOSED'`, [c.organizationId, project.id])).rows[0];
  const proposal = proposalRow ? { id: proposalRow.id, version: proposalRow.version, total: moneyOut(proposalRow.total_amount), reason: proposalRow.reason, proposedAt: proposalRow.proposed_at,
    proposedBy: (await userNames(client, [proposalRow.proposed_by])).get(proposalRow.proposed_by) ?? null, mine: proposalRow.proposed_by === c.userId,
    lines: Object.fromEntries((await client.query(`SELECT category, amount FROM tenant.project_cost_budget_lines WHERE budget_id = $1`, [proposalRow.id])).rows.map((row) => [row.category, moneyOut(row.amount)])) } : null;
  const commitments = await projectCommitments(client, c, project.id);
  const pending = await pendingClaims(client, c, project.id);
  const forecast = await latestForecast(client, c, project.id);
  // EAC = actual + ETC (+ open commitments when the estimate leaves them out) — never counting a commitment twice.
  const eac = forecast ? addMoney(actual, forecast.estimateToComplete, forecast.commitmentTreatment === "EXCLUDED" ? commitments.total : "0") : null;
  const byCategory = groupSum(recognized, "category", (line) => CATEGORIES[line.category]).map((row) => ({ ...row, budget: budget?.lines[row.key] ?? null }));
  for (const [key, amount] of Object.entries(budget?.lines ?? {})) if (!byCategory.some((row) => row.key === key)) byCategory.push({ key, label: CATEGORIES[key], amount: "0.00", lines: 0, budget: amount });
  const labor = recognized.filter((line) => line.category === "LABOR");
  const revenue = can.profitability ? await projectRevenue(client, c, project.id) : null;
  const exceptions = await getProjectCostExceptions(client, c, project.id, { scope: { project, can } });
  return {
    projectId: project.id, currency, calculatedAt: new Date().toISOString(),
    basis: "Labor and overhead are managerial cost allocations; supplier, expense and material cost come from the records that recognized them. Nothing here is posted to the ledger.",
    actual, budget: budget ?? { set: false, message: "Budget not set" }, proposal,
    remaining: budget ? subMoney(budget.total, actual) : null, utilization: budget ? pct(actual, budget.total) : null, overrun: budget ? cmpMoney(actual, budget.total) > 0 : null,
    commitments, pending, forecast,
    eac, eacVariance: budget && eac ? subMoney(budget.total, eac) : null, forecastOverrun: budget && eac ? cmpMoney(eac, budget.total) > 0 : null,
    byCategory, bySource: groupSum(recognized, "sourceModule", (line) => SOURCE_LABEL[line.sourceModule]),
    byTask: groupSum(recognized.filter((line) => line.taskId), "taskId", (line) => line.task), byMilestone: groupSum(recognized.filter((line) => line.milestoneId), "milestoneId", (line) => line.milestone),
    byMonth: monthly(recognized),
    labor: { total: sum(labor), billable: sum(labor.filter((line) => line.billable)), nonBillable: sum(labor.filter((line) => !line.billable)), minutes: labor.reduce((s, line) => s + line.minutes, 0),
      missingRate: all.filter((line) => line.missingRate).length },
    pendingSupplierBills: sum(all.filter((line) => line.recognized === false)),
    profitability: revenue ? { ...revenue, contribution: subMoney(revenue.invoicedNet, actual), margin: pct(subMoney(revenue.invoicedNet, actual), revenue.invoicedNet),
      recognizedContribution: revenue.recognized === null ? null : subMoney(revenue.recognized, actual) } : null,
    exceptions: exceptions.length,
    can: { detail: can.detail, laborRate: can.laborRate, allocate: can.allocate, approve: can.approve, forecast: can.forecast, reconcile: can.reconcile, profitability: can.profitability, export: can.export },
  };
}
function monthly(lines) {
  const map = new Map();
  for (const line of lines) {
    const month = (line.date ?? "").slice(0, 7) || "—";
    map.set(month, addMoney(map.get(month) ?? "0", line.amount ?? "0"));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
}
export async function getProjectCostTransactions(client, c, projectId, filters = {}) {
  const { project, can } = await costScope(client, c, projectId);
  requireSummary(can);
  if (!can.detail) throw costError(403, "PROJECT_COST_PERMISSION_DENIED", "The cost lines need the detail permission.");
  return { projectId: project.id, lines: await projectCostLines(client, c, project, can, filters) };
}

// ------------------------------------------------------------------ exceptions and reconciliation
export async function getProjectCostExceptions(client, c, projectId, options = {}) {
  const { project, can } = options.scope ?? await costScope(client, c, projectId);
  requireSummary(can);
  const out = [];
  const q = async (sql) => (await client.query(sql, [c.organizationId, project.id])).rows;
  const missing = await q(`SELECT count(*)::int AS n, COALESCE(sum(duration_minutes), 0)::int AS m FROM tenant.project_time_entries WHERE organization_id = $1 AND project_id = $2 AND entry_status = 'APPROVED' AND cost_amount IS NULL`);
  if (missing[0].n) out.push({ kind: "RATE_MISSING", code: "PROJECT_COST_RATE_MISSING", message: `${missing[0].n} approved time entr${missing[0].n === 1 ? "y has" : "ies have"} no internal labor rate (${Math.round(missing[0].m / 6) / 10} h) — their cost is missing, not zero.` });
  for (const row of await q(`SELECT bill.bill_number, bill.status, allocation.amount FROM tenant.project_expense_cost_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.id = allocation.source_id
      WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.source_module = 'SUPPLIER_BILL' AND allocation.status <> 'REVERSED' AND bill.status IN ('cancelled', 'reversed')`)) {
    out.push({ kind: "SOURCE_REVERSED", code: "PROJECT_COST_SOURCE_REVERSED", message: `Supplier bill ${row.bill_number} was ${row.status}; its ${row.amount} allocation still counts — correct the expense.` });
  }
  for (const row of await q(`SELECT issue.document_number, allocation.amount FROM tenant.project_expense_cost_allocations allocation JOIN tenant.goods_issues issue ON issue.id = allocation.source_id
      WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.source_module = 'GOODS_ISSUE' AND allocation.status <> 'REVERSED' AND issue.status = 'cancelled'`)) {
    out.push({ kind: "SOURCE_REVERSED", code: "PROJECT_COST_SOURCE_REVERSED", message: `Goods issue ${row.document_number} was cancelled; its material cost still counts.` });
  }
  const unrecognized = await q(`SELECT count(*)::int AS n FROM tenant.project_expenses expense WHERE expense.organization_id = $1 AND expense.project_id = $2 AND expense.finance_status = 'VERIFIED'
      AND expense.status IN ('APPROVED', 'CORRECTION_REQUIRED') AND NOT EXISTS (SELECT 1 FROM tenant.project_expense_cost_allocations a WHERE a.expense_id = expense.id AND a.status <> 'REVERSED')`);
  if (unrecognized[0].n) out.push({ kind: "VERIFIED_WITHOUT_COST", code: "PROJECT_COST_RECONCILIATION_REQUIRED", message: `${unrecognized[0].n} verified expense(s) have no recognized cost allocation.` });
  // Overhead charged on a labor basis that has changed since (time approved or corrected later).
  for (const row of await q(`SELECT allocation.id, policy.method, policy.rate, allocation.basis_minutes, allocation.basis_amount, to_char(allocation.period_start, 'YYYY-MM-DD') AS s, to_char(allocation.period_end, 'YYYY-MM-DD') AS e,
        (SELECT COALESCE(sum(duration_minutes), 0)::int FROM tenant.project_time_entries t WHERE t.project_id = $2 AND t.entry_status = 'APPROVED' AND t.work_date BETWEEN allocation.period_start AND allocation.period_end) AS minutes,
        (SELECT COALESCE(sum(cost_amount), 0) FROM tenant.project_time_entries t WHERE t.project_id = $2 AND t.entry_status = 'APPROVED' AND t.work_date BETWEEN allocation.period_start AND allocation.period_end) AS cost
      FROM tenant.project_overhead_allocations allocation JOIN tenant.project_overhead_policies policy ON policy.id = allocation.policy_id
     WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status = 'RECOGNIZED'`)) {
    const changed = row.method === "PER_LABOR_HOUR" ? row.minutes !== row.basis_minutes : row.method === "PERCENT_OF_LABOR" ? Number(row.cost).toFixed(2) !== Number(row.basis_amount).toFixed(2) : false;
    if (changed) out.push({ kind: "OVERHEAD_BASIS_CHANGED", code: "PROJECT_COST_RECONCILIATION_REQUIRED", allocationId: row.id, message: `Overhead for ${row.s}…${row.e} was charged on a labor basis that has changed since — reverse and allocate it again.` });
  }
  if (["IN_PROGRESS", "ON_HOLD"].includes(project.status) && !(await approvedBudget(client, c, project.id))) out.push({ kind: "BUDGET_MISSING", code: "PROJECT_COST_BUDGET_MISSING", message: "No approved budget: cost cannot be compared." });
  return out;
}
// Rechecks every line against its source: labor cost = approved minutes × the snapshot rate; no source allocated beyond its value; no
// supplier line, goods issue or claim counted twice. Returns the checks and whether the cost view is consistent.
export async function reconcileProjectCost(client, c, projectId) {
  const { project, can } = await costScope(client, c, projectId);
  if (!can.reconcile && !can.lead) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const q = async (sql) => (await client.query(sql, [c.organizationId, project.id])).rows;
  const laborDrift = await q(`SELECT entry_number, duration_minutes, cost_rate, cost_amount FROM tenant.project_time_entries WHERE organization_id = $1 AND project_id = $2 AND entry_status = 'APPROVED'
      AND cost_amount IS NOT NULL AND abs(round(duration_minutes::numeric / 60 * cost_rate, 2) - round(cost_amount, 2)) > 0.01`);
  const overBills = await q(`SELECT line.id, bill.bill_number, line.net_amount, sum(a.amount) AS allocated FROM tenant.project_expense_cost_allocations a JOIN tenant.accounting_vendor_bill_lines line ON line.id = a.source_line_id
      JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE a.organization_id = $1 AND a.source_module = 'SUPPLIER_BILL' AND a.status <> 'REVERSED'
        AND line.id IN (SELECT source_line_id FROM tenant.project_expense_cost_allocations WHERE project_id = $2) GROUP BY line.id, bill.bill_number, line.net_amount HAVING sum(a.amount) > line.net_amount`);
  const doubles = await q(`SELECT source_module, source_id, count(*)::int AS n FROM tenant.project_expense_cost_allocations WHERE organization_id = $1 AND project_id = $2 AND status <> 'REVERSED'
      AND source_module <> 'SUPPLIER_BILL' GROUP BY source_module, source_id HAVING count(*) > 1`);
  const checks = [
    { key: "labor", label: "Labor cost equals approved minutes × the rate applied", ok: !laborDrift.length, details: laborDrift.map((row) => `TE-${row.entry_number}`) },
    { key: "capacity", label: "No supplier bill line allocated beyond its value", ok: !overBills.length, details: overBills.map((row) => `${row.bill_number}: ${row.allocated} of ${row.net_amount}`) },
    { key: "duplicates", label: "No claim or material issue counted twice", ok: !doubles.length, details: doubles.map((row) => `${row.source_module} ${row.source_id}`) },
  ];
  const exceptions = await getProjectCostExceptions(client, c, project.id, { scope: { project, can: { ...can, summary: true } } });
  return { projectId: project.id, consistent: checks.every((check) => check.ok), checks, exceptions, checkedAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ reports
export const COST_REPORTS = Object.freeze(["summary", "by-category", "by-task-milestone", "by-source", "labor", "expenses", "materials", "budget-vs-actual", "actual-plus-commitments", "forecast",
  "profitability", "variance-trend", "unallocated", "corrections", "exceptions"]);
export async function getProjectCostReport(client, c, kind = "summary", filters = {}) {
  if (!COST_REPORTS.includes(kind)) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Unknown report.");
  if (!has(c, COST.summary)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const ids = (await client.query(`SELECT project.id FROM tenant.projects project WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.status <> 'DRAFT'
      AND (${has(c, COST.reconcile) ? "TRUE" : visibilitySql(c, "project", "$2")}) AND ($3::uuid IS NULL OR project.id = $3) AND ($2::uuid IS NULL OR TRUE) ORDER BY project.project_code LIMIT 300`,
  [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows.map((row) => row.id);
  const rows = [];
  for (const id of ids) {
    let summary;
    try { summary = await getProjectCostSummary(client, c, id); } catch { continue; }
    const project = (await client.query(`SELECT project_code, name, status FROM tenant.projects WHERE id = $1`, [id])).rows[0];
    rows.push({ projectId: id, project: `${project.project_code}${project.name ? ` · ${project.name}` : ""}`, status: project.status, summary });
  }
  const pick = (fn) => rows.map((row) => ({ projectId: row.projectId, project: row.project, ...fn(row.summary) }));
  switch (kind) {
    case "summary": return pick((s) => ({ actual: s.actual, budget: s.budget.total ?? null, utilization: s.utilization, commitments: s.commitments.total, eac: s.eac, overrun: s.overrun || s.forecastOverrun }));
    case "by-category": return rows.flatMap((row) => row.summary.byCategory.map((cat) => ({ projectId: row.projectId, project: row.project, category: cat.label, amount: cat.amount, budget: cat.budget })));
    case "by-task-milestone": return rows.flatMap((row) => [...row.summary.byMilestone.map((x) => ({ projectId: row.projectId, project: row.project, kind: "Milestone", label: x.label, amount: x.amount })),
      ...row.summary.byTask.map((x) => ({ projectId: row.projectId, project: row.project, kind: "Task", label: x.label, amount: x.amount }))]);
    case "by-source": return rows.flatMap((row) => row.summary.bySource.map((x) => ({ projectId: row.projectId, project: row.project, source: x.label, amount: x.amount, lines: x.lines })));
    case "labor": return pick((s) => ({ hours: Math.round(s.labor.minutes / 6) / 10, total: s.labor.total, billable: s.labor.billable, nonBillable: s.labor.nonBillable, missingRate: s.labor.missingRate }));
    case "expenses": return pick((s) => ({ claims: s.bySource.find((x) => x.key === "EXPENSE_CLAIM")?.amount ?? "0.00", supplierBills: s.bySource.find((x) => x.key === "SUPPLIER_BILL")?.amount ?? "0.00", pending: s.pending.total }));
    case "materials": return pick((s) => ({ materials: s.bySource.find((x) => x.key === "GOODS_ISSUE")?.amount ?? "0.00" }));
    case "budget-vs-actual": return pick((s) => ({ budget: s.budget.total ?? null, actual: s.actual, remaining: s.remaining, utilization: s.utilization, overrun: s.overrun }));
    case "actual-plus-commitments": return pick((s) => ({ actual: s.actual, commitments: s.commitments.total, pending: s.pending.total, exposure: addMoney(s.actual, s.commitments.total, s.pending.total) }));
    case "forecast": return pick((s) => ({ actual: s.actual, etc: s.forecast?.estimateToComplete ?? null, treatment: s.forecast?.commitmentTreatment ?? null, eac: s.eac, budget: s.budget.total ?? null, variance: s.eacVariance }));
    case "profitability": {
      if (!has(c, COST.profitability)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
      return pick((s) => ({ contractValue: s.profitability?.contractValue ?? null, invoiced: s.profitability?.invoicedNet ?? null, actual: s.actual, contribution: s.profitability?.contribution ?? null, margin: s.profitability?.margin ?? null }));
    }
    case "variance-trend": {
      const out = [];
      for (const row of rows) {
        const versions = (await client.query(`SELECT version, estimate_to_complete, commitment_treatment, to_char(as_of_date, 'YYYY-MM-DD') AS d FROM tenant.project_cost_forecasts WHERE project_id = $1 ORDER BY version`, [row.projectId])).rows;
        for (const v of versions) out.push({ projectId: row.projectId, project: row.project, version: v.version, asOf: v.d, etc: moneyOut(v.estimate_to_complete), treatment: v.commitment_treatment });
      }
      return out;
    }
    case "unallocated": {
      if (!has(c, COST.detail)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
      return (await client.query(`SELECT line.id, bill.bill_number, line.description, line.net_amount, po.purchase_order_number, link.project_id,
          COALESCE((SELECT sum(a.amount) FROM tenant.project_expense_cost_allocations a WHERE a.source_line_id = line.id AND a.status <> 'REVERSED'), 0) AS allocated
         FROM tenant.project_links link JOIN tenant.purchase_orders po ON po.id = link.source_id JOIN tenant.accounting_vendor_bills bill ON bill.source_purchase_order_id = po.id AND bill.status NOT IN ('draft', 'cancelled', 'reversed')
         JOIN tenant.accounting_vendor_bill_lines line ON line.vendor_bill_id = bill.id
        WHERE link.organization_id = $1 AND link.source_type = 'PURCHASE_ORDER' AND link.removed_at IS NULL AND link.project_id = ANY($2::uuid[])`, [c.organizationId, ids])).rows
        .map((row) => ({ ...row, remaining: subMoney(row.net_amount, row.allocated) })).filter((row) => cmpMoney(row.remaining, "0") > 0);
    }
    case "corrections": return (await client.query(`SELECT 'Expense allocation' AS kind, a.project_id, a.amount, a.reversal_reason AS reason, a.reversed_at AS at FROM tenant.project_expense_cost_allocations a
        WHERE a.organization_id = $1 AND a.status = 'REVERSED' AND a.project_id = ANY($2::uuid[])
       UNION ALL SELECT 'Overhead allocation', o.project_id, o.amount, o.reversal_reason, o.reversed_at FROM tenant.project_overhead_allocations o WHERE o.organization_id = $1 AND o.status = 'REVERSED' AND o.project_id = ANY($2::uuid[])
       ORDER BY at DESC LIMIT 500`, [c.organizationId, ids])).rows.map((row) => ({ ...row, project: rows.find((r) => r.projectId === row.project_id)?.project ?? null }));
    case "exceptions": {
      const out = [];
      for (const row of rows) for (const ex of await getProjectCostExceptions(client, c, row.projectId).catch(() => [])) out.push({ projectId: row.projectId, project: row.project, ...ex });
      return out;
    }
    default: return [];
  }
}
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportProjectCost(client, c, projectId, filters = {}) {
  const { project, can } = await costScope(client, c, projectId);
  if (!can.export || !can.detail) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const lines = await projectCostLines(client, c, project, can, filters);
  const header = ["Date", "Source", "Reference", "Category", "Type", "Basis", "Task", "Milestone", "Amount", "Currency", ...(can.laborRate ? ["Rate"] : []), "Recognized"];
  const rows = lines.map((line) => [line.date, SOURCE_LABEL[line.sourceModule], line.sourceRef, CATEGORIES[line.category], line.costType, line.basis, line.task ?? "", line.milestone ?? "", line.amount ?? "missing rate",
    line.currency ?? "", ...(can.laborRate ? [line.rate ?? ""] : []), line.recognized === false ? "Pending" : "Yes"]);
  return { fileName: `${project.project_code}-cost.csv`, csv: [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"), count: rows.length };
}

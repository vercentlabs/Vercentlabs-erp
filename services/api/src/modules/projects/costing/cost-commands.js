// Projects — Project Cost, the commands: propose and approve a budget (versioned; a different person approves), record the estimate to
// complete (versioned, stating whether it includes open commitments), set the company's overhead policy and allocate it to a project per
// period (managerial cost — never a new ledger expense, never twice for the same period), reverse an allocation, and the alert job.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, isoDay, projectEvent, text, uuid } from "../project-core.js";
import { addMoney, money, moneyOut } from "../expenses/expense-rules.js";
import { CATEGORIES, COST, costError, costScope, pct } from "./cost-rules.js";
import { getProjectCostSummary } from "./cost-read.js";

const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
const currencyOf = async (client, c) => (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR";
const companyDay = async (client, c) => (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`,
  [c.organizationId])).rows[0].d;
const periodOpen = async (client, c, day) => {
  const period = (await client.query(`SELECT status, locked_at FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0];
  if (period && (period.locked_at || String(period.status).toLowerCase() !== "open")) throw costError(409, "PROJECT_COST_PERIOD_CLOSED");
};

// ------------------------------------------------------------------ budgets
// input: { lines: [{ category, amount }], reason, idempotencyKey? } — the total is the sum of the category amounts.
export async function proposeProjectBudget(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, version, status FROM tenant.project_cost_budgets WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { budgetId: done.id, version: done.version, status: done.status, replayed: true };
  }
  const { project, can } = await costScope(client, c, projectId);
  if (!can.allocate) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  if (["CANCELLED"].includes(project.status)) throw costError(409, "PROJECT_COST_INPUT_INVALID", "A cancelled project takes no new budget.");
  const lines = (Array.isArray(input.lines) ? input.lines : []).filter((line) => line && line.amount !== "" && line.amount !== null && line.amount !== undefined);
  if (!lines.length) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Give at least one category amount.", { field: "lines" });
  const seen = new Set();
  const clean = lines.map((line) => {
    const category = String(line.category ?? "").toUpperCase();
    if (!CATEGORIES[category]) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Choose a cost category.", { field: "category" });
    if (seen.has(category)) throw costError(400, "PROJECT_COST_INPUT_INVALID", `${CATEGORIES[category]} appears twice.`);
    seen.add(category);
    return { category, amount: money(line.amount, "amount", { allowZero: true }) };
  });
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Say what the budget covers or why it changes.", { field: "reason" });
  await client.query(`SELECT id FROM tenant.projects WHERE id = $1 FOR UPDATE`, [project.id]);
  if ((await client.query(`SELECT 1 FROM tenant.project_cost_budgets WHERE project_id = $1 AND status = 'PROPOSED'`, [project.id])).rows[0]) {
    throw costError(409, "PROJECT_COST_VERSION_CONFLICT", "A proposed budget is already waiting for approval.");
  }
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.project_cost_budgets WHERE project_id = $1`, [project.id])).rows[0].v);
  const total = addMoney("0", ...clean.map((line) => line.amount));
  const row = (await client.query(`INSERT INTO tenant.project_cost_budgets (organization_id, project_id, version, total_amount, currency, reason, proposed_by, idempotency_key) VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8) RETURNING id`,
    [c.organizationId, project.id, version, total, await currencyOf(client, c), reason, c.userId ?? null, key])).rows[0];
  for (const line of clean) await client.query(`INSERT INTO tenant.project_cost_budget_lines (organization_id, budget_id, category, amount) VALUES ($1,$2,$3,$4::numeric)`, [c.organizationId, row.id, line.category, line.amount]);
  await projectEvent(client, c, project.id, "COST_BUDGET_PROPOSED", `Cost budget v${version} proposed: ${total} — ${reason}`);
  return { budgetId: row.id, version, total, status: "PROPOSED" };
}
// input: { decision: APPROVE | REJECT, note? } — by someone allowed to approve cost allocations, not the person who proposed it.
export async function decideProjectBudget(client, c, budgetId, input = {}) {
  if (!has(c, COST.approve)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const budget = (await client.query(`SELECT * FROM tenant.project_cost_budgets WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(budgetId, "Budget")])).rows[0];
  if (!budget) throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND", "Budget not found.");
  const decision = String(input.decision ?? "").toUpperCase();
  if (budget.status !== "PROPOSED") return { budgetId: budget.id, status: budget.status, replayed: true };
  if (budget.proposed_by === c.userId) throw costError(403, "PROJECT_COST_PERMISSION_DENIED", "Someone other than its author approves a budget.");
  if (!["APPROVE", "REJECT"].includes(decision)) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Approve or reject the budget.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && !note) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Say why the budget is rejected.", { field: "note" });
  if (decision === "APPROVE") await client.query(`UPDATE tenant.project_cost_budgets SET status = 'SUPERSEDED' WHERE project_id = $1 AND status = 'APPROVED'`, [budget.project_id]);
  await client.query(`UPDATE tenant.project_cost_budgets SET status = $2, decided_by = $3, decided_at = clock_timestamp(), decision_note = $4 WHERE id = $1`,
    [budget.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  await projectEvent(client, c, budget.project_id, decision === "APPROVE" ? "COST_BUDGET_APPROVED" : "COST_BUDGET_REJECTED", `Cost budget v${budget.version} ${decision === "APPROVE" ? "approved" : "rejected"}${note ? `: ${note}` : ""}`);
  if (decision === "APPROVE") await alertIfOverrun(client, c, budget.project_id);
  return { budgetId: budget.id, status: decision === "APPROVE" ? "APPROVED" : "REJECTED" };
}

// ------------------------------------------------------------------ the forecast
// input: { estimateToComplete, commitmentTreatment: INCLUDED | EXCLUDED, asOfDate?, notes?, idempotencyKey? }
export async function saveProjectCostForecast(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT version FROM tenant.project_cost_forecasts WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { version: done.version, replayed: true };
  }
  const { project, can } = await costScope(client, c, projectId);
  if (!can.forecast) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const etc = money(input.estimateToComplete, "estimateToComplete", { allowZero: true });
  const treatment = String(input.commitmentTreatment ?? "").toUpperCase();
  if (!["INCLUDED", "EXCLUDED"].includes(treatment)) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Say whether the estimate already includes the open purchase commitments.", { field: "commitmentTreatment" });
  const asOf = input.asOfDate ? isoDay(input.asOfDate) : await companyDay(client, c);
  await client.query(`SELECT id FROM tenant.projects WHERE id = $1 FOR UPDATE`, [project.id]);
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.project_cost_forecasts WHERE project_id = $1`, [project.id])).rows[0].v);
  await client.query(`INSERT INTO tenant.project_cost_forecasts (organization_id, project_id, version, estimate_to_complete, currency, as_of_date, commitment_treatment, notes, created_by, idempotency_key)
      VALUES ($1,$2,$3,$4::numeric,$5,$6::date,$7,$8,$9,$10)`, [c.organizationId, project.id, version, etc, await currencyOf(client, c), asOf, treatment, text(input.notes, 2000) || null, c.userId ?? null, key]);
  await projectEvent(client, c, project.id, "COST_FORECAST_UPDATED", `Estimate to complete v${version}: ${etc} (${treatment === "INCLUDED" ? "includes" : "excludes"} open commitments)`);
  await alertIfOverrun(client, c, project.id);
  return { version, estimateToComplete: etc };
}

// ------------------------------------------------------------------ overhead
// input: { method: PER_LABOR_HOUR | PERCENT_OF_LABOR | FIXED_AMOUNT, rate, projectId? (required for a fixed amount), effectiveFrom, effectiveTo?, description }
export async function setOverheadPolicy(client, c, input = {}) {
  if (!has(c, COST.approve)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const method = String(input.method ?? "").toUpperCase();
  if (!["PER_LABOR_HOUR", "PERCENT_OF_LABOR", "FIXED_AMOUNT"].includes(method)) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Choose how overhead is allocated.", { field: "method" });
  const rate = money(input.rate, "rate");
  if (method === "PERCENT_OF_LABOR" && Number(rate) > 500) throw costError(400, "PROJECT_COST_INPUT_INVALID", "A percentage above 500% is not plausible.", { field: "rate" });
  const projectId = input.projectId ? uuid(input.projectId, "Project") : null;
  if (method === "FIXED_AMOUNT" && !projectId) throw costError(400, "PROJECT_COST_INPUT_INVALID", "A fixed overhead amount is for one project.", { field: "projectId" });
  const from = isoDay(input.effectiveFrom);
  if (!from) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Give the date it applies from.", { field: "effectiveFrom" });
  const to = input.effectiveTo ? isoDay(input.effectiveTo) : null;
  const description = text(input.description, 500);
  if (description.length < 3) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Describe the overhead (what it recovers).", { field: "description" });
  const row = (await client.query(`INSERT INTO tenant.project_overhead_policies (organization_id, method, rate, currency, project_id, effective_from, effective_to, description, created_by)
      VALUES ($1,$2,$3::numeric,$4,$5,$6::date,$7::date,$8,$9) RETURNING id, policy_number`, [c.organizationId, method, rate, await currencyOf(client, c), projectId, from, to, description, c.userId ?? null])).rows[0];
  return { policyId: row.id, number: `OH-${row.policy_number}` };
}
export async function endOverheadPolicy(client, c, policyId, input = {}) {
  if (!has(c, COST.approve)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const policy = (await client.query(`SELECT * FROM tenant.project_overhead_policies WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(policyId, "Overhead policy")])).rows[0];
  if (!policy) throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND", "Overhead policy not found.");
  if (policy.status === "ENDED") return { policyId: policy.id, status: "ENDED", replayed: true };
  const to = input.effectiveTo ? isoDay(input.effectiveTo) : await companyDay(client, c);
  await client.query(`UPDATE tenant.project_overhead_policies SET status = 'ENDED', effective_to = LEAST(COALESCE(effective_to, $2::date), $2::date), ended_by = $3, ended_at = clock_timestamp() WHERE id = $1`,
    [policy.id, to, c.userId ?? null]);
  return { policyId: policy.id, status: "ENDED" };
}
export async function listOverheadPolicies(client, c) {
  if (!has(c, COST.summary)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  return (await client.query(`SELECT policy.*, to_char(policy.effective_from, 'YYYY-MM-DD') AS f, to_char(policy.effective_to, 'YYYY-MM-DD') AS t, project.project_code FROM tenant.project_overhead_policies policy
      LEFT JOIN tenant.projects project ON project.id = policy.project_id WHERE policy.organization_id = $1 ORDER BY policy.policy_number DESC`, [c.organizationId])).rows
    .map((row) => ({ id: row.id, number: `OH-${row.policy_number}`, method: row.method, rate: String(row.rate), currency: row.currency, project: row.project_code ?? "All projects", projectId: row.project_id,
      effectiveFrom: row.f, effectiveTo: row.t, description: row.description, status: row.status }));
}
// input: { periodStart, periodEnd } — each active policy that applies to the project and period, computed from the approved labor in it.
export async function applyProjectOverhead(client, c, projectId, input = {}) {
  const { project, can } = await costScope(client, c, projectId);
  if (!can.allocate || !has(c, COST.reconcile)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED", "Overhead is allocated by Finance.");
  const start = isoDay(input.periodStart);
  const end = isoDay(input.periodEnd);
  if (!start || !end || end < start) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Give the period (start and end).", { field: "periodStart" });
  await periodOpen(client, c, end);
  const policies = (await client.query(`SELECT * FROM tenant.project_overhead_policies WHERE organization_id = $1 AND status = 'ACTIVE' AND (project_id IS NULL OR project_id = $2)
      AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $3::date)`, [c.organizationId, project.id, start, end])).rows;
  if (!policies.length) throw costError(409, "PROJECT_COST_SOURCE_NOT_ELIGIBLE", "No overhead policy applies to this project and period.");
  const basis = (await client.query(`SELECT COALESCE(sum(duration_minutes), 0)::int AS minutes, COALESCE(sum(cost_amount), 0) AS cost, count(*) FILTER (WHERE cost_amount IS NULL)::int AS missing
     FROM tenant.project_time_entries WHERE organization_id = $1 AND project_id = $2 AND entry_status = 'APPROVED' AND work_date BETWEEN $3::date AND $4::date`, [c.organizationId, project.id, start, end])).rows[0];
  const made = [];
  for (const policy of policies) {
    let amount;
    if (policy.method === "PER_LABOR_HOUR") amount = moneyOut(((basis.minutes / 60) * Number(policy.rate)).toFixed(2));
    else if (policy.method === "PERCENT_OF_LABOR") {
      if (basis.missing) throw costError(409, "PROJECT_COST_RATE_MISSING", `${basis.missing} approved entr${basis.missing === 1 ? "y has" : "ies have"} no labor rate: the labor cost basis is incomplete.`);
      amount = moneyOut(((Number(basis.cost) * Number(policy.rate)) / 100).toFixed(2));
    } else amount = moneyOut(policy.rate);
    try {
      await client.query("SAVEPOINT overhead_allocation");
      const row = (await client.query(`INSERT INTO tenant.project_overhead_allocations (organization_id, project_id, policy_id, period_start, period_end, basis_minutes, basis_amount, amount, currency, created_by)
          VALUES ($1,$2,$3,$4::date,$5::date,$6,$7::numeric,$8::numeric,$9,$10) RETURNING id`,
      [c.organizationId, project.id, policy.id, start, end, basis.minutes, Number(basis.cost).toFixed(2), amount, policy.currency, c.userId ?? null])).rows[0];
      await client.query("RELEASE SAVEPOINT overhead_allocation");
      made.push({ allocationId: row.id, policy: `OH-${policy.policy_number}`, amount });
    } catch (failure) {
      await client.query("ROLLBACK TO SAVEPOINT overhead_allocation");
      if (failure?.code === "23505") throw costError(409, "PROJECT_COST_ALREADY_ALLOCATED", `OH-${policy.policy_number} is already allocated for a period starting ${start}.`);
      throw failure;
    }
  }
  await projectEvent(client, c, project.id, "COST_OVERHEAD_ALLOCATED", `Overhead ${start}…${end}: ${made.map((row) => `${row.policy} ${row.amount}`).join(", ")}`);
  await alertIfOverrun(client, c, project.id);
  return { projectId: project.id, allocations: made, total: addMoney("0", ...made.map((row) => row.amount)) };
}
export async function reverseOverheadAllocation(client, c, allocationId, input = {}) {
  if (!has(c, COST.reconcile)) throw costError(403, "PROJECT_COST_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.project_overhead_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(allocationId, "Allocation")])).rows[0];
  if (!row) throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND");
  if (row.status === "REVERSED") return { allocationId: row.id, status: "REVERSED", replayed: true };
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw costError(400, "PROJECT_COST_INPUT_INVALID", "Say why.", { field: "reason" });
  await periodOpen(client, c, await companyDay(client, c));
  await client.query(`UPDATE tenant.project_overhead_allocations SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE id = $1`, [row.id, c.userId ?? null, reason]);
  await projectEvent(client, c, row.project_id, "COST_OVERHEAD_REVERSED", `Overhead ${row.amount} reversed: ${reason}`);
  return { allocationId: row.id, status: "REVERSED" };
}

// ------------------------------------------------------------------ alerts
// The project's manager is told once a day when actual cost (or the estimate at completion) reaches the company's alert threshold of the budget.
async function alertIfOverrun(client, c, projectId) {
  const project = (await client.query(`SELECT id, project_code, manager_user_id FROM tenant.projects WHERE id = $1`, [projectId])).rows[0];
  if (!project?.manager_user_id) return;
  let summary;
  try { summary = await getProjectCostSummary(client, { ...c, permissions: [...(c.permissions ?? []), COST.summary, COST.reconcile] }, projectId); } catch { return; }
  if (!summary.budget?.total) return;
  const threshold = Number((await client.query(`SELECT cost_overrun_alert_percent FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.cost_overrun_alert_percent ?? 90);
  const actualPct = pct(summary.actual, summary.budget.total) ?? 0;
  const eacPct = summary.eac ? pct(summary.eac, summary.budget.total) ?? 0 : 0;
  if (actualPct < threshold && eacPct <= 100) return;
  const day = await companyDay(client, c);
  const marker = `cost-alert:${project.id}:${day}`;
  if ((await client.query(`SELECT 1 FROM notifications WHERE organization_id = $1 AND user_id = $2 AND entity_type = 'projects.cost' AND entity_id = $3 LIMIT 1`, [c.organizationId, project.manager_user_id, marker])).rows[0]) return;
  await createNotification(client, { organizationId: c.organizationId, userId: project.manager_user_id, category: "project_cost",
    title: `${project.project_code}: cost at ${actualPct}% of budget`, message: eacPct > 100 ? `The estimate at completion (${summary.eac}) is above the approved budget (${summary.budget.total}).` : `Actual cost ${summary.actual} of ${summary.budget.total} budgeted.`,
    href: `/projects/${project.id}?tab=financials`, entityType: "projects.cost", entityId: marker });
}
export async function evaluateProjectCostAlerts(client, c) {
  const rows = (await client.query(`SELECT DISTINCT project_id FROM tenant.project_cost_budgets WHERE organization_id = $1 AND status = 'APPROVED'`, [c.organizationId])).rows;
  for (const row of rows) await alertIfOverrun(client, c, row.project_id);
  return { checked: rows.length };
}

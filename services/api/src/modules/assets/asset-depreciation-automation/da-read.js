// Assets — Automatic Depreciation Accounting, reads: the automation's settings and versions, its health (what is pending, blocked, being
// verified or overdue), the executions and their attempts, the coming months, a run's balanced journal preview with its asset-level
// allocations, the audit trail and the accounting reports. Figures follow the depreciation financial-figures permission.
import { has, uuid } from "../common.js";
import { DP } from "../asset-depreciation/dp-rules.js";
import { fromPaise, toPaise } from "../asset-depreciation/dp-engine.js";
import { activePolicy, eligibleMonth, runOutcome, validateAutomationReadiness } from "./da-commands.js";
import { DA, EXECUTION, MODE, RECONCILIATION, addDays, addMonths, daError, dayOfDb, monthEnd, monthStart, requireDa } from "./da-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const amt = (c, v) => (has(c, DP.financials) ? (v === null || v === undefined ? null : String(v)) : null);
const today = () => new Date().toISOString().slice(0, 10);
const policyView = (p) => (p ? { id: p.id, version: p.version, mode: p.mode, modeLabel: MODE[p.mode], triggerDaysAfterPeriodEnd: p.trigger_days_after_period_end, closeDeadlineDays: p.close_deadline_days,
  firstPeriod: dayOfDb(p.first_period), notifyFinance: p.notify_finance, postingUser: p.posting_user ?? null, enabledBy: p.enabler ?? null, enabledAt: iso(p.enabled_at), reason: p.reason,
  savedBy: p.creator ?? null, savedAt: iso(p.created_at), status: p.status } : null);
const POLICY_SQL = `SELECT p.*, ${NAME("pu")} AS posting_user, ${NAME("en")} AS enabler, ${NAME("cr")} AS creator FROM tenant.asset_depreciation_automation_policies p
  LEFT JOIN public.users pu ON pu.id = p.posting_user_id LEFT JOIN public.users en ON en.id = p.enabled_by LEFT JOIN public.users cr ON cr.id = p.created_by`;
const EXEC_SQL = `SELECT x.*, o.run_number, o.status AS run_status, o.proposed_total, o.posted_total, o.journal_entry_id, je.entry_number AS journal_number, ${NAME("tb")} AS triggered_by_name
  FROM tenant.asset_depreciation_automation_executions x LEFT JOIN tenant.asset_depreciation_period_runs o ON o.id = x.run_id
  LEFT JOIN tenant.accounting_journal_entries je ON je.id = o.journal_entry_id LEFT JOIN public.users tb ON tb.id = x.triggered_by`;
const execView = (c, x) => ({ id: x.id, period: dayOfDb(x.period_start).slice(0, 7), mode: x.mode, modeLabel: MODE[x.mode], trigger: x.trigger, status: x.status, statusLabel: EXECUTION[x.status],
  reconciliation: x.reconciliation, reconciliationLabel: x.reconciliation ? RECONCILIATION[x.reconciliation] : null, attempts: x.attempts, errorCode: x.error_code, error: x.error_summary,
  runId: x.run_id, run: x.run_number, runStatus: x.run_status, proposedTotal: amt(c, x.proposed_total), postedTotal: amt(c, x.posted_total), journalEntryId: x.journal_entry_id, journalNumber: x.journal_number,
  journalHref: x.journal_entry_id && has(c, "accounting.view") ? `/accounting/journals/${x.journal_entry_id}` : null, policyVersion: x.policy_version, triggeredBy: x.triggered_by_name,
  startedAt: iso(x.started_at), completedAt: iso(x.completed_at), href: x.run_id ? `/assets/depreciation/runs/${x.run_id}` : null });

// The automation workspace overview: settings, readiness, health and the coming months.
export async function getDepreciationAutomation(client, c) {
  requireDa(c, DA.view);
  const org = c.organizationId;
  const current = (await client.query(`${POLICY_SQL} WHERE p.organization_id = $1 AND p.status = 'ACTIVE'`, [org])).rows[0] ?? null;
  const policy = current ?? (await activePolicy(client, c));
  const effective = policy ?? { mode: "PREPARE_APPROVE", trigger_days_after_period_end: 0, close_deadline_days: 10, first_period: monthStart(today()) };
  const executions = (await client.query(`${EXEC_SQL} WHERE x.organization_id = $1 ORDER BY x.period_start DESC, x.started_at DESC LIMIT 24`, [org])).rows.map((x) => execView(c, x));
  const due = eligibleMonth(effective);
  // Months whose depreciation is still unposted past the close deadline.
  const overdue = (await client.query(`SELECT to_char(l.period_start, 'YYYY-MM') AS month, count(DISTINCT l.asset_id)::int AS assets, sum(l.amount)::text AS amount
      FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT'
      WHERE l.organization_id = $1 AND (l.period_end + make_interval(days => $2)) < current_date
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED') GROUP BY 1 ORDER BY 1`,
    [org, effective.close_deadline_days])).rows.map((r) => ({ month: r.month, assets: r.assets, amount: amt(c, r.amount) }));
  const count = (status) => executions.filter((x) => x.status === status).length;
  const mismatches = executions.filter((x) => x.reconciliation === "MISMATCH").length;
  const health = mismatches || count("FAILED") || count("POSTING") ? "ATTENTION" : count("EXCEPTION") || overdue.length ? "WARNING" : "HEALTHY";
  return {
    policy: policyView(current), configured: Boolean(current), effectiveMode: effective.mode, effectiveModeLabel: MODE[effective.mode], book: "Financial reporting",
    nextEligibleMonth: due ? due.slice(0, 7) : null, health, healthLabel: { HEALTHY: "Healthy", WARNING: "Needs attention soon", ATTENTION: "Needs attention" }[health],
    counts: { awaitingApproval: count("AWAITING_APPROVAL"), exceptions: count("EXCEPTION"), failed: count("FAILED"), verifying: count("POSTING"), mismatches, overdueMonths: overdue.length },
    overdue, executions: executions.slice(0, 6), upcoming: await upcoming(client, c, effective), readiness: await validateAutomationReadiness(client, c),
    note: "Depreciation is calculated by the approved schedules; only Finance's confirmed journal makes a month posted.",
    can: { configure: has(c, DA.configure), enable: has(c, DA.enable) && has(c, DP.post) && has(c, "accounting.journal.post"), retry: has(c, DA.retry), run: has(c, DP.prepare) || has(c, DA.retry) },
  };
}
// The next months: when each becomes eligible, what the plans expect, and whether a run exists.
async function upcoming(client, c, policy) {
  const out = [];
  const start = eligibleMonth(policy) ? addMonths(eligibleMonth(policy), 0) : dayOfDb(policy.first_period);
  for (let i = 0; i < 3; i += 1) {
    const m = addMonths(start, i);
    const expected = (await client.query(`SELECT COALESCE(sum(l.amount), 0)::text AS t, count(DISTINCT l.asset_id)::int AS n FROM tenant.asset_depreciation_schedule_lines l
        JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT' WHERE l.organization_id = $1 AND l.period_start = $2`, [c.organizationId, m])).rows[0];
    const run = (await client.query(`SELECT id, run_number, status FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND period_start = $2 AND status <> 'CANCELLED'`, [c.organizationId, m])).rows[0];
    out.push({ month: m.slice(0, 7), eligibleOn: addDays(monthEnd(m), policy.trigger_days_after_period_end), expected: amt(c, expected.t), assets: expected.n, run: run?.run_number ?? null, runStatus: run?.status ?? null,
      href: run ? `/assets/depreciation/runs/${run.id}` : null });
  }
  return out;
}
const VIEWS = { all: null, awaiting: ["AWAITING_APPROVAL"], history: ["POSTED"], failed: ["FAILED", "EXCEPTION", "POSTING"], skipped: ["SKIPPED"] };
export async function listDepreciationExecutions(client, c, filters = {}) {
  requireDa(c, DA.view);
  const statuses = Object.hasOwn(VIEWS, filters.view ?? "all") ? VIEWS[filters.view ?? "all"] : null;
  const rows = (await client.query(`${EXEC_SQL} WHERE x.organization_id = $1 AND ($2::text[] IS NULL OR x.status = ANY($2::text[])) ORDER BY x.period_start DESC, x.started_at DESC LIMIT 200`,
    [c.organizationId, statuses])).rows.map((x) => execView(c, x));
  return { rows };
}
export async function getDepreciationExecution(client, c, executionId) {
  requireDa(c, DA.view);
  let id;
  try { id = uuid(executionId, "Execution"); } catch { throw daError(404, "DEPRECIATION_AUTO_INVALID", "This execution is not available."); }
  const x = (await client.query(`${EXEC_SQL} WHERE x.organization_id = $1 AND x.id = $2`, [c.organizationId, id])).rows[0];
  if (!x) throw daError(404, "DEPRECIATION_AUTO_INVALID", "This execution is not available.");
  const attempts = (await client.query(`SELECT attempt, outcome, details, occurred_at FROM tenant.asset_depreciation_automation_attempts WHERE execution_id = $1 ORDER BY occurred_at`, [id])).rows
    .map((a) => ({ attempt: a.attempt, outcome: a.outcome, details: a.details, at: iso(a.occurred_at) }));
  return { ...execView(c, x), details: x.details, attempts };
}

// A run's journal before it is posted (and after): one debit to depreciation expense and one credit to accumulated depreciation per account
// pair, each with the assets and months it carries, the department breakdown, and whether it balances.
export async function getDepreciationJournalPreview(client, c, runId) {
  if (!has(c, DP.view) && !has(c, DA.view)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED");
  let id;
  try { id = uuid(runId, "Run"); } catch { throw daError(404, "DEPRECIATION_AUTO_INVALID", "This run is not available."); }
  const run = (await client.query(`SELECT o.*, je.entry_number, je.status AS journal_status FROM tenant.asset_depreciation_period_runs o LEFT JOIN tenant.accounting_journal_entries je ON je.id = o.journal_entry_id
      WHERE o.organization_id = $1 AND o.id = $2`, [c.organizationId, id])).rows[0];
  if (!run) throw daError(404, "DEPRECIATION_AUTO_INVALID", "This run is not available.");
  const lines = (await client.query(`SELECT l.*, a.asset_number, a.name, ea.code AS e_code, ea.name AS e_name, aa.code AS a_code, aa.name AS a_name, d.name AS department, to_char(l.period_start, 'YYYY-MM') AS month
      FROM tenant.asset_depreciation_run_lines l JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.accounting_accounts ea ON ea.id = l.expense_account_id
      LEFT JOIN tenant.accounting_accounts aa ON aa.id = l.accumulated_account_id LEFT JOIN public.departments d ON d.id = l.department_id
      WHERE l.run_id = $1 AND l.status IN ('INCLUDED', 'POSTED') AND l.amount > 0 ORDER BY ea.code, aa.code, a.asset_number, l.period_start`, [id])).rows;
  const groups = new Map();
  for (const l of lines) {
    const key = `${l.expense_account_id}|${l.accumulated_account_id}`;
    const g = groups.get(key) ?? { expenseAccount: l.e_code ? `${l.e_code} ${l.e_name}` : null, accumulatedAccount: l.a_code ? `${l.a_code} ${l.a_name}` : null, total: 0n, departments: new Map(), allocations: [] };
    g.total += toPaise(String(l.amount));
    g.departments.set(l.department ?? "No department", (g.departments.get(l.department ?? "No department") ?? 0n) + toPaise(String(l.amount)));
    g.allocations.push({ assetId: l.asset_id, asset: `${l.asset_number} · ${l.name}`, month: l.month, amount: amt(c, l.amount), status: l.status, catchUp: l.month < dayOfDb(run.period_start).slice(0, 7) });
    groups.set(key, g);
  }
  const out = [...groups.values()];
  const debit = out.reduce((t, g) => t + g.total, 0n);
  const credit = debit; // each group is one debit and one equal credit
  return {
    runId: run.id, run: run.run_number, period: dayOfDb(run.period_start).slice(0, 7), journalDate: dayOfDb(run.period_end), status: run.status, book: "Financial reporting",
    journal: run.journal_entry_id ? { id: run.journal_entry_id, number: run.entry_number, status: run.journal_status, href: has(c, "accounting.view") ? `/accounting/journals/${run.journal_entry_id}` : null } : null,
    lines: out.flatMap((g) => [{ account: g.expenseAccount, debit: amt(c, fromPaise(g.total)), credit: null, assets: g.allocations.length }, { account: g.accumulatedAccount, debit: null, credit: amt(c, fromPaise(g.total)), assets: g.allocations.length }]),
    groups: out.map((g) => ({ expenseAccount: g.expenseAccount, accumulatedAccount: g.accumulatedAccount, total: amt(c, fromPaise(g.total)), departments: [...g.departments.entries()].map(([name, t]) => ({ name, total: amt(c, fromPaise(t)) })),
      allocations: g.allocations })),
    totalDebit: amt(c, fromPaise(debit)), totalCredit: amt(c, fromPaise(credit)), balanced: debit === credit, mapped: out.every((g) => g.expenseAccount && g.accumulatedAccount),
    catchUpMonths: [...new Set(lines.map((l) => l.month).filter((m) => m < dayOfDb(run.period_start).slice(0, 7)))], reconciliation: await runOutcome(client, run.id),
  };
}

// Settings changes, approvals and attempts — the automation's audit trail.
export async function getDepreciationAutomationAudit(client, c) {
  requireDa(c, DA.view);
  if (!has(c, DP.audit) && !has(c, DA.enable)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED");
  const versions = (await client.query(`${POLICY_SQL} WHERE p.organization_id = $1 ORDER BY p.version DESC`, [c.organizationId])).rows.map(policyView);
  const attempts = (await client.query(`SELECT t.attempt, t.outcome, t.details, t.occurred_at, to_char(x.period_start, 'YYYY-MM') AS month, x.trigger FROM tenant.asset_depreciation_automation_attempts t
      JOIN tenant.asset_depreciation_automation_executions x ON x.id = t.execution_id WHERE t.organization_id = $1 ORDER BY t.occurred_at DESC LIMIT 300`, [c.organizationId])).rows
    .map((a) => ({ month: a.month, trigger: a.trigger, attempt: a.attempt, outcome: a.outcome, details: a.details, at: iso(a.occurred_at) }));
  return { versions, attempts };
}

export const AUTOMATION_REPORTS = Object.freeze(["run-history", "posted-journals", "by-gl-account", "missing-postings", "failed-partial", "policy-changes", "opening-first-period"]);
export async function getDepreciationAutomationReport(client, c, kind) {
  if (!AUTOMATION_REPORTS.includes(kind)) throw daError(404, "DEPRECIATION_AUTO_INVALID", "There is no such report.");
  requireDa(c, DA.view);
  const org = c.organizationId;
  switch (kind) {
    case "run-history": return { rows: (await listDepreciationExecutions(client, c, {})).rows.map((x) => ({ month: x.period, mode: x.modeLabel, trigger: x.trigger, status: x.statusLabel, reconciliation: x.reconciliationLabel,
      run: x.run, posted: x.postedTotal, attempts: x.attempts, href: x.href })) };
    case "posted-journals": return { rows: (await client.query(`SELECT o.id, o.run_number, to_char(o.period_start, 'YYYY-MM') AS month, o.posted_total::text AS total, je.entry_number, je.status AS journal_status, o.prepared_by_automation,
        to_char(o.posted_at, 'YYYY-MM-DD HH24:MI') AS posted_at FROM tenant.asset_depreciation_period_runs o LEFT JOIN tenant.accounting_journal_entries je ON je.id = o.journal_entry_id
        WHERE o.organization_id = $1 AND o.status = 'POSTED' ORDER BY o.period_start DESC`, [org])).rows.map((r) => ({ run: r.run_number, month: r.month, posted: amt(c, r.total), journal: r.entry_number,
        journalStatus: r.journal_status, preparedBy: r.prepared_by_automation ? "Automation" : "A person", postedAt: r.posted_at, href: `/assets/depreciation/runs/${r.id}` })) };
    case "by-gl-account": return { rows: (await client.query(`SELECT ea.code || ' ' || ea.name AS expense, aa.code || ' ' || aa.name AS accumulated, to_char(l.period_start, 'YYYY-MM') AS month, sum(l.amount)::text AS total, count(*)::int AS allocations
        FROM tenant.asset_depreciation_run_lines l LEFT JOIN tenant.accounting_accounts ea ON ea.id = l.expense_account_id LEFT JOIN tenant.accounting_accounts aa ON aa.id = l.accumulated_account_id
        WHERE l.organization_id = $1 AND l.status = 'POSTED' GROUP BY 1, 2, 3 ORDER BY 3 DESC, 1`, [org])).rows.map((r) => ({ ...r, total: amt(c, r.total) })) };
    case "missing-postings": return { rows: (await getDepreciationAutomation(client, c)).overdue };
    case "failed-partial": return { rows: (await listDepreciationExecutions(client, c, { view: "failed" })).rows.map((x) => ({ month: x.period, status: x.statusLabel, error: x.error, run: x.run, attempts: x.attempts, href: x.href })) };
    case "policy-changes": return { rows: (await client.query(`${POLICY_SQL} WHERE p.organization_id = $1 ORDER BY p.version DESC`, [org])).rows.map((p) => ({ version: p.version, mode: MODE[p.mode],
      closeWindowDays: p.trigger_days_after_period_end, firstPeriod: dayOfDb(p.first_period).slice(0, 7), postingUser: p.posting_user, savedBy: p.creator, savedAt: iso(p.created_at), reason: p.reason })) };
    // The first months after a migration: what existed before Vercentlabs, the first charge Vercentlabs posts, and the new balance.
    case "opening-first-period": return { rows: (await client.query(`SELECT a.id, a.asset_number, a.name, b.accumulated_before::text AS before, to_char(b.commencement_date, 'YYYY-MM') AS first_month,
        (SELECT l.amount::text FROM tenant.asset_depreciation_run_lines l WHERE l.asset_id = b.asset_id AND l.status = 'POSTED' ORDER BY l.period_start LIMIT 1) AS first_posted,
        (SELECT sl.amount::text FROM tenant.asset_depreciation_schedule_lines sl JOIN tenant.asset_depreciation_schedule_versions v ON v.id = sl.schedule_id AND v.basis_id = b.id ORDER BY sl.period_start LIMIT 1) AS first_planned
        FROM tenant.asset_depreciation_bases b JOIN tenant.assets a ON a.id = b.asset_id WHERE b.organization_id = $1 AND b.source = 'OPENING' ORDER BY a.asset_number`, [org])).rows
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, beforeVercentlabs: amt(c, r.before), firstMonth: r.first_month, firstCharge: amt(c, r.first_posted ?? r.first_planned), firstChargePosted: Boolean(r.first_posted),
        expectedBalance: amt(c, fromPaise(toPaise(r.before) + toPaise(r.first_posted ?? r.first_planned ?? "0"))), href: `/assets/register/${r.id}?tab=financials` })) };
    default: return { rows: [] };
  }
}

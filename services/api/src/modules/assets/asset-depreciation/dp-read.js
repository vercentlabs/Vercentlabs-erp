// Assets — Straight-Line Depreciation, reads: the overview, the depreciable-asset directory, an asset's depreciation (basis, schedule with
// each month's posting status, financial-year totals, history), policies, runs and their per-asset lines, estimate changes, exceptions,
// reconciliation with the General Ledger, reports and export. Costs and balances need the financial-figures permission.
import { has, text, uuid } from "../common.js";
import { financialYearOf, fromPaise, sameAmount, toPaise } from "./dp-engine.js";
import { BASIS_SOURCE, CONVENTION, DP, EXCLUSION, LIFECYCLE, PERIOD_STATUS, RUN_STATUS, dayOfDb, dpError, requireDp, seesDepreciation } from "./dp-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;
const see = (c) => { if (!seesDepreciation(c)) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED"); };
// Amounts are Finance's figures: shown with the financial-figures permission only.
const amt = (c, v) => (has(c, DP.financials) ? (v === null || v === undefined ? null : String(v)) : null);

// Per asset: where its depreciation stands, from its approved basis, current schedule and posted run lines.
const STATE_SQL = `
  SELECT a.id, a.asset_number, a.name, a.capitalization_class, a.lifecycle_status, a.status AS legacy_status, a.capitalized_cost, a.accumulated_depreciation, a.impairment_accumulated, a.net_book_value,
    a.category_id, cat.name AS category, a.current_department_id, d.name AS department,
    b.id AS basis_id, b.basis_version, b.source, b.residual_value, b.useful_life_months, b.remaining_life_months, b.commencement_date, b.convention, b.policy_id, p.name AS policy, p.version AS policy_version,
    b.cost_basis, b.impairment_before, s.id AS schedule_id, s.version AS schedule_version, s.inputs ->> 'monthly' AS monthly,
    (SELECT count(*)::int FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = s.id) AS lines,
    (SELECT count(*)::int FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = s.id AND EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')) AS posted_lines,
    (SELECT min(l.period_start) FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = s.id AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')) AS next_period,
    (SELECT max(r.period_start) FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = a.id AND r.status = 'POSTED') AS last_posted,
    EXISTS (SELECT 1 FROM tenant.asset_depreciation_bases pb WHERE pb.asset_id = a.id AND pb.status = 'PROPOSED') AS has_proposal,
    (SELECT e.details ->> 'code' FROM tenant.asset_depreciation_events e WHERE e.asset_id = a.id AND e.action = 'BASIS_BLOCKED' ORDER BY e.occurred_at DESC LIMIT 1) AS blocked_code
  FROM tenant.assets a LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN public.departments d ON d.id = a.current_department_id
  LEFT JOIN tenant.asset_depreciation_bases b ON b.asset_id = a.id AND b.status = 'APPROVED' LEFT JOIN tenant.asset_depreciation_policies p ON p.id = b.policy_id
  LEFT JOIN tenant.asset_depreciation_schedule_versions s ON s.asset_id = a.id AND s.status = 'CURRENT'`;
function stateOf(r) {
  if (r.capitalization_class === "TRACKED_ONLY") return { state: "TRACKED_ONLY", label: "Tracked only — never depreciated" };
  if (r.capitalization_class !== "CAPITALIZED") return { state: "NOT_CAPITALIZED", label: "Not capitalized yet" };
  if (r.lifecycle_status === "DISPOSED" || r.legacy_status === "disposed") return { state: "DISPOSED", label: "Disposed" };
  if (!r.basis_id || !r.schedule_id) return { state: "NO_BASIS", label: r.has_proposal ? "Basis waiting for approval" : r.blocked_code ? EXCLUSION[r.blocked_code]?.label ?? "No approved basis" : "No approved basis" };
  if (!sameAmount(r.capitalized_cost, r.cost_basis) || !sameAmount(r.impairment_accumulated, r.impairment_before)) return { state: "STALE", label: EXCLUSION.SOURCE_CHANGED.label };
  if (r.lines === 0 || (r.lines > 0 && r.posted_lines >= r.lines)) return { state: "FULLY_DEPRECIATED", label: r.lifecycle_status === "ACTIVE" ? "Fully depreciated — still in use" : "Fully depreciated" };
  if (dayOfDb(r.next_period) && dayOfDb(r.commencement_date) > `${thisMonth().slice(0, 7)}-31`) return { state: "NOT_COMMENCED", label: "Commences later" };
  return { state: "DEPRECIATING", label: "Depreciating" };
}
const assetView = (c, r) => ({
  assetId: r.id, asset: `${r.asset_number} · ${r.name}`, category: r.category, department: r.department, lifecycle: r.lifecycle_status, ...stateOf(r),
  policy: r.policy ? `${r.policy} (v${r.policy_version})` : r.basis_id ? "Category policy" : null, basisVersion: r.basis_version ?? null, source: r.source ? BASIS_SOURCE[r.source] : null,
  convention: r.convention ? CONVENTION[r.convention] : null, usefulLifeMonths: r.useful_life_months ?? null, remainingLifeMonths: r.remaining_life_months ?? null, commencement: dayOfDb(r.commencement_date),
  cost: amt(c, r.capitalized_cost), residual: amt(c, r.residual_value), monthly: amt(c, r.monthly), accumulated: amt(c, r.accumulated_depreciation), carrying: amt(c, r.net_book_value),
  nextPeriod: dayOfDb(r.next_period), lastPosted: dayOfDb(r.last_posted), href: `/assets/register/${r.id}?tab=financials`,
});

export async function getDepreciationOverview(client, c) {
  see(c);
  const rows = (await client.query(`${STATE_SQL} WHERE a.organization_id = $1 AND a.capitalization_class IN ('CAPITALIZED', 'PENDING')`, [c.organizationId])).rows;
  const states = {};
  for (const r of rows) { const s = stateOf(r).state; states[s] = (states[s] ?? 0) + 1; }
  const due = (await client.query(`SELECT COALESCE(sum(l.amount), 0)::text AS t, count(*)::int AS n FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT'
      WHERE l.organization_id = $1 AND l.period_start <= $2 AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')`, [c.organizationId, thisMonth()])).rows[0];
  const runs = (await client.query(`SELECT status, count(*)::int AS n FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND status NOT IN ('POSTED', 'CANCELLED') GROUP BY status`, [c.organizationId])).rows;
  const proposals = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_bases WHERE organization_id = $1 AND status = 'PROPOSED'`, [c.organizationId])).rows[0].n);
  return { depreciating: states.DEPRECIATING ?? 0, notStarted: (states.NO_BASIS ?? 0) + (states.NOT_COMMENCED ?? 0) + (states.NOT_CAPITALIZED ?? 0), fullyDepreciated: states.FULLY_DEPRECIATED ?? 0,
    stale: states.STALE ?? 0, dueThisMonth: amt(c, due.t), dueLines: due.n, openRuns: Object.fromEntries(runs.map((r) => [r.status, r.n])), proposals,
    can: { prepare: has(c, DP.prepare), policy: has(c, DP.policy), generate: has(c, DP.generate), reconcile: has(c, DP.reconcile), export: has(c, DP.export), financials: has(c, DP.financials) } };
}
// views: all | depreciating | not_started | fully | stale | proposed
export async function listDepreciableAssets(client, c, filters = {}) {
  see(c);
  const values = [c.organizationId];
  let where = `a.organization_id = $1 AND a.capitalization_class IN ('CAPITALIZED', 'PENDING')`;
  const q = text(filters.search, 100);
  if (q) { values.push(`%${q.replace(/[%_]/g, "\\$&")}%`); where += ` AND (a.asset_number ILIKE $2 OR a.name ILIKE $2 OR cat.name ILIKE $2)`; }
  const rows = (await client.query(`${STATE_SQL} WHERE ${where} ORDER BY a.asset_number LIMIT 1000`, values)).rows.map((r) => assetView(c, r));
  const view = filters.view ?? "all";
  const keep = { all: () => true, depreciating: (r) => r.state === "DEPRECIATING", not_started: (r) => ["NO_BASIS", "NOT_COMMENCED", "NOT_CAPITALIZED"].includes(r.state),
    fully: (r) => r.state === "FULLY_DEPRECIATED", stale: (r) => r.state === "STALE", proposed: (r) => r.label === "Basis waiting for approval" }[view] ?? (() => true);
  return { rows: rows.filter(keep) };
}

// A schedule's months with their status derived from the run lines and Finance's journals (never stored): planned, due, in posting,
// posted (Finance confirmed it; the posted amount and any difference from the plan shown), skipped (no charge under the approved policy,
// with the reason) or exception (a missed month, a closed period, a missing journal). Actual figures accumulate from what Finance posted.
const LINES_SQL = `SELECT l.*, to_char(l.period_start, 'YYYY-MM-DD') AS p, to_char(l.period_end, 'YYYY-MM-DD') AS pe,
    rl.status AS run_line_status, rl.amount::text AS posted_amount, rl.exclusion_code, rl.exclusion_reason, rl.blocking, o.id AS run_id, o.run_number, o.status AS run_status,
    je.id AS journal_id, je.entry_number AS journal_number, je.status AS journal_status, rl.journal_entry_id AS journal_ref,
    (SELECT o2.run_number FROM tenant.asset_depreciation_period_runs o2 WHERE o2.organization_id = l.organization_id AND o2.period_start = l.period_start AND o2.status = 'POSTED' LIMIT 1) AS month_run,
    (SELECT fp.status FROM tenant.fiscal_periods fp WHERE fp.organization_id = l.organization_id AND fp.start_date <= l.period_end AND fp.end_date >= l.period_end ORDER BY (fp.status = 'open') DESC LIMIT 1) AS period_status
  FROM tenant.asset_depreciation_schedule_lines l
  LEFT JOIN LATERAL (SELECT r.* FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status <> 'CANCELLED'
     ORDER BY (r.status = 'POSTED') DESC, (r.status = 'INCLUDED') DESC, r.created_at DESC LIMIT 1) rl ON true
  LEFT JOIN tenant.asset_depreciation_period_runs o ON o.id = rl.run_id
  LEFT JOIN tenant.accounting_journal_entries je ON je.id = rl.journal_entry_id
  WHERE l.schedule_id = $1 ORDER BY l.period_start`;
function periodOf(l, schedule, now) {
  const disposedFrom = schedule.lifecycle_status === "TERMINATED" ? String(schedule.closed_reason ?? "").replace(/^Disposed on /, "") : null;
  if (l.run_line_status === "POSTED") {
    if (!l.journal_id && l.journal_ref) return { status: "EXCEPTION", note: "Finance's journal for this month cannot be found." };
    if (l.journal_id && l.journal_status !== "posted") return { status: "EXCEPTION", note: `Finance's journal ${l.journal_number ?? ""} is ${l.journal_status}.` };
    return { status: "POSTED", note: sameAmount(l.posted_amount, l.amount) ? null : l.exclusion_reason ?? "Posted amount differs from the plan" };
  }
  if (l.run_line_status === "INCLUDED") return ["POSTING", "RECOVERY_REQUIRED"].includes(l.run_status) ? { status: "IN_POSTING", note: `${l.run_number} is being posted` } : { status: "DUE", note: `In ${l.run_number}` };
  if (disposedFrom && l.p > disposedFrom) return { status: "SKIPPED", note: `Disposed on ${disposedFrom}` };
  if (l.run_line_status === "EXCLUDED" && l.run_status === "POSTED") return l.blocking ? { status: "EXCEPTION", note: l.exclusion_reason } : { status: "SKIPPED", note: l.exclusion_reason };
  if (l.p <= now) {
    if (l.month_run) return { status: "EXCEPTION", note: `Missed: ${l.month_run} was posted without this month` };
    if (l.period_status && l.period_status !== "open") return { status: "EXCEPTION", note: "The accounting period is closed; Finance corrects it" };
    return { status: "DUE", note: l.run_line_status === "EXCLUDED" ? l.exclusion_reason : null };
  }
  return { status: "PLANNED", note: null };
}
export async function scheduleLinesOf(client, c, schedule, basis) {
  const rows = (await client.query(LINES_SQL, [schedule.id])).rows;
  const now = thisMonth();
  let actual = toPaise(String(basis?.accumulated_before ?? 0));
  const carrying = toPaise(String(basis?.carrying_at_start ?? 0)) + actual;
  return rows.map((l) => {
    const { status, note } = periodOf(l, schedule, now);
    const posted = status === "POSTED" ? toPaise(l.posted_amount) : null;
    if (posted !== null) actual += posted;
    return { period: l.p, opening: amt(c, l.opening_value), amount: amt(c, l.amount), accumulated: amt(c, l.accumulated), closing: amt(c, l.closing_value),
      posted: posted === null ? null : amt(c, fromPaise(posted)), variance: posted === null ? null : amt(c, fromPaise(toPaise(String(l.amount)) - posted)),
      actualAccumulated: posted === null ? null : amt(c, fromPaise(actual)), actualClosing: posted === null ? null : amt(c, fromPaise(carrying - actual)),
      days: l.eligible_days === l.period_days ? null : `${l.eligible_days} of ${l.period_days} days`, rounding: amt(c, l.rounding), status, statusLabel: PERIOD_STATUS[status], note,
      run: l.run_number ?? null, runId: l.run_id ?? null, journalEntryId: l.journal_id ?? null, journalNumber: l.journal_number ?? null,
      journalHref: l.journal_id && has(c, "accounting.view") ? `/accounting/journals/${l.journal_id}` : null, financialYear: financialYearOf(l.p) };
  });
}
const versionView = (c, v) => ({ id: v.id, version: v.version, lifecycle: v.lifecycle_status, lifecycleLabel: LIFECYCLE[v.lifecycle_status], inForce: v.status === "CURRENT", basisId: v.basis_id,
  firstPeriod: dayOfDb(v.first_period), lastPeriod: dayOfDb(v.last_period), effectiveFrom: dayOfDb(v.effective_from), total: amt(c, v.total), monthly: amt(c, v.inputs?.monthly ?? null),
  algorithm: v.algorithm, approvedBy: v.approver ?? null, approvedAt: iso(v.approved_at), generatedAt: iso(v.generated_at), closedReason: v.closed_reason, supersedes: v.supersedes_schedule_id,
  validationErrors: v.validation_errors ?? [], rowVersion: v.row_version, canApprove: v.lifecycle_status === "DRAFT" && has(c, DP.approve) && v.requested_by !== c.userId });
const VERSIONS_SQL = `SELECT v.*, ${NAME("ap")} AS approver, b.requested_by FROM tenant.asset_depreciation_schedule_versions v LEFT JOIN public.users ap ON ap.id = v.approved_by
  LEFT JOIN tenant.asset_depreciation_bases b ON b.id = v.basis_id`;

// One asset's depreciation, as on its Financials tab. filters: { versionId? } — any version of its schedule, the plan in force by default.
export async function getAssetDepreciation(client, c, assetId, filters = {}) {
  see(c);
  let id;
  try { id = uuid(assetId, "Asset"); } catch { throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND"); }
  const r = (await client.query(`${STATE_SQL} WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, id])).rows[0];
  if (!r) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  const base = assetView(c, r);
  const versions = (await client.query(`${VERSIONS_SQL} WHERE v.asset_id = $1 ORDER BY v.version DESC`, [r.id])).rows;
  let chosen = filters.versionId ? versions.find((v) => v.id === filters.versionId) : versions.find((v) => v.status === "CURRENT") ?? versions.find((v) => v.lifecycle_status === "TERMINATED") ?? versions[0];
  if (filters.versionId && !chosen) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  chosen = chosen ?? null;
  const basis = chosen ? (await client.query(`SELECT * FROM tenant.asset_depreciation_bases WHERE id = $1`, [chosen.basis_id])).rows[0] : null;
  const schedule = chosen ? await scheduleLinesOf(client, c, chosen, basis) : [];
  // Depreciation recognized before this version (before Vercentlabs, or under earlier versions) is a baseline, never fictional posted months.
  const opening = basis && toPaise(String(basis.accumulated_before)) > 0n ? { label: basis.source === "OPENING" ? `Opening balance — ${dayOfDb(basis.commencement_date)}` : `Brought forward — ${dayOfDb(basis.effective_from)}`,
    source: BASIS_SOURCE[basis.source], accumulated: amt(c, basis.accumulated_before), carrying: amt(c, basis.carrying_at_start), cost: amt(c, basis.cost_basis), openingPositionId: basis.opening_position_id ?? null } : null;
  const years = new Map();
  for (const l of schedule) {
    const y = years.get(l.financialYear) ?? { year: l.financialYear, amount: 0n, posted: 0n, months: 0 };
    y.amount += toPaise(l.amount ?? "0"); y.months += 1;
    if (l.posted !== null) y.posted += toPaise(l.posted);
    years.set(l.financialYear, y);
  }
  const sum = (k) => fromPaise(schedule.reduce((t, l) => t + (l[k] === null ? 0n : toPaise(l[k])), 0n));
  const totals = { planned: amt(c, sum("amount")), posted: amt(c, sum("posted")), variance: amt(c, sum("variance")),
    exceptions: schedule.filter((l) => l.status === "EXCEPTION").length, due: schedule.filter((l) => l.status === "DUE").length };
  const bases = (await client.query(`SELECT b.*, ${NAME("rq")} AS requester, ${NAME("ap")} AS approver FROM tenant.asset_depreciation_bases b LEFT JOIN public.users rq ON rq.id = b.requested_by
      LEFT JOIN public.users ap ON ap.id = b.approved_by WHERE b.asset_id = $1 ORDER BY b.basis_version DESC`, [r.id])).rows.map((b) => ({
    id: b.id, version: b.basis_version, source: BASIS_SOURCE[b.source], status: b.status, cost: amt(c, b.cost_basis), carrying: amt(c, b.carrying_at_start), residual: amt(c, b.residual_value),
    remainingLifeMonths: b.remaining_life_months, commencement: dayOfDb(b.commencement_date), effectiveFrom: dayOfDb(b.effective_from), convention: CONVENTION[b.convention], reason: b.reason,
    requestedBy: b.requester, approvedBy: b.approver, approvedAt: iso(b.approved_at), decisionNote: b.decision_note,
    canDecide: b.status === "PROPOSED" && has(c, DP.approve) && b.requested_by !== c.userId }));
  const events = has(c, DP.audit) ? (await client.query(`SELECT e.action, e.details, e.reason, e.occurred_at, ${NAME("u")} AS actor FROM tenant.asset_depreciation_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      WHERE e.asset_id = $1 ORDER BY e.occurred_at DESC LIMIT 100`, [r.id])).rows.map((e) => ({ action: e.action, details: e.details, reason: e.reason, at: iso(e.occurred_at), by: e.actor })) : [];
  const postingStatus = schedule.some((l) => l.status === "EXCEPTION") ? "Exception — see the schedule" : schedule.some((l) => l.status === "IN_POSTING") ? "Being posted"
    : schedule.some((l) => l.status === "DUE") ? "Due — not yet posted" : base.lastPosted ? "Posted" : "Not posted yet";
  return { ...base, book: "Financial reporting (not income-tax)", method: "Straight-line", postingStatus, version: chosen ? versionView(c, chosen) : null, versions: versions.map((v) => versionView(c, v)),
    opening, totals, schedule, years: [...years.values()].map((y) => ({ year: y.year, months: y.months, amount: amt(c, fromPaise(y.amount)), posted: amt(c, fromPaise(y.posted)) })), bases, events,
    note: "Accumulated depreciation and the carrying value are Finance's posted figures; the schedule is the projection from the approved basis.",
    can: { propose: has(c, DP.assign) && base.state === "NO_BASIS" && !r.has_proposal, revise: has(c, DP.revise) && Boolean(r.basis_id) && !r.has_proposal, generate: has(c, DP.generate), financials: has(c, DP.financials) } };
}

export async function listDepreciationPolicies(client, c, filters = {}) {
  see(c);
  const rows = (await client.query(`SELECT p.*, cat.name AS category, ea.code AS expense_code, ea.name AS expense_name, aa.code AS accumulated_code, aa.name AS accumulated_name, ${NAME("u")} AS approver
      FROM tenant.asset_depreciation_policies p LEFT JOIN tenant.asset_categories cat ON cat.id = p.category_id LEFT JOIN tenant.accounting_accounts ea ON ea.id = p.expense_account_id
      LEFT JOIN tenant.accounting_accounts aa ON aa.id = p.accumulated_account_id LEFT JOIN public.users u ON u.id = p.approved_by
      WHERE p.organization_id = $1 AND ($2::boolean OR p.status = 'ACTIVE') ORDER BY p.policy_code, p.version DESC`, [c.organizationId, filters.all === true || filters.all === "true"])).rows;
  return { rows: rows.map((p) => ({ id: p.id, code: p.policy_code, version: p.version, name: p.name, book: "Financial reporting", method: "Straight-line", usefulLifeMonths: p.useful_life_months,
    residual: p.residual_rule === "PERCENT" ? `${Number(p.residual_percent)}% of cost` : "Asset's approved amount", convention: CONVENTION[p.convention], commencement: p.commencement_rule === "NEXT_MONTH" ? "From the next month" : "From the available-for-use date",
    expenseAccount: p.expense_code ? `${p.expense_code} ${p.expense_name}` : null, accumulatedAccount: p.accumulated_code ? `${p.accumulated_code} ${p.accumulated_name}` : null, category: p.category,
    effectiveFrom: dayOfDb(p.effective_from), status: p.status, approvedBy: p.approver, reason: p.reason })), can: { manage: has(c, DP.policy) } };
}

const RUN_SELECT = `SELECT o.*, ${NAME("pp")} AS preparer, ${NAME("ap")} AS approver, ${NAME("po")} AS poster FROM tenant.asset_depreciation_period_runs o
  LEFT JOIN public.users pp ON pp.id = o.prepared_by LEFT JOIN public.users ap ON ap.id = o.approved_by LEFT JOIN public.users po ON po.id = o.posted_by`;
const runView = (c, o) => ({ id: o.id, number: o.run_number, period: dayOfDb(o.period_start).slice(0, 7), periodStart: dayOfDb(o.period_start), periodEnd: dayOfDb(o.period_end), book: "Financial reporting",
  status: o.status, statusLabel: RUN_STATUS[o.status], proposedTotal: amt(c, o.proposed_total), approvedTotal: amt(c, o.approved_total), postedTotal: amt(c, o.posted_total), summary: o.summary,
  journalEntryId: o.journal_entry_id, preparedBy: o.preparer, preparedAt: iso(o.prepared_at), approvedBy: o.approver, approvedAt: iso(o.approved_at), postedBy: o.poster, postedAt: iso(o.posted_at),
  cancelReason: o.cancel_reason, version: o.row_version, href: `/assets/depreciation/runs/${o.id}` });
const RUN_VIEWS = { all: null, review: ["DRAFT", "CALCULATING", "READY_FOR_REVIEW", "NEEDS_CORRECTION"], pending: ["READY_FOR_REVIEW"], approved: ["APPROVED"], posted: ["POSTED", "PARTIALLY_POSTED"],
  attention: ["NEEDS_CORRECTION", "POSTING", "RECOVERY_REQUIRED"], cancelled: ["CANCELLED"] };
export async function listDepreciationRuns(client, c, filters = {}) {
  see(c);
  const statuses = RUN_VIEWS[filters.view ?? "all"] ?? null;
  const rows = (await client.query(`${RUN_SELECT} WHERE o.organization_id = $1 AND ($2::text[] IS NULL OR o.status = ANY($2::text[])) ORDER BY o.period_start DESC, o.prepared_at DESC LIMIT 200`,
    [c.organizationId, statuses])).rows.map((o) => runView(c, o));
  return { rows, can: { prepare: has(c, DP.prepare) } };
}
export async function getDepreciationRun(client, c, runId) {
  see(c);
  let id;
  try { id = uuid(runId, "Run"); } catch { throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND"); }
  const o = (await client.query(`${RUN_SELECT} WHERE o.organization_id = $1 AND o.id = $2`, [c.organizationId, id])).rows[0];
  if (!o) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  const lines = (await client.query(`SELECT l.*, a.asset_number, a.name AS asset_name, cat.name AS category, d.name AS department, ea.code AS expense_code, aa.code AS accumulated_code
      FROM tenant.asset_depreciation_run_lines l JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = l.category_id LEFT JOIN public.departments d ON d.id = l.department_id
      LEFT JOIN tenant.accounting_accounts ea ON ea.id = l.expense_account_id LEFT JOIN tenant.accounting_accounts aa ON aa.id = l.accumulated_account_id
      WHERE l.run_id = $1 AND l.status <> 'CANCELLED' ORDER BY l.status DESC, a.asset_number, l.period_start`, [o.id])).rows;
  const view = (l) => ({ id: l.id, assetId: l.asset_id, asset: `${l.asset_number} · ${l.asset_name}`, category: l.category, department: l.department, period: l.period_start ? dayOfDb(l.period_start).slice(0, 7) : null,
    scheduled: amt(c, l.scheduled_amount), amount: amt(c, l.amount), status: l.status, code: l.exclusion_code, reason: l.exclusion_reason, blocking: l.blocking,
    expenseAccount: l.expense_code, accumulatedAccount: l.accumulated_code, href: `/assets/register/${l.asset_id}?tab=financials` });
  const group = (key) => {
    const m = new Map();
    for (const l of lines.filter((x) => ["INCLUDED", "POSTED"].includes(x.status))) { const k = key(l) ?? "—"; m.set(k, (m.get(k) ?? 0n) + toPaise(String(l.amount))); }
    return [...m.entries()].map(([name, total]) => ({ name, total: amt(c, fromPaise(total)) }));
  };
  const settings = (await client.query(`SELECT * FROM tenant.asset_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  const self = settings.prohibit_self_approval !== false;
  return { ...runView(c, o), included: lines.filter((l) => ["INCLUDED", "POSTED"].includes(l.status)).map(view), excluded: lines.filter((l) => l.status === "EXCLUDED").map(view),
    byCategory: group((l) => l.category), byAccount: group((l) => (l.expense_code ? `${l.expense_code} / ${l.accumulated_code}` : null)), byDepartment: group((l) => l.department),
    exclusionLabels: Object.fromEntries(Object.entries(EXCLUSION).map(([k, v]) => [k, v.label])),
    catchUpMonths: [...new Set(lines.filter((l) => ["INCLUDED", "POSTED"].includes(l.status) && l.period_start && dayOfDb(l.period_start) < dayOfDb(o.period_start)).map((l) => dayOfDb(l.period_start).slice(0, 7)))].sort(),
    catchUpAcknowledged: Boolean(o.catch_up_acknowledged_at), preparedByAutomation: Boolean(o.prepared_by_automation), automationExecutionId: o.automation_execution_id ?? null,
    can: { recalculate: has(c, DP.review) && ["READY_FOR_REVIEW", "NEEDS_CORRECTION", "APPROVED"].includes(o.status),
      approve: has(c, DP.approve) && o.status === "READY_FOR_REVIEW" && !(self && o.prepared_by === c.userId),
      post: has(c, DP.post) && has(c, "accounting.journal.post") && (o.status === "APPROVED" || (settings.depreciation_approval_required === false && o.status === "READY_FOR_REVIEW")) && !(settings.depreciation_separate_poster && o.approved_by === c.userId),
      recover: (has(c, DP.correct) || has(c, DP.post)) && ["POSTING", "RECOVERY_REQUIRED"].includes(o.status), cancel: (has(c, DP.prepare) || has(c, DP.approve)) && !["POSTED", "POSTING", "CANCELLED", "RECOVERY_REQUIRED"].includes(o.status) } };
}

export async function listEstimateChanges(client, c) {
  see(c);
  const rows = (await client.query(`SELECT b.*, a.asset_number, a.name, ${NAME("rq")} AS requester, ${NAME("ap")} AS approver,
      (SELECT pb.remaining_life_months FROM tenant.asset_depreciation_bases pb WHERE pb.asset_id = b.asset_id AND pb.basis_version = b.basis_version - 1) AS previous_remaining,
      (SELECT pb.residual_value FROM tenant.asset_depreciation_bases pb WHERE pb.asset_id = b.asset_id AND pb.basis_version = b.basis_version - 1) AS previous_residual
      FROM tenant.asset_depreciation_bases b JOIN tenant.assets a ON a.id = b.asset_id LEFT JOIN public.users rq ON rq.id = b.requested_by LEFT JOIN public.users ap ON ap.id = b.approved_by
      WHERE b.organization_id = $1 AND b.source IN ('REVISION', 'ADJUSTMENT', 'ASSIGNED') ORDER BY b.requested_at DESC LIMIT 300`, [c.organizationId])).rows;
  return { rows: rows.map((b) => ({ id: b.id, assetId: b.asset_id, asset: `${b.asset_number} · ${b.name}`, source: BASIS_SOURCE[b.source], status: b.status, effectiveFrom: dayOfDb(b.effective_from),
    remainingLifeMonths: b.remaining_life_months, previousRemaining: b.previous_remaining, residual: amt(c, b.residual_value), previousResidual: amt(c, b.previous_residual), reason: b.reason,
    requestedBy: b.requester, approvedBy: b.approver, decisionNote: b.decision_note, canDecide: b.status === "PROPOSED" && has(c, DP.approve) && b.requested_by !== c.userId,
    href: `/assets/register/${b.asset_id}?tab=financials` })) };
}

export async function getDepreciationExceptions(client, c) {
  see(c);
  const out = [];
  for (const r of (await client.query(`${STATE_SQL} WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND a.lifecycle_status NOT IN ('DISPOSED')`, [c.organizationId])).rows) {
    const s = stateOf(r);
    if (["NO_BASIS", "STALE"].includes(s.state)) out.push({ kind: s.state === "STALE" ? "SOURCE_CHANGED" : r.blocked_code ?? "POLICY_MISSING", label: s.label, subject: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}?tab=financials` });
  }
  for (const o of (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND status IN ('NEEDS_CORRECTION', 'POSTING', 'RECOVERY_REQUIRED')`, [c.organizationId])).rows) {
    out.push({ kind: o.status === "NEEDS_CORRECTION" ? "RUN_NEEDS_CORRECTION" : "OUTCOME_UNKNOWN", label: o.status === "NEEDS_CORRECTION" ? "Run has blocking exceptions" : "Posting outcome is being verified", subject: o.run_number, href: `/assets/depreciation/runs/${o.id}` });
  }
  for (const p of (await client.query(`SELECT * FROM tenant.asset_depreciation_policies WHERE organization_id = $1 AND status = 'ACTIVE' AND (expense_account_id IS NULL OR accumulated_account_id IS NULL)`, [c.organizationId])).rows) {
    out.push({ kind: "GL_MAPPING_MISSING", label: EXCLUSION.GL_MAPPING_MISSING.label, subject: `${p.policy_code} ${p.name}`, href: "/assets/depreciation?view=policies" });
  }
  return out;
}

// Schedule versus General Ledger: each posted run's asset-level total against its journal, each asset's register balance against its
// posted depreciation. The ledger is authoritative; a difference is reported, never "fixed" here.
export async function reconcileDepreciation(client, c, filters = {}) {
  requireDp(c, DP.reconcile);
  const runs = (await client.query(`SELECT o.id, o.run_number, o.period_start, o.posted_total::text AS posted, o.journal_entry_id,
      (SELECT COALESCE(sum(l.amount), 0)::text FROM tenant.asset_depreciation_run_lines l WHERE l.run_id = o.id AND l.status = 'POSTED') AS lines_total,
      (SELECT COALESCE(sum(j.debit_amount), 0)::text FROM tenant.accounting_journal_lines j WHERE j.journal_entry_id = o.journal_entry_id) AS gl_total,
      (SELECT e.status FROM tenant.accounting_journal_entries e WHERE e.id = o.journal_entry_id) AS gl_status
      FROM tenant.asset_depreciation_period_runs o WHERE o.organization_id = $1 AND o.status = 'POSTED' AND ($2::uuid IS NULL OR o.id = $2) ORDER BY o.period_start`, [c.organizationId, filters.runId ? uuid(filters.runId, "Run") : null])).rows
    .map((o) => { const glTotal = o.journal_entry_id ? o.gl_total : "0.00"; const matched = toPaise(o.lines_total) === toPaise(glTotal || "0") && toPaise(o.posted) === toPaise(o.lines_total) && (!o.journal_entry_id || o.gl_status === "posted");
      return { runId: o.id, run: o.run_number, period: dayOfDb(o.period_start).slice(0, 7), scheduleTotal: o.lines_total, glTotal, glStatus: o.gl_status, matched }; });
  const assets = (await client.query(`SELECT a.id, a.asset_number, a.name, a.accumulated_depreciation::text AS register, first.accumulated_before::text AS opening,
      (SELECT COALESCE(sum(l.amount), 0)::text FROM tenant.asset_depreciation_run_lines l WHERE l.asset_id = a.id AND l.status = 'POSTED') AS posted
      FROM tenant.assets a JOIN LATERAL (SELECT b.accumulated_before FROM tenant.asset_depreciation_bases b WHERE b.asset_id = a.id AND b.status IN ('APPROVED', 'SUPERSEDED') ORDER BY b.basis_version LIMIT 1) first ON true
      WHERE a.organization_id = $1`, [c.organizationId])).rows
    .map((a) => ({ assetId: a.id, asset: `${a.asset_number} · ${a.name}`, register: a.register, expected: fromPaise(toPaise(a.opening) + toPaise(a.posted)), matched: toPaise(a.register ?? "0") === toPaise(a.opening) + toPaise(a.posted) }));
  const byAccount = (await client.query(`SELECT ea.code AS expense, aa.code AS accumulated, sum(l.amount)::text AS total FROM tenant.asset_depreciation_run_lines l
      LEFT JOIN tenant.accounting_accounts ea ON ea.id = l.expense_account_id LEFT JOIN tenant.accounting_accounts aa ON aa.id = l.accumulated_account_id
      WHERE l.organization_id = $1 AND l.status = 'POSTED' GROUP BY 1, 2 ORDER BY 1`, [c.organizationId])).rows;
  const differences = assets.filter((a) => !a.matched);
  const scheduleVariances = (await plannedVsPosted(client, c, {})).filter((v) => !v.explained && v.variance !== "0.00");
  const { scheduleReproduces } = await import("./dp-commands.js");
  const notReproducible = [];
  for (const s of (await client.query(`SELECT v.*, a.asset_number FROM tenant.asset_depreciation_schedule_versions v JOIN tenant.assets a ON a.id = v.asset_id WHERE v.organization_id = $1 AND v.status = 'CURRENT'`, [c.organizationId])).rows) {
    const b = (await client.query(`SELECT * FROM tenant.asset_depreciation_bases WHERE id = $1`, [s.basis_id])).rows[0];
    if (b && !(await scheduleReproduces(client, b, s))) notReproducible.push({ assetId: s.asset_id, asset: s.asset_number, scheduleId: s.id, version: s.version });
  }
  const matched = runs.every((r) => r.matched) && differences.length === 0 && scheduleVariances.length === 0 && notReproducible.length === 0;
  return { matched, runs, assetDifferences: differences, scheduleVariances, notReproducible, byAccount, message: matched ? null : "The depreciation records do not agree with Finance." };
}

export const DEPRECIATION_REPORTS = Object.freeze(["asset-schedule", "monthly", "yearly", "by-category", "by-department", "accumulated", "nbv-register", "fully-depreciated-active", "not-depreciating",
  "opening", "estimate-changes", "posting-history", "exceptions", "reconciliation", "planned-vs-posted", "monthly-planned", "annual-forecast", "posted-by-period", "schedule-revisions", "disposal-closures"]);
export async function getDepreciationReport(client, c, kind, input = {}) {
  if (!DEPRECIATION_REPORTS.includes(kind)) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND", "There is no such report.");
  requireDp(c, DP.financials);
  const org = c.organizationId;
  const q = async (sql, params = []) => (await client.query(sql, [org, ...params])).rows;
  const posted = `EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')`;
  switch (kind) {
    case "asset-schedule": return { rows: (await q(`SELECT a.asset_number, a.name, to_char(l.period_start, 'YYYY-MM') AS period, l.opening_value::text AS opening, l.amount::text AS depreciation, l.accumulated::text AS accumulated,
        l.closing_value::text AS closing, s.version AS schedule_version, CASE WHEN ${posted} THEN 'Posted' WHEN l.period_start <= current_date THEN 'Due' ELSE 'Forecast' END AS status, a.id AS asset_id
        FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT' JOIN tenant.assets a ON a.id = l.asset_id
        WHERE l.organization_id = $1 AND ($2::uuid IS NULL OR l.asset_id = $2) ORDER BY a.asset_number, l.period_start LIMIT 5000`, [input.assetId ? uuid(input.assetId, "Asset") : null]))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, period: r.period, opening: r.opening, depreciation: r.depreciation, accumulated: r.accumulated, closing: r.closing, scheduleVersion: r.schedule_version, status: r.status, href: `/assets/register/${r.asset_id}?tab=financials` })) };
    case "monthly": return { rows: (await q(`SELECT to_char(l.period_start, 'YYYY-MM') AS month, sum(l.amount) FILTER (WHERE ${posted})::text AS posted, sum(l.amount) FILTER (WHERE NOT ${posted})::text AS projected, count(DISTINCT l.asset_id)::int AS assets
        FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT' WHERE l.organization_id = $1 GROUP BY 1 ORDER BY 1 LIMIT 600`))
      .map((r) => ({ month: r.month, posted: r.posted ?? "0.00", projected: r.projected ?? "0.00", assets: r.assets })) };
    case "yearly": {
      const m = new Map();
      for (const r of await q(`SELECT l.period_start, l.amount::text AS amount, ${posted} AS is_posted FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT' WHERE l.organization_id = $1`)) {
        const fy = financialYearOf(dayOfDb(r.period_start)); const y = m.get(fy) ?? { year: fy, posted: 0n, projected: 0n };
        if (r.is_posted) y.posted += toPaise(r.amount); else y.projected += toPaise(r.amount); m.set(fy, y);
      }
      return { rows: [...m.values()].sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({ year: y.year, posted: fromPaise(y.posted), projected: fromPaise(y.projected) })) };
    }
    case "by-category": return { rows: (await q(`SELECT COALESCE(cat.name, '—') AS category, sum(l.amount)::text AS posted, count(DISTINCT l.asset_id)::int AS assets FROM tenant.asset_depreciation_run_lines l
        LEFT JOIN tenant.asset_categories cat ON cat.id = l.category_id WHERE l.organization_id = $1 AND l.status = 'POSTED' GROUP BY 1 ORDER BY 1`)) };
    case "by-department": return { rows: (await q(`SELECT COALESCE(d.name, 'No department') AS department, sum(l.amount)::text AS posted, count(DISTINCT l.asset_id)::int AS assets FROM tenant.asset_depreciation_run_lines l
        LEFT JOIN public.departments d ON d.id = l.department_id WHERE l.organization_id = $1 AND l.status = 'POSTED' GROUP BY 1 ORDER BY 1`)) };
    case "accumulated": case "nbv-register": return { rows: (await q(`${STATE_SQL} WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' ORDER BY a.asset_number`)).map((r) => ({
      asset: `${r.asset_number} · ${r.name}`, category: r.category, cost: String(r.capitalized_cost), accumulated: String(r.accumulated_depreciation ?? 0), impairment: String(r.impairment_accumulated ?? 0),
      carrying: String(r.net_book_value ?? 0), state: stateOf(r).label, href: `/assets/register/${r.id}?tab=financials` })) };
    case "fully-depreciated-active": return { rows: (await q(`${STATE_SQL} WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND a.lifecycle_status = 'ACTIVE' ORDER BY a.asset_number`))
      .filter((r) => stateOf(r).state === "FULLY_DEPRECIATED").map((r) => ({ asset: `${r.asset_number} · ${r.name}`, cost: String(r.capitalized_cost), carrying: String(r.net_book_value ?? 0), href: `/assets/register/${r.id}?tab=financials` })) };
    case "not-depreciating": return { rows: (await q(`${STATE_SQL} WHERE a.organization_id = $1 AND a.capitalization_class IN ('CAPITALIZED', 'PENDING') ORDER BY a.asset_number`))
      .map((r) => ({ r, s: stateOf(r) })).filter((x) => ["NO_BASIS", "NOT_COMMENCED", "NOT_CAPITALIZED", "STALE"].includes(x.s.state)).map(({ r, s }) => ({ asset: `${r.asset_number} · ${r.name}`, reason: s.label, href: `/assets/register/${r.id}?tab=financials` })) };
    case "opening": return { rows: (await q(`SELECT a.asset_number, a.name, b.accumulated_before::text AS pre_cutover, b.carrying_at_start::text AS opening_carrying, b.residual_value::text AS residual, b.remaining_life_months AS remaining,
        to_char(b.commencement_date, 'YYYY-MM-DD') AS from_date, a.id FROM tenant.asset_depreciation_bases b JOIN tenant.assets a ON a.id = b.asset_id WHERE b.organization_id = $1 AND b.source = 'OPENING' ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, preCutoverAccumulated: r.pre_cutover, openingCarrying: r.opening_carrying, residual: r.residual, remainingMonths: r.remaining, from: r.from_date, href: `/assets/register/${r.id}?tab=financials` })) };
    case "estimate-changes": return { rows: (await listEstimateChanges(client, c)).rows };
    case "posting-history": return { rows: (await client.query(`${RUN_SELECT} WHERE o.organization_id = $1 AND o.status IN ('POSTED', 'PARTIALLY_POSTED') ORDER BY o.period_start DESC`, [org])).rows
      .map((o) => ({ run: o.run_number, period: dayOfDb(o.period_start).slice(0, 7), posted: String(o.posted_total), journalEntryId: o.journal_entry_id, preparedBy: o.preparer, approvedBy: o.approver, postedBy: o.poster, href: `/assets/depreciation/runs/${o.id}` })) };
    case "exceptions": return { rows: await getDepreciationExceptions(client, c) };
    case "reconciliation": { const r = await reconcileDepreciation(client, c); return { rows: r.runs, assetDifferences: r.assetDifferences, scheduleVariances: r.scheduleVariances, matched: r.matched }; }
    case "planned-vs-posted": return { rows: (await plannedVsPosted(client, c, {})).map((v) => ({ ...v, projected: false })) };
    case "monthly-planned": return { rows: (await q(`SELECT to_char(l.period_start, 'YYYY-MM') AS month, sum(l.amount)::text AS planned, count(DISTINCT l.asset_id)::int AS assets
        FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT'
        WHERE l.organization_id = $1 AND l.period_start >= date_trunc('month', current_date) AND NOT ${posted} GROUP BY 1 ORDER BY 1 LIMIT 36`)).map((r) => ({ ...r, projected: true })) };
    case "annual-forecast": {
      const m = new Map();
      for (const r of await q(`SELECT l.period_start, l.amount::text AS amount FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id AND s.status = 'CURRENT'
          WHERE l.organization_id = $1 AND NOT ${posted}`)) { const fy = financialYearOf(dayOfDb(r.period_start)); m.set(fy, (m.get(fy) ?? 0n) + toPaise(r.amount)); }
      return { rows: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, t]) => ({ year, forecast: fromPaise(t), projected: true })) };
    }
    case "posted-by-period": return { rows: (await q(`SELECT to_char(l.period_start, 'YYYY-MM') AS month, sum(l.amount)::text AS posted, count(DISTINCT l.asset_id)::int AS assets, string_agg(DISTINCT o.run_number, ', ') AS runs
        FROM tenant.asset_depreciation_run_lines l JOIN tenant.asset_depreciation_period_runs o ON o.id = l.run_id WHERE l.organization_id = $1 AND l.status = 'POSTED' GROUP BY 1 ORDER BY 1`)).map((r) => ({ ...r, projected: false })) };
    case "schedule-revisions": return { rows: (await q(`${VERSIONS_SQL.replace("SELECT v.*", "SELECT v.*, a.asset_number, a.name AS asset_name").replace("FROM tenant.asset_depreciation_schedule_versions v", "FROM tenant.asset_depreciation_schedule_versions v JOIN tenant.assets a ON a.id = v.asset_id")}
        WHERE v.organization_id = $1 ORDER BY a.asset_number, v.version`)).map((v) => ({ asset: `${v.asset_number} · ${v.asset_name}`, version: v.version, lifecycle: LIFECYCLE[v.lifecycle_status], from: dayOfDb(v.effective_from),
        total: String(v.total), approvedBy: v.approver, reason: v.closed_reason, href: `/assets/register/${v.asset_id}?tab=financials` })) };
    case "disposal-closures": return { rows: (await q(`SELECT v.*, a.asset_number, a.name AS asset_name FROM tenant.asset_depreciation_schedule_versions v JOIN tenant.assets a ON a.id = v.asset_id
        WHERE v.organization_id = $1 AND v.lifecycle_status = 'TERMINATED' ORDER BY v.closed_at DESC`)).map((v) => ({ asset: `${v.asset_number} · ${v.asset_name}`, version: v.version, closed: v.closed_reason,
        unchargedPlanned: null, href: `/assets/register/${v.asset_id}?tab=financials` })) };
    default: return { rows: [] };
  }
}

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// kind: schedule (every current schedule line, or one asset's) | register (net book value register). Carries the book and the period.
export async function exportDepreciation(client, c, input = {}) {
  requireDp(c, DP.export);
  requireDp(c, DP.financials);
  const kind = input.kind === "register" ? "nbv-register" : "asset-schedule";
  const rows = (await getDepreciationReport(client, c, kind, { assetId: input.assetId })).rows;
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => k !== "href") : ["asset"];
  const head = [`Book: Financial reporting (straight-line; not income-tax depreciation)`, `Exported ${new Date().toISOString().slice(0, 10)}`].map(csvCell).join(",");
  return { filename: `depreciation-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv: [head, cols.join(","), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(","))].join("\r\n"), count: rows.length };
}
export async function getDepreciationHistory(client, c, filters = {}) {
  requireDp(c, DP.audit);
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number, o.run_number FROM tenant.asset_depreciation_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      LEFT JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN tenant.asset_depreciation_period_runs o ON o.id = e.run_id
      WHERE e.organization_id = $1 AND ($2::uuid IS NULL OR e.asset_id = $2) AND ($3::uuid IS NULL OR e.run_id = $3) ORDER BY e.occurred_at DESC LIMIT 500`,
    [c.organizationId, filters.assetId ? uuid(filters.assetId, "Asset") : null, filters.runId ? uuid(filters.runId, "Run") : null])).rows
    .map((e) => ({ action: e.action, asset: e.asset_number, run: e.run_number, details: e.details, reason: e.reason, by: e.actor, at: iso(e.occurred_at) }));
}

// Each posted month against its plan: the difference is shown with its source; one explained by the run (the final charge through a
// disposal) is marked so, any other is unreconciled — never rewritten to match.
export async function plannedVsPosted(client, c, filters = {}) {
  const rows = (await client.query(`SELECT r.asset_id, a.asset_number, a.name, to_char(r.period_start, 'YYYY-MM') AS month, r.scheduled_amount::text AS planned, r.amount::text AS posted,
      r.exclusion_reason, o.run_number, o.id AS run_id, je.entry_number AS journal_number, r.journal_entry_id
      FROM tenant.asset_depreciation_run_lines r JOIN tenant.assets a ON a.id = r.asset_id JOIN tenant.asset_depreciation_period_runs o ON o.id = r.run_id
      LEFT JOIN tenant.accounting_journal_entries je ON je.id = r.journal_entry_id
      WHERE r.organization_id = $1 AND r.status = 'POSTED' AND ($2::uuid IS NULL OR r.asset_id = $2) ORDER BY a.asset_number, r.period_start`, [c.organizationId, filters.assetId ? uuid(filters.assetId, "Asset") : null])).rows;
  return rows.map((r) => ({ asset: `${r.asset_number} · ${r.name}`, assetId: r.asset_id, month: r.month, planned: amt(c, r.planned), posted: amt(c, r.posted), variance: amt(c, fromPaise(toPaise(r.planned) - toPaise(r.posted))),
    explained: !sameAmount(r.planned, r.posted) && Boolean(r.exclusion_reason), reason: sameAmount(r.planned, r.posted) ? null : r.exclusion_reason ?? "Unreconciled difference",
    run: r.run_number, journal: r.journal_number, href: `/assets/depreciation/runs/${r.run_id}` }))
    .map((v) => ({ ...v, variance: v.variance ?? null }));
}
const SCHEDULE_VIEWS = { all: null, current: ["CURRENT"], draft: ["DRAFT"], attention: ["VALIDATION_FAILED", "CURRENT", "COMPLETED"], completed: ["COMPLETED"], superseded: ["SUPERSEDED"], terminated: ["TERMINATED"] };
// The Company's schedules: one row per version (the plan in force by default), with planned, posted and the difference, filtered in the database.
// filters: { view?, search?, categoryId?, postingState? }
export async function listDepreciationSchedules(client, c, filters = {}) {
  see(c);
  const view = filters.view ?? "current";
  const lifecycles = Object.hasOwn(SCHEDULE_VIEWS, view) ? SCHEDULE_VIEWS[view] : SCHEDULE_VIEWS.current;
  const values = [c.organizationId, lifecycles];
  let where = `v.organization_id = $1 AND ($2::text[] IS NULL OR v.lifecycle_status = ANY($2::text[]))`;
  const q = text(filters.search, 100);
  if (q) { values.push(`%${q.replace(/[%_]/g, "\\$&")}%`); where += ` AND (a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length})`; }
  if (filters.categoryId) { values.push(uuid(filters.categoryId, "Category")); where += ` AND a.category_id = $${values.length}`; }
  const rows = (await client.query(`SELECT v.*, a.asset_number, a.name AS asset_name, cat.name AS category, p.name AS policy, p.version AS policy_version, b.residual_value, b.remaining_life_months, b.cost_basis,
      ${NAME("ap")} AS approver,
      (SELECT COALESCE(sum(r.amount), 0)::text FROM tenant.asset_depreciation_run_lines r JOIN tenant.asset_depreciation_schedule_lines l ON l.asset_id = r.asset_id AND l.period_start = r.period_start AND l.schedule_id = v.id WHERE r.status = 'POSTED') AS posted,
      (SELECT COALESCE(sum(l.amount), 0)::text FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = v.id AND EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')) AS planned_posted,
      (SELECT count(*)::int FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = v.id AND l.period_start <= date_trunc('month', current_date)
         AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')) AS unposted_due,
      (SELECT min(l.period_start) FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = v.id AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')) AS next_period,
      NOT (a.capitalized_cost::numeric(18,2) = b.cost_basis AND COALESCE(a.impairment_accumulated, 0)::numeric(18,2) = b.impairment_before) AS stale
    FROM tenant.asset_depreciation_schedule_versions v JOIN tenant.assets a ON a.id = v.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id
    LEFT JOIN tenant.asset_depreciation_bases b ON b.id = v.basis_id LEFT JOIN tenant.asset_depreciation_policies p ON p.id = v.policy_id LEFT JOIN public.users ap ON ap.id = v.approved_by
    WHERE ${where} ORDER BY a.asset_number, v.version DESC LIMIT 1000`, values)).rows;
  const out = rows.map((v) => {
    const attention = v.lifecycle_status === "VALIDATION_FAILED" ? "Validation failed" : v.status === "CURRENT" && v.stale ? EXCLUSION.SOURCE_CHANGED.label
      : v.status === "CURRENT" && v.unposted_due > 1 ? `${v.unposted_due} months due and unposted` : null;
    return { scheduleId: v.id, assetId: v.asset_id, asset: `${v.asset_number} · ${v.asset_name}`, category: v.category, version: v.version, lifecycle: v.lifecycle_status, lifecycleLabel: LIFECYCLE[v.lifecycle_status],
      policy: v.policy ? `${v.policy} (v${v.policy_version})` : "Category policy", method: "Straight-line", book: "Financial reporting", effectiveFrom: dayOfDb(v.effective_from), lastPeriod: dayOfDb(v.last_period),
      cost: amt(c, v.cost_basis), residual: amt(c, v.residual_value), remainingLifeMonths: v.remaining_life_months, monthly: amt(c, v.inputs?.monthly ?? null), planned: amt(c, v.total),
      posted: amt(c, v.posted), variance: amt(c, fromPaise(toPaise(v.planned_posted) - toPaise(v.posted))), nextPeriod: dayOfDb(v.next_period), dueUnposted: v.unposted_due, attention,
      approvedBy: v.approver, approvedAt: iso(v.approved_at), closedReason: v.closed_reason, href: `/assets/register/${v.asset_id}?tab=financials` };
  });
  const filtered = view === "attention" ? out.filter((r) => r.attention) : out;
  const state = filters.postingState;
  return { rows: state === "due" ? filtered.filter((r) => r.dueUnposted > 0) : state === "variance" ? filtered.filter((r) => r.variance && r.variance !== "0.00") : filtered, view };
}
// What the month's run will consume: each asset's unposted months up to the period, from the plans in force.
export async function getDueDepreciationLines(client, c, filters = {}) {
  see(c);
  const m = /^(\d{4})-(\d{2})$/.exec(String(filters.period ?? new Date().toISOString().slice(0, 7)));
  if (!m) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Choose the month (YYYY-MM).");
  const period = `${m[1]}-${m[2]}-01`;
  const rows = (await client.query(`SELECT l.asset_id, a.asset_number, a.name, to_char(l.period_start, 'YYYY-MM') AS month, l.amount::text AS amount, v.version,
      (SELECT o.run_number FROM tenant.asset_depreciation_run_lines r JOIN tenant.asset_depreciation_period_runs o ON o.id = r.run_id WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'INCLUDED' LIMIT 1) AS in_run
      FROM tenant.asset_depreciation_schedule_lines l JOIN tenant.asset_depreciation_schedule_versions v ON v.id = l.schedule_id AND v.status = 'CURRENT' JOIN tenant.assets a ON a.id = l.asset_id
      WHERE l.organization_id = $1 AND l.period_start <= $2 AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED')
      ORDER BY a.asset_number, l.period_start LIMIT 5000`, [c.organizationId, period])).rows;
  const total = rows.reduce((t, r) => t + toPaise(r.amount), 0n);
  return { period: period.slice(0, 7), total: amt(c, fromPaise(total)), assets: new Set(rows.map((r) => r.asset_id)).size, rows: rows.map((r) => ({ asset: `${r.asset_number} · ${r.name}`, assetId: r.asset_id, month: r.month,
    amount: amt(c, r.amount), scheduleVersion: r.version, inRun: r.in_run, catchUp: r.month < period.slice(0, 7), href: `/assets/register/${r.asset_id}?tab=financials` })) };
}

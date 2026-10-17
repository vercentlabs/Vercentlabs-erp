// Assets — Straight-Line Depreciation, the commands: policies (Finance, versioned), each asset's approved basis (from capitalization, the
// opening balance, an estimate revision or a cost adjustment), schedule versions generated from that basis, and monthly runs — prepared,
// reviewed, approved, posted through Finance's journal with a stable source identity, recovered when the outcome is unknown, never posted twice.
import { has, loadSettings, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { accountingAvailable, postAssetJournal } from "../accounting-bridge.js";
import { calculateStraightLineSchedule, chargeThroughDisposal, commencementFor, fromPaise, parseDay, sameAmount, toPaise } from "./dp-engine.js";
import { DP, EXCLUSION, FINANCE_POST, dayOfDb, dpError, requireDp } from "./dp-rules.js";

const ALGORITHM = "SLM-1";
const monthStart = (day) => `${String(day).slice(0, 7)}-01`;
const nextMonth = (day) => { const d = parseDay(String(day).slice(0, 10)); const n = new Date(Date.UTC(d.y, d.m + 1, 1)); return n.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export async function logDepreciationEvent(client, c, refs, action, details = {}, reason = null, commandId = null) {
  await client.query(`INSERT INTO tenant.asset_depreciation_events (organization_id, asset_id, run_id, policy_id, basis_id, action, details, reason, actor_user_id, command_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [c.organizationId, refs.assetId ?? null, refs.runId ?? null, refs.policyId ?? null, refs.basisId ?? null, action, JSON.stringify(details), reason, c.userId, commandId]);
}
async function accountsUsable(client, c, ids) {
  if (ids.some((x) => !x)) return false;
  const n = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND status = 'active' AND NOT is_group`,
    [c.organizationId, ids])).rows[0].n);
  return n === new Set(ids).size;
}
const assetRow = async (client, c, assetId, { lock = false } = {}) => {
  let id;
  try { id = uuid(assetId, "Asset"); } catch { throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND"); }
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!a) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  return a;
};
export const approvedBasis = async (client, assetId) => (await client.query(`SELECT * FROM tenant.asset_depreciation_bases WHERE asset_id = $1 AND status = 'APPROVED'`, [assetId])).rows[0] ?? null;
export const currentSchedule = async (client, assetId) => (await client.query(`SELECT * FROM tenant.asset_depreciation_schedule_versions WHERE asset_id = $1 AND status = 'CURRENT'`, [assetId])).rows[0] ?? null;
// The last month whose ordinary depreciation Finance has posted (from any schedule version).
export const lastPostedPeriod = async (client, assetId) => dayOfDb((await client.query(`SELECT max(period_start) AS p FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND status = 'POSTED'`, [assetId])).rows[0].p);
const carryingOf = (a) => fromPaise(toPaise(String(a.capitalized_cost ?? 0)) - toPaise(String(a.accumulated_depreciation ?? 0)) - toPaise(String(a.impairment_accumulated ?? 0)));

// ------------------------------------------------------------------ policies
const CONVENTIONS = ["DAILY", "FULL_MONTH"];
function policyFields(input, base = {}) {
  const pick = (k) => (input[k] !== undefined ? input[k] : base[k]);
  const name = text(pick("name"), 200);
  if (name.length < 2) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Name the policy.", { field: "name" });
  const life = Number(pick("usefulLifeMonths"));
  if (!Number.isInteger(life) || life < 1 || life > 1200) throw dpError(400, "ASSET_DEPRECIATION_USEFUL_LIFE_INVALID", undefined, { field: "usefulLifeMonths" });
  const residualRule = pick("residualRule") ?? "AMOUNT";
  if (!["AMOUNT", "PERCENT"].includes(residualRule)) throw dpError(400, "ASSET_DEPRECIATION_RESIDUAL_INVALID", undefined, { field: "residualRule" });
  const pct = residualRule === "PERCENT" ? Number(pick("residualPercent")) : null;
  if (residualRule === "PERCENT" && !(pct >= 0 && pct < 100)) throw dpError(400, "ASSET_DEPRECIATION_RESIDUAL_INVALID", "A residual percentage from 0 to below 100.", { field: "residualPercent" });
  const convention = pick("convention") ?? "DAILY";
  if (!CONVENTIONS.includes(convention)) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Choose daily proration or full month.", { field: "convention" });
  const commencementRule = pick("commencementRule") ?? "AVAILABLE_FOR_USE";
  if (!["AVAILABLE_FOR_USE", "NEXT_MONTH"].includes(commencementRule)) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Choose when depreciation commences.", { field: "commencementRule" });
  const effectiveFrom = String(pick("effectiveFrom") ?? "");
  if (!parseDay(effectiveFrom)) throw dpError(400, "ASSET_DEPRECIATION_DATE_INVALID", "Enter the date the policy applies from.", { field: "effectiveFrom" });
  if (pick("book") && pick("book") !== "FINANCIAL") throw dpError(400, "ASSET_DEPRECIATION_BOOK_INVALID", "This engine depreciates the financial-reporting book only; income-tax depreciation is Finance's.");
  return { name, life, residualRule, pct, convention, commencementRule, effectiveFrom, expense: pick("expenseAccountId") ?? null, accumulated: pick("accumulatedAccountId") ?? null, categoryId: pick("categoryId") ?? null };
}
// input: { name, usefulLifeMonths, residualRule, residualPercent?, convention, commencementRule, expenseAccountId, accumulatedAccountId, categoryId?, effectiveFrom, reason? }
export async function createDepreciationPolicy(client, c, input = {}) {
  requireDp(c, DP.policy);
  const f = policyFields(input);
  if (!(await accountsUsable(client, c, [f.expense, f.accumulated]))) throw dpError(400, "ASSET_DEPRECIATION_GL_MAPPING_MISSING", undefined, { fields: ["expenseAccountId", "accumulatedAccountId"] });
  if (f.categoryId && !(await client.query(`SELECT 1 FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(f.categoryId, "Category")])).rows[0]) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Choose a category of this Company.");
  const code = await nextNumber(client, c, "asset_depreciation_policy", "DPP");
  const row = (await client.query(`INSERT INTO tenant.asset_depreciation_policies (organization_id, policy_code, version, name, useful_life_months, residual_rule, residual_percent, convention, commencement_rule,
      expense_account_id, accumulated_account_id, category_id, effective_from, reason, created_by, approved_by, approved_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,clock_timestamp()) RETURNING *`,
    [c.organizationId, code, f.name, f.life, f.residualRule, f.pct, f.convention, f.commencementRule, f.expense, f.accumulated, f.categoryId, f.effectiveFrom, text(input.reason, 1000) || null, c.userId])).rows[0];
  await logDepreciationEvent(client, c, { policyId: row.id }, "POLICY_CREATED", { code, version: 1 }, row.reason);
  return { policyId: row.id, code, version: 1 };
}
// A change is a new version; bases already approved keep the version they were approved on.
export async function reviseDepreciationPolicy(client, c, policyId, input = {}) {
  requireDp(c, DP.policy);
  const old = (await client.query(`SELECT * FROM tenant.asset_depreciation_policies WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(policyId, "Policy")])).rows[0];
  if (!old) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  if (old.status !== "ACTIVE") throw dpError(409, "ASSET_DEPRECIATION_INVALID", "Only the active version of a policy is revised.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Give the reason for the change.", { field: "reason" });
  const f = policyFields(input, { name: old.name, usefulLifeMonths: old.useful_life_months, residualRule: old.residual_rule, residualPercent: old.residual_percent, convention: old.convention,
    commencementRule: old.commencement_rule, expenseAccountId: old.expense_account_id, accumulatedAccountId: old.accumulated_account_id, categoryId: old.category_id, effectiveFrom: input.effectiveFrom });
  if (!(await accountsUsable(client, c, [f.expense, f.accumulated]))) throw dpError(400, "ASSET_DEPRECIATION_GL_MAPPING_MISSING");
  await client.query(`UPDATE tenant.asset_depreciation_policies SET status = 'SUPERSEDED' WHERE id = $1`, [old.id]);
  const row = (await client.query(`INSERT INTO tenant.asset_depreciation_policies (organization_id, policy_code, version, name, useful_life_months, residual_rule, residual_percent, convention, commencement_rule,
      expense_account_id, accumulated_account_id, category_id, effective_from, reason, created_by, approved_by, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,clock_timestamp()) RETURNING *`,
    [c.organizationId, old.policy_code, old.version + 1, f.name, f.life, f.residualRule, f.pct, f.convention, f.commencementRule, f.expense, f.accumulated, f.categoryId, f.effectiveFrom, reason, c.userId])).rows[0];
  await logDepreciationEvent(client, c, { policyId: row.id }, "POLICY_REVISED", { code: old.policy_code, version: row.version, previous: old.id }, reason);
  return { policyId: row.id, code: row.policy_code, version: row.version };
}
export async function deactivateDepreciationPolicy(client, c, policyId, input = {}) {
  requireDp(c, DP.policy);
  const r = (await client.query(`UPDATE tenant.asset_depreciation_policies SET status = 'INACTIVE' WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING id, policy_code`, [c.organizationId, uuid(policyId, "Policy")])).rows[0];
  if (!r) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  await logDepreciationEvent(client, c, { policyId: r.id }, "POLICY_DEACTIVATED", { code: r.policy_code }, text(input.reason, 1000) || null);
  return { policyId: r.id, status: "INACTIVE" };
}

// The policy that applies to an asset: an active Company policy for its category (the latest in effect), else the category's own Finance
// policy fields. Never a hard-coded life or rate.
export async function resolveDepreciationPolicy(client, c, asset, { policyId = null } = {}) {
  if (policyId) {
    const p = (await client.query(`SELECT * FROM tenant.asset_depreciation_policies WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE'`, [c.organizationId, uuid(policyId, "Policy")])).rows[0];
    if (!p) throw dpError(400, "ASSET_DEPRECIATION_POLICY_MISSING");
    return p;
  }
  const p = (await client.query(`SELECT * FROM tenant.asset_depreciation_policies WHERE organization_id = $1 AND category_id = $2 AND status = 'ACTIVE' AND effective_from <= current_date
      ORDER BY effective_from DESC, version DESC LIMIT 1`, [c.organizationId, asset.category_id])).rows[0];
  if (p) return p;
  const cat = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id = $1`, [asset.category_id])).rows[0];
  if (!cat || !(Number(cat.useful_life_months) > 0 || Number(asset.useful_life_months) > 0)) return null;
  return { id: null, policy_code: null, useful_life_months: Number(cat.useful_life_months) || null, residual_rule: cat.residual_value_percent !== null && cat.residual_value_percent !== undefined && Number(cat.residual_value_percent) > 0 ? "PERCENT" : "AMOUNT",
    residual_percent: cat.residual_value_percent, convention: ["daily", "mid_month"].includes(String(cat.depreciation_convention)) ? "DAILY" : cat.depreciation_convention === "full_month" ? "FULL_MONTH" : "DAILY",
    commencement_rule: "AVAILABLE_FOR_USE", expense_account_id: cat.depreciation_expense_account_id, accumulated_account_id: cat.accumulated_depreciation_account_id, fromCategory: true };
}
const residualFor = (policy, asset, cost) => {
  if (policy.residual_rule === "PERCENT") return fromPaise((toPaise(String(cost)) * BigInt(Math.round(Number(policy.residual_percent) * 10000)) + 500000n) / 1000000n);
  return String(asset.residual_value ?? "0");
};

// ------------------------------------------------------------------ bases and schedules
async function insertBasis(client, c, asset, b) {
  // An approved basis replaces the one in force (one approved basis per asset at a time).
  if (b.status === "APPROVED") await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'SUPERSEDED' WHERE asset_id = $1 AND status = 'APPROVED'`, [asset.id]);
  const version = Number((await client.query(`SELECT COALESCE(max(basis_version), 0) + 1 AS v FROM tenant.asset_depreciation_bases WHERE asset_id = $1`, [asset.id])).rows[0].v);
  return (await client.query(`INSERT INTO tenant.asset_depreciation_bases (organization_id, asset_id, basis_version, policy_id, source, capitalization_id, opening_position_id, cost_basis, accumulated_before,
      impairment_before, carrying_at_start, residual_value, useful_life_months, remaining_life_months, commencement_date, convention, expense_account_id, accumulated_account_id, effective_from, status,
      reason, requested_by, approved_by, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,CASE WHEN $20 = 'APPROVED' THEN clock_timestamp() END) RETURNING *`,
    [c.organizationId, asset.id, version, b.policyId ?? null, b.source, b.capitalizationId ?? null, b.openingPositionId ?? null, b.cost, b.accumulated, b.impairment, b.carrying, b.residual, b.life, b.remaining,
      b.commencement, b.convention, b.expense, b.accumulatedAccount, b.effectiveFrom, b.status, b.reason ?? null, c.userId, b.status === "APPROVED" ? c.userId : null])).rows[0];
}
// Validates a basis by calculating it: the same rules the schedule uses.
function check(b) {
  try {
    calculateStraightLineSchedule({ carrying: b.carrying, residual: b.residual, months: b.remaining, commencement: b.commencement, convention: b.convention, accumulatedBefore: b.accumulated });
  } catch (error) { throw dpError(400, error.code ?? "ASSET_DEPRECIATION_INVALID", error.message); }
}
// Retires the plan in force (current or completed) when an approved version replaces it — superseded, never rewritten.
async function supersedePlan(client, assetId, reason) {
  return (await client.query(`UPDATE tenant.asset_depreciation_schedule_versions SET status = 'SUPERSEDED', lifecycle_status = 'SUPERSEDED', superseded_at = clock_timestamp(), closed_reason = $2,
      row_version = row_version + 1 WHERE asset_id = $1 AND status = 'CURRENT' RETURNING id`, [assetId, reason])).rows[0]?.id ?? null;
}
const discardDraft = (client, where, value, reason) => client.query(`UPDATE tenant.asset_depreciation_schedule_versions SET lifecycle_status = 'SUPERSEDED', superseded_at = clock_timestamp(), closed_reason = $2,
    row_version = row_version + 1 WHERE ${where} = $1 AND lifecycle_status = 'DRAFT'`, [value, reason]);
// A schedule version from a basis: the approved plan in force (CURRENT, superseding the one before) or a DRAFT of a proposed basis for review.
export async function generateScheduleFor(client, c, basis, { draft = false } = {}) {
  const calc = calculateStraightLineSchedule({ carrying: String(basis.carrying_at_start), residual: String(basis.residual_value), months: basis.remaining_life_months,
    commencement: dayOfDb(basis.commencement_date), convention: basis.convention, accumulatedBefore: String(basis.accumulated_before) });
  const inForce = await currentSchedule(client, basis.asset_id);
  if (draft) await discardDraft(client, "asset_id", basis.asset_id, "Replaced by a newer draft");
  else await supersedePlan(client, basis.asset_id, `Replaced by basis v${basis.basis_version}`);
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.asset_depreciation_schedule_versions WHERE asset_id = $1`, [basis.asset_id])).rows[0].v);
  const s = (await client.query(`INSERT INTO tenant.asset_depreciation_schedule_versions (organization_id, asset_id, basis_id, version, algorithm, status, lifecycle_status, first_period, last_period, total, inputs,
      generated_by, supersedes_schedule_id, policy_id, effective_from, approved_by, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CASE WHEN $7 = 'CURRENT' THEN clock_timestamp() END) RETURNING *`,
    [c.organizationId, basis.asset_id, basis.id, version, ALGORITHM, draft ? "SUPERSEDED" : "CURRENT", draft ? "DRAFT" : "CURRENT", calc.lines[0]?.periodStart ?? null, calc.lines.at(-1)?.periodStart ?? null, calc.total,
      JSON.stringify({ carrying: String(basis.carrying_at_start), residual: String(basis.residual_value), months: basis.remaining_life_months, commencement: dayOfDb(basis.commencement_date), convention: basis.convention, monthly: calc.monthly }),
      c.userId, inForce?.id ?? null, basis.policy_id ?? null, dayOfDb(basis.effective_from), draft ? null : c.userId])).rows[0];
  for (const [i, l] of calc.lines.entries()) {
    await client.query(`INSERT INTO tenant.asset_depreciation_schedule_lines (organization_id, schedule_id, asset_id, line_number, period_start, period_end, opening_value, amount, accumulated, closing_value,
        eligible_from, eligible_to, eligible_days, period_days, rounding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.organizationId, s.id, basis.asset_id, i + 1, l.periodStart, l.periodEnd, l.opening, l.amount, l.accumulated, l.closing, l.eligibleFrom, l.eligibleTo, l.eligibleDays, l.periodDays, l.rounding]);
  }
  await logDepreciationEvent(client, c, { assetId: basis.asset_id, basisId: basis.id }, draft ? "SCHEDULE_DRAFTED" : "SCHEDULE_GENERATED",
    { scheduleId: s.id, version, lines: calc.lines.length, total: calc.total, monthly: calc.monthly, supersedes: inForce?.id ?? null });
  return { scheduleId: s.id, version, lifecycle: draft ? "DRAFT" : "CURRENT", lines: calc.lines.length, total: calc.total, monthly: calc.monthly };
}
async function approveBasisRow(client, c, basis, note = null) {
  await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'SUPERSEDED' WHERE asset_id = $1 AND status = 'APPROVED' AND id <> $2`, [basis.asset_id, basis.id]);
  const approved = basis.status === "APPROVED" ? basis
    : (await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), decision_note = $3 WHERE id = $1 RETURNING *`, [basis.id, c.userId, note])).rows[0];
  // The draft that was reviewed becomes the plan in force (the plan it replaces is superseded); without one, the plan is generated now.
  const draft = (await client.query(`SELECT * FROM tenant.asset_depreciation_schedule_versions WHERE basis_id = $1 AND lifecycle_status = 'DRAFT'`, [basis.id])).rows[0];
  let schedule;
  if (draft) {
    await supersedePlan(client, basis.asset_id, `Replaced by schedule v${draft.version}`);
    await client.query(`UPDATE tenant.asset_depreciation_schedule_versions SET status = 'CURRENT', lifecycle_status = 'CURRENT', approved_by = $2, approved_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
      [draft.id, c.userId]);
    await logDepreciationEvent(client, c, { assetId: basis.asset_id, basisId: basis.id }, "SCHEDULE_APPROVED", { scheduleId: draft.id, version: draft.version });
    schedule = { scheduleId: draft.id, version: draft.version, lifecycle: "CURRENT", total: String(draft.total), monthly: draft.inputs?.monthly ?? null };
  } else schedule = await generateScheduleFor(client, c, approved);
  await logDepreciationEvent(client, c, { assetId: basis.asset_id, basisId: basis.id, policyId: basis.policy_id }, "BASIS_APPROVED", { source: basis.source, version: basis.basis_version }, note);
  return { basis: approved, schedule };
}
// Establishes an asset's first basis from what Finance confirmed (its capitalization or opening balance), approved by that Finance action.
// When something is missing the asset simply has no basis yet and is reported as not depreciating, with the reason; the Finance action stands.
async function establish(client, c, asset, { source, capitalizationId = null, openingPositionId = null, commencement = null }) {
  const policy = await resolveDepreciationPolicy(client, c, asset);
  if (!policy) { await logDepreciationEvent(client, c, { assetId: asset.id }, "BASIS_BLOCKED", { code: "POLICY_MISSING", source }); return { ok: false, code: "ASSET_DEPRECIATION_POLICY_MISSING" }; }
  const start = commencement ?? (dayOfDb(asset.depreciation_start_date) ? commencementFor(dayOfDb(asset.depreciation_start_date), policy.commencement_rule) : null);
  if (!start) { await logDepreciationEvent(client, c, { assetId: asset.id }, "BASIS_BLOCKED", { code: "NOT_COMMENCED", source }); return { ok: false, code: "ASSET_DEPRECIATION_DATE_INVALID" }; }
  const life = Number(asset.useful_life_months) || Number(policy.useful_life_months);
  const carrying = carryingOf(asset);
  const residualRaw = source === "OPENING" ? String(asset.residual_value ?? "0") : residualFor(policy, asset, asset.capitalized_cost);
  const residual = toPaise(residualRaw) > toPaise(carrying) ? carrying : fromPaise(toPaise(residualRaw));
  const b = { policyId: policy.id, source, capitalizationId, openingPositionId, cost: fromPaise(toPaise(String(asset.capitalized_cost))), accumulated: fromPaise(toPaise(String(asset.accumulated_depreciation ?? 0))), impairment: fromPaise(toPaise(String(asset.impairment_accumulated ?? 0))),
    carrying, residual, life, remaining: life, commencement: start, convention: policy.convention, expense: policy.expense_account_id, accumulatedAccount: policy.accumulated_account_id,
    effectiveFrom: monthStart(start), status: "APPROVED", reason: source === "OPENING" ? "Opening balance approved by Finance" : "Capitalization posted by Finance" };
  try { check(b); } catch (error) { await logDepreciationEvent(client, c, { assetId: asset.id }, "BASIS_BLOCKED", { code: error.code, source }); return { ok: false, code: error.code }; }
  const basis = await insertBasis(client, c, asset, b);
  const done = await approveBasisRow(client, c, basis);
  return { ok: true, basisId: basis.id, ...done.schedule };
}
export async function onAssetCapitalized(client, c, assetId, { capitalizationId = null } = {}) {
  const a = await assetRow(client, c, assetId);
  if (a.capitalization_class !== "CAPITALIZED" || (await approvedBasis(client, a.id))) return { ok: false, skipped: true };
  return establish(client, c, a, { source: "CAPITALIZATION", capitalizationId });
}
// Opening: the approved carrying amount over the approved remaining life from the day after cutover — pre-cutover depreciation is never repeated.
export async function onOpeningApproved(client, c, assetId, { positionId = null } = {}) {
  const a = await assetRow(client, c, assetId);
  if (a.capitalization_class !== "CAPITALIZED" || (await approvedBasis(client, a.id))) return { ok: false, skipped: true };
  return establish(client, c, a, { source: "OPENING", openingPositionId: positionId, commencement: dayOfDb(a.depreciation_start_date) });
}
// From the first month not yet posted: the months still to run on the current schedule (a part-month counts when it is at least half).
async function remainingMonths(client, assetId, from) {
  const s = await currentSchedule(client, assetId);
  if (!s) return 1;
  const n = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_schedule_lines WHERE schedule_id = $1 AND period_start >= $2 AND eligible_days * 2 >= period_days`, [s.id, from])).rows[0].n);
  return Math.max(n, 1);
}
async function firstUnposted(client, asset, basis) {
  const last = await lastPostedPeriod(client, asset.id);
  const fromBasis = basis ? monthStart(dayOfDb(basis.effective_from)) : null;
  if (!last) return fromBasis ?? monthStart(today());
  const after = nextMonth(last);
  return fromBasis && fromBasis > after ? fromBasis : after;
}
// A Finance-posted cost adjustment (an upgrade, a correction of cost): the future schedule is recalculated from the adjusted carrying value.
export async function onCostAdjusted(client, c, assetId, { adjustmentId = null } = {}) {
  const a = await assetRow(client, c, assetId);
  const current = await approvedBasis(client, a.id);
  if (!current) return onAssetCapitalized(client, c, a.id);
  const from = await firstUnposted(client, a, current);
  const carrying = carryingOf(a);
  const residual = toPaise(String(current.residual_value)) > toPaise(carrying) ? carrying : String(current.residual_value);
  const b = { policyId: current.policy_id, source: "ADJUSTMENT", capitalizationId: current.capitalization_id, cost: String(a.capitalized_cost), accumulated: String(a.accumulated_depreciation ?? 0),
    impairment: String(a.impairment_accumulated ?? 0), carrying, residual, life: current.useful_life_months, remaining: await remainingMonths(client, a.id, from),
    commencement: from > dayOfDb(current.commencement_date) ? from : dayOfDb(current.commencement_date), convention: current.convention, expense: current.expense_account_id, accumulatedAccount: current.accumulated_account_id,
    effectiveFrom: from, status: "APPROVED", reason: `Capitalized cost adjusted${adjustmentId ? ` (${adjustmentId})` : ""}` };
  check(b);
  const basis = await insertBasis(client, c, a, b);
  return approveBasisRow(client, c, basis);
}
// A reversed capitalization takes its basis and schedule with it; posted depreciation must be reversed by Finance first.
export async function onCapitalizationReversed(client, c, assetId) {
  if ((await client.query(`SELECT 1 FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND status = 'POSTED'`, [assetId])).rows[0]) {
    throw dpError(409, "ASSET_DEPRECIATION_ALREADY_POSTED", "Depreciation is already posted on this asset; Finance reverses it first.");
  }
  await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'SUPERSEDED' WHERE asset_id = $1 AND status = 'APPROVED'`, [assetId]);
  await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'REJECTED', decision_note = 'Capitalization reversed' WHERE asset_id = $1 AND status = 'PROPOSED'`, [assetId]);
  await supersedePlan(client, assetId, "Capitalization reversed");
  await discardDraft(client, "asset_id", assetId, "Capitalization reversed");
  await logDepreciationEvent(client, c, { assetId }, "BASIS_WITHDRAWN", { reason: "Capitalization reversed" });
}
// A completed disposal closes the plan (TERMINATED): nothing after the disposal is ever charged; the version and its posted months stay.
export async function onAssetDisposed(client, c, assetId, disposalDay) {
  const r = (await client.query(`UPDATE tenant.asset_depreciation_schedule_versions SET status = 'SUPERSEDED', lifecycle_status = 'TERMINATED', closed_at = clock_timestamp(), closed_reason = $2, row_version = row_version + 1
      WHERE asset_id = $1 AND status = 'CURRENT' RETURNING id`, [assetId, `Disposed on ${disposalDay}`])).rows[0];
  await discardDraft(client, "asset_id", assetId, "Asset disposed");
  await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'REJECTED', decision_note = 'Asset disposed' WHERE asset_id = $1 AND status = 'PROPOSED'`, [assetId]);
  if (r) await logDepreciationEvent(client, c, { assetId }, "SCHEDULE_TERMINATED", { scheduleId: r.id, disposalDate: disposalDay });
}
// input: { expectedVersion?, note? } — approving a draft schedule is approving the basis it was drafted from (same rules, same separation of duties).
export async function approveDepreciationSchedule(client, c, scheduleId, input = {}) {
  requireDp(c, DP.approve);
  let id;
  try { id = uuid(scheduleId, "Schedule"); } catch { throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND"); }
  const s = (await client.query(`SELECT * FROM tenant.asset_depreciation_schedule_versions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!s) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  if (["CURRENT", "COMPLETED"].includes(s.lifecycle_status)) throw dpError(409, "DEPRECIATION_SCHEDULE_ALREADY_CURRENT");
  if (s.lifecycle_status !== "DRAFT") throw dpError(409, "ASSET_DEPRECIATION_INVALID", "Only a draft schedule is approved.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== s.row_version) throw dpError(409, "DEPRECIATION_SCHEDULE_VERSION_CONFLICT");
  return { ...(await approveDepreciationBasis(client, c, s.basis_id, input)), scheduleId: s.id };
}
// A draft schedule computed from proposed inputs for an asset with no basis yet — nothing is saved; problems are returned, not thrown.
export async function previewDepreciationSchedule(client, c, assetId, input = {}) {
  requireDp(c, DP.generate);
  const a = await assetRow(client, c, assetId);
  const errors = [];
  if (a.capitalization_class === "TRACKED_ONLY") errors.push({ code: "DEPRECIATION_SCHEDULE_ASSET_NOT_READY", message: "A tracked-only asset is never depreciated." });
  else if (a.capitalization_class !== "CAPITALIZED") errors.push({ code: "DEPRECIATION_SCHEDULE_COST_PENDING", message: "Finance has not confirmed the asset's cost." });
  const policy = errors.length ? null : await resolveDepreciationPolicy(client, c, a, { policyId: input.policyId ?? null }).catch(() => null);
  if (!errors.length && !policy) errors.push({ code: "DEPRECIATION_SCHEDULE_POLICY_MISSING", message: "Select an approved depreciation policy." });
  if (errors.length) return { valid: false, errors, lines: [] };
  const commencement = input.commencementDate ? String(input.commencementDate) : dayOfDb(a.depreciation_start_date) ? commencementFor(dayOfDb(a.depreciation_start_date), policy.commencement_rule) : null;
  const life = input.usefulLifeMonths !== undefined && input.usefulLifeMonths !== "" ? Number(input.usefulLifeMonths) : Number(a.useful_life_months) || Number(policy.useful_life_months);
  const residual = input.residualValue !== undefined && input.residualValue !== "" ? String(input.residualValue) : residualFor(policy, a, a.capitalized_cost);
  try {
    const calc = calculateStraightLineSchedule({ carrying: carryingOf(a), residual, months: life, commencement, convention: policy.convention, accumulatedBefore: String(a.accumulated_depreciation ?? 0) });
    return { valid: true, errors: [], commencement, usefulLifeMonths: life, residual: fromPaise(toPaise(residual)), convention: policy.convention, monthly: calc.monthly, total: calc.total, lines: calc.lines };
  } catch (error) {
    const code = { ASSET_DEPRECIATION_USEFUL_LIFE_INVALID: "DEPRECIATION_SCHEDULE_INVALID_LIFE", ASSET_DEPRECIATION_RESIDUAL_INVALID: "DEPRECIATION_SCHEDULE_INVALID_RESIDUAL",
      ASSET_DEPRECIATION_DATE_INVALID: "DEPRECIATION_SCHEDULE_DATE_INVALID" }[error.code] ?? "ASSET_DEPRECIATION_INVALID";
    return { valid: false, errors: [{ code, message: error.message }], lines: [] };
  }
}
// Same immutable inputs, same engine version, same schedule: the stored lines must reproduce from their basis.
export async function scheduleReproduces(client, basis, schedule) {
  const calc = calculateStraightLineSchedule({ carrying: String(basis.carrying_at_start), residual: String(basis.residual_value), months: basis.remaining_life_months,
    commencement: dayOfDb(basis.commencement_date), convention: basis.convention, accumulatedBefore: String(basis.accumulated_before) });
  const stored = (await client.query(`SELECT to_char(period_start, 'YYYY-MM-DD') AS p, amount::text AS amount FROM tenant.asset_depreciation_schedule_lines WHERE schedule_id = $1 ORDER BY period_start`, [schedule.id])).rows;
  return stored.length === calc.lines.length && stored.every((l, i) => l.p === calc.lines[i].periodStart && sameAmount(l.amount, calc.lines[i].amount));
}
// Recovery: every approved basis without a plan gets one; a plan in force that no longer reproduces from its basis is regenerated as a new
// version. Posted months and their run lines are never touched.
export async function rebuildDepreciationSchedules(client, c, input = {}) {
  requireDp(c, DP.generate);
  const assetId = input.assetId ? uuid(input.assetId, "Asset") : null;
  let generated = 0; let regenerated = 0;
  for (const b of (await client.query(`SELECT * FROM tenant.asset_depreciation_bases WHERE organization_id = $1 AND status = 'APPROVED' AND ($2::uuid IS NULL OR asset_id = $2)`, [c.organizationId, assetId])).rows) {
    const s = (await client.query(`SELECT * FROM tenant.asset_depreciation_schedule_versions WHERE basis_id = $1 AND lifecycle_status IN ('CURRENT', 'COMPLETED', 'TERMINATED') ORDER BY version DESC LIMIT 1`, [b.id])).rows[0];
    if (!s) { await generateScheduleFor(client, c, b); generated += 1; continue; }
    if (s.lifecycle_status !== "TERMINATED" && !(await scheduleReproduces(client, b, s))) { await generateScheduleFor(client, c, b); regenerated += 1; }
  }
  await logDepreciationEvent(client, c, { assetId }, "SCHEDULES_REBUILT", { generated, regenerated });
  return { generated, regenerated };
}
export const postedDepreciationExists = async (client, assetId) => (await client.query(`SELECT 1 FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND status = 'POSTED'`, [assetId])).rows[0] !== undefined;
// Before a disposal completes: every month up to the disposal date that carries a charge under the convention must be posted.
export async function assertDepreciationSettled(client, c, asset, disposalDay) {
  const basis = await approvedBasis(client, asset.id);
  const s = await currentSchedule(client, asset.id);
  if (!basis || !s) return;
  const lines = (await client.query(`SELECT l.* FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = $1 AND l.period_start <= $2
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED') ORDER BY l.period_start`, [s.id, disposalDay])).rows;
  const due = lines.filter((l) => toPaise(chargeThroughDisposal({ ...l, amount: String(l.amount), period_start: dayOfDb(l.period_start), period_end: dayOfDb(l.period_end), eligible_from: dayOfDb(l.eligible_from), eligible_to: dayOfDb(l.eligible_to) }, disposalDay, basis.convention)) > 0n);
  if (due.length) throw dpError(409, "ASSET_DEPRECIATION_PENDING", undefined, { periods: due.map((l) => dayOfDb(l.period_start).slice(0, 7)) });
}

// input: { policyId?, residualValue?, usefulLifeMonths?, commencementDate?, reason } — a basis for a capitalized asset that has none yet.
export async function proposeDepreciationBasis(client, c, assetId, input = {}) {
  requireDp(c, DP.assign);
  const a = await assetRow(client, c, assetId);
  if (a.capitalization_class === "TRACKED_ONLY") throw dpError(409, "ASSET_DEPRECIATION_NOT_ELIGIBLE", "A tracked-only asset is never depreciated.");
  if (a.capitalization_class !== "CAPITALIZED") throw dpError(409, "ASSET_DEPRECIATION_COST_UNCONFIRMED");
  if (await approvedBasis(client, a.id)) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "This asset already has an approved basis; revise its estimate instead.");
  if ((await client.query(`SELECT 1 FROM tenant.asset_depreciation_bases WHERE asset_id = $1 AND status = 'PROPOSED'`, [a.id])).rows[0]) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "A basis is already waiting for approval.");
  const policy = await resolveDepreciationPolicy(client, c, a, { policyId: input.policyId ?? null });
  if (!policy) throw dpError(400, "ASSET_DEPRECIATION_POLICY_MISSING");
  const commencement = input.commencementDate ? String(input.commencementDate) : dayOfDb(a.depreciation_start_date) ? commencementFor(dayOfDb(a.depreciation_start_date), policy.commencement_rule) : null;
  if (!parseDay(commencement)) throw dpError(400, "ASSET_DEPRECIATION_DATE_INVALID", undefined, { field: "commencementDate" });
  const life = input.usefulLifeMonths !== undefined ? Number(input.usefulLifeMonths) : Number(a.useful_life_months) || Number(policy.useful_life_months);
  const residual = input.residualValue !== undefined ? String(input.residualValue) : residualFor(policy, a, a.capitalized_cost);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Give the reason.", { field: "reason" });
  const b = { policyId: policy.id, source: "ASSIGNED", cost: String(a.capitalized_cost), accumulated: String(a.accumulated_depreciation ?? 0), impairment: String(a.impairment_accumulated ?? 0), carrying: carryingOf(a),
    residual, life, remaining: life, commencement, convention: policy.convention, expense: policy.expense_account_id, accumulatedAccount: policy.accumulated_account_id, effectiveFrom: monthStart(commencement), status: "PROPOSED", reason };
  check(b);
  const basis = await insertBasis(client, c, a, b);
  await logDepreciationEvent(client, c, { assetId: a.id, basisId: basis.id, policyId: policy.id }, "BASIS_PROPOSED", { source: "ASSIGNED" }, reason);
  const draft = await generateScheduleFor(client, c, basis, { draft: true });
  return { basisId: basis.id, status: "PROPOSED", draftScheduleId: draft.scheduleId, monthly: draft.monthly };
}
// input: { remainingLifeMonths?, residualValue?, effectiveFrom, reason } — a change of estimate, prospective from the first month not yet
// posted: posted history stays; a backdated change is a correction for Finance, not an estimate revision.
async function revisionOf(client, c, a, input) {
  const current = await approvedBasis(client, a.id);
  if (!current) throw dpError(409, "ASSET_DEPRECIATION_POLICY_MISSING", "This asset has no approved depreciation basis to revise.");
  const from = await firstUnposted(client, a, current);
  const effective = String(input.effectiveFrom ?? from);
  if (!parseDay(effective) || effective.slice(8) !== "01") throw dpError(400, "ASSET_DEPRECIATION_DATE_INVALID", "A revision takes effect from the first day of a month.", { field: "effectiveFrom" });
  if (effective < from) throw dpError(409, "ASSET_DEPRECIATION_DATE_INVALID", `Depreciation is posted up to ${from.slice(0, 7)}; a change before that is a correction for Finance, not an estimate revision.`, { firstUnposted: from });
  if (effective > from) throw dpError(409, "ASSET_DEPRECIATION_DATE_INVALID", `Revise from the first month not yet posted (${from.slice(0, 7)}), so no month is left on the old estimate unposted.`, { firstUnposted: from });
  const remaining = input.remainingLifeMonths !== undefined && input.remainingLifeMonths !== "" ? Number(input.remainingLifeMonths) : await remainingMonths(client, a.id, from);
  if (!Number.isInteger(remaining) || remaining < 1) throw dpError(400, "ASSET_DEPRECIATION_USEFUL_LIFE_INVALID", undefined, { field: "remainingLifeMonths" });
  const carrying = carryingOf(a);
  const residual = input.residualValue !== undefined && input.residualValue !== "" ? String(input.residualValue) : String(current.residual_value);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Give the reason for the revision.", { field: "reason" });
  const b = { policyId: current.policy_id, source: "REVISION", capitalizationId: current.capitalization_id, cost: String(a.capitalized_cost), accumulated: String(a.accumulated_depreciation ?? 0),
    impairment: String(a.impairment_accumulated ?? 0), carrying, residual, life: current.useful_life_months, remaining, commencement: effective, convention: current.convention,
    expense: current.expense_account_id, accumulatedAccount: current.accumulated_account_id, effectiveFrom: effective, status: "PROPOSED", reason };
  check(b);
  const s = await currentSchedule(client, a.id);
  const old = s ? (await client.query(`SELECT to_char(period_start, 'YYYY-MM-DD') AS period, amount::text, closing_value::text AS closing FROM tenant.asset_depreciation_schedule_lines WHERE schedule_id = $1 AND period_start >= $2 ORDER BY period_start`, [s.id, effective])).rows : [];
  const next = calculateStraightLineSchedule({ carrying, residual, months: remaining, commencement: effective, convention: current.convention, accumulatedBefore: b.accumulated });
  return { b, current, preview: { effectiveFrom: effective, carrying, residual, remainingLifeMonths: remaining, monthly: next.monthly, old: old.map((x) => ({ period: x.period, amount: x.amount, closing: x.closing })),
    next: next.lines.map((l) => ({ period: l.periodStart, amount: l.amount, closing: l.closing })) } };
}
export async function previewDepreciationRevision(client, c, assetId, input = {}) {
  requireDp(c, DP.revise);
  const a = await assetRow(client, c, assetId);
  return (await revisionOf(client, c, a, { reason: "preview", ...input })).preview;
}
export async function reviseDepreciationEstimate(client, c, assetId, input = {}) {
  requireDp(c, DP.revise);
  const a = await assetRow(client, c, assetId, { lock: true });
  if ((await client.query(`SELECT 1 FROM tenant.asset_depreciation_bases WHERE asset_id = $1 AND status = 'PROPOSED'`, [a.id])).rows[0]) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "A change is already waiting for approval.");
  const { b, current, preview } = await revisionOf(client, c, a, input);
  const basis = await insertBasis(client, c, a, b);
  await logDepreciationEvent(client, c, { assetId: a.id, basisId: basis.id }, "ESTIMATE_REVISION_REQUESTED", { from: { remaining: current.remaining_life_months, residual: String(current.residual_value) },
    to: { remaining: b.remaining, residual: b.residual }, effectiveFrom: b.effectiveFrom }, b.reason);
  const draft = await generateScheduleFor(client, c, basis, { draft: true });
  return { basisId: basis.id, status: "PROPOSED", draftScheduleId: draft.scheduleId, preview };
}
// input: { note? } — Finance authorizes a proposed basis or revision; never the person who asked (when the Company prohibits self-approval).
export async function approveDepreciationBasis(client, c, basisId, input = {}) {
  requireDp(c, DP.approve);
  const basis = (await client.query(`SELECT * FROM tenant.asset_depreciation_bases WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(basisId, "Basis")])).rows[0];
  if (!basis) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  if (basis.status === "APPROVED") return { basisId: basis.id, status: "APPROVED", replayed: true };
  if (basis.status !== "PROPOSED") throw dpError(409, "ASSET_DEPRECIATION_INVALID", "Only a proposed basis is approved.");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval !== false && basis.requested_by === c.userId) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED", "Someone other than the requester approves it.");
  const a = await assetRow(client, c, basis.asset_id, { lock: true });
  if (!sameAmount(a.capitalized_cost, basis.cost_basis) || !sameAmount(a.accumulated_depreciation, basis.accumulated_before) || !sameAmount(a.impairment_accumulated, basis.impairment_before)) {
    // Returned rather than thrown, so the outcome is kept: the draft fails validation (with the reason) and the proposal is withdrawn.
    await client.query(`UPDATE tenant.asset_depreciation_schedule_versions SET lifecycle_status = 'VALIDATION_FAILED', validation_errors = $2, row_version = row_version + 1 WHERE basis_id = $1 AND lifecycle_status = 'DRAFT'`,
      [basis.id, JSON.stringify([{ code: "DEPRECIATION_SCHEDULE_SOURCE_CHANGED", message: "The asset's cost or posted balances changed after this was proposed." }])]);
    await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'REJECTED', approved_by = $2, approved_at = clock_timestamp(), decision_note = 'Financial inputs changed after the proposal' WHERE id = $1`, [basis.id, c.userId]);
    await logDepreciationEvent(client, c, { assetId: basis.asset_id, basisId: basis.id }, "SCHEDULE_VALIDATION_FAILED", { code: "DEPRECIATION_SCHEDULE_SOURCE_CHANGED" });
    return { basisId: basis.id, status: "REJECTED", code: "DEPRECIATION_SCHEDULE_SOURCE_CHANGED", message: "Financial inputs have changed. Generate a new preview." };
  }
  const done = await approveBasisRow(client, c, basis, text(input.note, 1000) || null);
  return { basisId: basis.id, status: "APPROVED", scheduleId: done.schedule.scheduleId, monthly: done.schedule.monthly };
}
export async function rejectDepreciationBasis(client, c, basisId, input = {}) {
  requireDp(c, DP.approve);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Give the reason.", { field: "reason" });
  const r = (await client.query(`UPDATE tenant.asset_depreciation_bases SET status = 'REJECTED', approved_by = $3, approved_at = clock_timestamp(), decision_note = $4 WHERE organization_id = $1 AND id = $2 AND status = 'PROPOSED' RETURNING *`,
    [c.organizationId, uuid(basisId, "Basis"), c.userId, reason])).rows[0];
  if (!r) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  await discardDraft(client, "basis_id", r.id, "Proposal rejected");
  await logDepreciationEvent(client, c, { assetId: r.asset_id, basisId: r.id }, "BASIS_REJECTED", {}, reason);
  return { basisId: r.id, status: "REJECTED" };
}
// Generates the schedule of an approved basis that has none (a repeat changes nothing). Bulk: every approved basis without a current
// schedule, and a proposal for every capitalized asset that has no basis but a policy that applies.
export async function generateDepreciationSchedule(client, c, assetId) {
  requireDp(c, DP.generate);
  const a = await assetRow(client, c, assetId);
  const basis = await approvedBasis(client, a.id);
  if (!basis) throw dpError(409, "ASSET_DEPRECIATION_POLICY_MISSING");
  const s = await currentSchedule(client, a.id);
  if (s && s.basis_id === basis.id) return { scheduleId: s.id, version: s.version, lifecycle: s.lifecycle_status, replayed: true };
  return generateScheduleFor(client, c, basis);
}
export async function bulkGenerateDepreciationSchedules(client, c) {
  requireDp(c, DP.generate);
  let generated = 0; let proposed = 0; const blocked = [];
  for (const b of (await client.query(`SELECT b.* FROM tenant.asset_depreciation_bases b WHERE b.organization_id = $1 AND b.status = 'APPROVED'
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_schedule_versions s WHERE s.basis_id = b.id AND s.lifecycle_status IN ('CURRENT', 'COMPLETED', 'TERMINATED'))`, [c.organizationId])).rows) {
    await generateScheduleFor(client, c, b); generated += 1;
  }
  for (const a of (await client.query(`SELECT a.* FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND COALESCE(a.status, '') <> 'disposed'
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_bases b WHERE b.asset_id = a.id AND b.status IN ('APPROVED', 'PROPOSED'))`, [c.organizationId])).rows) {
    await client.query("SAVEPOINT dp_bulk");
    try { await proposeDepreciationBasis(client, c, a.id, { reason: "Proposed from the applicable policy (bulk)" }); await client.query("RELEASE SAVEPOINT dp_bulk"); proposed += 1; }
    catch (error) { await client.query("ROLLBACK TO SAVEPOINT dp_bulk"); blocked.push({ assetId: a.id, asset: a.asset_number, code: error.code, message: error.message }); }
  }
  return { generated, proposed, blocked };
}

// ------------------------------------------------------------------ monthly runs
function periodOf(input) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(input.period ?? ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Choose the month (YYYY-MM).", { field: "period" });
  const start = `${m[1]}-${m[2]}-01`;
  const d = parseDay(start);
  return { start, end: new Date(Date.UTC(d.y, d.m + 1, 0)).toISOString().slice(0, 10) };
}
// The accounting period that takes the month's journal must be open (when Finance has a ledger).
async function periodOpen(client, c, periodEnd) {
  if (!(await accountingAvailable(client, c))) return { fiscalPeriodId: null };
  const p = (await client.query(`SELECT id, status, name FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2 AND end_date >= $2 ORDER BY (status = 'open') DESC, start_date DESC LIMIT 1`, [c.organizationId, periodEnd])).rows[0];
  if (!p || p.status !== "open") throw dpError(409, "ASSET_DEPRECIATION_PERIOD_CLOSED", p ? `The accounting period ${p.name} is ${String(p.status).replace(/_/g, " ")}.` : "No open accounting period covers this month.");
  return { fiscalPeriodId: p.id };
}
const loadRun = async (client, c, runId, { lock = true } = {}) => {
  let id;
  try { id = uuid(runId, "Run"); } catch { throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND"); }
  const r = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!r) throw dpError(404, "ASSET_DEPRECIATION_NOT_FOUND");
  return r;
};
// Every asset the month concerns: those due a charge (with any earlier month not yet posted), and those excluded, each with the reason.
async function calculate(client, c, run) {
  const org = c.organizationId;
  const P = dayOfDb(run.period_start);
  const PEnd = dayOfDb(run.period_end);
  const lines = [];
  const add = (l) => lines.push(l);
  const assets = (await client.query(`SELECT a.*, b.id AS basis_id, b.cost_basis, b.accumulated_before, b.impairment_before, b.convention, b.expense_account_id AS b_expense, b.accumulated_account_id AS b_accum,
      b.commencement_date AS b_commencement, s.id AS schedule_id, (SELECT d.disposal_date FROM tenant.asset_disposals d WHERE d.asset_id = a.id AND d.status IN ('approved', 'completed') ORDER BY d.created_at DESC LIMIT 1) AS disposal_date,
      (SELECT d.status FROM tenant.asset_disposals d WHERE d.asset_id = a.id AND d.status IN ('approved', 'completed') ORDER BY d.created_at DESC LIMIT 1) AS disposal_status,
      EXISTS (SELECT 1 FROM tenant.asset_depreciation_bases pb WHERE pb.asset_id = a.id AND pb.status = 'PROPOSED') AS has_proposal
    FROM tenant.assets a LEFT JOIN tenant.asset_depreciation_bases b ON b.asset_id = a.id AND b.status = 'APPROVED' LEFT JOIN tenant.asset_depreciation_schedule_versions s ON s.asset_id = a.id AND s.status = 'CURRENT'
    WHERE a.organization_id = $1 AND a.capitalization_class IN ('CAPITALIZED', 'PENDING') AND a.lifecycle_status NOT IN ('DRAFT')`, [org])).rows;
  const trackedOnly = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.assets WHERE organization_id = $1 AND capitalization_class = 'TRACKED_ONLY'`, [org])).rows[0].n);
  const exclude = (a, code, extra = {}) => add({ asset: a, status: "EXCLUDED", code, blocking: EXCLUSION[code].blocking, reason: extra.reason ?? EXCLUSION[code].label, period: extra.period ?? null, scheduleLine: extra.line ?? null, scheduled: extra.scheduled ?? "0.00" });
  for (const a of assets) {
    // Not capitalized yet (awaiting Finance, or still being built up in capital work in progress): no ordinary depreciation.
    if (a.capitalization_class === "PENDING") { exclude(a, "COST_UNCONFIRMED"); continue; }
    // A disposed asset is reported as disposed (its plan is terminated), never as missing a basis.
    const disposalDay = dayOfDb(a.disposal_date);
    if ((a.disposal_status === "completed" && disposalDay < P) || a.lifecycle_status === "DISPOSED") { exclude(a, "DISPOSED"); continue; }
    if (!a.basis_id || !a.schedule_id) { exclude(a, a.has_proposal ? "BASIS_PROPOSED" : "POLICY_MISSING"); continue; }
    const due = (await client.query(`SELECT l.* FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = $1 AND l.period_start <= $2
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status IN ('POSTED', 'INCLUDED')) ORDER BY l.period_start`, [a.schedule_id, P])).rows;
    if (!due.length) {
      // Its due months already sit in another unposted run: nothing to add here.
      if ((await client.query(`SELECT 1 FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND status = 'INCLUDED' AND run_id <> $2 LIMIT 1`, [a.id, run.id])).rows[0]) continue;
      const remaining = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_schedule_lines WHERE schedule_id = $1 AND period_start > $2`, [a.schedule_id, P])).rows[0].n);
      const posted = (await client.query(`SELECT 1 FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND period_start = $2 AND status IN ('POSTED', 'INCLUDED')`, [a.id, P])).rows[0];
      if (!posted) exclude(a, remaining > 0 ? "NOT_COMMENCED" : "FULLY_DEPRECIATED", { period: P });
      continue;
    }
    // An approved disposal governs the final charge; otherwise retired and lost assets wait for Finance's review.
    if (!disposalDay && a.lifecycle_status === "RETIRED") { exclude(a, "RETIRED_REVIEW", { period: P }); continue; }
    if (!disposalDay && a.lifecycle_status === "LOST") { exclude(a, "LOST_REVIEW", { period: P }); continue; }
    const stale = !sameAmount(a.capitalized_cost, a.cost_basis) || !sameAmount(a.impairment_accumulated, a.impairment_before);
    const accountsOk = await accountsUsable(client, c, [a.b_expense, a.b_accum]);
    for (const l of due) {
      const line = { ...l, amount: String(l.amount), period_start: dayOfDb(l.period_start), period_end: dayOfDb(l.period_end), eligible_from: dayOfDb(l.eligible_from), eligible_to: dayOfDb(l.eligible_to) };
      if (stale) { exclude(a, "SOURCE_CHANGED", { period: line.period_start, line: l.id, scheduled: line.amount }); continue; }
      if (!accountsOk) { exclude(a, "GL_MAPPING_MISSING", { period: line.period_start, line: l.id, scheduled: line.amount }); continue; }
      const amount = disposalDay && disposalDay <= line.period_end ? chargeThroughDisposal(line, disposalDay, a.convention) : line.amount;
      if (toPaise(amount) === 0n && disposalDay) { exclude(a, "DISPOSED", { period: line.period_start, line: l.id, scheduled: line.amount, reason: "Disposed in this month: no charge under the convention" }); continue; }
      add({ asset: a, status: "INCLUDED", period: line.period_start, periodEnd: line.period_end, scheduleLine: l.id, scheduled: line.amount, amount, blocking: false,
        reason: amount !== line.amount ? `Final charge through the disposal on ${disposalDay}` : line.period_start < P ? "Catch-up of an earlier unposted month" : null });
    }
  }
  for (const l of lines) {
    await client.query(`INSERT INTO tenant.asset_depreciation_run_lines (organization_id, run_id, asset_id, period_start, period_end, schedule_line_id, schedule_id, basis_id, category_id, department_id,
        expense_account_id, accumulated_account_id, scheduled_amount, amount, status, exclusion_code, exclusion_reason, blocking) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [org, run.id, l.asset.id, l.period, l.periodEnd ?? (l.period ? new Date(Date.UTC(Number(l.period.slice(0, 4)), Number(l.period.slice(5, 7)), 0)).toISOString().slice(0, 10) : null), l.scheduleLine,
        l.asset.schedule_id ?? null, l.asset.basis_id ?? null, l.asset.category_id, l.asset.current_department_id ?? null, l.asset.b_expense ?? null, l.asset.b_accum ?? null, l.scheduled ?? "0.00",
        l.status === "INCLUDED" ? l.amount : "0.00", l.status, l.code ?? null, l.reason ?? null, Boolean(l.blocking)]);
  }
  const included = lines.filter((l) => l.status === "INCLUDED");
  const total = included.reduce((t, l) => t + toPaise(l.amount), 0n);
  const excluded = {};
  for (const l of lines.filter((x) => x.status === "EXCLUDED")) excluded[l.code] = (excluded[l.code] ?? 0) + 1;
  const blocking = lines.some((l) => l.blocking);
  const summary = { assetsWithCharge: new Set(included.map((l) => l.asset.id)).size, lines: included.length, excluded, trackedOnly, blocking,
    fullyDepreciated: excluded.FULLY_DEPRECIATED ?? 0, proposedTotal: fromPaise(total), alreadyPosted: "0.00", eligible: new Set(lines.map((l) => l.asset.id)).size };
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = $2, proposed_total = $3, summary = $4, row_version = row_version + 1, approved_by = NULL, approved_at = NULL, approved_total = NULL WHERE id = $1`,
    [run.id, blocking ? "NEEDS_CORRECTION" : "READY_FOR_REVIEW", fromPaise(total), JSON.stringify(summary)]);
  return { status: blocking ? "NEEDS_CORRECTION" : "READY_FOR_REVIEW", proposedTotal: fromPaise(total), summary, periodEnd: PEnd };
}
// input: { period: 'YYYY-MM', idempotencyKey? } — one live run per month; a repeat returns it.
export async function prepareDepreciationRun(client, c, input = {}) {
  requireDp(c, DP.prepare);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { runId: done.id, number: done.run_number, status: done.status, replayed: true };
  }
  const { start, end } = periodOf(input);
  const live = (await client.query(`SELECT id, run_number, status FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND book = 'FINANCIAL' AND period_start = $2 AND status <> 'CANCELLED'`, [c.organizationId, start])).rows[0];
  if (live) throw dpError(409, "ASSET_DEPRECIATION_INVALID", `${live.run_number} already covers ${start.slice(0, 7)}.`, { runId: live.id });
  const later = (await client.query(`SELECT run_number FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND period_start > $2 AND status = 'POSTED' LIMIT 1`, [c.organizationId, start])).rows[0];
  if (later) throw dpError(409, "ASSET_DEPRECIATION_DATE_INVALID", `${later.run_number} is already posted for a later month; an earlier month is a correction for Finance.`);
  const { fiscalPeriodId } = await periodOpen(client, c, end);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('asset_depreciation_run:' || $1::text))`, [c.organizationId]);
  const number = await nextNumber(client, c, "asset_depreciation_run", "DEP");
  const run = (await client.query(`INSERT INTO tenant.asset_depreciation_period_runs (organization_id, run_number, period_start, period_end, fiscal_period_id, status, idempotency_key, prepared_by)
      VALUES ($1,$2,$3,$4,$5,'CALCULATING',$6,$7) RETURNING *`, [c.organizationId, number, start, end, fiscalPeriodId, key, c.userId])).rows[0];
  const out = await calculate(client, c, run);
  await logDepreciationEvent(client, c, { runId: run.id }, "RUN_PREPARED", { period: start.slice(0, 7), total: out.proposedTotal, status: out.status });
  return { runId: run.id, number, status: out.status, proposedTotal: out.proposedTotal, summary: out.summary };
}
// Recalculates an unposted run from the current schedules (after a correction, a new basis or an approved revision).
export async function recalculateDepreciationRun(client, c, runId) {
  requireDp(c, DP.review);
  const run = await loadRun(client, c, runId);
  if (!["READY_FOR_REVIEW", "NEEDS_CORRECTION", "APPROVED", "DRAFT"].includes(run.status)) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "Only an unposted run is recalculated.");
  await client.query(`UPDATE tenant.asset_depreciation_run_lines SET status = 'CANCELLED' WHERE run_id = $1 AND status IN ('INCLUDED', 'EXCLUDED')`, [run.id]);
  const out = await calculate(client, c, run);
  await logDepreciationEvent(client, c, { runId: run.id }, "RUN_RECALCULATED", { total: out.proposedTotal, status: out.status });
  return { runId: run.id, status: out.status, proposedTotal: out.proposedTotal, summary: out.summary };
}
// An included line whose schedule was superseded (a new basis, an adjustment, an approved revision) makes the run stale.
async function staleLines(client, run) {
  return (await client.query(`SELECT l.id FROM tenant.asset_depreciation_run_lines l JOIN tenant.asset_depreciation_schedule_versions s ON s.id = l.schedule_id
      WHERE l.run_id = $1 AND l.status = 'INCLUDED' AND s.status <> 'CURRENT'`, [run.id])).rows;
}
// The run is marked for correction (and the decision recorded) rather than refused with an error, so the marking is kept.
async function markStale(client, c, run) {
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'NEEDS_CORRECTION', approved_by = NULL, approved_at = NULL, approved_total = NULL, row_version = row_version + 1 WHERE id = $1`, [run.id]);
  await logDepreciationEvent(client, c, { runId: run.id }, "RUN_STALE", {});
  return { runId: run.id, status: "NEEDS_CORRECTION", code: "ASSET_DEPRECIATION_SOURCE_CHANGED", message: "The approved accounting basis changed. Recalculate the draft." };
}
// input: { note?, expectedVersion? } — Finance authorizes the reviewed amounts; not the preparer when the Company prohibits self-approval.
export async function approveDepreciationRun(client, c, runId, input = {}) {
  requireDp(c, DP.approve);
  const run = await loadRun(client, c, runId);
  if (run.status === "APPROVED") return { runId: run.id, status: "APPROVED", replayed: true };
  if (run.status !== "READY_FOR_REVIEW") throw dpError(409, "ASSET_DEPRECIATION_INVALID", run.status === "NEEDS_CORRECTION" ? "Correct the blocking exceptions and recalculate first." : "Only a reviewed run is approved.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== run.row_version) throw dpError(409, "ASSET_DEPRECIATION_SOURCE_CHANGED", "The run changed since you reviewed it.");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval !== false && run.prepared_by === c.userId) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED", "Someone other than the preparer approves the run.");
  if ((await staleLines(client, run)).length) return markStale(client, c, run);
  // Earlier months not posted when due are not this month's ordinary expense by default: Finance confirms how the catch-up is treated.
  const earlier = (await client.query(`SELECT DISTINCT to_char(period_start, 'YYYY-MM') AS m FROM tenant.asset_depreciation_run_lines WHERE run_id = $1 AND status = 'INCLUDED' AND period_start < $2 ORDER BY 1`,
    [run.id, dayOfDb(run.period_start)])).rows.map((r) => r.m);
  if (earlier.length && !(input.acknowledgeCatchUp === true || input.acknowledgeCatchUp === "true")) {
    throw dpError(409, "ASSET_DEPRECIATION_CATCH_UP_UNACKNOWLEDGED", `This run also charges ${earlier.join(", ")}, not posted when due. Confirm Finance's treatment of the catch-up to approve it.`, { months: earlier });
  }
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), approved_total = proposed_total, row_version = row_version + 1,
      catch_up_acknowledged_by = CASE WHEN $3::boolean THEN $2::uuid END, catch_up_acknowledged_at = CASE WHEN $3::boolean THEN clock_timestamp() END WHERE id = $1`, [run.id, c.userId, earlier.length > 0]);
  await logDepreciationEvent(client, c, { runId: run.id }, "RUN_APPROVED", { total: String(run.proposed_total), catchUp: earlier }, text(input.note, 1000) || null);
  return { runId: run.id, status: "APPROVED", approvedTotal: String(run.proposed_total) };
}
const journalFor = async (client, c, runId) => (await client.query(`SELECT id FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_type = 'asset_depreciation_run' AND source_id = $2 ORDER BY created_at LIMIT 1`,
  [c.organizationId, runId])).rows[0]?.id ?? null;
// Marks the run's included lines as posted against Finance's journal and brings the register's accumulated depreciation to Finance's figure.
async function finish(client, c, run, journalId, outcome, commandId = null) {
  const lines = (await client.query(`SELECT l.*, a.asset_number FROM tenant.asset_depreciation_run_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.run_id = $1 AND l.status = 'INCLUDED' FOR UPDATE OF l`, [run.id])).rows;
  let total = 0n;
  for (const l of lines) {
    await client.query(`UPDATE tenant.asset_depreciation_run_lines SET status = 'POSTED', posted_at = clock_timestamp(), journal_entry_id = $2, posting_key = $3 WHERE id = $1`,
      [l.id, journalId, `${l.asset_id}:${dayOfDb(l.period_start)}`]);
    await client.query(`UPDATE tenant.assets SET accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + $2::numeric, net_book_value = capitalized_cost - (COALESCE(accumulated_depreciation, 0) + $2::numeric) - COALESCE(impairment_accumulated, 0),
        updated_at = now() WHERE id = $1`, [l.asset_id, l.amount]);
    await recordAssetEvent(client, c, l.asset_id, "asset.depreciated", { runId: run.id, period: dayOfDb(l.period_start), amount: String(l.amount), journalEntryId: journalId });
    total += toPaise(String(l.amount));
  }
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'POSTED', posted_by = $2, posted_at = clock_timestamp(), journal_entry_id = $3, accounting_outcome = $4, posted_total = $5, row_version = row_version + 1 WHERE id = $1`,
    [run.id, c.userId, journalId, outcome, fromPaise(total)]);
  // A plan whose every month is now recognized is completed — it stays the plan in force; the asset itself may well stay in use.
  await client.query(`UPDATE tenant.asset_depreciation_schedule_versions s SET lifecycle_status = 'COMPLETED', closed_at = clock_timestamp(), closed_reason = 'Fully depreciated', row_version = row_version + 1
      WHERE s.lifecycle_status = 'CURRENT' AND s.id IN (SELECT schedule_id FROM tenant.asset_depreciation_run_lines WHERE run_id = $1 AND status = 'POSTED')
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_schedule_lines l WHERE l.schedule_id = s.id
          AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines r WHERE r.asset_id = l.asset_id AND r.period_start = l.period_start AND r.status = 'POSTED'))`, [run.id]);
  await logDepreciationEvent(client, c, { runId: run.id }, outcome === "RECOVERED" ? "POSTING_RECOVERED" : "RUN_POSTED", { journalEntryId: journalId, total: fromPaise(total), lines: lines.length }, null, commandId);
  return { runId: run.id, status: "POSTED", journalEntryId: journalId, postedTotal: fromPaise(total), outcome };
}
// input: { commandId? } — posts through Finance (Finance's own journal-posting right is required too), once: a repeat returns the posted run;
// a run whose posting outcome is unknown is never posted again — it is recovered.
export async function postDepreciationRun(client, c, runId, input = {}) {
  requireDp(c, DP.post);
  if (!has(c, FINANCE_POST)) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED", "Posting needs Finance's journal-posting right as well.");
  const run = await loadRun(client, c, runId);
  if (run.status === "POSTED") return { runId: run.id, status: "POSTED", journalEntryId: run.journal_entry_id, postedTotal: String(run.posted_total), replayed: true };
  if (["POSTING", "RECOVERY_REQUIRED"].includes(run.status)) throw dpError(409, "ASSET_DEPRECIATION_OUTCOME_UNKNOWN");
  const settings = await loadSettings(client, c);
  const approvalNeeded = settings.depreciation_approval_required !== false;
  if (!(run.status === "APPROVED" || (!approvalNeeded && run.status === "READY_FOR_REVIEW"))) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "The run must be approved before it is posted.");
  if (settings.depreciation_separate_poster && run.approved_by === c.userId) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED", "The Company requires someone other than the approver to post.");
  await periodOpen(client, c, dayOfDb(run.period_end));
  if ((await staleLines(client, run)).length) return markStale(client, c, run);
  const already = (await client.query(`SELECT l.asset_id FROM tenant.asset_depreciation_run_lines l WHERE l.run_id = $1 AND l.status = 'INCLUDED'
      AND EXISTS (SELECT 1 FROM tenant.asset_depreciation_run_lines p WHERE p.asset_id = l.asset_id AND p.period_start = l.period_start AND p.status = 'POSTED')`, [run.id])).rows;
  if (already.length) throw dpError(409, "ASSET_DEPRECIATION_ALREADY_POSTED");
  const existing = await journalFor(client, c, run.id);
  if (existing) return finish(client, c, run, existing, "RECOVERED", text(input.commandId, 200) || null);
  const lines = (await client.query(`SELECT l.expense_account_id, l.accumulated_account_id, l.category_id, sum(l.amount)::text AS amount, count(*)::int AS n, max(cat.code) AS code
      FROM tenant.asset_depreciation_run_lines l LEFT JOIN tenant.asset_categories cat ON cat.id = l.category_id WHERE l.run_id = $1 AND l.status = 'INCLUDED' AND l.amount > 0
      GROUP BY l.expense_account_id, l.accumulated_account_id, l.category_id ORDER BY 6`, [run.id])).rows;
  if (!lines.length) return finish(client, c, run, null, "NOTHING_TO_POST");
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'POSTING', row_version = row_version + 1 WHERE id = $1`, [run.id]);
  const journalLines = lines.flatMap((g) => [
    { accountId: g.expense_account_id, debitCents: toPaise(g.amount), description: `Depreciation ${g.code ?? ""} ${dayOfDb(run.period_start).slice(0, 7)} (${g.n} asset-months)` },
    { accountId: g.accumulated_account_id, creditCents: toPaise(g.amount), description: `Accumulated depreciation ${g.code ?? ""} ${dayOfDb(run.period_start).slice(0, 7)}` },
  ]);
  let posted;
  await client.query("SAVEPOINT dp_post");
  try {
    posted = await postAssetJournal(client, c, { date: dayOfDb(run.period_end), reference: run.run_number, description: `Depreciation ${run.run_number} for ${dayOfDb(run.period_start).slice(0, 7)}`,
      sourceType: "asset_depreciation_run", sourceId: run.id, sourceNumber: run.run_number, lines: journalLines });
    await client.query("RELEASE SAVEPOINT dp_post");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT dp_post");
    await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'APPROVED' WHERE id = $1`, [run.id]);
    await logDepreciationEvent(client, c, { runId: run.id }, "POSTING_REJECTED", { message: String(error.message).slice(0, 500) });
    throw dpError(409, /period/i.test(String(error.message)) ? "ASSET_DEPRECIATION_PERIOD_CLOSED" : "ASSET_DEPRECIATION_INVALID", `Finance did not accept the journal: ${error.message}`);
  }
  if (posted.status !== "posted") {
    await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'APPROVED' WHERE id = $1`, [run.id]);
    throw dpError(409, "ASSET_DEPRECIATION_GL_MAPPING_MISSING", "Finance's asset journal or depreciation accounts are not set up; nothing was posted.");
  }
  return finish(client, c, run, posted.journalEntryId, "POSTED", text(input.commandId, 200) || null);
}
// A posting interrupted with no answer: Finance's journal is looked up by its source. Found, the run is completed from it (no second
// journal); not found, the run returns to approved and can be posted.
export async function recoverDepreciationPosting(client, c, runId) {
  if (!has(c, DP.correct) && !has(c, DP.post)) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED");
  const run = await loadRun(client, c, runId);
  if (run.status === "POSTED") return { runId: run.id, status: "POSTED", replayed: true };
  if (!["POSTING", "RECOVERY_REQUIRED"].includes(run.status)) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "Nothing to recover.");
  const journal = await journalFor(client, c, run.id);
  if (journal) return finish(client, c, run, journal, "RECOVERED");
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'APPROVED', row_version = row_version + 1 WHERE id = $1`, [run.id]);
  await logDepreciationEvent(client, c, { runId: run.id }, "POSTING_NOT_FOUND", {});
  return { runId: run.id, status: "APPROVED", journalEntryId: null };
}
export async function cancelDepreciationRun(client, c, runId, input = {}) {
  if (!has(c, DP.prepare) && !has(c, DP.approve)) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED");
  const run = await loadRun(client, c, runId);
  if (run.status === "CANCELLED") return { runId: run.id, status: "CANCELLED", replayed: true };
  if (["POSTED", "POSTING", "PARTIALLY_POSTED", "RECOVERY_REQUIRED"].includes(run.status)) throw dpError(409, "ASSET_DEPRECIATION_INVALID", "A posted or posting run is not cancelled; Finance reverses its journal.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dpError(400, "ASSET_DEPRECIATION_INVALID", "Give the reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_depreciation_run_lines SET status = 'CANCELLED' WHERE run_id = $1 AND status IN ('INCLUDED', 'EXCLUDED')`, [run.id]);
  await client.query(`UPDATE tenant.asset_depreciation_period_runs SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = clock_timestamp(), cancel_reason = $3, row_version = row_version + 1 WHERE id = $1`, [run.id, c.userId, reason]);
  await logDepreciationEvent(client, c, { runId: run.id }, "RUN_CANCELLED", {}, reason);
  return { runId: run.id, status: "CANCELLED" };
}

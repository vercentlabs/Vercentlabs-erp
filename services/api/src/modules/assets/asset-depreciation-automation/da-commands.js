// Assets — Automatic Depreciation Accounting, the commands: the versioned automation policy (manual; automatic preparation with Finance
// approval — the default; or automatic posting, which only a Finance user with posting rights can enable, and which then acts with that
// user's current rights), the readiness checks, and the orchestration the scheduler and an authorized person both run: resolve the month
// from Finance's calendar, claim one execution per book and month, prepare the run through the existing engine, then wait for approval or
// post, and reconcile every outcome — an interrupted posting is verified, never repeated.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, text, uuid } from "../common.js";
import { DP, FINANCE_POST } from "../asset-depreciation/dp-rules.js";
import { approveDepreciationRun, postDepreciationRun, prepareDepreciationRun, recalculateDepreciationRun, recoverDepreciationPosting } from "../asset-depreciation/dp-commands.js";
import { fromPaise, sameAmount, toPaise } from "../asset-depreciation/dp-engine.js";
import { DA, addDays, addMonths, daError, dayOfDb, monthEnd, monthStart, requireDa } from "./da-rules.js";

const BOOK = "FINANCIAL";
const LEASE_MINUTES = 15;
const today = () => new Date().toISOString().slice(0, 10);

export const activePolicy = async (client, c) => (await client.query(`SELECT * FROM tenant.asset_depreciation_automation_policies WHERE organization_id = $1 AND book = $2 AND status = 'ACTIVE'`,
  [c.organizationId, BOOK])).rows[0] ?? null;
// The default when nothing has been configured: automatic preparation with Finance approval, from this month.
const DEFAULTS = { mode: "PREPARE_APPROVE", trigger_days_after_period_end: 0, close_deadline_days: 10, first_period: monthStart(today()), notify_finance: true, posting_user_id: null };

// A user's rights as they stand now (roles in force, active membership) — the posting identity of automatic posting is re-checked every run.
export async function currentRights(client, organizationId, userId) {
  if (!userId) return { active: false, permissions: [], roleSlugs: [] };
  const rows = (await client.query(`SELECT role.slug, array_remove(array_agg(DISTINCT rp.permission_key), NULL) AS keys FROM public.organization_memberships m
      JOIN public.user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
        AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.expires_at IS NULL OR a.expires_at > now())
      JOIN public.roles role ON role.id = a.role_id AND role.status = 'active' LEFT JOIN public.role_permissions rp ON rp.role_id = role.id
      WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active' GROUP BY role.slug`, [organizationId, userId])).rows;
  return { active: rows.length > 0, permissions: [...new Set(rows.flatMap((r) => r.keys))], roleSlugs: rows.map((r) => r.slug) };
}
async function saveVersion(client, c, current, fields, reason, { enabling = false } = {}) {
  const base = current ?? DEFAULTS;
  const next = { ...base, ...fields };
  if (current) await client.query(`UPDATE tenant.asset_depreciation_automation_policies SET status = 'SUPERSEDED', superseded_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [current.id]);
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.asset_depreciation_automation_policies WHERE organization_id = $1 AND book = $2`, [c.organizationId, BOOK])).rows[0].v);
  const autoPost = next.mode === "AUTO_POST";
  const row = (await client.query(`INSERT INTO tenant.asset_depreciation_automation_policies (organization_id, book, version, mode, trigger_days_after_period_end, close_deadline_days, first_period,
      posting_user_id, notify_finance, reason, created_by, enabled_by, enabled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, BOOK, version, next.mode, next.trigger_days_after_period_end, next.close_deadline_days, dayOfDb(next.first_period), autoPost ? next.posting_user_id : null, next.notify_finance, reason, c.userId,
      autoPost ? (enabling ? c.userId : base.enabled_by) : null, autoPost ? (enabling ? new Date().toISOString() : base.enabled_at) : null])).rows[0];
  await client.query(`INSERT INTO tenant.asset_depreciation_events (organization_id, action, details, reason, actor_user_id) VALUES ($1, 'AUTOMATION_POLICY_SAVED', $2, $3, $4)`,
    [c.organizationId, JSON.stringify({ version, mode: next.mode, previousMode: current?.mode ?? null, triggerDays: next.trigger_days_after_period_end, firstPeriod: dayOfDb(next.first_period) }), reason, c.userId]);
  return row;
}
const policyView = (p) => ({ id: p.id, version: p.version, mode: p.mode, triggerDaysAfterPeriodEnd: p.trigger_days_after_period_end, closeDeadlineDays: p.close_deadline_days, firstPeriod: dayOfDb(p.first_period),
  postingUserId: p.posting_user_id, notifyFinance: p.notify_finance, enabledBy: p.enabled_by, enabledAt: p.enabled_at });

// input: { mode: MANUAL | PREPARE_APPROVE, triggerDaysAfterPeriodEnd?, closeDeadlineDays?, firstPeriod? 'YYYY-MM', notifyFinance?, reason } — saved as a new version.
// Automatic posting is never switched on here, and switching it off needs the enabling right.
export async function configureDepreciationAutomation(client, c, input = {}) {
  requireDa(c, DA.configure);
  const current = await activePolicy(client, c);
  const mode = input.mode ?? current?.mode ?? DEFAULTS.mode;
  if (mode === "AUTO_POST" && current?.mode !== "AUTO_POST") throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED", "Automatic posting is enabled by an authorized Finance user, separately.");
  if (!["MANUAL", "PREPARE_APPROVE", "AUTO_POST"].includes(mode)) throw daError(400, "DEPRECIATION_AUTO_INVALID", "Choose manual, or automatic preparation with approval.");
  if (current?.mode === "AUTO_POST" && mode !== "AUTO_POST" && !has(c, DA.enable)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED");
  const fields = { mode };
  if (input.triggerDaysAfterPeriodEnd !== undefined) {
    const n = Number(input.triggerDaysAfterPeriodEnd);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw daError(400, "DEPRECIATION_AUTO_INVALID", "The close window is 0 to 60 days after the month ends.", { field: "triggerDaysAfterPeriodEnd" });
    fields.trigger_days_after_period_end = n;
  }
  if (input.closeDeadlineDays !== undefined) {
    const n = Number(input.closeDeadlineDays);
    if (!Number.isInteger(n) || n < 0 || n > 120) throw daError(400, "DEPRECIATION_AUTO_INVALID", "The close deadline is 0 to 120 days.", { field: "closeDeadlineDays" });
    fields.close_deadline_days = n;
  }
  if (input.firstPeriod !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.firstPeriod))) throw daError(400, "DEPRECIATION_AUTO_INVALID", "The first period is a month (YYYY-MM).", { field: "firstPeriod" });
    fields.first_period = `${input.firstPeriod}-01`;
  }
  if (input.notifyFinance !== undefined) fields.notify_finance = input.notifyFinance === true || input.notifyFinance === "true";
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw daError(400, "DEPRECIATION_AUTO_INVALID", "Give the reason for the change.", { field: "reason" });
  if (mode !== "AUTO_POST") fields.posting_user_id = null;
  const row = await saveVersion(client, c, current, fields, reason);
  if (current?.mode === "AUTO_POST" && mode !== "AUTO_POST") await notifyFinance(client, c, row, "Automatic depreciation posting turned off", `${MODE_LABEL[mode]} from version ${row.version}.`, "/assets/depreciation?view=automation");
  return policyView(row);
}
const MODE_LABEL = { MANUAL: "Manual posting", PREPARE_APPROVE: "Automatic preparation with Finance approval", AUTO_POST: "Automatic posting" };

// Every control automatic posting depends on. Each failed check is listed; automatic posting is enabled only when there are none.
export async function validateAutomationReadiness(client, c) {
  requireDa(c, DA.view);
  const org = c.organizationId;
  const issues = [];
  const add = (code, message, count = null) => issues.push({ code, message, count });
  const settings = (await client.query(`SELECT * FROM tenant.asset_settings WHERE organization_id = $1`, [org])).rows[0] ?? {};
  if (settings.depreciation_separate_poster) add("DEPRECIATION_AUTO_APPROVAL_REQUIRED", "The Company requires a different person to post than to approve; automatic posting would bypass that.");
  const noBasis = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND a.lifecycle_status NOT IN ('DISPOSED', 'DRAFT')
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_bases b WHERE b.asset_id = a.id AND b.status = 'APPROVED')`, [org])).rows[0].n);
  if (noBasis) add("DEPRECIATION_AUTO_SCHEDULE_INVALID", `${noBasis} capitalized asset${noBasis === 1 ? " has" : "s have"} no approved depreciation basis.`, noBasis);
  const unmapped = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_bases b WHERE b.organization_id = $1 AND b.status = 'APPROVED' AND (b.expense_account_id IS NULL OR b.accumulated_account_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM tenant.accounting_accounts x WHERE x.id = b.expense_account_id AND x.status = 'active') OR NOT EXISTS (SELECT 1 FROM tenant.accounting_accounts x WHERE x.id = b.accumulated_account_id AND x.status = 'active'))`, [org])).rows[0].n);
  if (unmapped) add("DEPRECIATION_AUTO_GL_MAPPING_MISSING", `${unmapped} asset${unmapped === 1 ? "" : "s"} lack usable depreciation accounts.`, unmapped);
  const stale = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_bases b JOIN tenant.assets a ON a.id = b.asset_id WHERE b.organization_id = $1 AND b.status = 'APPROVED'
      AND (a.capitalized_cost::numeric(18,2) <> b.cost_basis OR COALESCE(a.impairment_accumulated, 0)::numeric(18,2) <> b.impairment_before)`, [org])).rows[0].n);
  if (stale) add("DEPRECIATION_AUTO_STALE_BASIS", `${stale} asset${stale === 1 ? "'s" : "s'"} approved basis no longer matches the cost or impairment.`, stale);
  const cutover = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_opening_batches WHERE organization_id = $1 AND status IN ('REGISTERED_PENDING_FINANCE', 'NEEDS_CORRECTION', 'RECOVERY_REQUIRED', 'REGISTERING')`, [org])).rows[0].n);
  if (cutover) add("DEPRECIATION_AUTO_SCHEDULE_INVALID", `${cutover} opening migration${cutover === 1 ? " is" : "s are"} not reconciled with Finance yet.`, cutover);
  const unknown = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND status IN ('POSTING', 'RECOVERY_REQUIRED')`, [org])).rows[0].n);
  if (unknown) add("DEPRECIATION_AUTO_OUTCOME_UNKNOWN", `${unknown} posting${unknown === 1 ? " is" : "s are"} still being verified.`, unknown);
  const policies = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_bases WHERE organization_id = $1 AND status = 'APPROVED'`, [org])).rows[0].n);
  if (!policies) add("DEPRECIATION_AUTO_SCHEDULE_INVALID", "No asset has an approved depreciation basis yet.");
  return { ready: issues.length === 0, issues };
}

// input: { reason } — the enabling Finance user becomes the posting identity; every run re-checks that their rights still stand.
export async function enableAutomaticDepreciationPosting(client, c, input = {}) {
  requireDa(c, DA.enable);
  if (!has(c, DP.post) || !has(c, FINANCE_POST) || !has(c, DP.approve)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED", "Only a Finance user who may approve and post depreciation can enable automatic posting.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw daError(400, "DEPRECIATION_AUTO_INVALID", "Give the reason for enabling automatic posting.", { field: "reason" });
  const readiness = await validateAutomationReadiness(client, c);
  if (!readiness.ready) throw daError(409, "DEPRECIATION_AUTO_NOT_READY", undefined, { issues: readiness.issues });
  const current = await activePolicy(client, c);
  if (current?.mode === "AUTO_POST" && current.posting_user_id === c.userId) return { ...policyView(current), replayed: true };
  const row = await saveVersion(client, c, current, { mode: "AUTO_POST", posting_user_id: c.userId }, reason, { enabling: true });
  await notifyFinance(client, c, row, "Automatic depreciation posting enabled", `Enabled by a Finance user from version ${row.version}. Runs that pass every check post without a further approval.`, "/assets/depreciation?view=automation");
  return policyView(row);
}
// input: { reason, mode? } — back to automatic preparation with approval (or manual). Runs already posting are still reconciled.
export async function disableAutomaticDepreciationPosting(client, c, input = {}) {
  requireDa(c, DA.enable);
  return configureDepreciationAutomation(client, { ...c, permissions: [...(c.permissions ?? []), DA.configure] }, { mode: input.mode === "MANUAL" ? "MANUAL" : "PREPARE_APPROVE", reason: input.reason });
}

// ------------------------------------------------------------------ notifications (one per outcome, never one per asset)
async function financeRecipients(client, organizationId) {
  return (await client.query(`SELECT DISTINCT m.user_id FROM public.organization_memberships m
      JOIN public.user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active' AND (a.expires_at IS NULL OR a.expires_at > now())
      JOIN public.roles role ON role.id = a.role_id AND role.status = 'active'
      WHERE m.organization_id = $1 AND m.status = 'active' AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role_id = role.id AND p.permission_key = $2))`,
    [organizationId, DP.approve])).rows.map((r) => r.user_id);
}
async function notifyFinance(client, c, policy, title, message, href) {
  if (policy && policy.notify_finance === false) return 0;
  let sent = 0;
  for (const userId of await financeRecipients(client, c.organizationId)) {
    if (await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_depreciation", title, message, href, entityType: "asset_depreciation_automation", entityId: policy?.id ?? null })) sent += 1;
  }
  return sent;
}

// ------------------------------------------------------------------ the orchestration
// The month the automation may process now: the latest month whose end plus the close window has passed, from the first period on.
export function eligibleMonth(policy, day = today()) {
  let m = monthStart(day);
  while (addDays(monthEnd(m), policy.trigger_days_after_period_end) > day) m = addMonths(m, -1);
  return m < dayOfDb(policy.first_period) ? null : m;
}
// Finance's calendar decides: the fiscal period covering the month's end must exist and be open.
async function financePeriod(client, organizationId, month) {
  return (await client.query(`SELECT id, status, name FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2 AND end_date >= $2 ORDER BY (status = 'open') DESC, start_date DESC LIMIT 1`,
    [organizationId, monthEnd(month)])).rows[0] ?? null;
}
// What reconciliation says of a run: posted and agreeing with Finance's journal, still to post, being verified, or not agreeing.
export async function runOutcome(client, runId) {
  const r = (await client.query(`SELECT o.*, (SELECT COALESCE(sum(l.amount), 0)::text FROM tenant.asset_depreciation_run_lines l WHERE l.run_id = o.id AND l.status = 'POSTED') AS lines_total,
      (SELECT COALESCE(sum(j.debit_amount), 0)::text FROM tenant.accounting_journal_lines j WHERE j.journal_entry_id = o.journal_entry_id) AS gl_total,
      (SELECT e.status FROM tenant.accounting_journal_entries e WHERE e.id = o.journal_entry_id) AS gl_status FROM tenant.asset_depreciation_period_runs o WHERE o.id = $1`, [runId])).rows[0];
  if (!r) return null;
  if (["POSTING", "RECOVERY_REQUIRED"].includes(r.status)) return "RECOVERY_REQUIRED";
  if (r.status === "PARTIALLY_POSTED") return "PARTIAL_POSTING";
  if (r.status !== "POSTED") return "PENDING_POSTING";
  const agree = sameAmount(r.posted_total, r.lines_total) && (!r.approved_total || sameAmount(r.approved_total, r.posted_total)) && (!r.journal_entry_id || (sameAmount(r.gl_total, r.lines_total) && r.gl_status === "posted"));
  return agree ? "RECONCILED" : "MISMATCH";
}
async function attempt(client, c, ex, outcome, details = {}) {
  await client.query(`INSERT INTO tenant.asset_depreciation_automation_attempts (organization_id, execution_id, attempt, outcome, details) VALUES ($1,$2,$3,$4,$5)`,
    [c.organizationId, ex.id, ex.attempts, outcome, JSON.stringify(details)]);
}
async function settle(client, c, ex, status, { code = null, summary = null, runId = undefined, details = {}, done = true } = {}) {
  const run = runId === undefined ? ex.run_id : runId;
  const reconciliation = run ? await runOutcome(client, run) : null;
  const row = (await client.query(`UPDATE tenant.asset_depreciation_automation_executions SET status = $2, error_code = $3, error_summary = $4, run_id = $5, reconciliation = $6, details = details || $7::jsonb,
      lease_expires_at = NULL, updated_at = clock_timestamp(), completed_at = CASE WHEN $8 THEN clock_timestamp() ELSE completed_at END WHERE id = $1 RETURNING *`,
    [ex.id, status, code, summary, run, reconciliation, JSON.stringify(details), done])).rows[0];
  await attempt(client, c, row, status, { code, summary, reconciliation, ...details });
  return row;
}
// The Company-scoped service authority the automation acts with: preparation only. Posting acts as the policy's Finance user.
const preparer = (c) => ({ organizationId: c.organizationId, userId: null, roleSlugs: ["system_worker"], permissions: [DP.prepare, DP.review, DP.view, DP.financials] });
async function poster(client, c, policy) {
  const rights = await currentRights(client, c.organizationId, policy.posting_user_id);
  const ctx = { organizationId: c.organizationId, userId: policy.posting_user_id, roleSlugs: rights.roleSlugs, permissions: rights.permissions };
  const owner = rights.roleSlugs.includes("organization_owner");
  const ok = rights.active && (owner || ([DP.post, DP.approve, FINANCE_POST].every((k) => rights.permissions.includes(k))));
  return { ok, ctx };
}

// The scheduler's entry (and an authorized person's "run now"). input: { today?, trigger?, triggeredBy?, period? 'YYYY-MM' }.
// First every interrupted posting is verified and every waiting execution brought up to date; then, if the policy allows, this month is
// prepared — once — and either left for Finance's approval or posted, depending on the mode.
export async function runDepreciationAutomation(client, c, input = {}) {
  const day = input.today ?? today();
  const trigger = input.trigger === "MANUAL" ? "MANUAL" : "SCHEDULED";
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('asset_depreciation_automation:' || $1::text))`, [c.organizationId]);
  const policy = await activePolicy(client, c) ?? null;
  const recovered = await reconcileOpenExecutions(client, c, policy);
  if (!policy && trigger === "SCHEDULED") return { status: "NO_POLICY", recovered };
  const effective = policy ?? { ...DEFAULTS, id: null, version: null };
  if (trigger === "SCHEDULED" && effective.mode === "MANUAL") return { status: "MANUAL", recovered };
  const latest = eligibleMonth(effective, day);
  let month = latest;
  if (input.period) {
    month = `${input.period}-01`;
    if (!latest || month > latest) throw daError(409, "DEPRECIATION_AUTO_PERIOD_NOT_READY", `${input.period} is not ready: a month is processed ${effective.trigger_days_after_period_end} day(s) after it ends.`);
  }
  if (!month) return { status: "WAITING", recovered, message: "No month is ready yet under the automation policy." };
  const key = `${BOOK}:${month}`;
  await client.query(`INSERT INTO tenant.asset_depreciation_automation_executions (organization_id, policy_id, policy_version, mode, book, period_start, trigger, execution_key, triggered_by, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CLAIMED') ON CONFLICT (organization_id, execution_key) DO NOTHING`, [c.organizationId, effective.id, effective.version, effective.mode, BOOK, month, trigger, key, input.triggeredBy ?? null]);
  let ex = (await client.query(`SELECT * FROM tenant.asset_depreciation_automation_executions WHERE organization_id = $1 AND execution_key = $2 FOR UPDATE`, [c.organizationId, key])).rows[0];
  // A finished or waiting execution is the same execution: never a second run or posting for the month.
  if (["POSTED", "AWAITING_APPROVAL", "POSTING", "SKIPPED"].includes(ex.status) && !input.retry) return { status: ex.status, executionId: ex.id, runId: ex.run_id, period: month.slice(0, 7), replayed: true, recovered };
  if (ex.status === "CLAIMED" && ex.attempts > 0 && ex.lease_expires_at && new Date(ex.lease_expires_at) > new Date() && !input.retry) throw daError(409, "DEPRECIATION_AUTO_CONCURRENT_RUN");
  ex = (await client.query(`UPDATE tenant.asset_depreciation_automation_executions SET status = 'CLAIMED', attempts = attempts + 1, lease_expires_at = clock_timestamp() + make_interval(mins => $2),
      mode = $3, policy_id = $4, policy_version = $5, updated_at = clock_timestamp() WHERE id = $1 RETURNING *`, [ex.id, LEASE_MINUTES, effective.mode, effective.id, effective.version])).rows[0];
  await attempt(client, c, ex, "CLAIMED", { trigger, month });
  const out = await processExecution(client, c, ex, effective, month);
  return { ...out, executionId: ex.id, period: month.slice(0, 7), recovered };
}

async function processExecution(client, c, ex, policy, month) {
  const fp = await financePeriod(client, c.organizationId, month);
  if (!fp || fp.status !== "open") {
    const row = await settle(client, c, ex, "EXCEPTION", { code: "DEPRECIATION_AUTO_PERIOD_CLOSED", summary: fp ? `The accounting period ${fp.name} is ${fp.status}.` : "No open accounting period covers this month." });
    await notifyFinance(client, c, policy, `Depreciation for ${month.slice(0, 7)} is blocked`, row.error_summary, "/assets/depreciation?view=automation");
    return { status: row.status, code: row.error_code };
  }
  // A run a person already prepared for the month is used, never duplicated.
  let run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE organization_id = $1 AND book = $2 AND period_start = $3 AND status <> 'CANCELLED'`, [c.organizationId, BOOK, month])).rows[0];
  // A posting whose answer was lost is verified against Finance's journal first — completed from it, or returned to approved — never re-sent blindly.
  if (run && ["POSTING", "RECOVERY_REQUIRED"].includes(run.status)) {
    const who = policy.posting_user_id ? await poster(client, c, policy) : null;
    await recoverDepreciationPosting(client, who?.ok ? who.ctx : { ...preparer(c), permissions: [...preparer(c).permissions, DP.correct] }, run.id);
    run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE id = $1`, [run.id])).rows[0];
    await attempt(client, c, ex, "RECOVERY", { runStatus: run.status });
  }
  if (run && run.status === "POSTED") return { status: (await settle(client, c, ex, "POSTED", { runId: run.id })).status, runId: run.id, reconciliation: await runOutcome(client, run.id) };
  if (run && run.status === "NEEDS_CORRECTION") { await recalculateDepreciationRun(client, preparer(c), run.id); run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE id = $1`, [run.id])).rows[0]; }
  if (!run) {
    let prepared;
    try { prepared = await prepareDepreciationRun(client, preparer(c), { period: month.slice(0, 7), idempotencyKey: `auto:${BOOK}:${month}` }); }
    catch (error) {
      const row = await settle(client, c, ex, "FAILED", { code: error.code ?? "DEPRECIATION_AUTO_INVALID", summary: String(error.message).slice(0, 500) });
      await notifyFinance(client, c, policy, `Depreciation for ${month.slice(0, 7)} could not be prepared`, row.error_summary, "/assets/depreciation?view=automation");
      return { status: row.status, code: row.error_code };
    }
    await client.query(`UPDATE tenant.asset_depreciation_period_runs SET automation_execution_id = $2, prepared_by_automation = true WHERE id = $1`, [prepared.runId, ex.id]);
    run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE id = $1`, [prepared.runId])).rows[0];
  }
  const href = `/assets/depreciation/runs/${run.id}`;
  if (run.status === "NEEDS_CORRECTION") {
    const codes = Object.keys(run.summary?.excluded ?? {});
    const code = codes.includes("GL_MAPPING_MISSING") ? "DEPRECIATION_AUTO_GL_MAPPING_MISSING" : "DEPRECIATION_AUTO_STALE_BASIS";
    const row = await settle(client, c, ex, "EXCEPTION", { code, summary: "The run has blocking exceptions; correct them and recalculate.", runId: run.id, done: false });
    await notifyFinance(client, c, policy, `${run.run_number}: depreciation needs correction`, row.error_summary, href);
    return { status: row.status, code, runId: run.id };
  }
  const catchUp = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_run_lines WHERE run_id = $1 AND status = 'INCLUDED' AND period_start < $2`, [run.id, month])).rows[0].n);
  if (policy.mode !== "AUTO_POST" || catchUp > 0 || ex.trigger === "MANUAL" && policy.mode === "MANUAL") {
    const code = policy.mode === "AUTO_POST" && catchUp > 0 ? "DEPRECIATION_AUTO_CATCH_UP" : null;
    const row = await settle(client, c, ex, "AWAITING_APPROVAL", { code, summary: code ? `${catchUp} earlier month${catchUp === 1 ? "" : "s"} included; Finance confirms the catch-up before posting.` : null, runId: run.id, done: false,
      details: { proposedTotal: String(run.proposed_total), assets: run.summary?.assetsWithCharge ?? 0 } });
    await notifyFinance(client, c, policy, `${run.run_number}: depreciation for ${month.slice(0, 7)} is ready for approval`,
      `${run.summary?.assetsWithCharge ?? 0} assets, ${fromPaise(toPaise(String(run.proposed_total)))} proposed.${code ? ` ${row.error_summary}` : ""}`, href);
    return { status: row.status, code, runId: run.id };
  }
  // Automatic posting: as the policy's Finance user, whose rights are checked now.
  const { ok, ctx } = await poster(client, c, policy);
  if (!ok) {
    const row = await settle(client, c, ex, "EXCEPTION", { code: "DEPRECIATION_AUTO_PERMISSION_DENIED", summary: "The Finance user automatic posting acts as no longer holds the posting rights; the run waits for approval.", runId: run.id, done: false });
    await notifyFinance(client, c, policy, `${run.run_number}: automatic posting stopped`, row.error_summary, href);
    return { status: row.status, code: row.error_code, runId: run.id };
  }
  await client.query(`UPDATE tenant.asset_depreciation_automation_executions SET status = 'POSTING', run_id = $2, updated_at = clock_timestamp() WHERE id = $1`, [ex.id, run.id]);
  await client.query("SAVEPOINT da_post");
  try {
    if (run.status === "READY_FOR_REVIEW") await approveDepreciationRun(client, ctx, run.id, { note: `Approved by automatic posting (policy v${policy.version})` });
    const posted = await postDepreciationRun(client, ctx, run.id, { commandId: `auto:${ex.id}:${ex.attempts}` });
    await client.query("RELEASE SAVEPOINT da_post");
    if (posted.code) {
      const row = await settle(client, c, ex, "EXCEPTION", { code: "DEPRECIATION_AUTO_STALE_BASIS", summary: posted.message, runId: run.id, done: false });
      await notifyFinance(client, c, policy, `${run.run_number}: depreciation needs correction`, row.error_summary, href);
      return { status: row.status, code: row.error_code, runId: run.id };
    }
    const row = await settle(client, c, ex, "POSTED", { runId: run.id, details: { journalEntryId: posted.journalEntryId, postedTotal: posted.postedTotal } });
    await notifyFinance(client, c, policy, `${run.run_number}: depreciation for ${month.slice(0, 7)} posted`, `${posted.postedTotal} posted automatically; reconciliation: ${row.reconciliation}.`, href);
    return { status: row.status, runId: run.id, journalEntryId: posted.journalEntryId, reconciliation: row.reconciliation };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT da_post");
    const row = await settle(client, c, ex, "EXCEPTION", { code: error.code === "ASSET_DEPRECIATION_PERIOD_CLOSED" ? "DEPRECIATION_AUTO_PERIOD_CLOSED" : error.code === "ASSET_DEPRECIATION_GL_MAPPING_MISSING" ? "DEPRECIATION_AUTO_GL_MAPPING_MISSING" : "DEPRECIATION_AUTO_FINANCE_UNAVAILABLE",
      summary: String(error.message).slice(0, 500), runId: run.id, done: false });
    await notifyFinance(client, c, policy, `${run.run_number}: automatic posting did not complete`, row.error_summary, href);
    return { status: row.status, code: row.error_code, runId: run.id };
  }
}
// Brings every unfinished execution up to date from the runs and Finance: an interrupted posting is verified against Finance's journal (found:
// completed from it; not found: back to approval), a run a person approved or posted is reflected. Runs even when automation is turned off.
async function reconcileOpenExecutions(client, c, policy) {
  let changed = 0;
  for (const ex of (await client.query(`SELECT * FROM tenant.asset_depreciation_automation_executions WHERE organization_id = $1 AND status IN ('AWAITING_APPROVAL', 'POSTING', 'EXCEPTION', 'CLAIMED') AND run_id IS NOT NULL FOR UPDATE`, [c.organizationId])).rows) {
    let run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE id = $1`, [ex.run_id])).rows[0];
    if (!run) continue;
    if (["POSTING", "RECOVERY_REQUIRED"].includes(run.status)) {
      const who = policy?.posting_user_id ? (await poster(client, c, policy)) : null;
      const recoverCtx = who?.ok ? who.ctx : { ...preparer(c), permissions: [...preparer(c).permissions, DP.correct] };
      await recoverDepreciationPosting(client, recoverCtx, run.id);
      run = (await client.query(`SELECT * FROM tenant.asset_depreciation_period_runs WHERE id = $1`, [ex.run_id])).rows[0];
      await attempt(client, c, ex, "RECOVERY", { runStatus: run.status });
    }
    const status = run.status === "POSTED" ? "POSTED" : run.status === "CANCELLED" ? "SKIPPED" : run.status === "NEEDS_CORRECTION" ? "EXCEPTION" : ["POSTING", "RECOVERY_REQUIRED"].includes(run.status) ? "POSTING" : "AWAITING_APPROVAL";
    const outcome = await runOutcome(client, run.id);
    if (status !== ex.status || outcome !== ex.reconciliation) {
      await settle(client, c, ex, status, { code: status === "POSTED" || status === "SKIPPED" ? null : ex.error_code, summary: status === "POSTED" || status === "SKIPPED" ? null : ex.error_summary, done: ["POSTED", "SKIPPED"].includes(status) });
      if (outcome === "MISMATCH") await notifyFinance(client, c, policy, `${run.run_number}: depreciation does not agree with Finance`, "The posted total and the journal differ; see Reconciliation.", `/assets/depreciation/runs/${run.id}`);
      changed += 1;
    }
  }
  return changed;
}

// An authorized "run now" for the eligible month (or a named eligible month).
export async function triggerDepreciationAutomation(client, c, input = {}) {
  if (!has(c, DP.prepare) && !has(c, DA.retry)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED");
  return runDepreciationAutomation(client, c, { trigger: "MANUAL", triggeredBy: c.userId, period: input.period ? String(input.period) : undefined });
}
// Retry a failed or blocked execution after the cause is corrected: the same execution, the run recalculated — never a second posting.
export async function retryDepreciationExecution(client, c, executionId) {
  requireDa(c, DA.retry);
  const ex = (await client.query(`SELECT * FROM tenant.asset_depreciation_automation_executions WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(executionId, "Execution")])).rows[0];
  if (!ex) throw daError(404, "DEPRECIATION_AUTO_INVALID", "This execution is not available.");
  if (!["FAILED", "EXCEPTION"].includes(ex.status)) throw daError(409, "DEPRECIATION_AUTO_INVALID", "Only a failed or blocked execution is retried.");
  return runDepreciationAutomation(client, c, { trigger: ex.trigger, triggeredBy: c.userId, period: dayOfDb(ex.period_start).slice(0, 7), retry: true });
}

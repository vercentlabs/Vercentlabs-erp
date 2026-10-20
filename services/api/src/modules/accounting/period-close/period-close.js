// Period close (Finance MVP F9). A month moves Open → Closing review → Closed → Locked, in date order:
//
//   review    Finance starts the month's closing review: nothing more posts into it (the database refuses), and the readiness checks
//             say what is left. Back to Open to fix something.
//   close     only from review, once every earlier month is closed, nothing blocking is left (journals not posted, failed automatic
//             postings, documents awaiting approval dated in the month, an unbalanced trial balance), and every warning — sub-ledgers that
//             don't agree with the books, bank lines not reconciled, depreciation or payroll not posted, input tax awaiting confirmation,
//             suspense balances — is cleared or acknowledged with a reason. The checks and trial balance totals are kept with the month.
//   lock      a closed month is locked (earlier months first).
//   reopen    with a reason, latest month first: a closed month by someone who manages the close, a locked one only by someone who may
//             waive close controls. A month of a closed financial year isn't reopened.
//   year      once its twelve months are closed, the financial year is closed: the year's profit is moved to retained earnings by a
//             closing entry, and every month is locked.
//
// Nothing here — or anywhere — posts into a month that isn't open: the database refuses it.
import { ACCOUNTING_PERMISSIONS, AccountingError, decimal, event, getAccountMapping, getPrimaryLedger, hasPermission, requirePermission, requiredText, text, uuid } from "../core.js";
import { formatDecimal } from "../../../core/decimal.js";
import { createJournalEntry, postJournalEntry } from "../journals.js";
import { getModuleReconciliation } from "../posting-rules/module-checks.js";
import { getTrialBalanceStatement } from "../statements/statements.js";

const fail = (status, message, code, details) => { throw new AccountingError(status, message, code, details); };
const pad = (n) => String(n).padStart(2, "0");
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : value ? String(value).slice(0, 10) : null);
const money = (value) => Number(formatDecimal(decimal(value ?? 0), 2));
export const STATUS = Object.freeze({
  open: { key: "OPEN", label: "Open" }, soft_closed: { key: "CLOSING_REVIEW", label: "Closing review" }, closed: { key: "CLOSED", label: "Closed" }, locked: { key: "LOCKED", label: "Locked" },
});
const elevated = (context, ...permissions) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ...permissions])] });

async function loadPeriod(client, context, idValue, { lock = false } = {}) {
  const row = (await client.query(
    `SELECT period.*, year.id AS year_id, year.name AS year_name, year.status AS year_status, year.start_date AS year_start, year.end_date AS year_end
       FROM tenant.fiscal_periods period LEFT JOIN tenant.accounting_fiscal_years year ON year.id = period.fiscal_year_id
      WHERE period.organization_id = $1 AND period.id = $2${lock ? " FOR UPDATE OF period" : ""}`, [context.organizationId, uuid(idValue, "Period")])).rows[0];
  if (!row) fail(404, "Accounting period not found.", "ACCOUNTING_PERIOD_NOT_FOUND");
  return row;
}

// ------------------------------------------------------------------ readiness checks
// Each check: blocking (must be cleared) or a warning (cleared, or acknowledged with a reason). Counts and amounts are for the month.
async function runChecks(client, context, period) {
  const start = day(period.start_date); const end = day(period.end_date);
  const org = context.organizationId;
  const ledger = await getPrimaryLedger(client, context);
  const one = async (sql, values) => (await client.query(sql, values)).rows[0];
  const checks = [];
  const add = (key, label, severity, count, extra = {}) => checks.push({ key, label, severity, count: Number(count ?? 0), clear: Number(count ?? 0) === 0, ...extra });

  const earlier = await one(
    `SELECT count(*)::int AS n, string_agg(name, ', ' ORDER BY start_date) AS names FROM tenant.fiscal_periods
      WHERE organization_id = $1 AND period_type = 'standard' AND end_date < $2::date AND status IN ('open', 'soft_closed')`, [org, start]);
  add("earlier_open", "Earlier months closed", "blocking", earlier.n, { detail: earlier.n ? `Close ${earlier.names} first.` : null, href: "/accounting/fiscal-periods" });

  const journals = await one(`SELECT count(*)::int AS n FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND accounting_date BETWEEN $2 AND $3
      AND status IN ('draft', 'pending_approval', 'approved')`, [org, start, end]);
  add("unposted_journals", "Journals posted", "blocking", journals.n, { detail: journals.n ? `${journals.n} journal entr${journals.n === 1 ? "y is" : "ies are"} not posted. Post them, or discard them.` : null, href: "/accounting/journals" });

  const postings = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'FAILED')::int AS failed FROM tenant.accounting_postings
      WHERE organization_id = $1 AND COALESCE(posting_date, transaction_date) BETWEEN $2 AND $3 AND status IN ('PENDING', 'DRAFT', 'FAILED')`, [org, start, end]);
  add("posting_failures", "Automatic postings complete", "blocking", postings.n,
    { detail: postings.n ? `${postings.n} document${postings.n === 1 ? "" : "s"} from Sales, Procurement, Inventory or other modules ${postings.n === 1 ? "is" : "are"} not in the books${postings.failed ? ` (${postings.failed} failed)` : ""}. Retry or resolve them.` : null, href: "/accounting/postings" });

  const waiting = await one(
    `SELECT (SELECT count(*) FROM tenant.accounting_expenses WHERE organization_id = $1 AND expense_date BETWEEN $2 AND $3 AND status = 'SUBMITTED')::int AS expenses,
            (SELECT count(*) FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND payment_date BETWEEN $2 AND $3 AND status IN ('pending_approval', 'approved'))::int AS payments`,
    [org, start, end]);
  add("awaiting_approval", "Nothing dated in the month awaiting approval", "blocking", waiting.expenses + waiting.payments,
    { detail: waiting.expenses + waiting.payments ? [waiting.expenses ? `${waiting.expenses} expense(s)` : null, waiting.payments ? `${waiting.payments} supplier payment(s)` : null].filter(Boolean).join(" and ") + " dated in the month still await approval. Approve, send back or cancel them." : null,
      href: waiting.expenses ? "/accounting/expenses" : "/accounting/payments" });

  const tb = await getTrialBalanceStatement(client, elevated(context, ACCOUNTING_PERMISSIONS.reportsView), { from: start, to: end });
  add("trial_balance", "Trial balance balances", "blocking", tb.balanced ? 0 : 1, { detail: tb.balanced ? null : tb.exceptions.join(" "), href: "/accounting/trial-balance" });

  const depreciation = await one(
    `SELECT count(DISTINCT line.asset_id)::int AS n, COALESCE(sum(line.amount), 0)::text AS amount FROM tenant.asset_depreciation_schedule_lines line
      WHERE line.organization_id = $1 AND line.period_end BETWEEN $2 AND $3 AND line.amount > 0
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_period_runs run WHERE run.organization_id = $1 AND run.status IN ('POSTED', 'PARTIALLY_POSTED')
                         AND run.period_start <= line.period_end AND run.period_end >= line.period_start)`, [org, start, end]);
  add("depreciation", "Depreciation posted", "warning", depreciation.n,
    { amount: money(depreciation.amount), detail: depreciation.n ? `Depreciation of ${depreciation.n} asset(s) (₹${money(depreciation.amount).toLocaleString("en-IN")}) for the month isn't posted.` : null, href: "/assets/depreciation" });

  const payroll = await one(`SELECT count(*)::int AS n FROM tenant.hr_payroll_runs WHERE organization_id = $1 AND period_end >= $2 AND period_start <= $3
      AND status IN ('calculated', 'pending_approval', 'approved')`, [org, start, end]);
  add("payroll", "Payroll posted", "warning", payroll.n, { detail: payroll.n ? `${payroll.n} payroll run(s) for the month aren't posted to the books.` : null, href: "/hr/payroll" });

  const modules = await getModuleReconciliation(client, elevated(context, ACCOUNTING_PERMISSIONS.view));
  const disagree = modules.checks.filter((entry) => !["ok", "not_applicable", "info"].includes(entry.status));
  add("subledgers", "Sub-ledgers agree with the books", "warning", disagree.length,
    { detail: disagree.length ? `${disagree.map((entry) => entry.label).join(", ")} ${disagree.length === 1 ? "doesn't" : "don't"} agree with ${disagree.length === 1 ? "its" : "their"} control account (as of now).` : null,
      href: "/accounting/postings?view=books" });

  const bank = await one(
    `SELECT count(*)::int AS n, COALESCE(sum(line.debit_amount + line.credit_amount), 0)::text AS amount FROM tenant.accounting_bank_statement_lines line
       JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id AND statement.status <> 'cancelled'
      WHERE line.organization_id = $1 AND line.transaction_date BETWEEN $2 AND $3 AND (line.match_status NOT IN ('matched', 'ignored') OR statement.status <> 'reconciled')`, [org, start, end]);
  const uncovered = await one(
    `SELECT count(*)::int AS n, string_agg(bank.account_name, ', ') AS names FROM tenant.accounting_bank_accounts bank
      WHERE bank.organization_id = $1 AND bank.status = 'active' AND bank.account_type <> 'cash'
        AND EXISTS (SELECT 1 FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
                     WHERE line.organization_id = $1 AND line.account_id = bank.gl_account_id AND entry.accounting_date BETWEEN $2 AND $3)
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_bank_statements statement WHERE statement.organization_id = $1 AND statement.bank_account_id = bank.id
                         AND statement.status <> 'cancelled' AND statement.period_end >= $3::date)`, [org, start, end]);
  add("bank", "Bank accounts reconciled", "warning", bank.n + uncovered.n,
    { detail: bank.n + uncovered.n ? [bank.n ? `${bank.n} bank statement line(s) dated in the month aren't reconciled` : null,
      uncovered.n ? `no statement covers the month's end for ${uncovered.names}` : null].filter(Boolean).join("; ") + "." : null, href: "/accounting/reconciliation" });

  const pendingItc = await one(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0)::text AS balance FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      WHERE line.organization_id = $1 AND entry.accounting_date <= $2::date
        AND line.account_id IN (SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND ledger_id = $3 AND mapping_key = 'input_tax_pending' AND status = 'active')`,
    [org, end, ledger.id]);
  const itc = money(pendingItc.balance);
  add("itc_pending", "Input tax credit decided", "warning", itc === 0 ? 0 : 1,
    { amount: itc, detail: itc ? `₹${itc.toLocaleString("en-IN")} of input GST is still awaiting confirmation against GSTR-2B.` : null, href: "/accounting/input-tax-credit" });

  const suspense = await one(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0)::text AS balance, count(DISTINCT account.id)::int AS accounts
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.account_type = 'suspense'
      WHERE line.organization_id = $1 AND entry.accounting_date <= $2::date`, [org, end]);
  const parked = money(suspense.balance);
  add("suspense", "Suspense and clearing accounts empty", "warning", parked === 0 ? 0 : 1,
    { amount: parked, detail: parked ? `Suspense and clearing accounts hold ₹${Math.abs(parked).toLocaleString("en-IN")} at the month's end.` : null, href: "/accounting/trial-balance" });

  // Acknowledgements of warnings.
  const acks = (await client.query(
    `SELECT ack.check_key, ack.reason, ack.acknowledged_at, person.full_name FROM tenant.accounting_period_close_acknowledgements ack
       LEFT JOIN public.users person ON person.id = ack.acknowledged_by
      WHERE ack.organization_id = $1 AND ack.fiscal_period_id = $2 AND ack.withdrawn_at IS NULL`, [org, period.id])).rows;
  for (const check of checks) {
    const ack = acks.find((entry) => entry.check_key === check.key);
    check.acknowledgement = ack ? { reason: ack.reason, at: ack.acknowledged_at, by: ack.full_name } : null;
    check.state = check.clear ? "ok" : check.severity === "warning" && ack ? "acknowledged" : "attention";
  }
  return { checks, trialBalance: tb.totals };
}

const readiness = (checks) => ({
  blocking: checks.filter((check) => check.severity === "blocking" && !check.clear).length,
  open: checks.filter((check) => check.state === "attention").length,
  ready: checks.every((check) => check.state !== "attention"),
});

// ------------------------------------------------------------------ reads
function periodView(row) {
  return {
    id: row.id, name: row.name, number: row.period_number, type: row.period_type ?? "standard", startDate: day(row.start_date), endDate: day(row.end_date), status: row.status,
    statusKey: STATUS[row.status]?.key ?? row.status, statusLabel: STATUS[row.status]?.label ?? row.status,
    reviewStartedAt: row.review_started_at ?? row.soft_closed_at ?? null, closedAt: row.closed_at ?? null, lockedAt: row.locked_at ?? null,
    reopenedAt: row.reopened_at ?? null, reopenReason: row.reopen_reason ?? null, note: row.close_note ?? null,
  };
}

// The financial years and their months, with where each month stands, and which month is next to close.
export async function getCloseOverview(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const years = (await client.query(`SELECT * FROM tenant.accounting_fiscal_years WHERE organization_id = $1 ORDER BY start_date DESC`, [context.organizationId])).rows;
  const periods = (await client.query(
    `SELECT period.*, closer.full_name AS closed_by_name FROM tenant.fiscal_periods period LEFT JOIN public.users closer ON closer.id = period.closed_by
      WHERE period.organization_id = $1 ORDER BY period.start_date, period.period_type DESC`, [context.organizationId])).rows;
  const nextToClose = periods.find((row) => row.period_type === "standard" && ["open", "soft_closed"].includes(row.status));
  return {
    nextToClose: nextToClose ? periodView(nextToClose) : null,
    years: years.map((year) => {
      const own = periods.filter((row) => row.fiscal_year_id === year.id);
      const standard = own.filter((row) => row.period_type === "standard");
      return {
        id: year.id, code: year.code, name: year.name, startDate: day(year.start_date), endDate: day(year.end_date), status: year.status,
        closingJournalEntryId: year.closing_journal_entry_id ?? null, closedAt: year.closed_at ?? null,
        canClose: year.status !== "closed" && standard.length > 0 && standard.every((row) => ["closed", "locked"].includes(row.status)),
        periods: own.map((row) => ({ ...periodView(row), closedBy: row.closed_by_name ?? null })),
      };
    }),
  };
}

export async function getPeriodCloseWorkspace(client, context, periodIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const period = await loadPeriod(client, context, periodIdValue);
  const live = ["open", "soft_closed"].includes(period.status);
  const { checks, trialBalance } = live ? await runChecks(client, context, period) : { checks: period.close_snapshot?.checks ?? [], trialBalance: period.close_snapshot?.trialBalance ?? null };
  const state = readiness(checks);
  const neighbours = (await client.query(
    `SELECT id, name, status, start_date FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard' AND id <> $2
        AND (start_date = (SELECT max(start_date) FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard' AND start_date < $3::date)
          OR start_date = (SELECT min(start_date) FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard' AND start_date > $3::date))`,
    [context.organizationId, period.id, day(period.start_date)])).rows;
  const previous = neighbours.find((row) => day(row.start_date) < day(period.start_date)) ?? null;
  const next = neighbours.find((row) => day(row.start_date) > day(period.start_date)) ?? null;
  const people = (await client.query(
    `SELECT (SELECT full_name FROM public.users WHERE id = $1) AS review_by, (SELECT full_name FROM public.users WHERE id = $2) AS closed_by,
            (SELECT full_name FROM public.users WHERE id = $3) AS locked_by, (SELECT full_name FROM public.users WHERE id = $4) AS reopened_by`,
    [period.review_started_by ?? period.soft_closed_by ?? null, period.closed_by ?? null, period.locked_by ?? null, period.reopened_by ?? null])).rows[0];
  const history = (await client.query(
    `SELECT event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor FROM tenant.accounting_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'fiscal_period' AND event.entity_id = $2 ORDER BY event.occurred_at DESC`, [context.organizationId, period.id])).rows;
  const can = (permission) => hasPermission(context, permission);
  const yearClosed = period.year_status === "closed";
  return {
    period: { ...periodView(period), yearId: period.year_id, yearName: period.year_name, yearClosed,
      reviewStartedBy: people.review_by, closedBy: people.closed_by, lockedBy: people.locked_by, reopenedBy: people.reopened_by },
    previous: previous ? { id: previous.id, name: previous.name, status: previous.status } : null,
    next: next ? { id: next.id, name: next.name, status: next.status } : null,
    checks, trialBalance, live, ...state,
    actions: {
      startReview: period.status === "open" && can(ACCOUNTING_PERMISSIONS.periodManage),
      backToOpen: period.status === "soft_closed" && can(ACCOUNTING_PERMISSIONS.periodManage),
      close: period.status === "soft_closed" && can(ACCOUNTING_PERMISSIONS.closeManage),
      lock: period.status === "closed" && can(ACCOUNTING_PERMISSIONS.closeManage),
      reopen: !yearClosed && ((period.status === "closed" && can(ACCOUNTING_PERMISSIONS.closeManage)) || (period.status === "locked" && can(ACCOUNTING_PERMISSIONS.closeWaive))),
      acknowledge: live && can(ACCOUNTING_PERMISSIONS.closeWaive),
    },
    history: history.map((entry) => ({
      label: { "accounting.period.review_started": "Closing review started", "accounting.period.back_to_open": "Back to open", "accounting.period.closed": "Closed",
        "accounting.period.locked": "Locked", "accounting.period.reopened": "Reopened", "accounting.period.acknowledged": "Exception acknowledged",
        "accounting.period.acknowledgement_withdrawn": "Acknowledgement withdrawn", "accounting.period.status_changed": "Status changed" }[entry.event_type] ?? entry.event_type,
      at: entry.occurred_at, actor: entry.actor, detail: entry.metadata?.reason ?? entry.metadata?.note ?? entry.metadata?.check ?? null,
    })),
  };
}

// ------------------------------------------------------------------ moves
export async function startPeriodReview(client, context, periodIdValue, { note } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.periodManage);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (period.status !== "open") fail(409, `${period.name} is ${STATUS[period.status]?.label.toLowerCase()}; only an open month goes into closing review.`, "ACCOUNTING_PERIOD_STATE");
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'soft_closed', soft_closed_at = now(), soft_closed_by = $3, review_started_at = now(), review_started_by = $3,
      close_note = COALESCE($4, close_note), updated_by = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, period.id, context.userId ?? null, text(note, 1000) || null]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.review_started", "open", "soft_closed", { note: text(note, 1000) || null });
  return getPeriodCloseWorkspace(client, context, period.id);
}

export async function returnPeriodToOpen(client, context, periodIdValue, { note } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.periodManage);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (period.status !== "soft_closed") fail(409, "Only a month in closing review goes back to open here; a closed month is reopened.", "ACCOUNTING_PERIOD_STATE");
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'open', soft_closed_at = NULL, soft_closed_by = NULL, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, period.id, context.userId ?? null]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.back_to_open", "soft_closed", "open", { note: text(note, 1000) || null });
  return getPeriodCloseWorkspace(client, context, period.id);
}

export async function closePeriod(client, context, periodIdValue, { note } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (period.status !== "soft_closed") fail(409, "Start the month's closing review first; only a month in review is closed.", "ACCOUNTING_PERIOD_STATE");
  const { checks, trialBalance } = await runChecks(client, context, period);
  const open = checks.filter((check) => check.state === "attention");
  if (open.length)
    fail(409, `${period.name} can't be closed yet: ${open.map((check) => check.detail ?? check.label).join(" ")}`, "ACCOUNTING_PERIOD_NOT_READY", { checks: open.map((check) => check.key) });
  const snapshot = { checks, trialBalance, closedAt: new Date().toISOString() };
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'closed', closed_at = now(), closed_by = $3, close_snapshot = $4::jsonb, close_note = COALESCE($5, close_note), updated_by = $3
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, period.id, context.userId ?? null, JSON.stringify(snapshot), text(note, 1000) || null]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.closed", "soft_closed", "closed",
    { note: text(note, 1000) || null, acknowledged: checks.filter((check) => check.state === "acknowledged").map((check) => check.key) });
  return getPeriodCloseWorkspace(client, context, period.id);
}

export async function lockPeriod(client, context, periodIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (period.status !== "closed") fail(409, "Only a closed month is locked.", "ACCOUNTING_PERIOD_STATE");
  const earlier = (await client.query(`SELECT string_agg(name, ', ' ORDER BY start_date) AS names FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard'
      AND end_date < $2::date AND status <> 'locked'`, [context.organizationId, day(period.start_date)])).rows[0].names;
  if (earlier) fail(409, `Lock ${earlier} first; months are locked in order.`, "ACCOUNTING_PERIOD_ORDER");
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'locked', locked_at = now(), locked_by = $3, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, period.id, context.userId ?? null]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.locked", "closed", "locked", {});
  return getPeriodCloseWorkspace(client, context, period.id);
}

// Reopens a closed (or, with the waive permission, a locked) month, with a reason; a later month that is closed must be reopened first.
export async function reopenPeriod(client, context, periodIdValue, { reason } = {}) {
  const why = requiredText(reason, "Reason", 500);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (!["closed", "locked"].includes(period.status)) fail(409, "Only a closed or locked month is reopened.", "ACCOUNTING_PERIOD_STATE");
  requirePermission(context, period.status === "locked" ? ACCOUNTING_PERMISSIONS.closeWaive : ACCOUNTING_PERMISSIONS.closeManage);
  if (period.year_status === "closed") fail(409, `${period.year_name} is closed; its months aren't reopened.`, "ACCOUNTING_YEAR_CLOSED");
  const later = (await client.query(`SELECT string_agg(name, ', ' ORDER BY start_date) AS names FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard'
      AND start_date > $2::date AND status IN ('closed', 'locked')`, [context.organizationId, day(period.start_date)])).rows[0].names;
  if (later) fail(409, `Reopen ${later} first; months are reopened latest first.`, "ACCOUNTING_PERIOD_ORDER");
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'open', reopened_at = now(), reopened_by = $3, reopen_reason = $4, soft_closed_at = NULL, soft_closed_by = NULL, updated_by = $3
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, period.id, context.userId ?? null, why]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.reopened", period.status, "open", { reason: why });
  return getPeriodCloseWorkspace(client, context, period.id);
}

const ACKNOWLEDGEABLE = new Set(["depreciation", "payroll", "subledgers", "bank", "itc_pending", "suspense"]);
// Acknowledges a warning the month is closed with, with the reason (blocking checks can't be acknowledged).
export async function acknowledgeCloseCheck(client, context, periodIdValue, { checkKey, reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeWaive);
  const why = requiredText(reason, "Reason", 500);
  if (why.length < 5) fail(400, "Say why the month can close with this open.", "ACCOUNTING_REASON_REQUIRED", { field: "reason" });
  const key = text(checkKey, 60);
  if (!ACKNOWLEDGEABLE.has(key)) fail(409, "That check must be cleared, not acknowledged.", "ACCOUNTING_CHECK_NOT_ACKNOWLEDGEABLE");
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (!["open", "soft_closed"].includes(period.status)) fail(409, "Only a month being closed takes acknowledgements.", "ACCOUNTING_PERIOD_STATE");
  const { checks } = await runChecks(client, context, period);
  const check = checks.find((entry) => entry.key === key);
  if (check.clear) fail(409, "That check is already clear.", "ACCOUNTING_CHECK_CLEAR");
  await client.query(`UPDATE tenant.accounting_period_close_acknowledgements SET withdrawn_at = now(), withdrawn_by = $4 WHERE organization_id = $1 AND fiscal_period_id = $2 AND check_key = $3
      AND withdrawn_at IS NULL`, [context.organizationId, period.id, key, context.userId ?? null]);
  await client.query(`INSERT INTO tenant.accounting_period_close_acknowledgements (organization_id, fiscal_period_id, check_key, reason, snapshot, acknowledged_by)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [context.organizationId, period.id, key, why, JSON.stringify({ count: check.count, amount: check.amount ?? null, detail: check.detail }), context.userId ?? null]);
  await event(client, context, "fiscal_period", period.id, "accounting.period.acknowledged", null, null, { check: check.label, reason: why });
  return getPeriodCloseWorkspace(client, context, period.id);
}

export async function withdrawCloseAcknowledgement(client, context, periodIdValue, { checkKey } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeWaive);
  const period = await loadPeriod(client, context, periodIdValue, { lock: true });
  if (!["open", "soft_closed"].includes(period.status)) fail(409, "A closed month keeps what it was closed with.", "ACCOUNTING_PERIOD_STATE");
  const done = await client.query(`UPDATE tenant.accounting_period_close_acknowledgements SET withdrawn_at = now(), withdrawn_by = $4 WHERE organization_id = $1 AND fiscal_period_id = $2
      AND check_key = $3 AND withdrawn_at IS NULL RETURNING id`, [context.organizationId, period.id, text(checkKey, 60), context.userId ?? null]);
  if (done.rowCount) await event(client, context, "fiscal_period", period.id, "accounting.period.acknowledgement_withdrawn", null, null, { check: text(checkKey, 60) });
  return getPeriodCloseWorkspace(client, context, period.id);
}

// ------------------------------------------------------------------ year end
// Closes a financial year whose months are all closed: the year's profit or loss moves to retained earnings (a closing entry dated the
// last day), then every month of the year is locked. The entry posts into the year-end adjustment period when the year has one;
// otherwise the last month is opened for that entry alone, inside this same step, and locked straight after.
export async function closeFinancialYear(client, context, yearIdValue, { note } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const year = (await client.query(`SELECT * FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(yearIdValue, "Financial year")])).rows[0];
  if (!year) fail(404, "Financial year not found.", "ACCOUNTING_FY_NOT_FOUND");
  if (year.status === "closed") fail(409, `${year.name} is already closed.`, "ACCOUNTING_YEAR_CLOSED");
  const periods = (await client.query(`SELECT * FROM tenant.fiscal_periods WHERE organization_id = $1 AND fiscal_year_id = $2 ORDER BY start_date, period_type DESC FOR UPDATE`,
    [context.organizationId, year.id])).rows;
  const standard = periods.filter((row) => row.period_type === "standard");
  const notClosed = standard.filter((row) => !["closed", "locked"].includes(row.status));
  if (!standard.length || notClosed.length) fail(409, `Close every month of ${year.name} first (${notClosed.map((row) => row.name).join(", ")} ${notClosed.length === 1 ? "is" : "are"} not closed).`, "ACCOUNTING_YEAR_NOT_READY");
  const earlierOpen = (await client.query(`SELECT name FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND end_date < $2 AND status <> 'closed' ORDER BY start_date LIMIT 1`,
    [context.organizationId, year.start_date])).rows[0];
  if (earlierOpen) fail(409, `Close ${earlierOpen.name} first; years are closed in order.`, "ACCOUNTING_PERIOD_ORDER");
  const ledger = await getPrimaryLedger(client, context);
  const end = day(year.end_date);
  const balances = (await client.query(
    `SELECT account.id, account.code, account.name, COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0)::text AS balance
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.account_class IN ('revenue', 'expense')
      WHERE line.organization_id = $1 AND entry.ledger_id = $2 AND entry.accounting_date BETWEEN $3 AND $4
      GROUP BY account.id HAVING sum(line.base_debit_amount - line.base_credit_amount) <> 0 ORDER BY account.code`,
    [context.organizationId, ledger.id, day(year.start_date), end])).rows;
  let journalEntryId = null;
  if (balances.length) {
    const internal = elevated(context, ACCOUNTING_PERMISSIONS.journalCreate);
    const retained = await getAccountMapping(client, internal, ledger.id, "retained_earnings", { date: end });
    const lines = balances.map((row) => {
      const balance = decimal(row.balance);
      return { accountId: row.id, description: `Close ${row.code} ${row.name}`, debit: balance < 0n ? formatDecimal(-balance) : "0", credit: balance > 0n ? formatDecimal(balance) : "0" };
    });
    const net = balances.reduce((total, row) => total + decimal(row.balance), 0n); // debit-positive: a profit is a credit balance (negative)
    lines.push({ accountId: retained.account_id, description: `${net <= 0n ? "Profit" : "Loss"} of ${year.name} to retained earnings`,
      debit: net > 0n ? formatDecimal(net) : "0", credit: net < 0n ? formatDecimal(-net) : "0" });
    const adjustment = periods.find((row) => row.period_type === "adjustment" && row.status === "open");
    const host = adjustment ?? standard.at(-1);
    const hostStatus = host.status;
    if (!adjustment) await client.query("UPDATE tenant.fiscal_periods SET status = 'open' WHERE organization_id = $1 AND id = $2", [context.organizationId, host.id]);
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type IN ('closing', 'general') AND status = 'active'
        ORDER BY journal_type = 'closing' DESC, created_at LIMIT 1`, [context.organizationId, ledger.id])).rows[0];
    const created = await createJournalEntry(client, internal, {
      ledgerId: ledger.id, journalId: journal.id, entryDate: end, accountingDate: end, documentDate: end, entryType: "closing", reference: year.code,
      description: `Year-end closing ${year.name}`, lines,
    }, { internal: true, sourceModule: "accounting", sourceType: "year_end_close", sourceId: year.id, sourceNumber: year.code });
    await postJournalEntry(client, internal, created.entry.id, { internal: true, allowDraft: true });
    if (!adjustment) await client.query("UPDATE tenant.fiscal_periods SET status = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, host.id, hostStatus]);
    journalEntryId = created.entry.id;
  }
  await client.query(`UPDATE tenant.fiscal_periods SET status = 'locked', locked_at = COALESCE(locked_at, now()), locked_by = COALESCE(locked_by, $3), closed_at = COALESCE(closed_at, now()),
      closed_by = COALESCE(closed_by, $3) WHERE organization_id = $1 AND fiscal_year_id = $2`, [context.organizationId, year.id, context.userId ?? null]);
  await client.query(`UPDATE tenant.accounting_fiscal_years SET status = 'closed', closed_at = now(), closed_by = $3, closing_journal_entry_id = $4, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, year.id, context.userId ?? null, journalEntryId]);
  await event(client, context, "fiscal_year", year.id, "accounting.fiscal_year.closed", year.status, "closed", { note: text(note, 1000) || null, journalEntryId });
  return (await getCloseOverview(client, context)).years.find((entry) => entry.id === year.id);
}

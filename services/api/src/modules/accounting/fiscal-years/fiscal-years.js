// Fiscal years and accounting periods (Finance MVP F1). A financial year (FY 2026-27, 1 Apr → 31 Mar) holds twelve monthly periods and,
// optionally, a year-end adjustment period. Period statuses: OPEN → CLOSING_REVIEW (stored 'soft_closed') → CLOSED → LOCKED. Moving
// between Open and Closing review can be done here too; closing, locking and reopening are in ../period-close (Finance unit F9).
import { ACCOUNTING_PERMISSIONS, AccountingError, event, requirePermission } from "../core.js";
import { returnPeriodToOpen, startPeriodReview } from "../period-close/period-close.js";

export const PERIOD_STATUS = Object.freeze({
  open: { key: "OPEN", label: "Open" },
  soft_closed: { key: "CLOSING_REVIEW", label: "Closing review" },
  closed: { key: "CLOSED", label: "Closed" },
  locked: { key: "LOCKED", label: "Locked" },
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// pg reads a DATE as local midnight, so take the local calendar parts (toISOString would shift it a day back east of UTC).
const pad = (n) => String(n).padStart(2, "0");
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : String(value ?? "").slice(0, 10));

function toPeriod(row) {
  return {
    id: row.id, name: row.name, number: row.period_number, type: row.period_type ?? "standard", startDate: day(row.start_date), endDate: day(row.end_date),
    status: row.status, statusKey: PERIOD_STATUS[row.status]?.key ?? row.status.toUpperCase(), statusLabel: PERIOD_STATUS[row.status]?.label ?? row.status,
    journalCount: Number(row.journal_count ?? 0), note: row.close_note ?? null,
  };
}

export async function listFiscalYears(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const years = (await client.query(
    `SELECT year.* FROM tenant.accounting_fiscal_years year WHERE year.organization_id = $1 ORDER BY year.start_date DESC`, [context.organizationId])).rows;
  const periods = (await client.query(
    `SELECT period.*, (SELECT count(*) FROM tenant.accounting_journal_entries entry WHERE entry.fiscal_period_id = period.id) AS journal_count
       FROM tenant.fiscal_periods period WHERE period.organization_id = $1 ORDER BY period.start_date, period.period_type DESC`, [context.organizationId])).rows;
  const today = new Date().toISOString().slice(0, 10);
  return years.map((year) => {
    const own = periods.filter((period) => period.fiscal_year_id === year.id).map(toPeriod);
    const counts = Object.fromEntries(Object.keys(PERIOD_STATUS).map((status) => [status, own.filter((period) => period.status === status).length]));
    return {
      id: year.id, code: year.code, name: year.name, startDate: day(year.start_date), endDate: day(year.end_date), status: year.status,
      current: day(year.start_date) <= today && today <= day(year.end_date), periods: own, counts,
    };
  });
}

// input: { startDate?: "YYYY-MM-DD" (default: the day after the latest year ends, else this year's start month), withAdjustmentPeriod? }
export async function createFiscalYear(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.periodManage);
  let start = input.startDate ? String(input.startDate) : null;
  if (start && !DATE.test(start)) throw new AccountingError(400, "Choose the first day of the financial year.", "ACCOUNTING_FY_INVALID", { field: "startDate" });
  if (!start) {
    const latest = (await client.query("SELECT max(end_date) AS end_date FROM tenant.accounting_fiscal_years WHERE organization_id = $1", [context.organizationId])).rows[0].end_date;
    if (latest) start = (await client.query("SELECT ($1::date + 1)::text AS start", [day(latest)])).rows[0].start;
    else {
      const month = (await client.query("SELECT fiscal_year_start_month FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.fiscal_year_start_month ?? 4;
      start = (await client.query(
        `SELECT make_date(CASE WHEN extract(month FROM tenant.company_today())::int >= $1 THEN extract(year FROM tenant.company_today())::int ELSE extract(year FROM tenant.company_today())::int - 1 END, $1, 1)::text AS start`,
        [month])).rows[0].start;
    }
  }
  if (!start.endsWith("-01")) throw new AccountingError(400, "A financial year starts on the first day of a month.", "ACCOUNTING_FY_INVALID", { field: "startDate" });
  // Checked first (a failed insert would end the caller's transaction): the database trigger and unique code are the backstop.
  const clash = (await client.query(
    `SELECT code FROM tenant.accounting_fiscal_years WHERE organization_id = $1
        AND daterange(start_date, end_date, '[]') && daterange($2::date, ($2::date + interval '1 year - 1 day')::date, '[]') LIMIT 1`,
    [context.organizationId, start])).rows[0];
  if (clash) throw new AccountingError(409, `This financial year overlaps ${clash.code}.`, "ACCOUNTING_FY_OVERLAP", { field: "startDate" });
  const year = (await client.query(
    `INSERT INTO tenant.accounting_fiscal_years (organization_id, code, name, start_date, end_date, created_by, updated_by)
     SELECT $1, 'FY' || to_char($2::date, 'YYYY') || '-' || to_char($2::date + interval '1 year', 'YY'), 'FY ' || to_char($2::date, 'YYYY') || '-' || to_char($2::date + interval '1 year', 'YY'),
            $2::date, ($2::date + interval '1 year - 1 day')::date, $3, $3
     RETURNING *`, [context.organizationId, start, context.userId ?? null])).rows[0];
  await client.query(
    `INSERT INTO tenant.fiscal_periods (organization_id, name, fiscal_year, fiscal_year_id, start_date, end_date, period_number, period_type, status, created_by, updated_by)
     SELECT $1, to_char(month_start, 'Mon YYYY'), to_char($3::date, 'YYYY') || '-' || to_char($4::date, 'YY'), $2, month_start::date, (month_start + interval '1 month - 1 day')::date,
            row_number() OVER (ORDER BY month_start)::int, 'standard', 'open', $5, $5
       FROM generate_series($3::timestamp, $4::timestamp, interval '1 month') AS month_start
     ON CONFLICT (organization_id, start_date, end_date) DO NOTHING`,
    [context.organizationId, year.id, day(year.start_date), day(year.end_date), context.userId ?? null]);
  // The year-end adjustment period: the last day, for audit and closing entries after month 12 is closed.
  if (input.withAdjustmentPeriod === true)
    await client.query(
      `INSERT INTO tenant.fiscal_periods (organization_id, name, fiscal_year, fiscal_year_id, start_date, end_date, period_number, period_type, status, created_by, updated_by)
       VALUES ($1, 'Year-end adjustments ' || $3, $3, $2, $4::date, $4::date, 13, 'adjustment', 'open', $5, $5)
       ON CONFLICT (organization_id, start_date, end_date) DO NOTHING`,
      [context.organizationId, year.id, year.code.replace("FY", ""), day(year.end_date), context.userId ?? null]);
  await event(client, context, "fiscal_year", year.id, "accounting.fiscal_year.created", null, "open", { code: year.code });
  return (await listFiscalYears(client, context)).find((entry) => entry.id === year.id);
}

// The financial year is always open ahead of time (Sales audit B3): every company — whether or not it has the Accounting app — posts its
// invoices, dispatches and payments to the ledger, which needs an open period for the date. Once a day the worker makes sure a year
// covers today and the next `aheadDays` days, opening the next one (its twelve monthly periods) before the current one ends; a company
// that slept through a year gets each missing year in turn. Returns the codes opened. The system acts here, not a person.
export async function ensureFiscalYearsAhead(client, organizationId, { aheadDays = 60 } = {}) {
  const system = { organizationId, userId: null, roleSlugs: ["system_worker"], permissions: [ACCOUNTING_PERMISSIONS.view, ACCOUNTING_PERMISSIONS.periodManage] };
  const opened = [];
  for (let guard = 0; guard < 5; guard += 1) {
    const state = (await client.query(
      `SELECT max(end_date)::text AS last_end, (tenant.company_today() + $2::int)::text AS horizon
         FROM tenant.accounting_fiscal_years WHERE organization_id = $1`, [organizationId, aheadDays])).rows[0];
    if (state.last_end && state.last_end >= state.horizon) break;
    // With no year at all, the one holding today (from the company's start month); else the day after the last one.
    const year = await createFiscalYear(client, system, {});
    opened.push(year.code);
  }
  return opened;
}

// Whether a company's open years run out within `aheadDays` (the job's cheap "anything to do?" check).
export async function fiscalYearsRunningOut(client, organizationId, { aheadDays = 60 } = {}) {
  return (await client.query(
    `SELECT COALESCE(max(end_date) < tenant.company_today() + $2::int, true) AS due FROM tenant.accounting_fiscal_years WHERE organization_id = $1`,
    [organizationId, aheadDays])).rows[0].due;
}

// Open ↔ Closing review. (Closing and locking go through the close run.)
export async function setPeriodReview(client, context, periodId, { review, note } = {}) {
  const workspace = review ? await startPeriodReview(client, context, periodId, { note }) : await returnPeriodToOpen(client, context, periodId, { note });
  const row = (await client.query("SELECT * FROM tenant.fiscal_periods WHERE organization_id = $1 AND id = $2", [context.organizationId, workspace.period.id])).rows[0];
  return toPeriod(row);
}

// General Ledger (Finance MVP F2): every posting account between two dates — balance brought forward, debits, credits and closing
// balance — from posted entries only (a reversed entry and its reversal both count, so they net to nothing). Filter by class, department
// or cost centre; each account opens its ledger with the running balance. Unfiltered, the debits and credits of the period must agree:
// the General Ledger is the books.
import { ACCOUNTING_PERMISSIONS, AccountingError, getPrimaryLedger, isoDate, requirePermission, uuid } from "../core.js";
import { localToday } from "../journals.js";

const CLASSES = ["asset", "liability", "equity", "revenue", "expense"];

export async function getGeneralLedgerSummary(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const ledger = await getPrimaryLedger(client, context);
  const to = filters.to ? isoDate(filters.to, "To date") : localToday();
  // From: the start of the financial year that holds the end date, unless given.
  const from = filters.from ? isoDate(filters.from, "From date") : ((await client.query(
    `SELECT start_date::text AS start FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
    [context.organizationId, to])).rows[0]?.start ?? `${to.slice(0, 4)}-01-01`);
  if (from > to) throw new AccountingError(400, "The start date is after the end date.", "ACCOUNTING_GL_RANGE", { field: "from" });
  const values = [context.organizationId, ledger.id, from, to];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const lineFilters = [];
  if (filters.departmentId) lineFilters.push(`line.department_id = ${bind(uuid(filters.departmentId, "Department"))}`);
  if (filters.costCenterId) lineFilters.push(`line.cost_center_id = ${bind(uuid(filters.costCenterId, "Cost centre"))}`);
  const accountFilters = [];
  if (filters.accountClass && CLASSES.includes(filters.accountClass)) accountFilters.push(`account.account_class = ${bind(filters.accountClass)}`);
  const lineWhere = lineFilters.length ? ` AND ${lineFilters.join(" AND ")}` : "";
  const rows = (await client.query(
    `WITH movement AS (
       SELECT line.account_id,
              COALESCE(sum(line.base_debit_amount - line.base_credit_amount) FILTER (WHERE entry.accounting_date < $3::date), 0) AS opening,
              COALESCE(sum(line.base_debit_amount) FILTER (WHERE entry.accounting_date BETWEEN $3::date AND $4::date), 0) AS debit,
              COALESCE(sum(line.base_credit_amount) FILTER (WHERE entry.accounting_date BETWEEN $3::date AND $4::date), 0) AS credit,
              count(*) FILTER (WHERE entry.accounting_date BETWEEN $3::date AND $4::date) AS lines
         FROM tenant.accounting_journal_lines line
         JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
        WHERE line.organization_id = $1 AND entry.ledger_id = $2 AND entry.accounting_date <= $4::date${lineWhere}
        GROUP BY line.account_id)
     SELECT account.id, account.code, account.name, account.account_class, account.account_type, account.normal_balance, account.status,
            COALESCE(movement.opening, 0)::text AS opening, COALESCE(movement.debit, 0)::text AS debit, COALESCE(movement.credit, 0)::text AS credit,
            (COALESCE(movement.opening, 0) + COALESCE(movement.debit, 0) - COALESCE(movement.credit, 0))::text AS closing, COALESCE(movement.lines, 0)::int AS lines
       FROM tenant.accounting_accounts account
       LEFT JOIN movement ON movement.account_id = account.id
      WHERE account.organization_id = $1 AND account.ledger_id = $2 AND NOT account.is_group${accountFilters.length ? ` AND ${accountFilters.join(" AND ")}` : ""}
      ORDER BY array_position(ARRAY['asset','liability','equity','revenue','expense']::text[], account.account_class), account.code`, values)).rows;
  // Debit-minus-credit amounts, shown with the side they sit on.
  const sided = (value) => { const amount = Number(value); return { amount: Math.abs(amount).toFixed(2), side: Math.abs(amount) < 0.005 ? null : amount > 0 ? "Dr" : "Cr" }; };
  const accounts = rows
    .filter((row) => filters.includeZero === "true" || filters.includeZero === true || Number(row.opening) !== 0 || Number(row.debit) !== 0 || Number(row.credit) !== 0)
    .map((row) => ({
      id: row.id, code: row.code, name: row.name, accountClass: row.account_class, accountType: row.account_type, normalBalance: row.normal_balance, status: row.status,
      opening: sided(row.opening), debit: Number(row.debit).toFixed(2), credit: Number(row.credit).toFixed(2), closing: sided(row.closing), lines: row.lines,
    }));
  const totals = (await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount), 0)::text AS debit, COALESCE(sum(line.base_credit_amount), 0)::text AS credit
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id
      WHERE line.organization_id = $1 AND entry.ledger_id = $2 AND entry.accounting_date BETWEEN $3::date AND $4::date${lineWhere}${accountFilters.length ? ` AND ${accountFilters.join(" AND ")}` : ""}`,
    values)).rows[0];
  const filtered = lineFilters.length > 0 || accountFilters.length > 0;
  return {
    from, to, accounts,
    totals: { debit: Number(totals.debit).toFixed(2), credit: Number(totals.credit).toFixed(2) },
    // Only the whole books must balance; a class or a department on its own need not.
    balanced: filtered ? null : totals.debit === totals.credit || Number(totals.debit).toFixed(2) === Number(totals.credit).toFixed(2),
  };
}

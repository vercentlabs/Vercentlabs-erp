// The balances every financial statement is built from (Finance MVP F8): per posting account of the primary ledger, the balance before a
// period, the period's debits and credits, and the balance at its end — from posted entries only (an entry later reversed stays, and so
// does its reversal, so the two cancel exactly). Year-end closing entries (profit moved to retained earnings) can be left out, which the
// profit and loss and the cash flow need. Amounts are summed in the database and carried as exact decimals, never floating point.
import { ACCOUNTING_PERMISSIONS, AccountingError, decimal, getPrimaryLedger, isoDate, requirePermission } from "../core.js";
import { formatDecimal } from "../../../core/decimal.js";
import { localToday } from "../journals.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
export const toMoney = (value) => Number(formatDecimal(value, 2));
const day = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
};

// A period: from/to (dates), checked; without them, the financial year so far.
export async function statementPeriod(client, context, filters = {}) {
  const to = filters.to ? isoDate(filters.to, "To date") : localToday();
  let from = filters.from ? isoDate(filters.from, "From date") : null;
  if (!from) from = (await financialYearOf(client, context, to))?.start ?? `${to.slice(0, 4)}-01-01`;
  if (from > to) fail(400, "The period starts after it ends.", "ACCOUNTING_STATEMENT_PERIOD_INVALID", "from");
  return { from, to };
}

export async function financialYearOf(client, context, date) {
  const row = (await client.query(
    `SELECT id, name, start_date, end_date, status FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1`,
    [context.organizationId, date])).rows[0];
  return row ? { id: row.id, name: row.name, start: day(row.start_date), end: day(row.end_date), status: row.status } : null;
}

// The period choices a statement screen offers: the financial years, and today.
export async function getStatementPeriods(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const years = (await client.query(
    `SELECT id, name, start_date, end_date, status FROM tenant.accounting_fiscal_years WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 20`, [context.organizationId])).rows;
  const today = localToday();
  return { today, current: await financialYearOf(client, context, today), years: years.map((row) => ({ id: row.id, name: row.name, start: day(row.start_date), end: day(row.end_date), status: row.status })) };
}

// Per account: opening (balance before `from`), debit and credit within [from, to], closing (balance at `to`); debit-positive.
// options: { excludeClosing } leaves out year-end closing entries; { from: null } makes the opening zero and the period everything up to `to`.
export async function accountBalances(client, context, { from, to }, { excludeClosing = false } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const ledger = await getPrimaryLedger(client, context);
  const rows = (await client.query(
    `SELECT account.id, account.code, account.name, account.account_class, account.account_type, account.status, parent.code AS parent_code, parent.name AS parent_name,
            COALESCE(sum(line.base_debit_amount - line.base_credit_amount) FILTER (WHERE $3::date IS NOT NULL AND entry.accounting_date < $3::date), 0)::text AS opening,
            COALESCE(sum(line.base_debit_amount) FILTER (WHERE $3::date IS NULL OR entry.accounting_date >= $3::date), 0)::text AS debit,
            COALESCE(sum(line.base_credit_amount) FILTER (WHERE $3::date IS NULL OR entry.accounting_date >= $3::date), 0)::text AS credit
       FROM tenant.accounting_accounts account
       LEFT JOIN tenant.accounting_accounts parent ON parent.id = account.parent_id
       LEFT JOIN tenant.accounting_journal_lines line ON line.organization_id = account.organization_id AND line.account_id = account.id
       LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE account.organization_id = $1 AND account.ledger_id = $2 AND NOT account.is_group
        AND (line.id IS NULL OR (entry.status IN ('posted', 'reversed') AND entry.accounting_date <= $4::date
             AND NOT ($5::boolean AND entry.entry_type = 'closing' AND entry.source_type = 'year_end_close')))
      GROUP BY account.id, parent.code, parent.name
      ORDER BY account.code`,
    [context.organizationId, ledger.id, from ?? null, to, excludeClosing])).rows;
  return rows.map((row) => {
    const opening = decimal(row.opening); const debit = decimal(row.debit); const credit = decimal(row.credit);
    return {
      id: row.id, code: row.code, name: row.name, accountClass: row.account_class, accountType: row.account_type, status: row.status,
      group: row.parent_code ? `${row.parent_code} · ${row.parent_name}` : null, opening, debit, credit, closing: opening + debit - credit,
    };
  });
}

// The accounts the company holds cash in: cash and bank accounts, and Funds in transit (money between two of its own accounts).
export async function cashAccountIds(client, context) {
  const ledger = await getPrimaryLedger(client, context);
  return new Set((await client.query(
    `SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND account_type IN ('cash', 'bank')
     UNION SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND ledger_id = $2 AND mapping_key = 'funds_in_transit' AND status = 'active'`,
    [context.organizationId, ledger.id])).rows.map((row) => row.id));
}

export async function mappedAccountIds(client, context, keys) {
  const ledger = await getPrimaryLedger(client, context);
  return new Set((await client.query(
    "SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND ledger_id = $2 AND mapping_key = ANY($3::text[]) AND status = 'active'",
    [context.organizationId, ledger.id, keys])).rows.map((row) => row.account_id));
}

export const sumOf = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0n);

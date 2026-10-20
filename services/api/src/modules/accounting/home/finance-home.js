// The Finance home (Finance MVP F10): where the money is and what needs attention, in one place.
//
//   figures      cash and bank (each account), what customers owe (and how much is overdue), what the company owes suppliers (and what is
//                due this week), expenses still owed, money in transit; and — for those who see reports — this month's revenue, expenses
//                and profit beside last month's.
//   attention    the exception dashboard: automatic postings that failed or wait (by module), sub-ledgers that don't agree with the books,
//                journals, expenses and supplier payments awaiting approval, bank lines to reconcile, months left open behind the current
//                one, input GST awaiting confirmation, suspense balances. Each says how many, how much, and where to fix it.
//   close        the month next to close and where it stands.
import { ACCOUNTING_PERMISSIONS, getPrimaryLedger, hasPermission, requirePermission } from "../core.js";
import { localToday } from "../journals.js";
import { getModuleReconciliation } from "../posting-rules/module-checks.js";
import { getProfitAndLossStatement } from "../statements/statements.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const MODULE_NAMES = { sales: "Sales", procurement: "Procurement", inventory: "Inventory", pos: "Point of sale", point_of_sale: "Point of sale", assets: "Assets",
  accounting: "Accounting", hr: "Payroll", payroll: "Payroll", projects: "Projects", manufacturing: "Manufacturing" };
const elevated = (context, ...permissions) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ...permissions])] });

export async function getFinanceHome(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const org = context.organizationId;
  const ledger = await getPrimaryLedger(client, context);
  const today = localToday();
  const now = new Date(`${today}T00:00:00`);
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastEnd = iso(new Date(now.getFullYear(), now.getMonth(), 0));
  const weekEnd = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const one = async (sql, values) => (await client.query(sql, values)).rows[0];

  // Cash and bank: every active register account with its book balance (and petty cash under it), plus Funds in transit.
  const cash = (await client.query(
    `SELECT bank.id, bank.account_name, bank.bank_name, bank.account_type, bank.masked_account_number, bank.gl_account_id,
            COALESCE((SELECT sum(line.base_debit_amount - line.base_credit_amount) FROM tenant.accounting_journal_lines line
                       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
                      WHERE line.organization_id = bank.organization_id AND line.account_id = bank.gl_account_id), 0) AS balance
       FROM tenant.accounting_bank_accounts bank WHERE bank.organization_id = $1 AND bank.status = 'active' ORDER BY (bank.account_type = 'cash'), bank.account_name`, [org])).rows;
  const transit = await one(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS balance FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      WHERE line.organization_id = $1 AND line.account_id IN (SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND ledger_id = $2
                                                              AND mapping_key = 'funds_in_transit' AND status = 'active')`, [org, ledger.id]);
  const receivables = await one(
    `SELECT COALESCE(sum(CASE WHEN invoice_type = 'credit_note' THEN -outstanding_amount ELSE outstanding_amount END), 0) AS owed,
            COALESCE(sum(outstanding_amount) FILTER (WHERE invoice_type <> 'credit_note' AND due_date < $2::date), 0) AS overdue,
            count(*) FILTER (WHERE invoice_type <> 'credit_note' AND due_date < $2::date AND outstanding_amount > 0)::int AS overdue_count
       FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND status IN ('posted', 'partially_paid', 'overdue', 'disputed')`, [org, today]);
  const payables = await one(
    `SELECT COALESCE(sum(CASE WHEN bill_type = 'credit_note' THEN -outstanding_amount ELSE outstanding_amount END), 0) AS owed,
            COALESCE(sum(outstanding_amount) FILTER (WHERE bill_type <> 'credit_note' AND due_date < $2::date), 0) AS overdue,
            COALESCE(sum(outstanding_amount) FILTER (WHERE bill_type <> 'credit_note' AND due_date BETWEEN $2::date AND $3::date), 0) AS due_week,
            count(*) FILTER (WHERE bill_type <> 'credit_note' AND due_date BETWEEN $2::date AND $3::date AND outstanding_amount > 0)::int AS due_week_count
       FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND status IN ('posted', 'partially_paid', 'overdue', 'disputed')`, [org, today, weekEnd]);
  const expensesOwed = await one(`SELECT COALESCE(sum(total_amount), 0) AS owed, count(*)::int AS n FROM tenant.accounting_expenses
      WHERE organization_id = $1 AND status = 'POSTED' AND settlement = 'PAYABLE' AND payment_journal_entry_id IS NULL`, [org]);

  // The exception dashboard.
  const attention = [];
  const add = (item) => { if (item.count > 0) attention.push(item); };
  const postings = (await client.query(
    `SELECT source_module, count(*)::int AS n, count(*) FILTER (WHERE status = 'FAILED')::int AS failed, COALESCE(sum(amount), 0) AS amount
       FROM tenant.accounting_postings WHERE organization_id = $1 AND status IN ('PENDING', 'DRAFT', 'FAILED') GROUP BY source_module ORDER BY source_module`, [org])).rows;
  const postingTotal = postings.reduce((total, row) => total + row.n, 0);
  add({ key: "postings", severity: postings.some((row) => row.failed > 0) ? "danger" : "warning", count: postingTotal, href: "/accounting/postings",
    label: `${postingTotal} document${postingTotal === 1 ? "" : "s"} not in the books`,
    detail: postings.map((row) => `${MODULE_NAMES[row.source_module] ?? row.source_module ?? "Other"}: ${row.n}${row.failed ? ` (${row.failed} failed)` : ""}`).join(" · ") });
  const modules = await getModuleReconciliation(client, elevated(context, ACCOUNTING_PERMISSIONS.view));
  const differences = modules.checks.filter((check) => !["ok", "not_applicable", "info"].includes(check.status));
  add({ key: "subledgers", severity: "danger", count: differences.length, href: "/accounting/postings?view=books",
    label: `${differences.length} sub-ledger${differences.length === 1 ? " doesn't" : "s don't"} agree with the books`, detail: differences.map((check) => check.label).join(", ") });
  const approvals = await one(
    `SELECT (SELECT count(*) FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND status = 'pending_approval')::int AS journals,
            (SELECT count(*) FROM tenant.accounting_expenses WHERE organization_id = $1 AND status = 'SUBMITTED')::int AS expenses,
            (SELECT count(*) FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND status = 'pending_approval')::int AS payments,
            (SELECT count(*) FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND status = 'approved')::int AS to_post`, [org]);
  add({ key: "journal_approvals", severity: "info", count: approvals.journals, href: "/accounting/journals", label: `${approvals.journals} journal${approvals.journals === 1 ? "" : "s"} awaiting approval` });
  add({ key: "expense_approvals", severity: "info", count: approvals.expenses, href: "/accounting/expenses", label: `${approvals.expenses} expense${approvals.expenses === 1 ? "" : "s"} awaiting approval` });
  add({ key: "payment_approvals", severity: "info", count: approvals.payments, href: "/accounting/payments", label: `${approvals.payments} supplier payment${approvals.payments === 1 ? "" : "s"} awaiting approval` });
  add({ key: "payments_to_post", severity: "warning", count: approvals.to_post, href: "/accounting/payments", label: `${approvals.to_post} approved supplier payment${approvals.to_post === 1 ? "" : "s"} to post` });
  const bank = await one(
    `SELECT count(*)::int AS n FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id
      WHERE line.organization_id = $1 AND statement.status IN ('imported', 'reconciling') AND line.match_status NOT IN ('matched', 'ignored')`, [org]);
  const exceptions = await one(`SELECT count(*)::int AS n FROM tenant.accounting_bank_statement_lines WHERE organization_id = $1 AND exception_reason IS NOT NULL AND match_status NOT IN ('matched', 'ignored')`, [org]);
  add({ key: "bank", severity: exceptions.n ? "warning" : "info", count: bank.n, href: "/accounting/reconciliation",
    label: `${bank.n} bank line${bank.n === 1 ? "" : "s"} to reconcile`, detail: exceptions.n ? `${exceptions.n} marked as exception${exceptions.n === 1 ? "" : "s"}` : null });
  const transfers = await one(`SELECT count(*)::int AS n FROM tenant.accounting_fund_transfers WHERE organization_id = $1 AND status = 'POSTED' AND transit_account_id IS NOT NULL
      AND arrival_journal_entry_id IS NULL AND arrival_date < $2::date`, [org, today]);
  add({ key: "transfers", severity: "warning", count: transfers.n, href: "/accounting/fund-transfers", label: `${transfers.n} transfer${transfers.n === 1 ? "" : "s"} past their arrival date, not received` });
  const months = await one(`SELECT count(*)::int AS n, min(name) FILTER (WHERE start_date = (SELECT min(start_date) FROM tenant.fiscal_periods p WHERE p.organization_id = $1 AND p.period_type = 'standard'
        AND p.end_date < $2::date AND p.status IN ('open', 'soft_closed'))) AS oldest
       FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard' AND end_date < $2::date AND status IN ('open', 'soft_closed')`, [org, monthStart]);
  add({ key: "close", severity: months.n > 1 ? "warning" : "info", count: months.n, href: "/accounting/close",
    label: `${months.n} past month${months.n === 1 ? "" : "s"} not closed`, detail: months.oldest ? `Oldest: ${months.oldest}` : null });
  const balances = await one(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount) FILTER (WHERE account.account_type = 'suspense'), 0) AS suspense,
            COALESCE(sum(line.base_debit_amount - line.base_credit_amount) FILTER (WHERE account.id IN (SELECT account_id FROM tenant.accounting_account_mappings
                       WHERE organization_id = $1 AND ledger_id = $2 AND mapping_key = 'input_tax_pending' AND status = 'active')), 0) AS itc
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id WHERE line.organization_id = $1`, [org, ledger.id]);
  add({ key: "itc", severity: "info", count: money(balances.itc) ? 1 : 0, amount: money(balances.itc), href: "/accounting/input-tax-credit", label: "Input GST awaiting confirmation" });
  add({ key: "suspense", severity: "warning", count: money(balances.suspense) ? 1 : 0, amount: money(balances.suspense), href: "/accounting/trial-balance", label: "Money parked in suspense and clearing accounts" });

  const next = await one(`SELECT id, name, status, end_date FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard' AND status IN ('open', 'soft_closed')
      ORDER BY start_date LIMIT 1`, [org]);

  // This month's results beside last month's (only for those who see reports).
  let results = null;
  if (hasPermission(context, ACCOUNTING_PERMISSIONS.reportsView)) {
    const pick = (pl) => ({
      revenue: pl.sections.find((section) => section.key === "revenue").total + pl.sections.find((section) => section.key === "otherIncome").total,
      expenses: pl.sections.filter((section) => ["costOfSales", "operatingExpenses", "otherExpenses"].includes(section.key)).reduce((total, section) => total + section.total, 0),
      profit: pl.netProfit,
    });
    const current = await getProfitAndLossStatement(client, context, { from: monthStart, to: today });
    const previous = await getProfitAndLossStatement(client, context, { from: lastStart, to: lastEnd });
    results = { month: { from: monthStart, to: today, ...pick(current) }, previous: { from: lastStart, to: lastEnd, ...pick(previous) } };
  }

  return {
    today,
    cash: {
      total: money(cash.reduce((total, row) => total + Number(row.balance), 0) + Number(transit.balance)), inTransit: money(transit.balance),
      accounts: cash.map((row) => ({ id: row.id, name: row.account_name, kind: row.account_type === "cash" ? "cash" : "bank", bankName: row.account_type === "cash" ? null : row.bank_name,
        accountNumber: row.masked_account_number, ledgerAccountId: row.gl_account_id, balance: money(row.balance) })),
    },
    receivables: { owed: money(receivables.owed), overdue: money(receivables.overdue), overdueCount: receivables.overdue_count },
    payables: { owed: money(payables.owed), overdue: money(payables.overdue), dueThisWeek: money(payables.due_week), dueThisWeekCount: payables.due_week_count },
    expensesOwed: { amount: money(expensesOwed.owed), count: expensesOwed.n },
    results, attention,
    nextToClose: next ? { id: next.id, name: next.name, status: next.status } : null,
  };
}

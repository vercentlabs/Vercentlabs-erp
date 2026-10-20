// Reading the Chart of Accounts (Finance MVP F1): the tree with each account's posted balance and what uses it, one account's details,
// and the opening cutover check (each control account against its sub-ledger).
import { ACCOUNTING_PERMISSIONS, AccountingError, requirePermission, uuid } from "../core.js";
import { ACCOUNT_CLASSES, ACCOUNT_TYPE_LABELS, CONTROL_KINDS, NO_MANUAL_CONTROL_KINDS } from "./chart-rules.js";

const money = (value) => Number(value ?? 0);

function toAccount(row) {
  return {
    id: row.id, ledgerId: row.ledger_id, parentId: row.parent_id ?? null, code: row.code, name: row.name, accountClass: row.account_class,
    accountType: row.account_type, accountTypeLabel: ACCOUNT_TYPE_LABELS[row.account_type] ?? row.account_type, normalBalance: row.normal_balance,
    isGroup: row.is_group, allowManualPosting: row.allow_manual_posting, reconciliationRequired: row.reconciliation_required,
    controlKind: row.control_kind ?? null, controlLabel: row.control_kind ? CONTROL_KINDS[row.control_kind] : null,
    manualPostingLocked: NO_MANUAL_CONTROL_KINDS.includes(row.control_kind), currencyCode: row.currency_code?.trim() ?? null,
    cashFlowCategory: row.cash_flow_category ?? null, status: row.status, updatedAt: row.updated_at,
    // Balance in the account's normal direction (a debit-normal account shows debits minus credits).
    debit: money(row.debit), credit: money(row.credit),
    balance: row.normal_balance === "credit" ? money(row.credit) - money(row.debit) : money(row.debit) - money(row.credit),
    postingCount: Number(row.posting_count ?? 0), mappings: row.mappings ?? [],
  };
}

const ACCOUNT_SELECT = `
  SELECT account.*,
         COALESCE(totals.debit, 0) AS debit, COALESCE(totals.credit, 0) AS credit, COALESCE(totals.posting_count, 0) AS posting_count,
         COALESCE((SELECT array_agg(DISTINCT mapping.mapping_key ORDER BY mapping.mapping_key) FROM tenant.accounting_account_mappings mapping
                    WHERE mapping.organization_id = account.organization_id AND mapping.account_id = account.id AND mapping.status = 'active'), ARRAY[]::text[]) AS mappings
    FROM tenant.accounting_accounts account
    LEFT JOIN LATERAL (
      SELECT sum(line.base_debit_amount) AS debit, sum(line.base_credit_amount) AS credit, count(*) AS posting_count
        FROM tenant.accounting_journal_lines line
        JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       WHERE line.organization_id = account.organization_id AND line.account_id = account.id) totals ON true`;

// The whole chart, ordered as a tree (each account after its parent), with group totals rolled up from their accounts.
export async function listChartOfAccounts(client, context, { includeInactive = true } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const { rows } = await client.query(
    `${ACCOUNT_SELECT}
      WHERE account.organization_id = $1 AND account.ledger_id = (SELECT default_ledger_id FROM tenant.accounting_settings WHERE organization_id = $1)
        AND ($2 OR account.status = 'active')
      ORDER BY account.code`,
    [context.organizationId, includeInactive],
  );
  const accounts = rows.map(toAccount);
  const byId = new Map(accounts.map((account) => [account.id, { ...account, children: [] }]));
  const roots = [];
  for (const account of byId.values()) {
    const parent = account.parentId ? byId.get(account.parentId) : null;
    if (parent) parent.children.push(account);
    else roots.push(account);
  }
  // Groups show the sum of what sits under them.
  const rollUp = (node) => {
    for (const child of node.children) rollUp(child);
    if (node.isGroup) {
      node.debit = node.children.reduce((sum, child) => sum + child.debit, node.debit);
      node.credit = node.children.reduce((sum, child) => sum + child.credit, node.credit);
      node.balance = node.normalBalance === "credit" ? node.credit - node.debit : node.debit - node.credit;
    }
  };
  const flat = [];
  const walk = (node, depth) => {
    flat.push({ ...node, depth, childCount: node.children.length, children: undefined });
    for (const child of node.children.sort((a, b) => a.code.localeCompare(b.code))) walk(child, depth + 1);
  };
  const classOrder = new Map(ACCOUNT_CLASSES.map((entry, index) => [entry.code, index]));
  for (const root of roots.sort((a, b) => (classOrder.get(a.accountClass) ?? 9) - (classOrder.get(b.accountClass) ?? 9) || a.code.localeCompare(b.code))) {
    rollUp(root);
    walk(root, 0);
  }
  return { accounts: flat, classes: ACCOUNT_CLASSES };
}

export async function getChartAccount(client, context, accountIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const { rows } = await client.query(`${ACCOUNT_SELECT} WHERE account.organization_id = $1 AND account.id = $2`, [context.organizationId, uuid(accountIdValue, "Account")]);
  if (!rows[0]) throw new AccountingError(404, "Account not found.", "ACCOUNTING_ACCOUNT_NOT_FOUND");
  const account = toAccount(rows[0]);
  const children = (await client.query("SELECT count(*)::int AS count FROM tenant.accounting_accounts WHERE organization_id = $1 AND parent_id = $2", [context.organizationId, account.id])).rows[0].count;
  return { ...account, childCount: children };
}

// Opening cutover check: each control account's balance against the sub-ledger it summarises, so opening customer, supplier and stock
// balances are neither missing nor counted twice (once as an opening journal, once as opening invoices, bills or stock).
export async function getControlAccountReconciliation(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const glFor = async (kind) => money((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS balance
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.control_kind = $2
      WHERE line.organization_id = $1`, [context.organizationId, kind])).rows[0].balance);
  // Open documents' outstanding amounts in the company's currency (document amount × its exchange rate).
  const OPEN = "('posted', 'partially_paid', 'overdue', 'disputed')";
  const receivable = money((await client.query(
    `SELECT COALESCE(round(sum(invoice.outstanding_amount * COALESCE(invoice.exchange_rate, 1)), 2), 0) AS amount FROM tenant.accounting_customer_invoices invoice
      WHERE invoice.organization_id = $1 AND invoice.status IN ${OPEN}`, [context.organizationId])).rows[0].amount);
  const payable = money((await client.query(
    `SELECT COALESCE(round(sum(bill.outstanding_amount * COALESCE(bill.exchange_rate, 1)), 2), 0) AS amount FROM tenant.accounting_vendor_bills bill
      WHERE bill.organization_id = $1 AND bill.status IN ${OPEN}`, [context.organizationId])).rows[0].amount);
  const rows = [
    { kind: "receivable", label: "Customer receivables", ledger: await glFor("receivable"), subledger: receivable, subledgerLabel: "open customer invoices" },
    { kind: "payable", label: "Supplier payables", ledger: -(await glFor("payable")), subledger: payable, subledgerLabel: "open supplier bills" },
  ];
  return rows.map((row) => ({ ...row, difference: Math.round((row.ledger - row.subledger) * 100) / 100, agrees: Math.abs(row.ledger - row.subledger) < 0.005 }));
}

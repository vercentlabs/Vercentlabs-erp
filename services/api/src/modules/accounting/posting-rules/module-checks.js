// Module-to-GL checks (Finance MVP F3): does each sub-ledger agree with the accounts that summarise it?
//
//   Customers         open customer invoices            vs the receivable control accounts
//   Suppliers         open supplier bills               vs the payable control accounts
//   Stock             valued stock on hand              vs the inventory accounts (work in progress excluded)   — perpetual inventory only
//   Goods received    goods received, not yet billed    vs goods received not invoiced (GRNI)                   — perpetual inventory only
//   Fixed assets      capitalisations and depreciation that should have posted but have no entry
//   Payroll           what is still owed: net pay and statutory dues (information)
//
// A difference is shown with its amount and the documents behind it, never "fixed" by a plug: the cause is a missing or wrong posting,
// found here and corrected at its source.
import { ACCOUNTING_PERMISSIONS, requirePermission } from "../core.js";
import { getControlAccountReconciliation } from "../chart/chart-read.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const agreeing = (a, b) => Math.abs(money(a) - money(b)) < 0.005;

// Posted balance (debit minus credit) of a set of accounts.
async function glBalance(client, organizationId, accountIds) {
  if (!accountIds.length) return 0;
  return money((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS balance
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      WHERE line.organization_id = $1 AND line.account_id = ANY($2::uuid[])`, [organizationId, accountIds])).rows[0].balance);
}

async function mappedAccounts(client, organizationId, key) {
  return (await client.query("SELECT DISTINCT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND mapping_key = $2 AND status = 'active'",
    [organizationId, key])).rows.map((row) => row.account_id);
}

async function perpetualInventory(client, organizationId) {
  return Boolean((await client.query("SELECT post_receipt_accrual FROM tenant.procurement_settings WHERE organization_id = $1", [organizationId])).rows[0]?.post_receipt_accrual);
}

async function stockCheck(client, organizationId, perpetual) {
  const base = { key: "stock", area: "Stock", label: "Stock on hand vs inventory accounts", subledgerLabel: "valued stock on hand", ledgerLabel: "inventory accounts", href: "/inventory" };
  if (!perpetual) return { ...base, status: "not_applicable", note: "Perpetual inventory is off (Procurement settings): purchases are expensed, so the accounts don't carry the stock's value." };
  const wip = await mappedAccounts(client, organizationId, "wip");
  const inventoryAccounts = (await client.query(
    "SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND control_kind = 'inventory' AND NOT is_group AND NOT (id = ANY($2::uuid[]))",
    [organizationId, wip])).rows.map((row) => row.id);
  const ledger = await glBalance(client, organizationId, inventoryAccounts);
  const subledger = money((await client.query("SELECT COALESCE(sum(inventory_value), 0) AS value FROM tenant.inventory_valuation_balances WHERE organization_id = $1",
    [organizationId])).rows[0].value);
  const items = (await client.query(
    `SELECT warehouse.name AS warehouse, COALESCE(sum(balance.inventory_value), 0) AS value
       FROM tenant.inventory_valuation_balances balance LEFT JOIN tenant.warehouses warehouse ON warehouse.id = balance.warehouse_id
      WHERE balance.organization_id = $1 GROUP BY warehouse.name ORDER BY 2 DESC LIMIT 8`, [organizationId])).rows
    .map((row) => ({ label: row.warehouse ?? "No warehouse", amount: money(row.value) }));
  return { ...base, ledger, subledger, difference: money(ledger - subledger), status: agreeing(ledger, subledger) ? "ok" : "difference", items,
    note: agreeing(ledger, subledger) ? null : "A stock movement was valued without an accounting entry (or the other way round). Look for failed postings in Inventory, Procurement and Manufacturing." };
}

// Goods received not invoiced: what each accrued receipt line booked, for the part not yet billed or returned (at the agreed price).
async function grniCheck(client, organizationId, perpetual) {
  const base = { key: "grni", area: "Goods received", label: "Goods received, not yet billed vs GRNI", subledgerLabel: "receipts not yet billed (agreed price)", ledgerLabel: "GRNI account",
    href: "/procurement/goods-receipts" };
  if (!perpetual) return { ...base, status: "not_applicable", note: "Perpetual inventory is off: receipts don't book goods received not invoiced." };
  const grniAccounts = [...new Set([...(await mappedAccounts(client, organizationId, "grni")),
    ...(await client.query("SELECT DISTINCT clearing_account_id AS id FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND clearing_account_id IS NOT NULL", [organizationId])
      .then((result) => result.rows.map((row) => row.id)))])];
  const ledger = money(-(await glBalance(client, organizationId, grniAccounts)));
  const rows = (await client.query(
    `SELECT receipt.id, receipt.receipt_number, round(sum(accrued.amount * GREATEST(billing.billable_quantity - billing.allocated_quantity, 0)
              / NULLIF(receipt_line.accepted_quantity + receipt_line.held_quantity, 0)), 2) AS open_value
       FROM tenant.goods_receipts receipt
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.goods_receipt_id = receipt.id
       JOIN tenant.goods_receipt_line_billing billing ON billing.goods_receipt_line_id = receipt_line.id
       JOIN LATERAL (SELECT COALESCE(sum(line.base_debit_amount), 0) AS amount FROM tenant.accounting_journal_lines line
                      WHERE line.journal_entry_id = receipt.accrual_journal_entry_id AND line.reference_type = 'goods_receipt_line' AND line.reference_id = receipt_line.id) accrued ON true
      WHERE receipt.organization_id = $1 AND receipt.accrual_journal_entry_id IS NOT NULL AND receipt.accrual_reversal_journal_entry_id IS NULL
      GROUP BY receipt.id, receipt.receipt_number HAVING round(sum(accrued.amount * GREATEST(billing.billable_quantity - billing.allocated_quantity, 0)
              / NULLIF(receipt_line.accepted_quantity + receipt_line.held_quantity, 0)), 2) <> 0
      ORDER BY 3 DESC`, [organizationId])).rows;
  const subledger = money(rows.reduce((total, row) => total + Number(row.open_value), 0));
  return {
    ...base, ledger, subledger, difference: money(ledger - subledger), status: agreeing(ledger, subledger) ? "ok" : "difference",
    items: rows.slice(0, 8).map((row) => ({ label: row.receipt_number, amount: money(row.open_value), href: `/procurement/goods-receipts/${row.id}` })),
    note: agreeing(ledger, subledger) ? null
      : "A receipt, bill or return touched GRNI differently from the receipt it belongs to — for example a bill for received goods booked to an expense instead of GRNI.",
  };
}

async function assetCheck(client, organizationId) {
  const missing = (await client.query(
    `SELECT 'capitalisation' AS kind, cap.capitalization_number::text AS number, cap.proposed_amount::numeric AS amount, '/assets/capitalization/' || cap.id AS href
       FROM tenant.asset_capitalizations cap
      WHERE cap.organization_id = $1 AND cap.status = 'POSTED' AND cap.treatment IN ('CAPITALIZE', 'CWIP') AND cap.journal_entry_id IS NULL
        AND COALESCE(cap.accounting_outcome, '') <> 'NOT_REQUIRED'
     UNION ALL
     SELECT 'depreciation', to_char(run.period_start, 'Mon YYYY'), run.posted_total::numeric, '/assets/depreciation'
       FROM tenant.asset_depreciation_period_runs run
      WHERE run.organization_id = $1 AND run.status = 'POSTED' AND run.journal_entry_id IS NULL AND COALESCE(run.posted_total, 0) <> 0`, [organizationId])).rows;
  return {
    key: "assets", area: "Fixed assets", label: "Asset events with an accounting entry", href: "/assets", status: missing.length ? "attention" : "ok",
    items: missing.slice(0, 8).map((row) => ({ label: `${row.kind === "capitalisation" ? "Capitalisation" : "Depreciation"} ${row.number}`, amount: money(row.amount), href: row.href })),
    count: missing.length,
    note: missing.length ? `${missing.length} asset event(s) were recorded without an accounting entry, usually because the asset category had no accounts. Set the category's accounts, then post the entry from the asset.` : null,
  };
}

async function payrollDues(client, organizationId) {
  const keys = [["salary_payable", "Net pay owed"], ["tds_payable", "TDS on salaries"], ["epf_payable", "EPF"], ["esi_payable", "ESI"], ["pt_payable", "Professional tax"]];
  const items = [];
  for (const [key, label] of keys) {
    const owed = money(-(await glBalance(client, organizationId, await mappedAccounts(client, organizationId, key))));
    if (owed !== 0) items.push({ label, amount: owed });
  }
  return { key: "payroll", area: "Payroll", label: "Payroll dues still owed", status: "info", items, ledger: money(items.reduce((total, item) => total + item.amount, 0)),
    note: items.length ? null : "Nothing owed to employees or the authorities." };
}

export async function getModuleReconciliation(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const organizationId = context.organizationId;
  const perpetual = await perpetualInventory(client, organizationId);
  const control = await getControlAccountReconciliation(client, context);
  const parties = control.map((row) => ({
    key: row.kind, area: row.kind === "receivable" ? "Customers" : "Suppliers", label: `${row.label} vs open documents`, ledger: row.ledger, subledger: row.subledger, difference: row.difference,
    ledgerLabel: row.kind === "receivable" ? "receivable accounts" : "payable accounts", subledgerLabel: row.subledgerLabel, status: row.agrees ? "ok" : "difference",
    href: row.kind === "receivable" ? "/sales/invoices" : "/procurement/supplier-bills",
    note: row.agrees ? null : "An invoice, bill, receipt or payment posted without its entry, or an entry was made to the control account by hand. Check Automatic postings for failures.",
  }));
  const checks = [...parties, await stockCheck(client, organizationId, perpetual), await grniCheck(client, organizationId, perpetual), await assetCheck(client, organizationId),
    await payrollDues(client, organizationId)];
  return { checks, agree: checks.every((check) => ["ok", "not_applicable", "info"].includes(check.status)), perpetualInventory: perpetual };
}

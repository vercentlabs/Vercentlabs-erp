// Expense categories (Finance MVP F7): the company's one standard classification of what it spends on — the same categories Procurement's
// direct supplier bills use. Each category posts to one expense
// account, carries the GST rate usually charged (left empty when it varies) and says whether a receipt is needed — and up to what amount
// none is (a ₹40 auto fare). An expense always has a category, so the books classify spending the same way whoever records it.
// A category with expenses is never deleted, only switched off; changing its account affects expenses recorded afterwards.
import { ACCOUNTING_PERMISSIONS, AccountingError, event, getPrimaryLedger, requirePermission, requiredText, text, uuid } from "../core.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

const CATEGORY_SELECT = `SELECT category.*, account.code AS account_code, account.name AS account_name, account.status AS account_status,
         (SELECT count(*) FROM tenant.accounting_expenses expense WHERE expense.organization_id = category.organization_id AND expense.category_id = category.id)::int AS expenses,
         (SELECT COALESCE(sum(expense.amount), 0) FROM tenant.accounting_expenses expense WHERE expense.organization_id = category.organization_id AND expense.category_id = category.id
             AND expense.status = 'POSTED' AND expense.expense_date >= date_trunc('month', current_date)) AS spent_this_month
    FROM tenant.expense_categories category
    JOIN tenant.accounting_accounts account ON account.id = category.account_id`;

export const categoryView = (row) => ({
  id: row.id, code: row.code, name: row.name, description: row.description ?? null,
  account: { id: row.account_id, label: `${row.account_code} · ${row.account_name}`, active: row.account_status === "active" },
  defaultGstRate: row.default_gst_rate === null || row.default_gst_rate === undefined ? null : Number(row.default_gst_rate),
  receiptRequired: row.receipt_required, receiptThreshold: money(row.receipt_threshold), status: row.status, sortOrder: row.sort_order,
  expenses: Number(row.expenses ?? 0), spentThisMonth: money(row.spent_this_month),
});

export async function listAccountingExpenseCategories(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const all = filters.includeInactive === true || filters.includeInactive === "true";
  const rows = (await client.query(`${CATEGORY_SELECT} WHERE category.organization_id = $1 AND ($2::boolean OR category.status = 'active') ORDER BY category.sort_order, category.name`,
    [context.organizationId, all])).rows;
  return rows.map(categoryView);
}

export async function loadExpenseCategory(client, context, idValue, { forUse = false } = {}) {
  if (!idValue) fail(400, "Choose the expense's category.", "ACCOUNTING_EXPENSE_CATEGORY_NOT_FOUND", "categoryId");
  const row = (await client.query(`${CATEGORY_SELECT} WHERE category.organization_id = $1 AND category.id = $2`, [context.organizationId, uuid(idValue, "Category")])).rows[0];
  if (!row) fail(404, "Choose an expense category.", "ACCOUNTING_EXPENSE_CATEGORY_NOT_FOUND", "categoryId");
  if (forUse && row.status !== "active") fail(409, `The category ${row.name} is switched off; choose another.`, "ACCOUNTING_EXPENSE_CATEGORY_INACTIVE", "categoryId");
  if (forUse && row.account_status !== "active") fail(409, `${row.name}'s account ${row.account_code} is disabled; ask Finance to correct the category.`, "ACCOUNTING_EXPENSE_CATEGORY_ACCOUNT", "categoryId");
  return row;
}

async function expenseAccount(client, context, accountIdValue) {
  const ledger = await getPrimaryLedger(client, context);
  const account = (await client.query(
    "SELECT id, code, name, account_class, status, is_group, control_kind FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND id = $3",
    [context.organizationId, ledger.id, uuid(accountIdValue, "Account")])).rows[0];
  if (!account || account.status !== "active" || account.is_group || account.control_kind || account.account_class !== "expense")
    fail(400, "A category posts to an active expense account (not a group heading).", "ACCOUNTING_EXPENSE_CATEGORY_ACCOUNT", "accountId");
  return account;
}

function rules(input, current = {}) {
  const rate = input.defaultGstRate === undefined ? current.default_gst_rate ?? null : input.defaultGstRate === null || input.defaultGstRate === "" ? null : Number(input.defaultGstRate);
  if (rate !== null && !(rate >= 0 && rate <= 100)) fail(400, "The GST rate is between 0 and 100.", "ACCOUNTING_EXPENSE_CATEGORY_INVALID", "defaultGstRate");
  const threshold = input.receiptThreshold === undefined ? Number(current.receipt_threshold ?? 0) : Number(input.receiptThreshold || 0);
  if (!(threshold >= 0)) fail(400, "The amount without a receipt can't be negative.", "ACCOUNTING_EXPENSE_CATEGORY_INVALID", "receiptThreshold");
  return { rate, threshold, receipt: input.receiptRequired === undefined ? current.receipt_required ?? true : input.receiptRequired !== false };
}

// input: { name, code?, description?, accountId, defaultGstRate?, receiptRequired?, receiptThreshold?, sortOrder? }
export async function createAccountingExpenseCategory(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const name = requiredText(input.name, "Name", 120);
  const code = (text(input.code, 30) || name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "CATEGORY";
  if (code.length < 2) fail(400, "Give the category a code of at least two letters.", "ACCOUNTING_EXPENSE_CATEGORY_INVALID", "code");
  const account = await expenseAccount(client, context, input.accountId);
  const { rate, threshold, receipt } = rules(input);
  const clash = (await client.query("SELECT name, code FROM tenant.expense_categories WHERE organization_id = $1 AND (code = $2 OR lower(btrim(name)) = lower(btrim($3)))",
    [context.organizationId, code, name])).rows[0];
  if (clash) fail(409, `A category ${clash.name} (${clash.code}) already exists.`, "ACCOUNTING_EXPENSE_CATEGORY_DUPLICATE", "name");
  const row = (await client.query(
    `INSERT INTO tenant.expense_categories (organization_id, code, name, description, account_id, default_gst_rate, receipt_required, receipt_threshold, sort_order,
       created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
    [context.organizationId, code, name, text(input.description, 300) || null, account.id, rate, receipt, threshold, Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 150,
      context.userId ?? null])).rows[0];
  await event(client, context, "expense_category", row.id, "accounting.expense_category.created", null, "active", { name, account: account.code });
  return categoryView((await client.query(`${CATEGORY_SELECT} WHERE category.organization_id = $1 AND category.id = $2`, [context.organizationId, row.id])).rows[0]);
}

// input: any of { name, description, accountId, defaultGstRate, receiptRequired, receiptThreshold, sortOrder, status }
export async function updateAccountingExpenseCategory(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const current = await loadExpenseCategory(client, context, idValue);
  const name = input.name === undefined ? current.name : requiredText(input.name, "Name", 120);
  if (name.toLowerCase() !== current.name.toLowerCase()) {
    const clash = (await client.query("SELECT 1 FROM tenant.expense_categories WHERE organization_id = $1 AND id <> $2 AND lower(btrim(name)) = lower(btrim($3))",
      [context.organizationId, current.id, name])).rows[0];
    if (clash) fail(409, `A category named ${name} already exists.`, "ACCOUNTING_EXPENSE_CATEGORY_DUPLICATE", "name");
  }
  const account = input.accountId && input.accountId !== current.account_id ? await expenseAccount(client, context, input.accountId) : null;
  const { rate, threshold, receipt } = rules(input, current);
  const status = ["active", "inactive"].includes(input.status) ? input.status : current.status;
  await client.query(
    `UPDATE tenant.expense_categories SET name = $3, description = $4, account_id = $5, default_gst_rate = $6, receipt_required = $7, receipt_threshold = $8,
            sort_order = $9, status = $10, updated_by = $11, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, name, input.description === undefined ? current.description : text(input.description, 300) || null, account?.id ?? current.account_id,
      rate, receipt, threshold, Number.isInteger(Number(input.sortOrder)) && input.sortOrder !== undefined ? Number(input.sortOrder) : current.sort_order, status, context.userId ?? null]);
  await event(client, context, "expense_category", current.id, "accounting.expense_category.updated", current.status, status,
    { ...(account ? { account: { from: current.account_code, to: account.code } } : {}), name });
  return categoryView((await client.query(`${CATEGORY_SELECT} WHERE category.organization_id = $1 AND category.id = $2`, [context.organizationId, current.id])).rows[0]);
}

// The expense accounts a category may post to (the categories screen's choices).
export async function getAccountingExpenseCategoryOptions(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const ledger = await getPrimaryLedger(client, context);
  const accounts = (await client.query(
    `SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' AND NOT is_group AND control_kind IS NULL
        AND account_class = 'expense' ORDER BY code`, [context.organizationId, ledger.id])).rows;
  return { accounts: accounts.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` })) };
}

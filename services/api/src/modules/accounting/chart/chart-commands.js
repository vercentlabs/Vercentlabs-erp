// Changing the Chart of Accounts (Finance MVP F1): add, edit, move, deactivate, reactivate and delete accounts. The database trigger
// (migration 0196) is the backstop for history protection and the hierarchy; these commands give the clear message first.
import { ACCOUNTING_PERMISSIONS, AccountingError, event, getPrimaryLedger, requirePermission, uuid } from "../core.js";
import { ACCOUNT_CODE, ACCOUNT_TYPES_BY_CLASS, NO_MANUAL_CONTROL_KINDS, controlKindForType, normalBalanceOf } from "./chart-rules.js";
import { getChartAccount } from "./chart-read.js";

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
const invalid = (field, message) => new AccountingError(400, message, "ACCOUNTING_ACCOUNT_INVALID", { field });
const CASH_FLOW = ["operating", "investing", "financing", "cash", "non_cash"];

function requireChart(context) {
  // Changing the chart is its own permission; the older settings permission still covers it for existing roles.
  if (context.permissions?.includes(ACCOUNTING_PERMISSIONS.chartManage ?? "accounting.chart.manage") || context.roleSlugs?.includes("organization_owner")) return;
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
}

async function postingCount(client, organizationId, accountId) {
  return Number((await client.query("SELECT count(*)::int AS count FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND account_id = $2", [organizationId, accountId])).rows[0].count);
}

async function loadParent(client, context, ledgerId, parentId, accountClass) {
  if (!parentId) return null;
  const parent = (await client.query("SELECT id, code, name, is_group, account_class, ledger_id, status FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2",
    [context.organizationId, uuid(parentId, "Parent account")])).rows[0];
  if (!parent) throw invalid("parentId", "Choose a parent group from the chart.");
  if (!parent.is_group) throw invalid("parentId", `${parent.code} · ${parent.name} is not a group heading; accounts sit under groups.`);
  if (parent.account_class !== accountClass) throw invalid("parentId", `${parent.code} · ${parent.name} is a different kind of account; choose a group of the same class.`);
  if (parent.ledger_id !== ledgerId) throw invalid("parentId", "The parent belongs to another ledger.");
  return parent;
}

async function assertCodeFree(client, context, ledgerId, code, exceptId = null) {
  const taken = (await client.query("SELECT code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND code = $3 AND ($4::uuid IS NULL OR id <> $4)",
    [context.organizationId, ledgerId, code, exceptId])).rows[0];
  if (taken) throw new AccountingError(409, `Code ${code} is already used by ${taken.name}.`, "ACCOUNTING_ACCOUNT_CODE_TAKEN", { field: "code" });
}

// input: { code, name, accountClass, accountType | isGroup, parentId?, allowManualPosting?, reconciliationRequired?, cashFlowCategory?, currencyCode? }
export async function createChartAccount(client, context, input = {}) {
  requireChart(context);
  const ledger = await getPrimaryLedger(client, context);
  const code = text(input.code, 20).toUpperCase();
  const name = text(input.name, 200);
  if (!ACCOUNT_CODE.test(code)) throw invalid("code", "Use up to 20 digits or capital letters for the code, such as 6640.");
  if (!name) throw invalid("name", "Enter the account name.");
  const accountClass = String(input.accountClass ?? "");
  if (!ACCOUNT_TYPES_BY_CLASS[accountClass]) throw invalid("accountClass", "Choose Assets, Liabilities, Equity, Revenue or Expenses.");
  const isGroup = input.isGroup === true;
  const accountType = isGroup ? "group" : String(input.accountType ?? "");
  if (!isGroup && !ACCOUNT_TYPES_BY_CLASS[accountClass].includes(accountType)) throw invalid("accountType", "Choose a type that belongs to this class.");
  await loadParent(client, context, ledger.id, input.parentId, accountClass);
  await assertCodeFree(client, context, ledger.id, code);
  const controlKind = isGroup ? null : controlKindForType(accountType);
  const allowManual = NO_MANUAL_CONTROL_KINDS.includes(controlKind) ? false : input.allowManualPosting !== false;
  const cashFlow = input.cashFlowCategory ? String(input.cashFlowCategory) : null;
  if (cashFlow && !CASH_FLOW.includes(cashFlow)) throw invalid("cashFlowCategory", "Choose operating, investing, financing, cash or non-cash.");
  const row = (await client.query(
    `INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
       allow_manual_posting, reconciliation_required, control_kind, currency_code, cash_flow_category, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$15) RETURNING id`,
    [context.organizationId, ledger.id, input.parentId || null, code, name, accountClass, accountType, normalBalanceOf(accountClass, accountType), isGroup,
      isGroup ? false : allowManual, Boolean(input.reconciliationRequired) || ["bank", "cash"].includes(controlKind ?? ""), controlKind,
      input.currencyCode ? text(input.currencyCode, 3).toUpperCase() : null, cashFlow, context.userId ?? null])).rows[0];
  await event(client, context, "accounting_account", row.id, "accounting.account.created", null, "active", { code, name, accountClass, accountType });
  return getChartAccount(client, context, row.id);
}

// input: any of { code, name, parentId, accountType, allowManualPosting, reconciliationRequired, cashFlowCategory, expectedUpdatedAt }.
// Once an account has postings its class, normal balance and group setting are fixed (the database enforces it too).
export async function updateChartAccount(client, context, accountIdValue, input = {}) {
  requireChart(context);
  const id = uuid(accountIdValue, "Account");
  const row = (await client.query("SELECT * FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, id])).rows[0];
  if (!row) throw new AccountingError(404, "Account not found.", "ACCOUNTING_ACCOUNT_NOT_FOUND");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new AccountingError(409, "Someone else changed this account. Reload it and make your change again.", "ACCOUNTING_ACCOUNT_STALE");
  const next = { code: row.code, name: row.name, parentId: row.parent_id, accountType: row.account_type, allowManual: row.allow_manual_posting,
    reconcile: row.reconciliation_required, cashFlow: row.cash_flow_category };
  if (has(input, "code")) {
    next.code = text(input.code, 20).toUpperCase();
    if (!ACCOUNT_CODE.test(next.code)) throw invalid("code", "Use up to 20 digits or capital letters for the code.");
    if (next.code !== row.code) await assertCodeFree(client, context, row.ledger_id, next.code, row.id);
  }
  if (has(input, "name")) {
    next.name = text(input.name, 200);
    if (!next.name) throw invalid("name", "Enter the account name.");
  }
  if (has(input, "parentId")) {
    next.parentId = input.parentId || null;
    if (next.parentId === row.id) throw invalid("parentId", "An account cannot sit under itself.");
    await loadParent(client, context, row.ledger_id, next.parentId, row.account_class);
  }
  if (has(input, "accountType") && !row.is_group && input.accountType !== row.account_type) {
    if (!ACCOUNT_TYPES_BY_CLASS[row.account_class].includes(input.accountType)) throw invalid("accountType", "Choose a type that belongs to this class.");
    if (await postingCount(client, context.organizationId, row.id))
      throw new AccountingError(409, "This account has postings, so its type can no longer change. Create a new account instead.", "ACCOUNTING_ACCOUNT_HAS_POSTINGS");
    next.accountType = input.accountType;
  }
  const controlKind = row.is_group ? null : controlKindForType(next.accountType) ?? (row.control_kind === "payroll" ? "payroll" : null);
  if (has(input, "allowManualPosting")) {
    if (input.allowManualPosting === true && NO_MANUAL_CONTROL_KINDS.includes(controlKind))
      throw invalid("allowManualPosting", "This is a control account: it is posted only from its own documents, never by a manual journal.");
    next.allowManual = input.allowManualPosting === true && !row.is_group;
  }
  if (NO_MANUAL_CONTROL_KINDS.includes(controlKind)) next.allowManual = false;
  if (has(input, "reconciliationRequired")) next.reconcile = input.reconciliationRequired === true;
  if (has(input, "cashFlowCategory")) {
    next.cashFlow = input.cashFlowCategory || null;
    if (next.cashFlow && !CASH_FLOW.includes(next.cashFlow)) throw invalid("cashFlowCategory", "Choose operating, investing, financing, cash or non-cash.");
  }
  await client.query(
    `UPDATE tenant.accounting_accounts SET code = $3, name = $4, parent_id = $5, account_type = $6, normal_balance = $7, allow_manual_posting = $8,
            reconciliation_required = $9, cash_flow_category = $10, control_kind = $11, updated_by = $12, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, next.code, next.name, next.parentId, next.accountType, row.is_group ? row.normal_balance : normalBalanceOf(row.account_class, next.accountType),
      next.allowManual, next.reconcile, next.cashFlow, controlKind, context.userId ?? null]);
  await event(client, context, "accounting_account", row.id, "accounting.account.updated", row.status, row.status, {
    before: { code: row.code, name: row.name, parentId: row.parent_id, accountType: row.account_type },
    after: { code: next.code, name: next.name, parentId: next.parentId, accountType: next.accountType },
  });
  return getChartAccount(client, context, row.id);
}

// Deactivating keeps the history and stops new postings. Refused while it still carries a balance, is used by a posting rule, or (a group)
// still has active accounts under it.
export async function setChartAccountStatus(client, context, accountIdValue, status) {
  requireChart(context);
  if (!["active", "inactive"].includes(status)) throw invalid("status", "Choose active or inactive.");
  const account = await getChartAccount(client, context, accountIdValue);
  if (account.status === status) return account;
  if (status === "inactive") {
    if (Math.abs(account.balance) >= 0.005)
      throw new AccountingError(409, `${account.code} · ${account.name} still has a balance. Move it to another account with a journal before deactivating.`, "ACCOUNTING_ACCOUNT_HAS_BALANCE");
    if (account.mappings.length)
      throw new AccountingError(409, `${account.code} · ${account.name} is used by posting rules (${account.mappings.join(", ")}). Point them at another account first.`, "ACCOUNTING_ACCOUNT_MAPPED");
    const activeChildren = Number((await client.query("SELECT count(*)::int AS count FROM tenant.accounting_accounts WHERE organization_id = $1 AND parent_id = $2 AND status = 'active'",
      [context.organizationId, account.id])).rows[0].count);
    if (activeChildren) throw new AccountingError(409, "Deactivate or move the accounts under this group first.", "ACCOUNTING_ACCOUNT_HAS_CHILDREN");
  }
  await client.query("UPDATE tenant.accounting_accounts SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, account.id, status, context.userId ?? null]);
  await event(client, context, "accounting_account", account.id, status === "inactive" ? "accounting.account.deactivated" : "accounting.account.reactivated", account.status, status, {});
  return getChartAccount(client, context, account.id);
}

// Deleting is only for a mistake: never posted to, nothing under it, no posting rule using it.
export async function deleteChartAccount(client, context, accountIdValue) {
  requireChart(context);
  const account = await getChartAccount(client, context, accountIdValue);
  if (account.postingCount) throw new AccountingError(409, "This account has postings and can only be deactivated.", "ACCOUNTING_ACCOUNT_HAS_POSTINGS");
  if (account.childCount) throw new AccountingError(409, "Move or delete the accounts under this group first.", "ACCOUNTING_ACCOUNT_HAS_CHILDREN");
  if (account.mappings.length) throw new AccountingError(409, `Posting rules use this account (${account.mappings.join(", ")}).`, "ACCOUNTING_ACCOUNT_MAPPED");
  const settings = (await client.query(
    `SELECT 1 FROM tenant.accounting_settings s WHERE s.organization_id = $1 AND $2 IN (s.retained_earnings_account_id, s.suspense_account_id, s.rounding_account_id,
       s.realized_gain_account_id, s.realized_loss_account_id, s.unrealized_gain_account_id, s.unrealized_loss_account_id, s.default_receivable_account_id,
       s.default_payable_account_id, s.default_revenue_account_id, s.default_expense_account_id, s.default_output_tax_account_id, s.default_input_tax_account_id,
       s.bank_suspense_account_id, s.writeoff_account_id)`, [context.organizationId, account.id])).rows[0];
  if (settings) throw new AccountingError(409, "Finance settings use this account as a default.", "ACCOUNTING_ACCOUNT_IN_SETTINGS");
  await client.query("DELETE FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2", [context.organizationId, account.id]);
  await event(client, context, "accounting_account", account.id, "accounting.account.deleted", account.status, null, { code: account.code, name: account.name });
  return { deleted: true };
}

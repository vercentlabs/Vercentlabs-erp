// Bank and cash accounts (Finance MVP F6). Each is a register entry joined to its ledger account (the money's balance lives in the ledger):
// a bank account keeps its bank, branch code (IFSC) and only the last digits of its number; a cash account has a person responsible for it
// (its custodian). Adding one can create its ledger account under Cash and bank. An account with money in it isn't closed until its
// balance has been moved.
import { ACCOUNTING_PERMISSIONS, AccountingError, currency, event, getPrimaryLedger, loadOrganization, requirePermission, requiredText, text, uuid } from "../core.js";
import { createChartAccount } from "../chart/chart-commands.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const BANK_TYPES = ["current", "savings", "credit_card", "loan", "virtual", "other"];
// Only the last four digits of an account number are ever stored or shown.
export const maskAccountNumber = (value) => {
  const digits = String(value ?? "").replace(/\s+/g, "");
  if (!digits) return null;
  return digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`;
};

const ACCOUNT_SELECT = `SELECT bank.*, gl.code AS gl_code, gl.name AS gl_name, gl.account_type AS gl_type, custodian.full_name AS custodian_name,
         COALESCE((SELECT sum(line.base_debit_amount - line.base_credit_amount) FROM tenant.accounting_journal_lines line
                    JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
                   WHERE line.organization_id = bank.organization_id AND line.account_id = bank.gl_account_id), 0) AS balance,
         (SELECT max(reconciliation.reconciliation_date) FROM tenant.accounting_reconciliations reconciliation
           WHERE reconciliation.organization_id = bank.organization_id AND reconciliation.bank_account_id = bank.id AND reconciliation.status = 'completed') AS reconciled_to,
         (SELECT count(*) FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id
           WHERE statement.organization_id = bank.organization_id AND statement.bank_account_id = bank.id AND statement.status IN ('imported', 'reconciling')
             AND line.match_status IN ('unmatched', 'suggested', 'partially_matched')) AS lines_to_reconcile
    FROM tenant.accounting_bank_accounts bank
    JOIN tenant.accounting_accounts gl ON gl.id = bank.gl_account_id
    LEFT JOIN public.users custodian ON custodian.id = bank.custodian_user_id`;

function accountView(row) {
  const cash = row.account_type === "cash";
  return {
    id: row.id, code: row.code, kind: cash ? "cash" : "bank", name: row.account_name, bankName: cash ? null : row.bank_name, accountNumber: row.masked_account_number,
    ifsc: row.ifsc_swift, type: row.account_type, currency: String(row.currency_code).trim(), status: row.status, notes: row.notes ?? null,
    custodian: row.custodian_user_id ? { id: row.custodian_user_id, name: row.custodian_name } : null,
    ledgerAccount: { id: row.gl_account_id, label: `${row.gl_code} · ${row.gl_name}` }, balance: money(row.balance),
    reconciledTo: row.reconciled_to ? String(row.reconciled_to instanceof Date ? localDay(row.reconciled_to) : row.reconciled_to).slice(0, 10) : null,
    linesToReconcile: Number(row.lines_to_reconcile ?? 0), updatedAt: row.updated_at,
  };
}
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export async function listBankCashAccounts(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const rows = (await client.query(`${ACCOUNT_SELECT} WHERE bank.organization_id = $1 AND ($2::boolean OR bank.status = 'active') ORDER BY (bank.account_type = 'cash'), bank.account_name`,
    [context.organizationId, filters.includeInactive === true || filters.includeInactive === "true"])).rows;
  return rows.map(accountView);
}

export async function getBankCashAccount(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(`${ACCOUNT_SELECT} WHERE bank.organization_id = $1 AND bank.id = $2`, [context.organizationId, uuid(idValue, "Account")])).rows[0];
  if (!row) fail(404, "Account not found.", "ACCOUNTING_BANK_NOT_FOUND");
  return accountView(row);
}

// The form's choices: the ledger accounts (bank or cash) not yet tied to a register entry, and the people who can hold cash.
export async function getBankAccountFormOptions(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const ledger = await getPrimaryLedger(client, context);
  const free = (await client.query(
    `SELECT account.id, account.code, account.name, account.account_type FROM tenant.accounting_accounts account
      WHERE account.organization_id = $1 AND account.ledger_id = $2 AND account.status = 'active' AND NOT account.is_group AND account.account_type IN ('bank', 'cash')
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_bank_accounts bank WHERE bank.organization_id = account.organization_id AND bank.gl_account_id = account.id)
      ORDER BY account.code`, [context.organizationId, ledger.id])).rows;
  const people = (await client.query(
    `SELECT DISTINCT person.id, person.full_name FROM organization_memberships membership JOIN public.users person ON person.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY person.full_name`, [context.organizationId])).rows;
  const organization = await loadOrganization(client, context);
  return {
    baseCurrency: String(organization.base_currency).trim(),
    ledgerAccounts: free.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, kind: row.account_type })),
    people: people.map((row) => ({ id: row.id, name: row.full_name })),
  };
}

// The next free code for a new bank (1121, 1122 …) or cash (1111, 1112 …) ledger account.
async function nextCode(client, context, ledgerId, kind) {
  const base = kind === "cash" ? 1111 : 1121;
  const taken = new Set((await client.query("SELECT code FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2", [context.organizationId, ledgerId])).rows.map((row) => row.code));
  for (let code = base; code < base + 9; code += 1) if (!taken.has(String(code))) return String(code);
  for (let code = 11100; code < 11999; code += 1) if (!taken.has(String(code))) return String(code);
  fail(409, "No free account code is left under Cash and bank; choose an existing ledger account.", "ACCOUNTING_BANK_CODE_EXHAUSTED");
}

// input: { kind: "bank" | "cash", name, bankName?, accountNumber?, ifsc?, type?, currencyCode?, ledgerAccountId? (else one is created), custodianUserId?, notes? }
export async function createBankCashAccount(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const kind = input.kind === "cash" ? "cash" : "bank";
  const name = requiredText(input.name, "Name", 200);
  if (kind === "bank" && !text(input.bankName, 200)) fail(400, "Enter the bank's name.", "ACCOUNTING_BANK_INVALID", "bankName");
  if (kind === "cash" && !input.custodianUserId) fail(400, "Choose the person responsible for this cash.", "ACCOUNTING_BANK_INVALID", "custodianUserId");
  const ifsc = text(input.ifsc, 20).toUpperCase() || null;
  if (kind === "bank" && ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) fail(400, "An IFSC is 11 characters, like HDFC0001234.", "ACCOUNTING_BANK_INVALID", "ifsc");
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context);
  let ledgerAccountId = input.ledgerAccountId ? uuid(input.ledgerAccountId, "Ledger account") : null;
  if (ledgerAccountId) {
    const gl = (await client.query("SELECT account_type, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2", [context.organizationId, ledgerAccountId])).rows[0];
    if (!gl || gl.status !== "active" || gl.is_group || gl.account_type !== kind) fail(400, `Choose an active ${kind} ledger account.`, "ACCOUNTING_BANK_INVALID", "ledgerAccountId");
    const used = (await client.query("SELECT account_name FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND gl_account_id = $2", [context.organizationId, ledgerAccountId])).rows[0];
    if (used) fail(409, `That ledger account already belongs to ${used.account_name}.`, "ACCOUNTING_BANK_LEDGER_TAKEN", "ledgerAccountId");
  } else {
    const group = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND code = '1100' AND is_group", [context.organizationId, ledger.id])).rows[0];
    const created = await createChartAccount(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "accounting.chart.manage"])] }, {
      code: await nextCode(client, context, ledger.id, kind), name: kind === "cash" ? name : `${name} · ${text(input.bankName, 100)}`.slice(0, 200), accountClass: "asset", accountType: kind,
      parentId: group?.id ?? null, reconciliationRequired: true,
    });
    ledgerAccountId = created.id;
  }
  const code = (text(input.code, 30) || `${kind === "cash" ? "CASH" : "BANK"}-${Date.now().toString(36).slice(-5)}`).toUpperCase();
  const row = (await client.query(
    `INSERT INTO tenant.accounting_bank_accounts (organization_id, ledger_id, gl_account_id, code, bank_name, account_name, masked_account_number, ifsc_swift, currency_code, account_type,
       statement_import_format, status, custodian_user_id, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csv','active',$11,$12,$13,$13) RETURNING id`,
    [context.organizationId, ledger.id, ledgerAccountId, code, kind === "cash" ? "Cash" : text(input.bankName, 200), name, kind === "cash" ? null : maskAccountNumber(input.accountNumber),
      kind === "cash" ? null : ifsc, currency(input.currencyCode || organization.base_currency), kind === "cash" ? "cash" : BANK_TYPES.includes(input.type) ? input.type : "current",
      input.custodianUserId ? uuid(input.custodianUserId, "Custodian") : null, text(input.notes, 2000) || null, context.userId ?? null])).rows[0];
  await event(client, context, "bank_account", row.id, "accounting.bank_account.created", null, "active", { kind, name });
  return getBankCashAccount(client, context, row.id);
}

// input: { name?, bankName?, accountNumber?, ifsc?, custodianUserId?, notes?, status? ("active" | "inactive") }
export async function updateBankCashAccount(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const current = await getBankCashAccount(client, context, idValue);
  if (input.status === "inactive" && current.status === "active" && Math.abs(current.balance) >= 0.005)
    fail(409, `${current.name} still holds ${current.balance.toFixed(2)}. Transfer the balance out before closing it.`, "ACCOUNTING_BANK_HAS_BALANCE");
  if (current.kind === "cash" && input.custodianUserId === null) fail(400, "A cash account always has a person responsible for it.", "ACCOUNTING_BANK_INVALID", "custodianUserId");
  const ifsc = input.ifsc === undefined ? undefined : text(input.ifsc, 20).toUpperCase() || null;
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) fail(400, "An IFSC is 11 characters, like HDFC0001234.", "ACCOUNTING_BANK_INVALID", "ifsc");
  await client.query(
    `UPDATE tenant.accounting_bank_accounts SET account_name = COALESCE($3, account_name), bank_name = COALESCE($4, bank_name),
            masked_account_number = CASE WHEN $5::boolean THEN $6 ELSE masked_account_number END, ifsc_swift = CASE WHEN $7::boolean THEN $8 ELSE ifsc_swift END,
            custodian_user_id = CASE WHEN $9::boolean THEN $10::uuid ELSE custodian_user_id END, notes = CASE WHEN $11::boolean THEN $12 ELSE notes END,
            status = COALESCE($13, status), updated_by = $14, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, input.name ? requiredText(input.name, "Name", 200) : null, input.bankName && current.kind === "bank" ? text(input.bankName, 200) : null,
      input.accountNumber !== undefined, maskAccountNumber(input.accountNumber), ifsc !== undefined, ifsc ?? null,
      input.custodianUserId !== undefined, input.custodianUserId ? uuid(input.custodianUserId, "Custodian") : null, input.notes !== undefined, text(input.notes, 2000) || null,
      ["active", "inactive"].includes(input.status) ? input.status : null, context.userId ?? null]);
  await event(client, context, "bank_account", current.id, "accounting.bank_account.updated", current.status, input.status ?? current.status, {
    custodian: input.custodianUserId !== undefined ? { from: current.custodian?.id ?? null, to: input.custodianUserId } : undefined,
  });
  return getBankCashAccount(client, context, current.id);
}


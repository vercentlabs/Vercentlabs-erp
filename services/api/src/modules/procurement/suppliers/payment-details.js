// Where a supplier is paid: Finance's data on the supplier.
//
// Procurement never needs it (an RFQ or a purchase order is created without
// it) and Procurement permissions never reach it. Whoever pays suppliers sees
// the full account number; only whoever may manage payment details (Finance,
// by default the payment approvers) adds or changes an account. Every change
// is in the supplier's history, with the number masked.
import { SUPPLIER_PERMISSIONS, SupplierError, has, requireUuid, text } from "./constants.js";
import { recordSupplierEvent, requireSupplierPermission, supplierCan } from "./access.js";

// Finance reaches a supplier through its payment permission, not through Procurement's supplier visibility: the tenant's supplier, nothing more.
async function loadSupplier(client, context, supplierId, { lock = false } = {}) {
  const row = (await client.query(`SELECT id, party_id, supplier_number, default_currency FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(supplierId, "Supplier")])).rows[0];
  if (!row) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  return row;
}

const mask = (number) => (number ? `•••• ${String(number).slice(-4)}` : null);

function canView(context) {
  return supplierCan(context, SUPPLIER_PERMISSIONS.paymentDetailsView) || supplierCan(context, SUPPLIER_PERMISSIONS.paymentDetailsManage);
}

function fail(field, message) {
  throw new SupplierError(400, message, "SUPPLIER_PAYMENT_DETAILS_VALIDATION", { issues: [{ field, message }] });
}

function normalizeAccount(input = {}, current = {}) {
  const pick = (field, max = 120) => (has(input, field) ? text(input[field], max) : current[field] ?? null);
  const account = {
    accountHolder: pick("accountHolder", 200), bankName: pick("bankName", 200),
    accountNumber: pick("accountNumber", 40)?.toUpperCase().replace(/[\s-]+/g, "") ?? null,
    ifscCode: pick("ifscCode", 11)?.toUpperCase() ?? null, swiftCode: pick("swiftCode", 11)?.toUpperCase() ?? null, currencyCode: pick("currencyCode", 3)?.toUpperCase() ?? null,
  };
  if (!account.accountHolder) fail("accountHolder", "Enter the account holder's name.");
  if (!account.bankName) fail("bankName", "Enter the bank's name.");
  if (!/^[A-Z0-9]{4,34}$/.test(account.accountNumber ?? "")) fail("accountNumber", "Enter the account number (letters and digits only).");
  if (account.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(account.ifscCode)) fail("ifscCode", "An IFSC has 11 characters, like HDFC0001234.");
  if (account.swiftCode && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(account.swiftCode)) fail("swiftCode", "A SWIFT code has 8 or 11 characters.");
  if (!/^[A-Z]{3}$/.test(account.currencyCode ?? "")) fail("currencyCode", "Choose the account's currency.");
  return account;
}

const toAccount = (row, full) => ({
  id: row.id, accountHolder: row.account_holder, bankName: row.bank_name, accountNumber: full ? row.account_number : null, accountNumberMasked: mask(row.account_number),
  ifscCode: row.ifsc_code, swiftCode: row.swift_code, currencyCode: row.currency_code?.trim(), isPrimary: row.is_primary, status: row.status,
  updatedAt: row.updated_at, updatedByName: row.updated_by_name ?? null,
});

export async function listSupplierPaymentDetails(client, context, supplierId) {
  if (!canView(context)) throw new SupplierError(403, "Supplier payment details are Finance's: you do not have permission to see them.", "PERMISSION_DENIED");
  const supplier = await loadSupplier(client, context, supplierId);
  const { rows } = await client.query(
    `SELECT account.*, editor.full_name AS updated_by_name FROM tenant.accounting_supplier_bank_accounts account LEFT JOIN public.users editor ON editor.id = account.updated_by
      WHERE account.organization_id = $1 AND account.supplier_id = $2 ORDER BY (account.status = 'active') DESC, account.is_primary DESC, account.created_at`,
    [context.organizationId, supplier.id]);
  return { accounts: rows.map((row) => toAccount(row, true)), canManage: supplierCan(context, SUPPLIER_PERMISSIONS.paymentDetailsManage) };
}

async function currencyKnown(client, context, code) {
  return Boolean((await client.query(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, [context.organizationId, code])).rows[0]);
}

export async function addSupplierBankAccount(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.paymentDetailsManage, "Only Finance may change where a supplier is paid.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const account = normalizeAccount({ currencyCode: supplier.default_currency?.trim(), ...input });
  if (!(await currencyKnown(client, context, account.currencyCode))) fail("currencyCode", "Choose a currency your organization uses.");
  const hasPrimary = (await client.query(`SELECT 1 FROM tenant.accounting_supplier_bank_accounts WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
    [context.organizationId, supplier.id])).rows[0];
  const primary = input.isPrimary === true || !hasPrimary;
  if (primary) await client.query(`UPDATE tenant.accounting_supplier_bank_accounts SET is_primary = false WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
    [context.organizationId, supplier.id]);
  const { rows } = await client.query(
    `INSERT INTO tenant.accounting_supplier_bank_accounts (organization_id, supplier_id, account_holder, bank_name, account_number, ifsc_code, swift_code, currency_code, is_primary,
       created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [context.organizationId, supplier.id, account.accountHolder, account.bankName, account.accountNumber, account.ifscCode, account.swiftCode, account.currencyCode, primary,
      context.userId ?? null]);
  await recordSupplierEvent(client, context, supplier.id, "supplier.payment_details_changed",
    `Bank account added: ${account.bankName} ${mask(account.accountNumber)}${account.ifscCode ? ` · ${account.ifscCode}` : ""} (${account.currencyCode})${primary ? ", primary" : ""}`,
    { accountId: rows[0].id, bankName: account.bankName, accountNumber: mask(account.accountNumber), ifscCode: account.ifscCode, primary });
  return { accountId: rows[0].id };
}

// input: the account fields, isPrimary, and status ("active" | "inactive").
export async function updateSupplierBankAccount(client, context, supplierId, accountId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.paymentDetailsManage, "Only Finance may change where a supplier is paid.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.accounting_supplier_bank_accounts WHERE organization_id = $1 AND supplier_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, supplier.id, requireUuid(accountId, "Bank account")])).rows[0];
  if (!row) throw new SupplierError(404, "Bank account not found.", "SUPPLIER_BANK_ACCOUNT_NOT_FOUND");
  const before = { accountHolder: row.account_holder, bankName: row.bank_name, accountNumber: row.account_number, ifscCode: row.ifsc_code, swiftCode: row.swift_code,
    currencyCode: row.currency_code?.trim() };
  const account = normalizeAccount(input, before);
  if (account.currencyCode !== before.currencyCode && !(await currencyKnown(client, context, account.currencyCode))) fail("currencyCode", "Choose a currency your organization uses.");
  const status = has(input, "status") ? (input.status === "inactive" ? "inactive" : "active") : row.status;
  const primary = status === "active" && (input.isPrimary === true || (row.is_primary && input.isPrimary !== false));
  if (primary && !row.is_primary)
    await client.query(`UPDATE tenant.accounting_supplier_bank_accounts SET is_primary = false WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`, [context.organizationId, supplier.id]);
  await client.query(
    `UPDATE tenant.accounting_supplier_bank_accounts SET account_holder = $3, bank_name = $4, account_number = $5, ifsc_code = $6, swift_code = $7, currency_code = $8, status = $9,
            is_primary = $10, updated_by = $11, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, account.accountHolder, account.bankName, account.accountNumber, account.ifscCode, account.swiftCode, account.currencyCode, status, primary,
      context.userId ?? null]);
  const changed = Object.keys(account).filter((field) => (account[field] ?? null) !== (before[field] ?? null));
  if (status !== row.status) changed.push("status");
  if (primary !== row.is_primary) changed.push("primary");
  if (changed.length) {
    const shown = (field, value) => (field === "accountNumber" ? mask(value) : value);
    await recordSupplierEvent(client, context, supplier.id, "supplier.payment_details_changed",
      `Bank account changed (${account.bankName} ${mask(account.accountNumber)}): ${changed.map((field) => ({ accountHolder: "account holder", bankName: "bank", accountNumber: "account number",
        ifscCode: "IFSC", swiftCode: "SWIFT", currencyCode: "currency", status: status === "inactive" ? "deactivated" : "reactivated", primary: primary ? "made primary" : "no longer primary" })[field]).join(", ")}`,
      { accountId: row.id, changes: Object.fromEntries(changed.filter((field) => field in account).map((field) => [field, { from: shown(field, before[field]), to: shown(field, account[field]) }])) });
  }
  return { accountId: row.id };
}

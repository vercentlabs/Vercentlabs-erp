// Payment Reconciliation (0108). One engine over the shared payment records — it verifies, it never decides a payment's outcome:
//
//   layer                 evidence                                              outcome kept
//   checkout              a completed sale vs its applied tenders               every sale paid exactly (change is never a tender)
//   provider payment      the provider's own confirmation (API / webhook)       PROVIDER_VERIFIED vs EXTERNALLY_ATTESTED kept apart
//   settlement            provider settlement lines (payment, refund, fee …)    each payment / refund matched to its line, once
//   bank                  the provider payout vs Finance bank statement lines   a payout is received only when the bank shows it
//   cash                  the cash session and its cash differences             linked, never re-counted here
//   finance               settlement journals through Accounting               posted once, after the bank receipt
//
// Matching is deterministic: an exact provider transaction id (or payout reference) + merchant account + currency + amount, and only when it is
// unique. Amount-and-date alone only ever proposes candidates. A manual match needs a reason and evidence, and above the company's threshold a
// second person's approval; a wrong match is reversed, never edited. The database refuses any match that would use more of a source than it
// holds. Every difference is an exception in one queue until resolved with evidence. Nothing here edits a sale, retries a payment or refund,
// or rewrites provider evidence; a finalized Z report gets its reconciliation status, never new figures.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { parseCsvUpload, DataExchangeError } from "../../../core/platform/data-exchange/csv.js";
import { parseXlsxUpload, isXlsxFileName } from "../../../core/platform/data-exchange/xlsx.js";
import { decimal, add, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { createJournalEntry, postJournalEntry, getAccountMapping, getPrimaryLedger, recordPostingFailure, registerPostingRetry } from "../../accounting/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, accessiblePosStoreIds } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";
import { posAccountingContext } from "../shared/accounting-bridge.js";
import { getPosCardAttempt } from "../tender-and-payment-execution/card-payments.js";

export const RECONCILIATION_MESSAGES = Object.freeze({
  RECON_PERMISSION_DENIED: "You do not have permission for payment reconciliation.",
  RECON_NOT_FOUND: "Reconciliation record not found.",
  RECON_MERCHANT_ACCOUNT_INVALID: "Choose a merchant account of this company.",
  RECON_IMPORT_INVALID: "The settlement file could not be read.",
  RECON_IMPORT_HAS_ERRORS: "Fix the rows with errors and upload the file again.",
  RECON_IMPORT_DUPLICATE: "This settlement file was already imported.",
  RECON_IMPORT_STATE: "This import was already committed or rejected.",
  RECON_MATCH_INVALID: "These records cannot be matched.",
  RECON_MATCH_CAPACITY: "This match would use more than the records hold.",
  RECON_MATCH_APPROVAL_REQUIRED: "This match needs a second person's approval.",
  RECON_SELF_APPROVAL: "You cannot approve your own match or resolution.",
  RECON_EXCEPTION_STATE: "This exception cannot change that way.",
  RECON_RESOLUTION_INVALID: "Give the resolution, a note and the evidence.",
  RECON_VERSION_CONFLICT: "The record changed. Refresh and try again.",
  RECON_FINANCE_NOT_READY: "The payout is posted to Finance once its bank receipt is matched.",
});
const reconError = (status, code, message = RECONCILIATION_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const mayView = (c) => ["pos.reconciliation.view", "pos.reconciliation.manage", "pos.reconciliation.approve", "pos.accounting.post"].some((key) => can(c, key));
const mayManage = (c) => can(c, "pos.reconciliation.manage");
const mayApprove = (c) => can(c, "pos.reconciliation.approve");
const mayWork = (c) => mayManage(c) || mayApprove(c);
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const money = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const out = (value) => money(asDatabaseDecimal(value));
const dec = (value) => decimal(String(value ?? "0"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const event = (client, context, type, id, name, payload = {}) => auditEvent(client, context, type, id, name, payload);
const APPLIED = ["captured", "partially_refunded", "refunded"];
const LIVE_ATTEMPTS = ["created", "awaiting_customer", "processing", "authorized", "capture_pending", "unknown", "cancel_pending"];

async function policyOf(client, context) {
  const row = (await client.query(`SELECT reconciliation_unknown_after_minutes, reconciliation_refund_overdue_days, reconciliation_manual_approval_above FROM tenant.pos_settings
      WHERE organization_id = $1`, [context.organizationId])).rows[0];
  return { unknownAfterMinutes: Number(row?.reconciliation_unknown_after_minutes ?? 30), refundOverdueDays: Number(row?.reconciliation_refund_overdue_days ?? 7),
    manualApprovalAbove: row ? (row.reconciliation_manual_approval_above === null ? null : dec(row.reconciliation_manual_approval_above)) : dec("10000") };
}

// ------------------------------------------------------------------ merchant accounts

const merchantView = (row) => ({ id: row.id, providerKey: row.provider_key, merchantAccountReference: row.merchant_account_reference, displayName: row.display_name,
  paymentMethods: row.payment_methods, currency: row.currency_code, bankAccountId: row.bank_account_id, bankAccount: row.bank_account_name ?? null,
  settlementExpectedDays: row.settlement_expected_days, status: row.status });

export async function listMerchantAccounts(client, context) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  return (await client.query(`SELECT merchant.*, bank.account_name AS bank_account_name FROM tenant.payment_merchant_accounts merchant
      LEFT JOIN tenant.accounting_bank_accounts bank ON bank.organization_id = merchant.organization_id AND bank.id = merchant.bank_account_id
     WHERE merchant.organization_id = $1 ORDER BY merchant.display_name`, [context.organizationId])).rows.map(merchantView);
}

// The Finance bank accounts payouts can reach (read only; Finance owns them).
export async function listReconciliationBankAccounts(client, context) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  return (await client.query(`SELECT id, code, bank_name, account_name, currency_code FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND status = 'active' ORDER BY code`,
    [context.organizationId])).rows.map((row) => ({ id: row.id, code: row.code, bankName: row.bank_name, accountName: row.account_name, currency: String(row.currency_code).trim() }));
}

// A merchant account: the provider and merchant reference payments carry, the Finance bank account its payouts reach, and how many days a
// settlement normally takes (the aging threshold). input: id?, providerKey, merchantAccountReference, displayName, paymentMethods, bankAccountId,
// settlementExpectedDays, status.
export async function saveMerchantAccount(client, context, input = {}) {
  if (!mayManage(context) && !mayApprove(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const bankId = input.bankAccountId === null || input.bankAccountId === "" ? null : input.bankAccountId;
  if (bankId) {
    if (!UUID.test(String(bankId)) || !(await client.query(`SELECT 1 FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND id = $2`, [context.organizationId, bankId])).rows[0])
      throw reconError(400, "RECON_MERCHANT_ACCOUNT_INVALID", "Choose a bank account of this company.");
  }
  const methods = Array.isArray(input.paymentMethods) && input.paymentMethods.length ? input.paymentMethods.filter((method) => ["card", "upi", "wallet", "bank_transfer"].includes(method)) : ["card", "upi"];
  const days = Number(input.settlementExpectedDays ?? 3);
  if (!Number.isInteger(days) || days < 0 || days > 60) throw reconError(400, "RECON_MERCHANT_ACCOUNT_INVALID", "Settlement days must be between 0 and 60.");
  let row;
  if (input.id) {
    row = (await client.query(
      `UPDATE tenant.payment_merchant_accounts SET display_name = COALESCE($3, display_name), payment_methods = $4, bank_account_id = $5, settlement_expected_days = $6,
              status = COALESCE($7, status), updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [context.organizationId, input.id, text(input.displayName, 120), methods, bankId, days, ["active", "inactive"].includes(input.status) ? input.status : null])).rows[0];
    if (!row) throw reconError(404, "RECON_NOT_FOUND");
  } else {
    const provider = text(input.providerKey, 60);
    const reference = text(input.merchantAccountReference, 120);
    if (!provider || !reference) throw reconError(400, "RECON_MERCHANT_ACCOUNT_INVALID", "Give the provider and the merchant account reference.");
    row = (await client.query(
      `INSERT INTO tenant.payment_merchant_accounts (organization_id, provider_key, merchant_account_reference, display_name, payment_methods, bank_account_id, settlement_expected_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, provider_key, merchant_account_reference) DO UPDATE SET payment_methods = EXCLUDED.payment_methods, bank_account_id = EXCLUDED.bank_account_id,
         settlement_expected_days = EXCLUDED.settlement_expected_days, updated_at = now() RETURNING *`,
      [context.organizationId, provider, reference, text(input.displayName, 120) ?? `${provider} · ${reference}`, methods, bankId, days, context.userId])).rows[0];
  }
  await event(client, context, "payment_merchant_account", row.id, "payments.merchant_account.saved", { bankAccountId: row.bank_account_id, days: row.settlement_expected_days });
  return merchantView(row);
}

async function loadMerchant(client, context, merchantAccountId) {
  if (!UUID.test(String(merchantAccountId ?? ""))) throw reconError(400, "RECON_MERCHANT_ACCOUNT_INVALID");
  const row = (await client.query(`SELECT * FROM tenant.payment_merchant_accounts WHERE organization_id = $1 AND id = $2`, [context.organizationId, merchantAccountId])).rows[0];
  if (!row) throw reconError(400, "RECON_MERCHANT_ACCOUNT_INVALID");
  return row;
}

const merchantKeyOf = (payment) => `${payment.provider_key}|${String(payment.merchant_account_reference ?? "").trim() || "DEFAULT"}`;

// ------------------------------------------------------------------ exceptions (one queue)

// Raise (or refresh) an open exception for a source. values: code, layer, sourceType, sourceId, storeId, merchantAccountId, currency, expected,
// actual, difference, exposure, references.
async function raise(client, context, values) {
  const existing = (await client.query(`SELECT id FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND exception_code = $2 AND source_type = $3 AND source_id = $4
      AND status <> 'RESOLVED'`, [context.organizationId, values.code, values.sourceType, values.sourceId])).rows[0];
  const amounts = [values.expected, values.actual, values.difference, values.exposure].map((value) => (value === null || value === undefined ? null : out(dec(value))));
  if (existing) {
    await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET last_seen_at = now(), expected_amount = $3, actual_amount = $4, difference_amount = $5, exposure_amount = $6,
        references_json = references_json || $7::jsonb WHERE organization_id = $1 AND id = $2`, [context.organizationId, existing.id, ...amounts, JSON.stringify(values.references ?? {})]);
    return { id: existing.id, created: false };
  }
  const number = await nextDocumentNumber(client, context, { documentType: "payment_reconciliation_exception", prefix: "PRX" });
  const row = (await client.query(
    `INSERT INTO tenant.payment_reconciliation_exceptions (organization_id, exception_number, exception_code, layer, store_id, merchant_account_id, source_type, source_id, references_json,
       currency_code, expected_amount, actual_amount, difference_amount, exposure_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14) RETURNING id`,
    [context.organizationId, number, values.code, values.layer, values.storeId ?? null, values.merchantAccountId ?? null, values.sourceType, values.sourceId, JSON.stringify(values.references ?? {}),
      values.currency ?? "INR", ...amounts])).rows[0];
  await event(client, context, "payment_reconciliation_exception", row.id, "payments.reconciliation.exception_raised", { code: values.code, number });
  return { id: row.id, created: true };
}

// The condition is gone (the system can see it): resolve as cleared, with the current state as evidence.
async function clearCondition(client, context, code, sourceType, sourceId, note) {
  const row = (await client.query(`SELECT id FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND exception_code = $2 AND source_type = $3 AND source_id = $4
      AND status <> 'RESOLVED'`, [context.organizationId, code, sourceType, sourceId])).rows[0];
  if (!row) return false;
  await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET status = 'RESOLVED', resolution_type = 'CONDITION_CLEARED', resolution_note = $3, resolved_by = $4, resolved_at = now(),
      evidence = evidence || jsonb_build_array(jsonb_build_object('kind', 'system_check', 'note', $3::text, 'at', now())) WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, note, context.userId]);
  return true;
}

// ------------------------------------------------------------------ settlement import (preview → commit)

const STANDARD_COLUMNS = ["settlement_id", "settlement_date", "payout_reference", "line_type", "transaction_id", "reference", "original_transaction_id", "transaction_time", "currency",
  "gross_amount", "fee_amount", "fee_tax_amount", "net_amount", "description"];
// Adapters: how a provider's report maps to settlement lines. standard_v1 is Vercentlabs' documented template (also the normalized form a
// provider API adapter produces); a provider with its own report format gets its own adapter here, never a guessed universal mapping.
const ADAPTERS = Object.freeze({
  standard_v1: { required: ["settlement_id", "settlement_date", "line_type", "gross_amount"], columns: STANDARD_COLUMNS, map: (record) => record },
});
const LINE_TYPES = ["PAYMENT", "REFUND", "FEE", "FEE_TAX", "CHARGEBACK", "ADJUSTMENT", "PAYOUT"];
const AMOUNT = /^-?\d{1,14}(\.\d{1,2})?$/;
// A value a spreadsheet would run as a formula is refused, never stored.
const unsafeCell = (value) => /^[=+@\t\r]/.test(String(value ?? "")) || (/^-/.test(String(value ?? "")) && !AMOUNT.test(String(value).trim()));

function normalizeRows(records, adapter) {
  const errors = [];
  const rows = records.map((raw, index) => {
    const record = adapter.map(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase().replace(/\s+/g, "_"), String(value ?? "").trim()])));
    const at = index + 2;
    const fail = (message) => errors.push({ row: at, message });
    for (const [key, value] of Object.entries(record)) if (unsafeCell(value) && !["gross_amount", "fee_amount", "fee_tax_amount", "net_amount"].includes(key)) fail(`${key} starts with a formula character`);
    const type = String(record.line_type ?? "").toUpperCase();
    if (!LINE_TYPES.includes(type)) fail(`line_type must be one of ${LINE_TYPES.join(", ")}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.settlement_date ?? "")) fail("settlement_date must be YYYY-MM-DD");
    if (!text(record.settlement_id, 120)) fail("settlement_id is required");
    for (const key of ["gross_amount", "fee_amount", "fee_tax_amount", "net_amount"]) if (record[key] && !AMOUNT.test(record[key])) fail(`${key} must be an amount (two decimals at most)`);
    if (!record.gross_amount) fail("gross_amount is required");
    if (["PAYMENT", "REFUND", "CHARGEBACK"].includes(type) && !text(record.transaction_id, 120)) fail(`${type} lines need the provider transaction_id`);
    if (type !== "ADJUSTMENT" && record.gross_amount && AMOUNT.test(record.gross_amount) && Number(record.gross_amount) < 0) fail("gross_amount cannot be negative (use ADJUSTMENT for signed amounts)");
    const currency = (text(record.currency, 3) ?? "INR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail("currency must be a 3-letter code");
    if (record.transaction_time && Number.isNaN(Date.parse(record.transaction_time))) fail("transaction_time is not a date-time");
    return { row: at, settlementId: text(record.settlement_id, 120), settlementDate: record.settlement_date, payoutReference: text(record.payout_reference, 120), type,
      transactionId: text(record.transaction_id, 120), reference: text(record.reference, 120), originalTransactionId: text(record.original_transaction_id, 120),
      transactionAt: record.transaction_time ? new Date(record.transaction_time).toISOString() : null, currency, gross: record.gross_amount || "0", fee: record.fee_amount || "0",
      feeTax: record.fee_tax_amount || "0", net: record.net_amount || null, description: text(record.description, 300) };
  });
  return { rows, errors };
}

// Group the rows into payouts and compute each one's gross-to-net: gross receipts − refunds − fees − tax on fees − chargebacks + adjustments.
function buildBatches(rows) {
  const batches = new Map();
  for (const row of rows) {
    const batch = batches.get(row.settlementId) ?? { settlementId: row.settlementId, settlementDate: row.settlementDate, payoutReference: row.payoutReference, currency: row.currency,
      gross: decimal("0"), refunds: decimal("0"), fees: decimal("0"), feeTax: decimal("0"), chargebacks: decimal("0"), adjustments: decimal("0"), reportedNet: null, declaredFees: null, lines: [] };
    batches.set(row.settlementId, batch);
    if (!batch.payoutReference && row.payoutReference) batch.payoutReference = row.payoutReference;
    const gross = dec(row.gross);
    if (row.type === "PAYOUT") { batch.reportedNet = gross; batch.declaredFees = row.fee !== "0" || row.feeTax !== "0" ? add(dec(row.fee), dec(row.feeTax)) : batch.declaredFees; continue; }
    if (row.type === "PAYMENT") batch.gross = add(batch.gross, gross);
    if (row.type === "REFUND") batch.refunds = add(batch.refunds, gross);
    if (row.type === "FEE") batch.fees = add(batch.fees, gross);
    if (row.type === "FEE_TAX") batch.feeTax = add(batch.feeTax, gross);
    if (row.type === "CHARGEBACK") batch.chargebacks = add(batch.chargebacks, gross);
    if (row.type === "ADJUSTMENT") batch.adjustments = add(batch.adjustments, gross);
    batch.fees = add(batch.fees, dec(row.fee));
    batch.feeTax = add(batch.feeTax, dec(row.feeTax));
    batch.lines.push(row);
  }
  return [...batches.values()].map((batch) => ({ ...batch,
    calculatedNet: add(sub(sub(sub(sub(batch.gross, batch.refunds), batch.fees), batch.feeTax), batch.chargebacks), batch.adjustments) }));
}

const batchPreview = (batch, duplicates) => ({ settlementId: batch.settlementId, settlementDate: batch.settlementDate, payoutReference: batch.payoutReference, currency: batch.currency,
  gross: out(batch.gross), refunds: out(batch.refunds), fees: out(batch.fees), feeTax: out(batch.feeTax), chargebacks: out(batch.chargebacks), adjustments: out(batch.adjustments),
  calculatedNet: out(batch.calculatedNet), reportedNet: batch.reportedNet === null ? null : out(batch.reportedNet),
  netDifference: batch.reportedNet === null ? null : out(sub(batch.reportedNet, batch.calculatedNet)), lines: batch.lines.length, duplicateLines: duplicates });

// Preview a settlement report: parse (CSV or XLSX, or normalized provider API lines), validate every row, compute each payout's gross-to-net,
// and flag lines already imported — nothing is recorded as settlement yet. The same file (by hash) is never imported twice.
// input: merchantAccountId, adapterCode, fileName, contentBase64 | lines[].
export async function previewSettlementImport(client, context, input = {}) {
  if (!mayManage(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const merchant = await loadMerchant(client, context, input.merchantAccountId);
  const adapterCode = String(input.adapterCode ?? "standard_v1");
  const adapter = ADAPTERS[adapterCode];
  if (!adapter) throw reconError(400, "RECON_IMPORT_INVALID", `No settlement adapter ${adapterCode}. Supported: ${Object.keys(ADAPTERS).join(", ")}.`);
  let records; let kind; let sourceText;
  try {
    if (Array.isArray(input.lines)) { records = input.lines.map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, String(value ?? "")]))); kind = "API"; sourceText = JSON.stringify(input.lines); }
    else {
      const bytes = Buffer.from(String(input.contentBase64 ?? ""), "base64");
      const parsed = isXlsxFileName(input.fileName ?? "") ? parseXlsxUpload(bytes) : parseCsvUpload(bytes);
      kind = isXlsxFileName(input.fileName ?? "") ? "XLSX" : "CSV";
      const headers = parsed.headers.map((header) => header.trim().toLowerCase().replace(/\s+/g, "_"));
      const missing = adapter.required.filter((column) => !headers.includes(column));
      if (missing.length) throw reconError(400, "RECON_IMPORT_INVALID", `This is not a ${adapterCode} settlement report: missing ${missing.join(", ")}.`);
      const unknown = headers.filter((header) => !adapter.columns.includes(header));
      if (unknown.length) throw reconError(400, "RECON_IMPORT_INVALID", `Unrecognised columns: ${unknown.join(", ")}.`);
      records = parsed.records;
      sourceText = bytes.toString("base64");
    }
  } catch (error) {
    if (error instanceof DataExchangeError) throw reconError(400, "RECON_IMPORT_INVALID", error.message);
    throw error;
  }
  if (!records.length) throw reconError(400, "RECON_IMPORT_INVALID", "The report has no lines.");
  const sourceHash = sha(`${merchant.id}|${adapterCode}|${sourceText}`);
  const previous = (await client.query(`SELECT * FROM tenant.payment_reconciliation_imports WHERE organization_id = $1 AND merchant_account_id = $2 AND source_hash = $3 AND status <> 'REJECTED'`,
    [context.organizationId, merchant.id, sourceHash])).rows[0];
  if (previous?.status === "PREVIEW") return importView(previous);
  if (previous?.status === "COMMITTED") {
    await raise(client, context, { code: "PROVIDER_FILE_DUPLICATE", layer: "SETTLEMENT", sourceType: "payment_reconciliation_import", sourceId: previous.id, merchantAccountId: merchant.id,
      references: { fileName: text(input.fileName, 200), uploadedBy: context.userId } });
    throw reconError(409, "RECON_IMPORT_DUPLICATE", undefined, { importId: previous.id });
  }
  const { rows, errors } = normalizeRows(records, adapter);
  const batches = buildBatches(rows.filter((row) => !errors.some((error) => error.row === row.row)));
  for (const batch of batches) {
    if (batch.currency !== merchant.currency_code) errors.push({ row: batch.lines[0]?.row ?? 2, message: `Settlement ${batch.settlementId} is in ${batch.currency}; the merchant account settles in ${merchant.currency_code}` });
    if ((await client.query(`SELECT 1 FROM tenant.payment_settlement_batches WHERE organization_id = $1 AND merchant_account_id = $2 AND provider_settlement_id = $3`,
      [context.organizationId, merchant.id, batch.settlementId])).rows[0]) errors.push({ row: batch.lines[0]?.row ?? 2, message: `Settlement ${batch.settlementId} was already imported` });
  }
  const preview = [];
  for (const batch of batches) {
    let duplicates = 0;
    for (const line of batch.lines.filter((entry) => ["PAYMENT", "REFUND", "CHARGEBACK"].includes(entry.type))) {
      const seen = (await client.query(`SELECT 1 FROM tenant.payment_settlement_lines WHERE organization_id = $1 AND merchant_account_id = $2 AND line_type = $3 AND provider_transaction_id = $4`,
        [context.organizationId, merchant.id, line.type, line.transactionId])).rows[0];
      if (seen) { duplicates += 1; line.duplicate = true; }
    }
    preview.push({ ...batchPreview(batch, duplicates), rows: batch.lines });
  }
  const row = (await client.query(
    `INSERT INTO tenant.payment_reconciliation_imports (organization_id, merchant_account_id, adapter_code, source_kind, file_name, source_hash, status, line_count, error_count, errors, preview, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12) RETURNING *`,
    [context.organizationId, merchant.id, adapterCode, kind, text(input.fileName, 200), sourceHash, "PREVIEW", rows.length, errors.length, JSON.stringify(errors.slice(0, 200)),
      JSON.stringify({ batches: preview }), context.userId])).rows[0];
  await event(client, context, "payment_reconciliation_import", row.id, "payments.settlement.previewed", { lines: rows.length, errors: errors.length, sourceHash });
  return importView(row);
}

function importView(row) {
  return { id: row.id, merchantAccountId: row.merchant_account_id, adapter: row.adapter_code, kind: row.source_kind, fileName: row.file_name, status: row.status, lines: row.line_count,
    errors: row.errors, errorCount: row.error_count, batches: (row.preview?.batches ?? []).map(({ rows, ...batch }) => batch), batchIds: row.preview?.batchIds ?? [],
    uploadedAt: row.uploaded_at, committedAt: row.committed_at };
}

// Commit a previewed settlement report: the payouts and their lines are recorded (lines already imported are skipped, never doubled), each
// payment and refund line is matched by its exact provider transaction id, and every difference becomes an exception. Repeating it returns the
// same result.
export async function commitSettlementImport(client, context, importId) {
  if (!mayManage(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  if (!UUID.test(String(importId ?? ""))) throw reconError(404, "RECON_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM tenant.payment_reconciliation_imports WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, importId])).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  if (row.status === "COMMITTED") return { import: importView(row), batches: await batchesOf(client, context, row.preview?.batchIds ?? []) };
  if (row.status !== "PREVIEW") throw reconError(409, "RECON_IMPORT_STATE");
  if (row.error_count > 0) throw reconError(409, "RECON_IMPORT_HAS_ERRORS", undefined, { errors: row.errors });
  const merchant = await loadMerchant(client, context, row.merchant_account_id);
  const batchIds = [];
  for (const preview of row.preview.batches) {
    const batch = buildBatches(preview.rows)[0];
    const inserted = (await client.query(
      `INSERT INTO tenant.payment_settlement_batches (organization_id, merchant_account_id, import_id, provider_settlement_id, settlement_date, currency_code, gross_amount, refund_amount, fee_amount,
         fee_tax_amount, chargeback_amount, adjustment_amount, calculated_net_amount, reported_net_amount, bank_payout_reference, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [context.organizationId, merchant.id, row.id, batch.settlementId, batch.settlementDate, batch.currency, out(batch.gross), out(batch.refunds), out(batch.fees), out(batch.feeTax),
        out(batch.chargebacks), out(batch.adjustments), out(batch.calculatedNet), batch.reportedNet === null ? null : out(batch.reportedNet), batch.payoutReference, context.userId])).rows[0];
    batchIds.push(inserted.id);
    let number = 0;
    for (const line of preview.rows.filter((entry) => entry.type !== "PAYOUT")) {
      number += 1;
      await client.query("SAVEPOINT payment_settlement_line");
      let lineRow;
      try {
        const gross = dec(line.gross);
        const net = line.net ? dec(line.net) : sub(sub(gross, dec(line.fee)), dec(line.feeTax));
        lineRow = (await client.query(
          `INSERT INTO tenant.payment_settlement_lines (organization_id, batch_id, merchant_account_id, line_number, line_type, provider_transaction_id, provider_reference, original_provider_transaction_id,
             transaction_at, currency_code, gross_amount, fee_amount, fee_tax_amount, net_amount, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
          [context.organizationId, inserted.id, merchant.id, number, line.type, line.transactionId, line.reference, line.originalTransactionId, line.transactionAt, line.currency, out(gross),
            out(dec(line.fee)), out(dec(line.feeTax)), out(net), line.description])).rows[0];
        await client.query("RELEASE SAVEPOINT payment_settlement_line");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT payment_settlement_line");
        // The same provider transaction already settled in an earlier report: recognised once, skipped here.
        if (error?.code === "23505" && error.constraint === "payment_settlement_lines_identity_uidx") continue;
        throw error;
      }
      if (line.type === "PAYMENT") await matchPaymentLine(client, context, merchant, inserted, lineRow);
      if (line.type === "REFUND") await matchRefundLine(client, context, merchant, inserted, lineRow);
      if (line.type === "CHARGEBACK" || line.type === "ADJUSTMENT") {
        await raise(client, context, { code: "PROVIDER_ADJUSTMENT_REPORTED", layer: "SETTLEMENT", sourceType: "payment_settlement_line", sourceId: lineRow.id, merchantAccountId: merchant.id,
          currency: line.currency, actual: lineRow.gross_amount, exposure: lineRow.gross_amount, references: { settlementId: batch.settlementId, transactionId: line.transactionId, type: line.type } });
      }
    }
    await evaluateBatch(client, context, inserted.id);
  }
  await client.query(`UPDATE tenant.payment_reconciliation_imports SET status = 'COMMITTED', committed_by = $3, committed_at = now(), preview = preview || jsonb_build_object('batchIds', $4::jsonb)
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId, JSON.stringify(batchIds)]);
  await event(client, context, "payment_reconciliation_import", row.id, "payments.settlement.committed", { batches: batchIds.length });
  const fresh = (await client.query(`SELECT * FROM tenant.payment_reconciliation_imports WHERE id = $1`, [row.id])).rows[0];
  return { import: importView(fresh), batches: await batchesOf(client, context, batchIds) };
}

// ------------------------------------------------------------------ matching (deterministic)

async function insertMatch(client, context, values) {
  await client.query("SAVEPOINT payment_match");
  try {
    const row = (await client.query(
      `INSERT INTO tenant.payment_reconciliation_matches (organization_id, layer, internal_source_type, internal_source_id, external_source_type, external_source_id, matched_amount, currency_code,
         match_type, match_rule, status, reason, evidence, idempotency_key, matched_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15) RETURNING *`,
      [context.organizationId, values.layer, values.internalType, values.internalId, values.externalType, values.externalId, out(values.amount), values.currency ?? "INR", values.matchType ?? "AUTO",
        values.rule, values.status ?? "ACTIVE", values.reason ?? null, JSON.stringify(values.evidence ?? []), values.idempotencyKey ?? null, context.userId])).rows[0];
    await client.query("RELEASE SAVEPOINT payment_match");
    return row;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT payment_match");
    if (error?.code === "23514" && /use more than/.test(String(error.message))) return null;
    throw error;
  }
}

// A settlement payment line: the internal payment with exactly this provider transaction id (or reference / UTR / approval code), in this
// merchant account, in this currency, for this amount — unique, or nothing is matched.
async function matchPaymentLine(client, context, merchant, batch, line) {
  const ids = [line.provider_transaction_id, line.provider_reference].filter(Boolean);
  const candidates = (await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id = $1 AND payment_method <> 'cash'
        AND (provider_reference = ANY($2::text[]) OR provider_transaction_reference = ANY($2::text[]) OR external_reference = ANY($2::text[]) OR id::text = ANY($2::text[]))
        AND (status = ANY($3::text[]) OR (status = 'pending' AND attempt_status = 'externally_attested'))`,
    [context.organizationId, ids, APPLIED])).rows;
  const base = { layer: "PROVIDER_PAYMENT", sourceType: "payment_settlement_line", sourceId: line.id, merchantAccountId: merchant.id, currency: line.currency_code,
    references: { settlementId: batch.provider_settlement_id, transactionId: line.provider_transaction_id, reference: line.provider_reference } };
  if (!candidates.length) {
    // Only proposals: same amount, same merchant, within a day — never matched on amount alone.
    const proposals = (await client.query(
      `SELECT id FROM tenant.pos_payments WHERE organization_id = $1 AND payment_method <> 'cash' AND amount = $2 AND provider_key = $3
          AND COALESCE(NULLIF(btrim(merchant_account_reference), ''), 'DEFAULT') = $4 AND initiated_at BETWEEN COALESCE($5::timestamptz, now()) - interval '1 day' AND COALESCE($5::timestamptz, now()) + interval '1 day'
        LIMIT 5`, [context.organizationId, line.gross_amount, merchant.provider_key, merchant.merchant_account_reference, line.transaction_at])).rows.map((row) => row.id);
    await raise(client, context, { ...base, code: "PAYMENT_MISSING_INTERNAL", actual: line.gross_amount, exposure: line.gross_amount, references: { ...base.references, candidates: proposals } });
    return null;
  }
  if (candidates.length > 1) {
    await raise(client, context, { ...base, code: "PAYMENT_DUPLICATE", actual: line.gross_amount, exposure: line.gross_amount, references: { ...base.references, candidates: candidates.map((row) => row.id) } });
    return null;
  }
  const payment = candidates[0];
  if (merchantKeyOf(payment) !== `${merchant.provider_key}|${merchant.merchant_account_reference}`) {
    await raise(client, context, { ...base, code: "MERCHANT_ACCOUNT_MISMATCH", storeId: payment.store_id, expected: payment.amount, actual: line.gross_amount,
      references: { ...base.references, paymentId: payment.id, paymentMerchant: merchantKeyOf(payment) } });
    return null;
  }
  if ((payment.currency_code ?? "INR").trim() !== line.currency_code) {
    await raise(client, context, { ...base, code: "PAYMENT_CURRENCY_MISMATCH", storeId: payment.store_id, expected: payment.amount, actual: line.gross_amount, references: { ...base.references, paymentId: payment.id } });
    return null;
  }
  if (dec(payment.amount) !== dec(line.gross_amount)) {
    await raise(client, context, { ...base, code: "PAYMENT_AMOUNT_MISMATCH", storeId: payment.store_id, expected: payment.amount, actual: line.gross_amount,
      difference: sub(dec(line.gross_amount), dec(payment.amount)), exposure: sub(dec(line.gross_amount), dec(payment.amount)), references: { ...base.references, paymentId: payment.id } });
    return null;
  }
  const match = await insertMatch(client, context, { layer: "PAYMENT_SETTLEMENT", internalType: "pos_payment", internalId: payment.id, externalType: "payment_settlement_line", externalId: line.id,
    amount: dec(line.gross_amount), currency: line.currency_code, rule: "EXACT_PROVIDER_TRANSACTION_ID", evidence: [{ kind: "settlement_line", settlementId: batch.provider_settlement_id }] });
  if (!match) {
    await raise(client, context, { ...base, code: "PAYMENT_DUPLICATE", storeId: payment.store_id, actual: line.gross_amount, exposure: line.gross_amount,
      references: { ...base.references, paymentId: payment.id, note: "This payment is already settled in another report." } });
    return null;
  }
  await applySettlementToPayment(client, context, payment, line, batch);
  return match;
}

// The payment's own settlement fields; a standalone-terminal or static-QR payment the provider's settlement now confirms is verified by that
// evidence (the match and its rule say so).
async function applySettlementToPayment(client, context, payment, line, batch) {
  await client.query(`UPDATE tenant.pos_payments SET settlement_status = 'settled', settled_amount = $3, settlement_fee_amount = $4, settled_at = COALESCE($5::timestamptz, $6::date::timestamptz),
      updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, payment.id, line.gross_amount, out(add(dec(line.fee_amount), dec(line.fee_tax_amount))), line.transaction_at, batch.settlement_date]);
  if (payment.attempt_status === "externally_attested" || payment.verification_status === "externally_attested") {
    await client.query(`UPDATE tenant.pos_payments SET verification_status = 'provider_verified', attempt_status = 'captured', status = CASE WHEN status = 'pending' THEN 'captured' ELSE status END,
        captured_at = COALESCE(captured_at, $3::date::timestamptz), display_message = 'Confirmed by the provider settlement.', updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, payment.id, batch.settlement_date]);
    await event(client, context, "payment", payment.id, "payments.reconciliation.verified_by_settlement", { settlementId: batch.provider_settlement_id, lineId: line.id });
  }
  await clearCondition(client, context, "SETTLEMENT_MISSING", "pos_payment", payment.id, `Settled in ${batch.provider_settlement_id}`);
  await clearCondition(client, context, "PAYMENT_MISSING_PROVIDER", "pos_payment", payment.id, `Confirmed by settlement ${batch.provider_settlement_id}`);
}

// A settlement refund line: the refund component with this provider refund id, for this amount, that the refund service already reports as
// succeeded. A refund the provider settled but we still show as processing is an exception — the refund service, not reconciliation, records
// refund outcomes.
async function matchRefundLine(client, context, merchant, batch, line) {
  const ids = [line.provider_transaction_id, line.provider_reference].filter(Boolean);
  const candidates = (await client.query(
    `SELECT component.*, refund.store_id FROM tenant.payment_refund_components component JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND component.refund_method <> 'cash' AND (component.provider_refund_id = ANY($2::text[]) OR component.provider_reference = ANY($2::text[]))`,
    [context.organizationId, ids])).rows;
  const base = { layer: "REFUND", sourceType: "payment_settlement_line", sourceId: line.id, merchantAccountId: merchant.id, currency: line.currency_code,
    references: { settlementId: batch.provider_settlement_id, transactionId: line.provider_transaction_id } };
  if (candidates.length !== 1) {
    await raise(client, context, { ...base, code: candidates.length ? "REFUND_DUPLICATE" : "PAYMENT_MISSING_INTERNAL", actual: line.gross_amount, exposure: line.gross_amount,
      references: { ...base.references, candidates: candidates.map((row) => row.id) } });
    return null;
  }
  const component = candidates[0];
  const settled = component.status === "succeeded" ? dec(component.successful_amount) : decimal("0");
  if (settled !== dec(line.gross_amount)) {
    await raise(client, context, { ...base, code: "REFUND_AMOUNT_MISMATCH", storeId: component.store_id, expected: out(settled), actual: line.gross_amount,
      difference: sub(dec(line.gross_amount), settled), exposure: line.gross_amount, references: { ...base.references, refundComponentId: component.id, refundStatus: component.status } });
    return null;
  }
  const match = await insertMatch(client, context, { layer: "REFUND_SETTLEMENT", internalType: "payment_refund_component", internalId: component.id, externalType: "payment_settlement_line",
    externalId: line.id, amount: dec(line.gross_amount), currency: line.currency_code, rule: "EXACT_PROVIDER_REFUND_ID", evidence: [{ kind: "settlement_line", settlementId: batch.provider_settlement_id }] });
  if (!match) await raise(client, context, { ...base, code: "REFUND_DUPLICATE", storeId: component.store_id, actual: line.gross_amount, exposure: line.gross_amount });
  else await clearCondition(client, context, "REFUND_MISSING_PROVIDER", "payment_refund_component", component.id, `Settled in ${batch.provider_settlement_id}`);
  return match;
}

// A payout's status from its lines and figures: mismatched (net or fees differ, a line differs), partially matched (lines still open), or
// awaiting its bank receipt (and bank-matched once Finance's bank shows the whole net).
async function evaluateBatch(client, context, batchId) {
  const batch = (await client.query(`SELECT * FROM tenant.payment_settlement_batches WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, batchId])).rows[0];
  const lines = (await client.query(
    `SELECT line.id, line.line_type, line.fee_amount, line.fee_tax_amount,
            EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = line.organization_id AND match.external_source_type = 'payment_settlement_line'
                     AND match.external_source_id = line.id AND match.status = 'ACTIVE') AS matched,
            EXISTS (SELECT 1 FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = line.organization_id AND exception.source_type = 'payment_settlement_line'
                     AND exception.source_id = line.id AND exception.status <> 'RESOLVED' AND exception.exception_code IN ('PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH', 'MERCHANT_ACCOUNT_MISMATCH',
                       'REFUND_AMOUNT_MISMATCH', 'PAYMENT_DUPLICATE', 'REFUND_DUPLICATE')) AS mismatched
       FROM tenant.payment_settlement_lines line WHERE line.organization_id = $1 AND line.batch_id = $2`, [context.organizationId, batch.id])).rows;
  const merchant = await loadMerchant(client, context, batch.merchant_account_id);
  let netMismatch = false;
  if (batch.reported_net_amount !== null && dec(batch.reported_net_amount) !== dec(batch.calculated_net_amount)) {
    netMismatch = true;
    await raise(client, context, { code: "SETTLEMENT_AMOUNT_MISMATCH", layer: "SETTLEMENT", sourceType: "payment_settlement_batch", sourceId: batch.id, merchantAccountId: merchant.id,
      currency: batch.currency_code, expected: batch.calculated_net_amount, actual: batch.reported_net_amount, difference: sub(dec(batch.reported_net_amount), dec(batch.calculated_net_amount)),
      exposure: sub(dec(batch.reported_net_amount), dec(batch.calculated_net_amount)), references: { settlementId: batch.provider_settlement_id } });
  }
  const preview = (await client.query(`SELECT preview FROM tenant.payment_reconciliation_imports WHERE id = $1`, [batch.import_id])).rows[0]?.preview;
  const payout = preview?.batches?.find((entry) => entry.settlementId === batch.provider_settlement_id)?.rows?.find((row) => row.type === "PAYOUT");
  if (payout && (payout.fee !== "0" || payout.feeTax !== "0")) {
    const declared = add(dec(payout.fee), dec(payout.feeTax));
    const computed = add(dec(batch.fee_amount), dec(batch.fee_tax_amount));
    if (declared !== computed) {
      await raise(client, context, { code: "SETTLEMENT_FEE_MISMATCH", layer: "SETTLEMENT", sourceType: "payment_settlement_batch", sourceId: batch.id, merchantAccountId: merchant.id,
        currency: batch.currency_code, expected: out(computed), actual: out(declared), difference: sub(declared, computed), exposure: sub(declared, computed), references: { settlementId: batch.provider_settlement_id } });
      netMismatch = true;
    }
  }
  const matchable = lines.filter((line) => ["PAYMENT", "REFUND"].includes(line.line_type));
  const status = batch.status === "BANK_MATCHED" ? "BANK_MATCHED" : netMismatch || matchable.some((line) => line.mismatched) ? "MISMATCHED"
    : matchable.every((line) => line.matched) ? "AWAITING_BANK_MATCH" : "PARTIALLY_MATCHED";
  await client.query(`UPDATE tenant.payment_settlement_batches SET status = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, batch.id, status]);
  return status;
}

// Bank receipts: Finance's bank statement lines on the merchant account's bank account that carry the payout reference — one line or several
// adding up to the net; a single line with that reference but another amount is a mismatch; nothing is received until the bank shows it.
export async function matchBankReceipts(client, context, { batchId = null } = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const batches = (await client.query(
    `SELECT batch.*, merchant.bank_account_id FROM tenant.payment_settlement_batches batch JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id
      WHERE batch.organization_id = $1 AND batch.status <> 'BANK_MATCHED' AND batch.bank_payout_reference IS NOT NULL AND merchant.bank_account_id IS NOT NULL ${batchId ? "AND batch.id = $2" : ""}
      ORDER BY batch.settlement_date`, batchId ? [context.organizationId, batchId] : [context.organizationId])).rows;
  let matched = 0;
  for (const batch of batches) {
    const lines = (await client.query(
      `SELECT line.*, line.credit_amount - COALESCE((SELECT sum(match.matched_amount) FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = line.organization_id
                AND match.external_source_type = 'accounting_bank_statement_line' AND match.external_source_id = line.id AND match.status <> 'REVERSED'), 0) AS available
         FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.organization_id = line.organization_id AND statement.id = line.bank_statement_id
        WHERE line.organization_id = $1 AND statement.bank_account_id = $2 AND line.credit_amount > 0
          AND (position($3 in COALESCE(line.reference, '')) > 0 OR position($3 in COALESCE(line.description, '')) > 0 OR line.external_id = $3)
        ORDER BY line.transaction_date, line.sequence`, [context.organizationId, batch.bank_account_id, batch.bank_payout_reference])).rows.filter((line) => dec(line.available) > 0n);
    const remaining = sub(dec(batch.calculated_net_amount), dec(batch.bank_matched_amount));
    if (!lines.length || remaining <= 0n) continue;
    const total = lines.reduce((sum, line) => add(sum, dec(line.available)), decimal("0"));
    if (total !== remaining) {
      await raise(client, context, { code: "BANK_RECEIPT_AMOUNT_MISMATCH", layer: "BANK", sourceType: "payment_settlement_batch", sourceId: batch.id, merchantAccountId: batch.merchant_account_id,
        currency: batch.currency_code, expected: out(remaining), actual: out(total), difference: sub(total, remaining), exposure: sub(total, remaining),
        references: { payoutReference: batch.bank_payout_reference, bankLines: lines.map((line) => line.id) } });
      continue;
    }
    for (const line of lines) {
      const match = await insertMatch(client, context, { layer: "BANK_RECEIPT", internalType: "payment_settlement_batch", internalId: batch.id, externalType: "accounting_bank_statement_line",
        externalId: line.id, amount: dec(line.available), currency: batch.currency_code, rule: lines.length > 1 ? "PAYOUT_REFERENCE_SPLIT_RECEIPTS" : "EXACT_PAYOUT_REFERENCE",
        evidence: [{ kind: "bank_statement_line", reference: line.reference, date: line.transaction_date }] });
      if (match) { matched += 1; await refreshBankLine(client, context, line.id); }
    }
    await refreshBatchBank(client, context, batch.id);
  }
  return { matched };
}

async function refreshBankLine(client, context, lineId) {
  await client.query(
    `UPDATE tenant.accounting_bank_statement_lines line SET match_status = CASE WHEN used.total >= GREATEST(line.credit_amount, line.debit_amount) THEN 'matched' WHEN used.total > 0 THEN 'partially_matched' ELSE 'unmatched' END
       FROM (SELECT COALESCE(sum(matched_amount), 0) AS total FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND external_source_type = 'accounting_bank_statement_line'
               AND external_source_id = $2 AND status = 'ACTIVE') used
      WHERE line.organization_id = $1 AND line.id = $2`, [context.organizationId, lineId]);
}

async function refreshBatchBank(client, context, batchId) {
  const total = (await client.query(`SELECT COALESCE(sum(matched_amount), 0)::text AS total FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND internal_source_type = 'payment_settlement_batch'
      AND internal_source_id = $2 AND layer = 'BANK_RECEIPT' AND status = 'ACTIVE'`, [context.organizationId, batchId])).rows[0].total;
  const batch = (await client.query(`SELECT * FROM tenant.payment_settlement_batches WHERE organization_id = $1 AND id = $2`, [context.organizationId, batchId])).rows[0];
  const full = dec(total) === dec(batch.calculated_net_amount);
  await client.query(`UPDATE tenant.payment_settlement_batches SET bank_matched_amount = $3, status = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, batchId, money(total), full ? "BANK_MATCHED" : batch.status === "BANK_MATCHED" ? "AWAITING_BANK_MATCH" : batch.status]);
  if (full) {
    await clearCondition(client, context, "BANK_RECEIPT_MISSING", "payment_settlement_batch", batchId, "Bank receipt matched");
    await clearCondition(client, context, "BANK_RECEIPT_AMOUNT_MISMATCH", "payment_settlement_batch", batchId, "Bank receipt matched in full");
  } else if (batch.status === "BANK_MATCHED") await evaluateBatch(client, context, batchId);
}

// Suggested matches for a record that has none: deterministic, with the rule and why — amount-and-date candidates are only ever proposals.
// input: externalType (payment_settlement_line | accounting_bank_statement_line), externalId.
export async function suggestReconciliationMatches(client, context, input = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  if (!UUID.test(String(input.externalId ?? ""))) throw reconError(400, "RECON_MATCH_INVALID");
  if (input.externalType === "payment_settlement_line") {
    const line = (await client.query(`SELECT line.*, merchant.provider_key, merchant.merchant_account_reference FROM tenant.payment_settlement_lines line
        JOIN tenant.payment_merchant_accounts merchant ON merchant.id = line.merchant_account_id WHERE line.organization_id = $1 AND line.id = $2`, [context.organizationId, input.externalId])).rows[0];
    if (!line) throw reconError(404, "RECON_NOT_FOUND");
    const rows = (await client.query(
      `SELECT payment.id, payment.amount::text AS amount, payment.payment_method, payment.provider_reference, payment.provider_transaction_reference, payment.initiated_at, payment.sale_id,
              (payment.provider_reference = $3 OR payment.provider_transaction_reference = $3 OR payment.external_reference = $3) AS same_reference
         FROM tenant.pos_payments payment
        WHERE payment.organization_id = $1 AND payment.payment_method <> 'cash' AND payment.amount = $2 AND payment.provider_key = $4
          AND (payment.initiated_at BETWEEN COALESCE($5::timestamptz, now()) - interval '2 days' AND COALESCE($5::timestamptz, now()) + interval '2 days' OR payment.provider_reference = $3)
        ORDER BY same_reference DESC, abs(extract(epoch FROM payment.initiated_at - COALESCE($5::timestamptz, now()))) LIMIT 10`,
      [context.organizationId, line.gross_amount, line.provider_reference ?? line.provider_transaction_id, line.provider_key, line.transaction_at])).rows;
    return rows.map((row) => ({ internalType: "pos_payment", internalId: row.id, amount: money(row.amount), method: row.payment_method, reference: row.provider_reference ?? row.provider_transaction_reference,
      at: row.initiated_at, rule: row.same_reference ? "SAME_REFERENCE" : "AMOUNT_AND_DATE_ONLY", automatic: false, sale: row.sale_id }));
  }
  if (input.externalType === "accounting_bank_statement_line") {
    const line = (await client.query(`SELECT * FROM tenant.accounting_bank_statement_lines WHERE organization_id = $1 AND id = $2`, [context.organizationId, input.externalId])).rows[0];
    if (!line) throw reconError(404, "RECON_NOT_FOUND");
    return (await client.query(
      `SELECT id, provider_settlement_id, bank_payout_reference, calculated_net_amount::text AS net, bank_matched_amount::text AS matched, settlement_date FROM tenant.payment_settlement_batches
        WHERE organization_id = $1 AND status <> 'BANK_MATCHED' AND settlement_date BETWEEN $2::date - 7 AND $2::date + 1 ORDER BY abs(calculated_net_amount - bank_matched_amount - $3) LIMIT 10`,
      [context.organizationId, line.transaction_date, line.credit_amount])).rows.map((row) => ({ internalType: "payment_settlement_batch", internalId: row.id, settlementId: row.provider_settlement_id,
      payoutReference: row.bank_payout_reference, remaining: out(sub(dec(row.net), dec(row.matched))), date: row.settlement_date, rule: "AMOUNT_AND_DATE_ONLY", automatic: false }));
  }
  throw reconError(400, "RECON_MATCH_INVALID");
}

const MANUAL_LAYERS = {
  "pos_payment|payment_settlement_line": "PAYMENT_SETTLEMENT",
  "payment_refund_component|payment_settlement_line": "REFUND_SETTLEMENT",
  "payment_settlement_batch|accounting_bank_statement_line": "BANK_RECEIPT",
};

// A manual match — what a Finance user establishes from evidence, never a cashier marking a payment successful: both records, an amount within
// what each still holds (the database enforces it), the same company, merchant account and currency, a reason and evidence. Above the
// company's threshold (or for less than either record's full amount) it waits for a second person's approval. input: internalType,
// internalId, externalType, externalId, amount, reason, evidence[], idempotencyKey.
export async function applyManualMatch(client, context, input = {}) {
  if (!mayManage(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const layer = MANUAL_LAYERS[`${input.internalType}|${input.externalType}`];
  if (!layer || !UUID.test(String(input.internalId ?? "")) || !UUID.test(String(input.externalId ?? ""))) throw reconError(400, "RECON_MATCH_INVALID");
  const key = text(input.idempotencyKey, 120);
  if (key) {
    const replay = (await client.query(`SELECT * FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (replay) return matchView(replay);
  }
  const reason = text(input.reason);
  const evidence = Array.isArray(input.evidence) ? input.evidence.map((item) => ({ kind: text(item?.kind, 40) ?? "note", reference: text(item?.reference, 200), note: text(item?.note, 300) })).filter((item) => item.reference || item.note) : [];
  if (!reason || !evidence.length) throw reconError(400, "RECON_MATCH_INVALID", "A manual match needs a reason and at least one piece of evidence.");
  const amount = String(input.amount ?? "").trim();
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(amount) || dec(amount) <= 0n) throw reconError(400, "RECON_MATCH_INVALID", "Give the matched amount.");
  // The two sides must belong together: same company (RLS), same merchant account, same currency.
  let internalAmount; let externalAmount; let currency; let merchantOk = true;
  if (input.externalType === "payment_settlement_line") {
    const line = (await client.query(`SELECT line.*, merchant.provider_key, merchant.merchant_account_reference FROM tenant.payment_settlement_lines line
        JOIN tenant.payment_merchant_accounts merchant ON merchant.id = line.merchant_account_id WHERE line.organization_id = $1 AND line.id = $2`, [context.organizationId, input.externalId])).rows[0];
    if (!line) throw reconError(404, "RECON_NOT_FOUND");
    externalAmount = dec(line.gross_amount); currency = line.currency_code;
    if (input.internalType === "pos_payment") {
      const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id = $1 AND id = $2`, [context.organizationId, input.internalId])).rows[0];
      if (!payment) throw reconError(404, "RECON_NOT_FOUND");
      merchantOk = merchantKeyOf(payment) === `${line.provider_key}|${line.merchant_account_reference}`;
      internalAmount = dec(payment.amount);
      if ((payment.currency_code ?? "INR").trim() !== currency) throw reconError(409, "RECON_MATCH_INVALID", "The currencies differ.");
      if (line.line_type !== "PAYMENT") throw reconError(409, "RECON_MATCH_INVALID", "A payment matches a payment line.");
    } else {
      const component = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id = $1 AND id = $2`, [context.organizationId, input.internalId])).rows[0];
      if (!component) throw reconError(404, "RECON_NOT_FOUND");
      if (component.status !== "succeeded") throw reconError(409, "RECON_MATCH_INVALID", "Only a refund the refund service reports as succeeded can be matched.");
      internalAmount = dec(component.successful_amount);
      if (line.line_type !== "REFUND") throw reconError(409, "RECON_MATCH_INVALID", "A refund matches a refund line.");
    }
  } else {
    const line = (await client.query(`SELECT line.*, statement.bank_account_id FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id
        WHERE line.organization_id = $1 AND line.id = $2`, [context.organizationId, input.externalId])).rows[0];
    const batch = (await client.query(`SELECT batch.*, merchant.bank_account_id FROM tenant.payment_settlement_batches batch JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id
        WHERE batch.organization_id = $1 AND batch.id = $2`, [context.organizationId, input.internalId])).rows[0];
    if (!line || !batch) throw reconError(404, "RECON_NOT_FOUND");
    if (!(dec(line.credit_amount) > 0n)) throw reconError(409, "RECON_MATCH_INVALID", "A payout matches a bank credit.");
    merchantOk = !batch.bank_account_id || batch.bank_account_id === line.bank_account_id;
    internalAmount = dec(batch.calculated_net_amount); externalAmount = dec(line.credit_amount); currency = batch.currency_code;
  }
  if (!merchantOk) throw reconError(409, "RECON_MATCH_INVALID", "These records belong to different merchant or bank accounts.");
  const policy = await policyOf(client, context);
  const partial = dec(amount) !== internalAmount || dec(amount) !== externalAmount;
  const material = partial || (policy.manualApprovalAbove !== null && dec(amount) > policy.manualApprovalAbove);
  const row = await insertMatch(client, context, { layer, internalType: input.internalType, internalId: input.internalId, externalType: input.externalType, externalId: input.externalId,
    amount: dec(amount), currency, matchType: "MANUAL", rule: partial ? "MANUAL_PARTIAL" : "MANUAL_EVIDENCE", status: material ? "PENDING_APPROVAL" : "ACTIVE", reason, evidence, idempotencyKey: key });
  if (!row) throw reconError(409, "RECON_MATCH_CAPACITY");
  await event(client, context, "payment_reconciliation_match", row.id, "payments.reconciliation.manual_match", { layer, amount, material });
  if (!material) await afterMatch(client, context, row);
  return matchView(row);
}

// A material manual match takes effect once someone other than its author approves it.
export async function approveManualMatch(client, context, matchId, input = {}) {
  if (!mayApprove(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, matchId])).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  if (row.status !== "PENDING_APPROVAL") throw reconError(409, "RECON_EXCEPTION_STATE", "This match is not waiting for approval.");
  if (row.matched_by === context.userId) throw reconError(403, "RECON_SELF_APPROVAL");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version)) throw reconError(409, "RECON_VERSION_CONFLICT");
  const updated = (await client.query(`UPDATE tenant.payment_reconciliation_matches SET status = 'ACTIVE', approved_by = $3, approved_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, row.id, context.userId])).rows[0];
  await event(client, context, "payment_reconciliation_match", row.id, "payments.reconciliation.match_approved", {});
  await afterMatch(client, context, updated);
  return matchView(updated);
}

// Reverse a wrong match (an audited correction): the evidence stays, the match is marked reversed with who and why, and the records it touched
// are re-evaluated. input: reason, expectedVersion?.
export async function reverseMatch(client, context, matchId, input = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, matchId])).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  if (row.status === "REVERSED") throw reconError(409, "RECON_EXCEPTION_STATE", "This match is already reversed.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version)) throw reconError(409, "RECON_VERSION_CONFLICT");
  const reason = text(input.reason);
  if (!reason) throw reconError(400, "RECON_MATCH_INVALID", "Say why the match is wrong.");
  const updated = (await client.query(`UPDATE tenant.payment_reconciliation_matches SET status = 'REVERSED', reversed_by = $3, reversed_at = now(), reversal_reason = $4 WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, row.id, context.userId, reason])).rows[0];
  if (row.internal_source_type === "pos_payment" && row.status === "ACTIVE") {
    await client.query(`UPDATE tenant.pos_payments SET settlement_status = 'pending', settled_amount = 0, settlement_fee_amount = 0, settled_at = NULL, updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND NOT EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND internal_source_id = $2 AND status = 'ACTIVE')`,
      [context.organizationId, row.internal_source_id]);
  }
  if (row.external_source_type === "accounting_bank_statement_line") await refreshBankLine(client, context, row.external_source_id);
  if (row.internal_source_type === "payment_settlement_batch") await refreshBatchBank(client, context, row.internal_source_id);
  if (row.external_source_type === "payment_settlement_line") {
    const line = (await client.query(`SELECT batch_id FROM tenant.payment_settlement_lines WHERE id = $1`, [row.external_source_id])).rows[0];
    if (line) await evaluateBatch(client, context, line.batch_id);
  }
  await event(client, context, "payment_reconciliation_match", row.id, "payments.reconciliation.match_reversed", { reason });
  return matchView(updated);
}

// After a match takes effect: the payment's settlement fields, the bank line and payout totals, the batch status — and exceptions whose
// subject is now matched are resolved with the match as their evidence.
async function afterMatch(client, context, match) {
  if (match.layer === "PAYMENT_SETTLEMENT") {
    const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE id = $1`, [match.internal_source_id])).rows[0];
    const line = (await client.query(`SELECT * FROM tenant.payment_settlement_lines WHERE id = $1`, [match.external_source_id])).rows[0];
    const batch = (await client.query(`SELECT * FROM tenant.payment_settlement_batches WHERE id = $1`, [line.batch_id])).rows[0];
    await applySettlementToPayment(client, context, payment, line, batch);
  }
  if (match.external_source_type === "accounting_bank_statement_line") await refreshBankLine(client, context, match.external_source_id);
  if (match.internal_source_type === "payment_settlement_batch") await refreshBatchBank(client, context, match.internal_source_id);
  for (const exception of (await client.query(`SELECT id FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND status <> 'RESOLVED'
      AND ((source_type = $2 AND source_id = $3) OR (source_type = $4 AND source_id = $5)) AND exception_code IN ('PAYMENT_MISSING_INTERNAL', 'PAYMENT_DUPLICATE', 'SETTLEMENT_MISSING',
        'PAYMENT_MISSING_PROVIDER', 'BANK_RECEIPT_MISSING', 'BANK_RECEIPT_AMOUNT_MISMATCH', 'REFUND_MISSING_PROVIDER')`,
    [context.organizationId, match.external_source_type, match.external_source_id, match.internal_source_type, match.internal_source_id])).rows) {
    await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET status = 'RESOLVED', resolution_type = 'MATCHED_WITH_EVIDENCE', resolution_reference = $3, resolution_note = $4, resolved_by = $5,
        resolved_at = now(), evidence = evidence || $6::jsonb WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, exception.id, match.id, `Matched (${match.match_rule})${match.reason ? `: ${match.reason}` : ""}`, context.userId, JSON.stringify(match.evidence ?? [])]);
  }
  if (match.external_source_type === "payment_settlement_line") {
    const line = (await client.query(`SELECT batch_id FROM tenant.payment_settlement_lines WHERE id = $1`, [match.external_source_id])).rows[0];
    await evaluateBatch(client, context, line.batch_id);
  }
}

function matchView(row) {
  return { id: row.id, layer: row.layer, internalType: row.internal_source_type, internalId: row.internal_source_id, externalType: row.external_source_type, externalId: row.external_source_id,
    amount: money(row.matched_amount), currency: row.currency_code, matchType: row.match_type, rule: row.match_rule, status: row.status, reason: row.reason, evidence: row.evidence,
    matchedBy: row.matched_by, matchedAt: row.matched_at, approvedBy: row.approved_by, reversedAt: row.reversed_at, reversalReason: row.reversal_reason, version: row.version };
}

// ------------------------------------------------------------------ Finance: the settlement journal (through Accounting)

const CLEARING_KEY = { card: "pos_card_clearing", upi: "pos_upi_clearing", wallet: "pos_wallet_clearing", bank_transfer: "bank" };

// Post a payout once its bank receipt is matched: clearing is relieved by the gross receipts, refunds deducted put clearing back, fees and tax on
// fees are expenses, chargebacks go to their clearing, signed adjustments to unapplied collections, and the net is the bank receipt — never
// the sale's figures. Once only (a retry after a failure posts the same journal, never a second one); a failure is a Finance exception.
export async function postSettlementToFinance(client, context, batchId) {
  if (!mayWork(context) && !can(context, "pos.accounting.post")) throw reconError(403, "RECON_PERMISSION_DENIED");
  const batch = (await client.query(`SELECT batch.*, merchant.bank_account_id, merchant.payment_methods, merchant.provider_key FROM tenant.payment_settlement_batches batch
      JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id WHERE batch.organization_id = $1 AND batch.id = $2 FOR UPDATE OF batch`, [context.organizationId, batchId])).rows[0];
  if (!batch) throw reconError(404, "RECON_NOT_FOUND");
  if (batch.finance_status === "POSTED") return { posted: true, replayed: true, journalEntryId: batch.finance_journal_entry_id };
  if (batch.status !== "BANK_MATCHED") throw reconError(409, "RECON_FINANCE_NOT_READY");
  const accountingContext = posAccountingContext(context);
  await client.query("SAVEPOINT payment_settlement_posting");
  try {
    const ledger = await getPrimaryLedger(client, accountingContext);
    const date = String(batch.settlement_date instanceof Date ? `${batch.settlement_date.getFullYear()}-${String(batch.settlement_date.getMonth() + 1).padStart(2, "0")}-${String(batch.settlement_date.getDate()).padStart(2, "0")}` : batch.settlement_date).slice(0, 10);
    const account = async (key) => (await getAccountMapping(client, accountingContext, ledger.id, key, { date })).account_id;
    // Gross and refunds by tender, from the matched payments (unmatched lines use the merchant account's first method).
    const byMethod = (await client.query(
      `SELECT COALESCE(payment.payment_method, component.refund_method, $3) AS method, line.line_type, COALESCE(sum(line.gross_amount), 0)::text AS amount
         FROM tenant.payment_settlement_lines line
         LEFT JOIN tenant.payment_reconciliation_matches match ON match.organization_id = line.organization_id AND match.external_source_type = 'payment_settlement_line' AND match.external_source_id = line.id
              AND match.status = 'ACTIVE'
         LEFT JOIN tenant.pos_payments payment ON payment.id = match.internal_source_id AND match.internal_source_type = 'pos_payment'
         LEFT JOIN tenant.payment_refund_components component ON component.id = match.internal_source_id AND match.internal_source_type = 'payment_refund_component'
        WHERE line.organization_id = $1 AND line.batch_id = $2 AND line.line_type IN ('PAYMENT', 'REFUND') GROUP BY 1, 2`, [context.organizationId, batch.id, batch.payment_methods?.[0] ?? "card"])).rows;
    const lines = [];
    const push = (accountId, debit, credit, description) => { if (dec(debit) > 0n || dec(credit) > 0n) lines.push({ accountId, description, debit: out(dec(debit)), credit: out(dec(credit)),
      referenceType: "payment_settlement_batch", referenceId: batch.id }); };
    for (const row of byMethod) {
      const clearing = await account(CLEARING_KEY[row.method] ?? "pos_card_clearing");
      if (row.line_type === "PAYMENT") push(clearing, "0", row.amount, `${row.method.toUpperCase()} settled — ${batch.provider_settlement_id}`);
      else push(clearing, row.amount, "0", `${row.method.toUpperCase()} refunds deducted — ${batch.provider_settlement_id}`);
    }
    push(await account("pos_payment_processing_fees"), batch.fee_amount, "0", `Provider fees — ${batch.provider_settlement_id}`);
    if (dec(batch.fee_tax_amount) > 0n) push(await account("pos_payment_fee_tax"), batch.fee_tax_amount, "0", `Tax on provider fees — ${batch.provider_settlement_id}`);
    if (dec(batch.chargeback_amount) > 0n) push(await account("pos_chargeback_clearing"), batch.chargeback_amount, "0", `Chargebacks — ${batch.provider_settlement_id}`);
    const adjustment = dec(batch.adjustment_amount);
    if (adjustment !== 0n) {
      const suspense = await account("pos_unapplied_collections");
      if (adjustment > 0n) push(suspense, "0", out(adjustment), `Provider adjustment — ${batch.provider_settlement_id}`);
      else push(suspense, out(sub(decimal("0"), adjustment)), "0", `Provider adjustment — ${batch.provider_settlement_id}`);
    }
    const bankGl = batch.bank_account_id
      ? (await client.query(`SELECT gl_account_id FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND id = $2`, [context.organizationId, batch.bank_account_id])).rows[0]?.gl_account_id
      : await account("bank");
    push(bankGl, batch.calculated_net_amount, "0", `Bank receipt ${batch.bank_payout_reference ?? ""} — ${batch.provider_settlement_id}`.trim());
    const journalId = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type IN ('bank', 'general') AND status = 'active'
        ORDER BY (journal_type = 'bank') DESC, created_at LIMIT 1`, [context.organizationId, ledger.id])).rows[0]?.id;
    if (!journalId) throw new Error("A bank or general journal is not configured.");
    const journal = await createJournalEntry(client, accountingContext, { ledgerId: ledger.id, journalId, entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
      reference: batch.provider_settlement_id, description: `Provider settlement ${batch.provider_settlement_id}`, currencyCode: batch.currency_code, lines },
    { internal: true, sourceModule: "point_of_sale", sourceType: "payment_settlement_batch", sourceId: batch.id, sourceNumber: batch.provider_settlement_id });
    await postJournalEntry(client, accountingContext, journal.entry.id, { internal: true, allowDraft: true });
    await client.query("RELEASE SAVEPOINT payment_settlement_posting");
    await client.query(`UPDATE tenant.payment_settlement_batches SET finance_status = 'POSTED', finance_journal_entry_id = $3, finance_error = NULL, finance_attempts = finance_attempts + 1
        WHERE organization_id = $1 AND id = $2`, [context.organizationId, batch.id, journal.entry.id]);
    await clearCondition(client, context, "FINANCE_POSTING_MISSING", "payment_settlement_batch", batch.id, `Posted as journal ${journal.entry.id}`);
    await event(client, context, "payment_settlement_batch", batch.id, "payments.settlement.posted", { journalEntryId: journal.entry.id });
    return { posted: true, replayed: false, journalEntryId: journal.entry.id };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT payment_settlement_posting");
    const message = String(error?.message ?? error).slice(0, 500);
    await recordPostingFailure(client, context, { postingEvent: "payment_settlement_batch", sourceModule: "point_of_sale", sourceType: "payment_settlement_batch", sourceId: batch.id,
      sourceNumber: batch.provider_settlement_id, transactionDate: batch.settlement_date, amount: batch.calculated_net_amount, currencyCode: batch.currency_code }, error);
    await client.query(`UPDATE tenant.payment_settlement_batches SET finance_status = 'FAILED', finance_error = $3, finance_attempts = finance_attempts + 1 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, batch.id, message]);
    await raise(client, context, { code: "FINANCE_POSTING_MISSING", layer: "FINANCE", sourceType: "payment_settlement_batch", sourceId: batch.id, merchantAccountId: batch.merchant_account_id,
      currency: batch.currency_code, expected: batch.calculated_net_amount, exposure: batch.calculated_net_amount, references: { settlementId: batch.provider_settlement_id, error: message } });
    return { posted: false, replayed: false, message };
  }
}

// ------------------------------------------------------------------ detection and runs

// One pass over a window: ask the provider about live attempts (never assuming an outcome), then find what does not reconcile — and resolve
// exceptions whose condition the system can now see is gone.
async function detect(client, context, window, policy, counters) {
  const org = context.organizationId;
  const found = new Map();
  const note = async (values) => { found.set(`${values.code}|${values.sourceType}|${values.sourceId}`, true); const result = await raise(client, context, values); if (result.created) counters.exceptions += 1; };
  // Provider inquiry for attempts still in flight (the card / UPI service applies the answer and recovers a paid but unfinished checkout).
  for (const row of (await client.query(
    `SELECT id FROM tenant.pos_payments WHERE organization_id = $1 AND payment_method <> 'cash' AND attempt_status = ANY($4::text[]) AND provider_key NOT IN ('standalone', 'static_qr')
        AND initiated_at >= $2 AND initiated_at < $3 LIMIT 200`, [org, window.from, window.to, LIVE_ATTEMPTS])).rows) {
    await client.query("SAVEPOINT payment_inquiry");
    try { await getPosCardAttempt(client, context, row.id); counters.inquiries += 1; await client.query("RELEASE SAVEPOINT payment_inquiry"); }
    catch { await client.query("ROLLBACK TO SAVEPOINT payment_inquiry"); }
  }
  const payments = (await client.query(
    `SELECT payment.*, (SELECT count(*)::int FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = payment.organization_id AND match.internal_source_type = 'pos_payment'
              AND match.internal_source_id = payment.id AND match.status = 'ACTIVE') AS settlement_matches,
            merchant.id AS merchant_id, COALESCE(merchant.settlement_expected_days, 3) AS expected_days
       FROM tenant.pos_payments payment
       LEFT JOIN tenant.payment_merchant_accounts merchant ON merchant.organization_id = payment.organization_id AND merchant.provider_key = payment.provider_key
            AND merchant.merchant_account_reference = COALESCE(NULLIF(btrim(payment.merchant_account_reference), ''), 'DEFAULT')
      WHERE payment.organization_id = $1 AND payment.initiated_at >= $2 AND payment.initiated_at < $3`, [org, window.from, window.to])).rows;
  const now = Date.now();
  for (const payment of payments) {
    counters.processed += 1;
    const base = { sourceType: "pos_payment", sourceId: payment.id, storeId: payment.store_id, merchantAccountId: payment.merchant_id, currency: (payment.currency_code ?? "INR").trim(),
      references: { paymentId: payment.id, saleId: payment.sale_id, cartId: payment.cart_id, providerReference: payment.provider_reference } };
    if (payment.payment_method === "cash") continue;
    const age = now - new Date(payment.initiated_at).getTime();
    if ((LIVE_ATTEMPTS.includes(payment.attempt_status) || payment.attempt_status === "reconciliation_required") && age > policy.unknownAfterMinutes * 60000)
      await note({ ...base, code: "PAYMENT_STATUS_UNKNOWN", layer: "PROVIDER_PAYMENT", actual: payment.amount, exposure: payment.amount });
    if (payment.status === "captured" && !payment.sale_id && !["refunded", "resolved"].includes(payment.recovery_status ?? "") && age > policy.unknownAfterMinutes * 60000)
      await note({ ...base, code: "PAYMENT_UNAPPLIED", layer: "CHECKOUT", actual: payment.amount, exposure: payment.amount });
    const days = Number(payment.expected_days) * 86400000;
    if (payment.settlement_matches === 0 && age > days && (APPLIED.includes(payment.status) || payment.attempt_status === "externally_attested")) {
      if (payment.verification_status === "externally_attested") await note({ ...base, code: "PAYMENT_MISSING_PROVIDER", layer: "PROVIDER_PAYMENT", actual: payment.amount, exposure: payment.amount });
      else if (payment.sale_id) await note({ ...base, code: "SETTLEMENT_MISSING", layer: "SETTLEMENT", expected: payment.amount, exposure: payment.amount });
    }
    if (dec(payment.refunded_amount) > dec(payment.amount))
      await note({ ...base, code: "REFUND_DUPLICATE", layer: "REFUND", expected: payment.amount, actual: payment.refunded_amount, exposure: sub(dec(payment.refunded_amount), dec(payment.amount)) });
  }
  // The same provider transaction recorded as two applied payments.
  for (const row of (await client.query(
    `SELECT provider_reference, array_agg(id ORDER BY initiated_at) AS ids, max(amount)::text AS amount, max(store_id::text)::uuid AS store_id FROM tenant.pos_payments
      WHERE organization_id = $1 AND payment_method <> 'cash' AND provider_reference IS NOT NULL AND status = ANY($4::text[]) AND initiated_at >= $2 AND initiated_at < $3
      GROUP BY provider_reference HAVING count(*) > 1`, [org, window.from, window.to, APPLIED])).rows)
    await note({ code: "PAYMENT_DUPLICATE", layer: "PROVIDER_PAYMENT", sourceType: "pos_payment", sourceId: row.ids[row.ids.length - 1], storeId: row.store_id, actual: row.amount, exposure: row.amount,
      references: { providerReference: row.provider_reference, payments: row.ids } });
  // Checkout: each completed sale is paid exactly by its applied tenders (change is never a tender; pending amounts never count).
  for (const sale of (await client.query(
    `SELECT sale.id, sale.store_id, sale.grand_total::text AS total, sale.cart_id, COALESCE((SELECT sum(payment.amount) FROM tenant.pos_payments payment WHERE payment.organization_id = sale.organization_id
              AND payment.sale_id = sale.id AND payment.status = ANY($4::text[])), 0)::text AS applied,
            COALESCE((SELECT sum(payment.amount) FROM tenant.pos_payments payment WHERE payment.organization_id = sale.organization_id AND payment.cart_id = sale.cart_id AND payment.status = 'captured'
              AND payment.sale_id IS NULL AND payment.payment_method <> 'cash' AND COALESCE(payment.recovery_status, '') NOT IN ('refunded', 'resolved')), 0)::text AS excess
       FROM tenant.pos_sales sale WHERE sale.organization_id = $1 AND sale.status IN ('completed', 'partially_returned', 'returned')
        AND COALESCE(sale.completed_at, sale.created_at) >= $2 AND COALESCE(sale.completed_at, sale.created_at) < $3`, [org, window.from, window.to, APPLIED])).rows) {
    const difference = sub(dec(sale.applied), dec(sale.total));
    if (difference !== 0n) await note({ code: "CHECKOUT_PAYMENT_MISMATCH", layer: "CHECKOUT", sourceType: "pos_sale", sourceId: sale.id, storeId: sale.store_id, expected: sale.total, actual: sale.applied,
      difference, exposure: difference, references: { saleId: sale.id } });
    if (dec(sale.excess) > 0n) await note({ code: "PAYMENT_DUPLICATE", layer: "CHECKOUT", sourceType: "pos_sale", sourceId: sale.id, storeId: sale.store_id, expected: sale.total, actual: out(add(dec(sale.applied), dec(sale.excess))),
      exposure: sale.excess, references: { saleId: sale.id, note: "Money collected beyond the bill" } });
  }
  // Refunds with the provider past their expected time.
  for (const row of (await client.query(
    `SELECT component.id, component.allocated_amount::text AS amount, refund.store_id FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND component.refund_method <> 'cash' AND component.status IN ('submitted', 'processing', 'unknown', 'pending')
        AND component.created_at < now() - make_interval(days => $4) AND component.created_at >= $2 AND component.created_at < $3`, [org, window.from, window.to, policy.refundOverdueDays])).rows)
    await note({ code: "REFUND_MISSING_PROVIDER", layer: "REFUND", sourceType: "payment_refund_component", sourceId: row.id, storeId: row.store_id, expected: row.amount, exposure: row.amount });
  // Payouts the bank has not shown within the merchant account's settlement time.
  for (const row of (await client.query(
    `SELECT batch.id, batch.merchant_account_id, batch.calculated_net_amount::text AS net, batch.bank_matched_amount::text AS matched, batch.currency_code FROM tenant.payment_settlement_batches batch
       JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id
      WHERE batch.organization_id = $1 AND batch.status <> 'BANK_MATCHED' AND batch.settlement_date < current_date - merchant.settlement_expected_days
        AND batch.settlement_date >= $2::date - 60`, [org, window.from])).rows)
    await note({ code: "BANK_RECEIPT_MISSING", layer: "BANK", sourceType: "payment_settlement_batch", sourceId: row.id, merchantAccountId: row.merchant_account_id, currency: row.currency_code,
      expected: row.net, actual: row.matched, exposure: sub(dec(row.net), dec(row.matched)) });
  // Cash: linked from the cash session's own difference cases (counted and approved there, never here).
  for (const row of (await client.query(
    `SELECT id, store_id, difference_amount::text AS amount FROM tenant.pos_cash_differences WHERE organization_id = $1 AND case_status <> 'RESOLVED' AND created_at >= $2 AND created_at < $3`,
    [org, window.from, window.to])).rows)
    await note({ code: "CASH_SESSION_VARIANCE", layer: "CASH", sourceType: "pos_cash_difference", sourceId: row.id, storeId: row.store_id, difference: row.amount, exposure: row.amount });
  // Finance: sales whose accounting failed, payouts whose journal failed.
  for (const row of (await client.query(
    `SELECT id, store_id, grand_total::text AS amount FROM tenant.pos_sales WHERE organization_id = $1 AND accounting_posting_status = 'failed' AND COALESCE(completed_at, created_at) >= $2 AND COALESCE(completed_at, created_at) < $3`,
    [org, window.from, window.to])).rows)
    await note({ code: "FINANCE_POSTING_MISSING", layer: "FINANCE", sourceType: "pos_sale", sourceId: row.id, storeId: row.store_id, exposure: row.amount });
  // Exceptions this pass can re-check and no longer finds are cleared (import-raised ones wait for a match or a person).
  const recheckable = ["PAYMENT_STATUS_UNKNOWN", "PAYMENT_UNAPPLIED", "SETTLEMENT_MISSING", "PAYMENT_MISSING_PROVIDER", "REFUND_MISSING_PROVIDER", "CHECKOUT_PAYMENT_MISMATCH", "CASH_SESSION_VARIANCE", "REFUND_DUPLICATE"];
  for (const row of (await client.query(
    `SELECT exception.id, exception.exception_code, exception.source_type, exception.source_id FROM tenant.payment_reconciliation_exceptions exception
      WHERE exception.organization_id = $1 AND exception.status <> 'RESOLVED' AND exception.exception_code = ANY($2::text[])
        AND COALESCE((SELECT payment.initiated_at FROM tenant.pos_payments payment WHERE payment.id = exception.source_id),
                     (SELECT COALESCE(sale.completed_at, sale.created_at) FROM tenant.pos_sales sale WHERE sale.id = exception.source_id),
                     (SELECT difference.created_at FROM tenant.pos_cash_differences difference WHERE difference.id = exception.source_id),
                     (SELECT component.created_at FROM tenant.payment_refund_components component WHERE component.id = exception.source_id)) BETWEEN $3 AND $4`,
    [org, recheckable, window.from, window.to])).rows) {
    if (found.has(`${row.exception_code}|${row.source_type}|${row.source_id}`)) continue;
    if (await clearCondition(client, context, row.exception_code, row.source_type, row.source_id, "No longer found by a reconciliation run")) counters.resolved += 1;
  }
}

// Each finalized Z report learns its reconciliation status (its figures never change): matched when its card / UPI payments are all settled with
// no open exception, exception when something on its sales is open, pending otherwise.
async function syncZReports(client, context, window) {
  for (const report of (await client.query(`SELECT id, lineage FROM tenant.pos_day_end_reports WHERE organization_id = $1 AND business_day_id IS NOT NULL AND finalized_at >= $2::timestamptz - interval '60 days'`,
    [context.organizationId, window.from])).rows) {
    const saleIds = Array.isArray(report.lineage?.saleIds) ? report.lineage.saleIds : [];
    if (!saleIds.length) continue;
    const state = (await client.query(
      `SELECT count(*) FILTER (WHERE payment.payment_method <> 'cash' AND NOT EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = payment.organization_id
                AND match.internal_source_type = 'pos_payment' AND match.internal_source_id = payment.id AND match.status = 'ACTIVE'))::int AS unsettled,
              (SELECT array_agg(exception.exception_number) FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = $1 AND exception.status <> 'RESOLVED'
                AND (exception.source_id = ANY($2::uuid[]) OR exception.source_id IN (SELECT id FROM tenant.pos_payments WHERE organization_id = $1 AND sale_id = ANY($2::uuid[])))) AS open
         FROM tenant.pos_payments payment WHERE payment.organization_id = $1 AND payment.sale_id = ANY($2::uuid[]) AND payment.status = ANY($3::text[])`,
      [context.organizationId, saleIds, APPLIED])).rows[0];
    const status = state.open?.length ? "exception" : state.unsettled === 0 ? "matched" : "pending";
    await client.query(`UPDATE tenant.pos_day_end_reports SET reconciliation_status = $3, reconciliation_references = $4::jsonb, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, report.id, status, JSON.stringify((state.open ?? []).map((number) => ({ type: "payment_reconciliation_exception", number })))]);
  }
}

// A reconciliation run over a window (default: the last 7 days): provider inquiry, detection, bank matching and Finance posting of bank-matched
// payouts, then the Z reports' status. Idempotent on its key. input: runType, merchantAccountId?, from?, to?, idempotencyKey.
export async function startReconciliationRun(client, context, input = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const key = text(input.idempotencyKey, 120);
  if (key) {
    const replay = (await client.query(`SELECT * FROM tenant.payment_reconciliation_runs WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (replay) return runView(replay);
  }
  const runType = ["ALL", "PAYMENT", "REFUND", "SETTLEMENT", "BANK"].includes(input.runType) ? input.runType : "ALL";
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 7 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw reconError(400, "RECON_MATCH_INVALID", "Choose a valid period.");
  const run = (await client.query(`INSERT INTO tenant.payment_reconciliation_runs (organization_id, merchant_account_id, run_type, period_start, period_end, idempotency_key, started_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [context.organizationId, UUID.test(String(input.merchantAccountId ?? "")) ? input.merchantAccountId : null, runType, from, to, key, context.userId])).rows[0];
  const counters = { processed: 0, matched: 0, exceptions: 0, resolved: 0, inquiries: 0, posted: 0 };
  await client.query("SAVEPOINT payment_reconciliation_run");
  try {
    const policy = await policyOf(client, context);
    if (["ALL", "PAYMENT", "REFUND", "SETTLEMENT"].includes(runType)) await detect(client, context, { from, to }, policy, counters);
    if (["ALL", "BANK", "SETTLEMENT"].includes(runType)) counters.matched += (await matchBankReceipts(client, context)).matched;
    if (["ALL", "BANK"].includes(runType)) {
      for (const batch of (await client.query(`SELECT id FROM tenant.payment_settlement_batches WHERE organization_id = $1 AND status = 'BANK_MATCHED' AND finance_status IN ('PENDING', 'FAILED')`,
        [context.organizationId])).rows) if ((await postSettlementToFinance(client, context, batch.id)).posted) counters.posted += 1;
    }
    await syncZReports(client, context, { from });
    await client.query("RELEASE SAVEPOINT payment_reconciliation_run");
    const done = (await client.query(`UPDATE tenant.payment_reconciliation_runs SET status = 'COMPLETED', processed_count = $3, matched_count = $4, exception_count = $5, resolved_count = $6, summary = $7::jsonb,
        finished_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [context.organizationId, run.id, counters.processed, counters.matched, counters.exceptions, counters.resolved, JSON.stringify(counters)])).rows[0];
    await event(client, context, "payment_reconciliation_run", run.id, "payments.reconciliation.run_completed", counters);
    return runView(done);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT payment_reconciliation_run");
    const failed = (await client.query(`UPDATE tenant.payment_reconciliation_runs SET status = 'FAILED', error = $3, finished_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [context.organizationId, run.id, String(error?.message ?? error).slice(0, 500)])).rows[0];
    return runView(failed);
  }
}

function runView(row) {
  return { id: row.id, runType: row.run_type, merchantAccountId: row.merchant_account_id, periodStart: row.period_start, periodEnd: row.period_end, status: row.status, processed: row.processed_count,
    matched: row.matched_count, exceptions: row.exception_count, resolved: row.resolved_count, summary: row.summary, error: row.error, startedAt: row.started_at, finishedAt: row.finished_at };
}

export async function getReconciliationRun(client, context, runId) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const row = UUID.test(String(runId ?? "")) ? (await client.query(`SELECT * FROM tenant.payment_reconciliation_runs WHERE organization_id = $1 AND id = $2`, [context.organizationId, runId])).rows[0] : null;
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  return runView(row);
}

// Runs left RUNNING (a lost worker or connection) are marked failed so they can be run again; nothing they did half-way was committed.
export async function recoverReconciliationRuns(client, context) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const rows = (await client.query(`UPDATE tenant.payment_reconciliation_runs SET status = 'FAILED', error = 'Interrupted — run again', finished_at = now()
      WHERE organization_id = $1 AND status = 'RUNNING' AND started_at < now() - interval '15 minutes' RETURNING id`, [context.organizationId])).rows;
  return { recovered: rows.length };
}

// ------------------------------------------------------------------ exception workflow

function exceptionView(row) {
  return { id: row.id, number: row.exception_number, code: row.exception_code, layer: row.layer, storeId: row.store_id, outlet: row.store_name ?? null, merchantAccountId: row.merchant_account_id,
    merchant: row.merchant_name ?? null, sourceType: row.source_type, sourceId: row.source_id, references: row.references_json, currency: row.currency_code, expected: money(row.expected_amount),
    actual: money(row.actual_amount), difference: money(row.difference_amount), exposure: money(row.exposure_amount), status: row.status, assignedTo: row.assignee_name ?? null,
    assignedToUserId: row.assigned_to, evidence: row.evidence, notes: row.notes, resolutionType: row.resolution_type, resolutionReference: row.resolution_reference, resolutionNote: row.resolution_note,
    approvalRequestedBy: row.approval_requested_by, approvedBy: row.approved_by, resolvedBy: row.resolver_name ?? null, resolvedAt: row.resolved_at, detectedAt: row.detected_at,
    ageDays: Math.floor((Date.now() - new Date(row.detected_at).getTime()) / 86400000), version: row.version };
}
const EXCEPTION_SELECT = `
  SELECT exception.*, store.name AS store_name, merchant.display_name AS merchant_name, assignee.full_name AS assignee_name, resolver.full_name AS resolver_name
    FROM tenant.payment_reconciliation_exceptions exception
    LEFT JOIN tenant.pos_stores store ON store.organization_id = exception.organization_id AND store.id = exception.store_id
    LEFT JOIN tenant.payment_merchant_accounts merchant ON merchant.id = exception.merchant_account_id
    LEFT JOIN public.users assignee ON assignee.id = exception.assigned_to
    LEFT JOIN public.users resolver ON resolver.id = exception.resolved_by`;

async function exceptionScope(client, context, filters) {
  const values = [context.organizationId];
  const where = ["exception.organization_id = $1"];
  const push = (value) => { values.push(value); return `$${values.length}`; };
  const outlets = await accessiblePosStoreIds(client, context);
  if (outlets) where.push(`(exception.store_id IS NULL OR exception.store_id = ANY(${push(outlets)}::uuid[]))`);
  const status = String(filters.status ?? "open");
  if (status === "open") where.push("exception.status <> 'RESOLVED'");
  else if (["OPEN", "ASSIGNED", "INVESTIGATING", "AWAITING_EXTERNAL_EVIDENCE", "ESCALATED", "RESOLVED"].includes(status)) where.push(`exception.status = ${push(status)}`);
  if (text(filters.code, 60)) where.push(`exception.exception_code = ${push(text(filters.code, 60))}`);
  if (text(filters.layer, 30)) where.push(`exception.layer = ${push(text(filters.layer, 30))}`);
  if (UUID.test(String(filters.storeId ?? ""))) where.push(`exception.store_id = ${push(filters.storeId)}`);
  if (UUID.test(String(filters.merchantAccountId ?? ""))) where.push(`exception.merchant_account_id = ${push(filters.merchantAccountId)}`);
  if (UUID.test(String(filters.assignedTo ?? ""))) where.push(`exception.assigned_to = ${push(filters.assignedTo)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`exception.detected_at >= ${push(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`exception.detected_at < ${push(filters.to)}::date + 1`);
  if (/^\d+$/.test(String(filters.minAgeDays ?? ""))) where.push(`exception.detected_at <= now() - make_interval(days => ${push(Number(filters.minAgeDays))})`);
  if (text(filters.q, 80)) where.push(`(exception.exception_number ILIKE ${push(`%${text(filters.q, 80)}%`)} OR exception.references_json::text ILIKE $${values.length})`);
  return { where: where.join(" AND "), values };
}

export async function listReconciliationExceptions(client, context, filters = {}) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const { where, values } = await exceptionScope(client, context, filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = (await client.query(`SELECT count(*)::int AS n FROM tenant.payment_reconciliation_exceptions exception WHERE ${where}`, values)).rows[0].n;
  return { total, rows: (await client.query(`${EXCEPTION_SELECT} WHERE ${where} ORDER BY exception.detected_at DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows.map(exceptionView) };
}

export async function getReconciliationException(client, context, exceptionId) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  if (!UUID.test(String(exceptionId ?? ""))) throw reconError(404, "RECON_NOT_FOUND");
  const { where, values } = await exceptionScope(client, context, { status: "all" });
  values.push(exceptionId);
  const row = (await client.query(`${EXCEPTION_SELECT} WHERE ${where} AND exception.id = $${values.length}`, values)).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  const matches = (await client.query(`SELECT * FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND ((internal_source_type = $2 AND internal_source_id = $3) OR (external_source_type = $2 AND external_source_id = $3))
      ORDER BY matched_at`, [context.organizationId, row.source_type, row.source_id])).rows.map(matchView);
  return { ...exceptionView(row), matches };
}

// Work an exception: assign, start investigating, wait for external evidence, escalate, add a note or a piece of evidence, or ask for the
// approval a material resolution needs. input: action, assignedTo?, note?, evidence?, proposal?, expectedVersion?.
export async function updateReconciliationException(client, context, exceptionId, input = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, exceptionId])).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  if (row.status === "RESOLVED") throw reconError(409, "RECON_EXCEPTION_STATE");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version)) throw reconError(409, "RECON_VERSION_CONFLICT");
  const note = text(input.note);
  const entry = (kind) => JSON.stringify([{ kind, note, by: context.userId, at: new Date().toISOString() }]);
  switch (input.action) {
    case "assign": {
      const assignee = UUID.test(String(input.assignedTo ?? "")) ? input.assignedTo : context.userId;
      await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET status = 'ASSIGNED', assigned_to = $3, notes = notes || $4::jsonb WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, assignee, entry("assigned")]);
      break;
    }
    case "investigate": case "await_evidence": case "escalate": {
      const status = { investigate: "INVESTIGATING", await_evidence: "AWAITING_EXTERNAL_EVIDENCE", escalate: "ESCALATED" }[input.action];
      await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET status = $3, assigned_to = COALESCE(assigned_to, $4), notes = notes || $5::jsonb WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, status, context.userId, entry(input.action)]);
      break;
    }
    case "note":
      if (!note) throw reconError(400, "RECON_RESOLUTION_INVALID", "Write the note.");
      await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET notes = notes || $3::jsonb WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, entry("note")]);
      break;
    case "evidence": {
      const reference = text(input.evidence?.reference, 200);
      if (!reference) throw reconError(400, "RECON_RESOLUTION_INVALID", "Give the evidence reference (statement line, provider ticket, document number …).");
      await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET evidence = evidence || $3::jsonb WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, JSON.stringify([{ kind: text(input.evidence?.kind, 40) ?? "document", reference, note: text(input.evidence?.note, 300), by: context.userId, at: new Date().toISOString() }])]);
      break;
    }
    case "request_approval":
      if (!note) throw reconError(400, "RECON_RESOLUTION_INVALID", "Describe the proposed resolution.");
      await client.query(`UPDATE tenant.payment_reconciliation_exceptions SET approval_requested_by = $3, approved_by = NULL, notes = notes || $4::jsonb WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, context.userId, entry("approval_requested")]);
      break;
    default: throw reconError(400, "RECON_EXCEPTION_STATE", "Unknown action.");
  }
  await event(client, context, "payment_reconciliation_exception", row.id, `payments.reconciliation.exception_${input.action}`, { note });
  return getReconciliationException(client, context, row.id);
}

const MATERIAL_RESOLUTIONS = ["ACCEPTED_DIFFERENCE", "DUPLICATE_IGNORED", "OTHER"];

// Resolve with what was done: a resolution type, a note, and evidence (or the reference of the correction, refund, match or provider fix). A
// note alone never closes it. Accepting a difference, ignoring a duplicate or "other" — and anything above the company's threshold — needs an
// approver other than the person who asked. Nothing here moves money: a correction is posted through Finance and referenced here.
// input: resolutionType, resolutionNote, resolutionReference?, evidence?, expectedVersion?.
export async function resolveReconciliationException(client, context, exceptionId, input = {}) {
  if (!mayWork(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, exceptionId])).rows[0];
  if (!row) throw reconError(404, "RECON_NOT_FOUND");
  if (row.status === "RESOLVED") throw reconError(409, "RECON_EXCEPTION_STATE");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version)) throw reconError(409, "RECON_VERSION_CONFLICT");
  const type = String(input.resolutionType ?? "").toUpperCase();
  const note = text(input.resolutionNote);
  const reference = text(input.resolutionReference, 200);
  const evidence = input.evidence && text(input.evidence.reference, 200) ? [{ kind: text(input.evidence.kind, 40) ?? "document", reference: text(input.evidence.reference, 200), note: text(input.evidence.note, 300) }] : [];
  if (!["MATCHED_WITH_EVIDENCE", "CHECKOUT_RECOVERED", "CUSTOMER_REFUNDED", "ACCEPTED_DIFFERENCE", "FINANCE_CORRECTION_POSTED", "PROVIDER_CORRECTED", "DUPLICATE_IGNORED", "OTHER"].includes(type) || !note)
    throw reconError(400, "RECON_RESOLUTION_INVALID");
  if (!reference && !evidence.length && !(row.evidence?.length)) throw reconError(400, "RECON_RESOLUTION_INVALID", "A resolution needs evidence or a reference — a note alone is not enough.");
  const policy = await policyOf(client, context);
  const exposure = row.exposure_amount === null ? decimal("0") : dec(row.exposure_amount);
  const absolute = exposure < 0n ? sub(decimal("0"), exposure) : exposure;
  const material = MATERIAL_RESOLUTIONS.includes(type) || (policy.manualApprovalAbove !== null && absolute > policy.manualApprovalAbove);
  if (material) {
    if (!mayApprove(context)) throw reconError(403, "RECON_MATCH_APPROVAL_REQUIRED", "This resolution needs an approver.");
    if (!row.approval_requested_by) throw reconError(409, "RECON_MATCH_APPROVAL_REQUIRED", "Ask for approval of this resolution first.");
    if (row.approval_requested_by === context.userId) throw reconError(403, "RECON_SELF_APPROVAL");
  }
  await client.query(
    `UPDATE tenant.payment_reconciliation_exceptions SET status = 'RESOLVED', resolution_type = $3, resolution_note = $4, resolution_reference = $5, evidence = evidence || $6::jsonb, resolved_by = $7,
            resolved_at = now(), approved_by = $8, approved_at = CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() END WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, type, note, reference, JSON.stringify(evidence), context.userId, material ? context.userId : null]);
  await event(client, context, "payment_reconciliation_exception", row.id, "payments.reconciliation.exception_resolved", { type, reference, material });
  return getReconciliationException(client, context, row.id);
}

// ------------------------------------------------------------------ dashboard, reports, POS status

// The dashboard: paid, provider-matched, awaiting provider, awaiting settlement, settled, awaiting bank, bank received — never one "paid" flag —
// and the open exceptions by type and age. filters: from, to (dates), storeId, merchantAccountId, method.
export async function getReconciliationOverview(client, context, filters = {}) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? "")) ? filters.to : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? "")) ? filters.from : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const where = ["payment.organization_id = $1", "payment.initiated_at >= $2::date", "payment.initiated_at < $3::date + 1"];
  const outlets = await accessiblePosStoreIds(client, context);
  if (outlets) { values.push(outlets); where.push(`payment.store_id = ANY($${values.length}::uuid[])`); }
  if (UUID.test(String(filters.storeId ?? ""))) { values.push(filters.storeId); where.push(`payment.store_id = $${values.length}`); }
  if (["cash", "card", "upi", "wallet"].includes(filters.method)) { values.push(filters.method); where.push(`payment.payment_method = $${values.length}`); }
  if (UUID.test(String(filters.merchantAccountId ?? ""))) {
    values.push(filters.merchantAccountId);
    where.push(`EXISTS (SELECT 1 FROM tenant.payment_merchant_accounts merchant WHERE merchant.id = $${values.length} AND merchant.provider_key = payment.provider_key
      AND merchant.merchant_account_reference = COALESCE(NULLIF(btrim(payment.merchant_account_reference), ''), 'DEFAULT'))`);
  }
  const settledExpr = `EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = payment.organization_id AND match.internal_source_type = 'pos_payment'
      AND match.internal_source_id = payment.id AND match.status = 'ACTIVE')`;
  const totals = (await client.query(
    `SELECT COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL AND payment.status = ANY($${values.length + 1}::text[])), 0)::text AS paid,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'cash' AND payment.sale_id IS NOT NULL AND payment.status = ANY($${values.length + 1}::text[])), 0)::text AS cash,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND payment.verification_status = 'provider_verified' AND payment.status = ANY($${values.length + 1}::text[])), 0)::text AS provider_matched,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND (payment.verification_status = 'externally_attested' OR payment.attempt_status IN ('unknown', 'reconciliation_required', 'cancel_pending'))
              AND NOT ${settledExpr}), 0)::text AS awaiting_provider,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND payment.verification_status = 'provider_verified' AND payment.status = ANY($${values.length + 1}::text[]) AND NOT ${settledExpr}), 0)::text AS awaiting_settlement,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND ${settledExpr}), 0)::text AS settled,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.status = 'captured' AND payment.sale_id IS NULL AND payment.payment_method <> 'cash'
              AND COALESCE(payment.recovery_status, '') NOT IN ('refunded', 'resolved')), 0)::text AS unapplied
       FROM tenant.pos_payments payment WHERE ${where.join(" AND ")}`, [...values, APPLIED])).rows[0];
  const byMethod = (await client.query(
    `SELECT payment.payment_method AS method, count(*)::int AS count, COALESCE(sum(payment.amount), 0)::text AS amount,
            COALESCE(sum(payment.amount) FILTER (WHERE ${settledExpr}), 0)::text AS settled
       FROM tenant.pos_payments payment WHERE ${where.join(" AND ")} AND payment.sale_id IS NOT NULL AND payment.status = ANY($${values.length + 1}::text[]) GROUP BY 1 ORDER BY 1`, [...values, APPLIED])).rows;
  const settlements = (await client.query(
    `SELECT COALESCE(sum(calculated_net_amount) FILTER (WHERE status <> 'BANK_MATCHED'), 0)::text AS awaiting_bank, COALESCE(sum(bank_matched_amount), 0)::text AS bank_received,
            COALESCE(sum(gross_amount), 0)::text AS gross, COALESCE(sum(fee_amount + fee_tax_amount), 0)::text AS fees, count(*)::int AS batches,
            count(*) FILTER (WHERE finance_status = 'POSTED')::int AS posted, count(*) FILTER (WHERE finance_status = 'FAILED')::int AS posting_failed
       FROM tenant.payment_settlement_batches WHERE organization_id = $1 AND settlement_date BETWEEN $2::date AND $3::date`, [context.organizationId, from, to])).rows[0];
  const { where: exceptionWhere, values: exceptionValues } = await exceptionScope(client, context, { status: "open", storeId: filters.storeId, merchantAccountId: filters.merchantAccountId });
  const exceptions = (await client.query(
    `SELECT count(*)::int AS open, COALESCE(sum(abs(exposure_amount)), 0)::text AS exposure,
            count(*) FILTER (WHERE detected_at > now() - interval '1 day')::int AS age_0_1, count(*) FILTER (WHERE detected_at <= now() - interval '1 day' AND detected_at > now() - interval '3 days')::int AS age_1_3,
            count(*) FILTER (WHERE detected_at <= now() - interval '3 days' AND detected_at > now() - interval '7 days')::int AS age_3_7, count(*) FILTER (WHERE detected_at <= now() - interval '7 days')::int AS age_7
       FROM tenant.payment_reconciliation_exceptions exception WHERE ${exceptionWhere}`, exceptionValues)).rows[0];
  const byCode = (await client.query(`SELECT exception_code AS code, count(*)::int AS count, COALESCE(sum(abs(exposure_amount)), 0)::text AS exposure FROM tenant.payment_reconciliation_exceptions exception
      WHERE ${exceptionWhere} GROUP BY 1 ORDER BY 2 DESC`, exceptionValues)).rows;
  const recent = (await client.query(`${EXCEPTION_SELECT} WHERE ${exceptionWhere} ORDER BY exception.detected_at DESC LIMIT 10`, exceptionValues)).rows.map(exceptionView);
  const runs = (await client.query(`SELECT * FROM tenant.payment_reconciliation_runs WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 5`, [context.organizationId])).rows.map(runView);
  return { from, to,
    totals: { paid: money(totals.paid), cashApplied: money(totals.cash), providerMatched: money(totals.provider_matched), awaitingProvider: money(totals.awaiting_provider),
      awaitingSettlement: money(totals.awaiting_settlement), settled: money(totals.settled), unapplied: money(totals.unapplied), awaitingBankMatch: money(settlements.awaiting_bank),
      bankReceived: money(settlements.bank_received), settlementGross: money(settlements.gross), settlementFees: money(settlements.fees), settlementBatches: settlements.batches,
      financePosted: settlements.posted, financeFailed: settlements.posting_failed },
    byMethod: byMethod.map((row) => ({ method: row.method, count: row.count, amount: money(row.amount), settled: money(row.settled) })),
    exceptions: { open: exceptions.open, exposure: money(exceptions.exposure), aging: { "0-1d": exceptions.age_0_1, "1-3d": exceptions.age_1_3, "3-7d": exceptions.age_3_7, "7d+": exceptions.age_7 },
      byCode: byCode.map((row) => ({ code: row.code, count: row.count, exposure: money(row.exposure) })), recent },
    runs };
}

export async function listSettlementBatches(client, context, filters = {}) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const values = [context.organizationId];
  const where = ["batch.organization_id = $1"];
  if (UUID.test(String(filters.merchantAccountId ?? ""))) { values.push(filters.merchantAccountId); where.push(`batch.merchant_account_id = $${values.length}`); }
  if (filters.status) { values.push(String(filters.status)); where.push(`batch.status = $${values.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) { values.push(filters.from); where.push(`batch.settlement_date >= $${values.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) { values.push(filters.to); where.push(`batch.settlement_date <= $${values.length}::date`); }
  return (await client.query(`SELECT batch.*, merchant.display_name FROM tenant.payment_settlement_batches batch JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id
      WHERE ${where.join(" AND ")} ORDER BY batch.settlement_date DESC, batch.created_at DESC LIMIT 200`, values)).rows.map(batchView);
}

function batchView(row) {
  return { id: row.id, merchantAccountId: row.merchant_account_id, merchant: row.display_name ?? null, settlementId: row.provider_settlement_id, settlementDate: row.settlement_date, currency: row.currency_code,
    gross: money(row.gross_amount), refunds: money(row.refund_amount), fees: money(row.fee_amount), feeTax: money(row.fee_tax_amount), chargebacks: money(row.chargeback_amount),
    adjustments: money(row.adjustment_amount), calculatedNet: money(row.calculated_net_amount), reportedNet: money(row.reported_net_amount), payoutReference: row.bank_payout_reference,
    status: row.status, bankMatched: money(row.bank_matched_amount), financeStatus: row.finance_status, financeJournalEntryId: row.finance_journal_entry_id, financeError: row.finance_error };
}

async function batchesOf(client, context, ids) {
  if (!ids.length) return [];
  return (await client.query(`SELECT batch.*, merchant.display_name FROM tenant.payment_settlement_batches batch JOIN tenant.payment_merchant_accounts merchant ON merchant.id = batch.merchant_account_id
      WHERE batch.organization_id = $1 AND batch.id = ANY($2::uuid[]) ORDER BY batch.settlement_date`, [context.organizationId, ids])).rows.map(batchView);
}

export async function getSettlementBatch(client, context, batchId) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const [batch] = UUID.test(String(batchId ?? "")) ? await batchesOf(client, context, [batchId]) : [];
  if (!batch) throw reconError(404, "RECON_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.*, (SELECT jsonb_agg(jsonb_build_object('id', match.id, 'internalType', match.internal_source_type, 'internalId', match.internal_source_id, 'amount', match.matched_amount,
              'rule', match.match_rule, 'status', match.status)) FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = line.organization_id
              AND match.external_source_type = 'payment_settlement_line' AND match.external_source_id = line.id AND match.status <> 'REVERSED') AS matches
       FROM tenant.payment_settlement_lines line WHERE line.organization_id = $1 AND line.batch_id = $2 ORDER BY line.line_number`, [context.organizationId, batchId])).rows
    .map((line) => ({ id: line.id, number: line.line_number, type: line.line_type, transactionId: line.provider_transaction_id, reference: line.provider_reference, transactionAt: line.transaction_at,
      gross: money(line.gross_amount), fee: money(line.fee_amount), feeTax: money(line.fee_tax_amount), net: money(line.net_amount), matches: line.matches ?? [], status: (line.matches ?? []).some((m) => m.status === "ACTIVE") ? "MATCHED"
        : (line.matches ?? []).length ? "PENDING_APPROVAL" : ["PAYMENT", "REFUND"].includes(line.line_type) ? "UNMATCHED" : "NOT_APPLICABLE" }));
  const bank = (await client.query(`SELECT match.*, line.reference, line.transaction_date, line.credit_amount FROM tenant.payment_reconciliation_matches match
      JOIN tenant.accounting_bank_statement_lines line ON line.id = match.external_source_id WHERE match.organization_id = $1 AND match.internal_source_type = 'payment_settlement_batch'
        AND match.internal_source_id = $2 ORDER BY match.matched_at`, [context.organizationId, batchId])).rows
    .map((row) => ({ ...matchView(row), bankReference: row.reference, bankDate: row.transaction_date, bankCredit: money(row.credit_amount) }));
  return { ...batch, lines, bankMatches: bank };
}

const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[=+@\t\r-]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Reports (rows, or CSV with spreadsheet formulas neutralised): summary, unmatched, duplicates, unknown, settlements, settlement_aging, refunds,
// bank_unmatched, manual_matches, cash_links, clearing, day_end. filters: from, to, format.
export async function getReconciliationReport(client, context, type, filters = {}) {
  if (!mayView(context)) throw reconError(403, "RECON_PERMISSION_DENIED");
  const org = context.organizationId;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? "")) ? filters.to : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? "")) ? filters.from : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const exceptionsOf = async (codes) => (await listReconciliationExceptions(client, context, { status: "open", from, to, limit: 200 })).rows.filter((row) => codes.includes(row.code));
  let rows;
  switch (type) {
    case "summary": { const overview = await getReconciliationOverview(client, context, { from, to }); rows = [overview.totals]; break; }
    case "unmatched": rows = await exceptionsOf(["PAYMENT_MISSING_INTERNAL", "PAYMENT_MISSING_PROVIDER", "SETTLEMENT_MISSING"]); break;
    case "duplicates": rows = await exceptionsOf(["PAYMENT_DUPLICATE", "PAYMENT_UNAPPLIED", "REFUND_DUPLICATE"]); break;
    case "unknown": rows = await exceptionsOf(["PAYMENT_STATUS_UNKNOWN"]); break;
    case "settlements": rows = await listSettlementBatches(client, context, { from, to }); break;
    case "settlement_aging": rows = (await client.query(
      `SELECT batch.provider_settlement_id, batch.settlement_date, batch.calculated_net_amount, batch.bank_matched_amount, batch.status, (current_date - batch.settlement_date) AS age_days
         FROM tenant.payment_settlement_batches batch WHERE batch.organization_id = $1 AND batch.status <> 'BANK_MATCHED' ORDER BY batch.settlement_date`, [org])).rows; break;
    case "refunds": rows = (await client.query(
      `SELECT refund.refund_number, component.refund_method, component.status, component.allocated_amount, component.successful_amount, component.provider_refund_id, component.created_at
         FROM tenant.payment_refund_components component JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
        WHERE component.organization_id = $1 AND component.created_at >= $2::date AND component.created_at < $3::date + 1 ORDER BY component.created_at`, [org, from, to])).rows; break;
    case "bank_unmatched": rows = (await listSettlementBatches(client, context, { from, to })).filter((row) => row.status !== "BANK_MATCHED"); break;
    case "manual_matches": rows = (await client.query(`SELECT match.*, users.full_name AS matched_by_name FROM tenant.payment_reconciliation_matches match LEFT JOIN public.users ON users.id = match.matched_by
        WHERE match.organization_id = $1 AND match.match_type = 'MANUAL' AND match.matched_at >= $2::date AND match.matched_at < $3::date + 1 ORDER BY match.matched_at`, [org, from, to])).rows
      .map((row) => ({ ...matchView(row), matchedByName: row.matched_by_name })); break;
    case "cash_links": rows = await exceptionsOf(["CASH_SESSION_VARIANCE"]); break;
    case "clearing": rows = (await client.query(
      `SELECT payment.payment_method AS method, COALESCE(sum(payment.amount), 0)::text AS captured,
              COALESCE(sum(match.matched_amount) FILTER (WHERE match.id IS NOT NULL), 0)::text AS settled,
              (COALESCE(sum(payment.amount), 0) - COALESCE(sum(match.matched_amount), 0))::text AS outstanding_clearing
         FROM tenant.pos_payments payment LEFT JOIN tenant.payment_reconciliation_matches match ON match.organization_id = payment.organization_id AND match.internal_source_type = 'pos_payment'
              AND match.internal_source_id = payment.id AND match.status = 'ACTIVE'
        WHERE payment.organization_id = $1 AND payment.payment_method <> 'cash' AND payment.sale_id IS NOT NULL AND payment.status = ANY($4::text[])
          AND payment.initiated_at >= $2::date AND payment.initiated_at < $3::date + 1 GROUP BY 1 ORDER BY 1`, [org, from, to, APPLIED])).rows; break;
    case "day_end": rows = (await client.query(`SELECT report.report_number, report.business_date::text AS business_date, store.name AS outlet, report.reconciliation_status, report.reconciliation_references
        FROM tenant.pos_day_end_reports report JOIN tenant.pos_stores store ON store.id = report.store_id WHERE report.organization_id = $1 AND report.business_day_id IS NOT NULL
          AND report.business_date BETWEEN $2::date AND $3::date ORDER BY report.business_date DESC`, [org, from, to])).rows; break;
    default: throw reconError(400, "RECON_MATCH_INVALID", "Unknown report.");
  }
  if (filters.format === "csv") {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return { type, from, to, contentType: "text/csv", csv: [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") };
  }
  return { type, from, to, rows };
}

// What a cashier needs to know about one payment, in plain words: paid, confirmed by the provider (or recorded from a machine / QR), settled to
// the business, and anything still being checked.
export async function getPaymentReconciliationStatus(client, context, paymentId) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(paymentId ?? ""))) throw reconError(404, "RECON_NOT_FOUND");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id = $1 AND id = $2`, [context.organizationId, paymentId])).rows[0];
  if (!payment) throw reconError(404, "RECON_NOT_FOUND");
  const outlets = await accessiblePosStoreIds(client, context);
  if (outlets && payment.store_id && !outlets.includes(payment.store_id)) throw reconError(404, "RECON_NOT_FOUND");
  const settled = (await client.query(`SELECT 1 FROM tenant.payment_reconciliation_matches WHERE organization_id = $1 AND internal_source_type = 'pos_payment' AND internal_source_id = $2 AND status = 'ACTIVE'`,
    [context.organizationId, payment.id])).rows[0];
  const open = (await client.query(`SELECT exception_code FROM tenant.payment_reconciliation_exceptions WHERE organization_id = $1 AND status <> 'RESOLVED' AND source_type = 'pos_payment' AND source_id = $2`,
    [context.organizationId, payment.id])).rows.map((row) => row.exception_code);
  const cash = payment.payment_method === "cash";
  return {
    paymentId: payment.id, method: payment.payment_method, amount: money(payment.amount),
    payment: APPLIED.includes(payment.status) ? (payment.sale_id ? "PAID" : "COLLECTED_NOT_APPLIED") : LIVE_ATTEMPTS.includes(payment.attempt_status) ? "CHECKING_WITH_PROVIDER" : String(payment.status).toUpperCase(),
    provider: cash ? "NOT_APPLICABLE" : payment.verification_status === "provider_verified" ? "MATCHED" : payment.verification_status === "externally_attested" ? "RECORDED_FROM_MACHINE_OR_QR" : "AWAITING_PROVIDER",
    settlement: cash ? "CASH_SESSION" : settled ? "SETTLED" : "AWAITING_SETTLEMENT",
    beingChecked: open,
  };
}

// Day-End: the reconciliation picture of a set of sales (for the Z report's Finance section) — read only.
export async function reconciliationSummaryForSales(client, organizationId, saleIds) {
  if (!saleIds.length) return { providerMatched: "0.00", awaitingProvider: "0.00", awaitingSettlement: "0.00", settled: "0.00", openExceptions: 0 };
  const row = (await client.query(
    `SELECT COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND payment.verification_status = 'provider_verified'), 0)::text AS provider_matched,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND payment.verification_status = 'externally_attested'), 0)::text AS awaiting_provider,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method <> 'cash' AND NOT EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = payment.organization_id
              AND match.internal_source_type = 'pos_payment' AND match.internal_source_id = payment.id AND match.status = 'ACTIVE')), 0)::text AS awaiting_settlement,
            COALESCE(sum(payment.amount) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.payment_reconciliation_matches match WHERE match.organization_id = payment.organization_id
              AND match.internal_source_type = 'pos_payment' AND match.internal_source_id = payment.id AND match.status = 'ACTIVE')), 0)::text AS settled,
            (SELECT count(*)::int FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = $1 AND exception.status <> 'RESOLVED'
              AND (exception.source_id = ANY($2::uuid[]) OR exception.source_id IN (SELECT id FROM tenant.pos_payments WHERE organization_id = $1 AND sale_id = ANY($2::uuid[])))) AS open_exceptions
       FROM tenant.pos_payments payment WHERE payment.organization_id = $1 AND payment.sale_id = ANY($2::uuid[]) AND payment.status = ANY($3::text[])`, [organizationId, saleIds, APPLIED])).rows[0];
  return { providerMatched: money(row.provider_matched), awaitingProvider: money(row.awaiting_provider), awaitingSettlement: money(row.awaiting_settlement), settled: money(row.settled),
    openExceptions: row.open_exceptions };
}

export const RECONCILIATION_ADAPTERS = Object.freeze(Object.keys(ADAPTERS));
export const STANDARD_SETTLEMENT_COLUMNS = STANDARD_COLUMNS;

// Retried from Accounting's Automatic postings screen once the cause (usually a missing clearing or fee account) is fixed.
registerPostingRetry("payment_settlement_batch", (client, context, batchId) =>
  postSettlementToFinance(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "pos.accounting.post"])] }, batchId));

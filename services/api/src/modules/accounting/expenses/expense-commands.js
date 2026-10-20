// Expenses (Finance MVP F7): money spent on running the business that isn't a supplier bill — a cab fare, the internet bill, a repair paid
// in cash, a team lunch an employee paid for.
//
//   record    an expense is recorded in a category (which decides its expense account), with the payee, the amount before GST and the GST
//             treatment, how it was paid — from a cash or bank account, or still owed (to a supplier, or to the employee who paid it from
//             their own pocket) — and its department / cost centre. The same supplier invoice is never recorded twice.
//   evidence  the receipt or invoice is attached. A category may need none up to a small amount; without one, the payer declares why
//             (lost, no bill given) and the approver sees it.
//   approve   a submitted expense is approved by someone else — never the person who submitted it, nor the employee being reimbursed —
//             unless the company turns approval off. Approval posts it: Dr expense (+ input GST when the credit is claimable)
//             · Cr cash / bank, or Cr Expense claims payable.
//   pay       an expense still owed is paid later (Dr Expense claims payable · Cr cash / bank).
//   correct   a draft or one sent back is edited; one not posted is cancelled with a reason; a posted one is reversed with a reason —
//             its payment, its input-tax decision and the expense itself — and nothing posted is ever edited.
import {
  ACCOUNTING_PERMISSIONS, AccountingError, allocateNumber, asDatabaseDecimal, decimal, event, getAccountMapping, getPrimaryLedger, loadOrganization, optionalUuid,
  requirePermission, roundMoney, text, uuid,
} from "../core.js";
import { createJournalEntry, localToday, postJournalEntry, reverseJournalEntry } from "../journals.js";
import { div, mul } from "../money.js";
import { itcRequiresConfirmation, recordDocumentTaxLedger, taxPostingLines } from "../tax.js";
import { loadExpenseCategory } from "./categories.js";
import { EXPENSE_FILE_ENTITY, evidenceFiles } from "./files.js";
import { getExpenseRecord } from "./expense-read.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const out = (value) => asDatabaseDecimal(value);
const money = (value) => roundMoney(decimal(value || 0), 2);
const dayText = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const result = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(400, "The date is invalid.", "ACCOUNTING_DATE_INVALID", "date");
  return result;
};
const elevated = (context, ...permissions) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ...permissions])] });
export const PAYMENT_METHODS = Object.freeze(["cash", "upi", "card", "bank_transfer", "cheque", "other"]);
const OPEN_STATES = ["DRAFT", "REJECTED"];

async function journalOfType(client, context, ledgerId, types, label) {
  const row = (await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = ANY($3::text[]) AND status = 'active'
      ORDER BY array_position($3::text[], journal_type), created_at LIMIT 1`, [context.organizationId, ledgerId, types])).rows[0];
  if (!row) fail(409, `${label} journal is not configured in Accounting.`, "ACCOUNTING_JOURNAL_MISSING");
  return row.id;
}

async function moneyAccount(client, context, ledgerId, accountIdValue, field = "paidFromAccountId") {
  const account = (await client.query(
    `SELECT id, code, name, account_type, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND id = $3`,
    [context.organizationId, ledgerId, uuid(accountIdValue, "Paid from")])).rows[0];
  if (!account || account.status !== "active" || account.is_group || !["cash", "bank"].includes(account.account_type))
    fail(409, "Choose the cash or bank account it was paid from.", "ACCOUNTING_ACCOUNT_INCOMPATIBLE", field);
  return account;
}

async function lockExpense(client, context, idValue) {
  const row = (await client.query(`SELECT * FROM tenant.accounting_expenses WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(idValue, "Expense")])).rows[0];
  if (!row) fail(404, "Expense not found.", "ACCOUNTING_EXPENSE_NOT_FOUND");
  return row;
}

// Everything an expense is made of, checked: used by create and by edit.
async function shape(client, context, input, current = null) {
  const pick = (key, column) => (input[key] === undefined && current ? current[column] : input[key]);
  const ledger = await getPrimaryLedger(client, context);
  const category = await loadExpenseCategory(client, context, pick("categoryId", "category_id"), { forUse: true });
  const description = text(pick("description", "description"), 500);
  if (!description) fail(400, "Say what the expense was for.", "ACCOUNTING_EXPENSE_DESCRIPTION_REQUIRED", "description");
  const date = dayText(pick("date", "expense_date")) ?? localToday();
  if (date > localToday()) fail(400, "An expense can't be dated in the future.", "ACCOUNTING_EXPENSE_DATE_FUTURE", "date");
  const amount = money(pick("amount", "amount"));
  if (amount <= 0n) fail(400, "The amount must be more than zero.", "ACCOUNTING_EXPENSE_AMOUNT_INVALID", "amount");
  const treatment = ["NO_GST", "GST_CLAIM_ITC", "GST_NO_ITC"].includes(pick("gstTreatment", "gst_treatment")) ? pick("gstTreatment", "gst_treatment") : "NO_GST";
  const supply = treatment === "NO_GST" ? null : pick("gstSupply", "gst_supply") === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE";
  const rate = treatment === "NO_GST" ? 0 : Number(pick("gstRate", "gst_rate"));
  if (treatment !== "NO_GST" && !(rate > 0 && rate <= 100)) fail(400, "Give the GST rate on the bill.", "ACCOUNTING_EXPENSE_GST_RATE_INVALID", "gstRate");
  const tax = treatment === "NO_GST" ? 0n : roundMoney(div(mul(amount, decimal(rate)), decimal(100)), 2);
  const gstin = text(pick("supplierGstin", "supplier_gstin"), 15).toUpperCase() || null;
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) fail(400, "That GSTIN isn't valid (15 characters, like 27AAPFU0939F1ZV).", "ACCOUNTING_EXPENSE_GSTIN_INVALID", "supplierGstin");
  if (treatment === "GST_CLAIM_ITC" && !gstin) fail(400, "Input tax credit needs the supplier's GSTIN from the bill.", "ACCOUNTING_EXPENSE_GSTIN_REQUIRED", "supplierGstin");
  const invoiceRef = text(pick("supplierInvoiceReference", "supplier_invoice_reference"), 100) || null;
  if (treatment === "GST_CLAIM_ITC" && !invoiceRef) fail(400, "Input tax credit needs the bill's invoice number.", "ACCOUNTING_EXPENSE_INVOICE_REQUIRED", "supplierInvoiceReference");
  const partyId = optionalUuid(pick("partyId", "party_id"), "Payee");
  if (partyId && !(await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, partyId])).rows[0])
    fail(404, "The payee is inactive or unavailable.", "ACCOUNTING_EXPENSE_PAYEE_INVALID", "partyId");
  const payeeName = partyId ? null : text(pick("payeeName", "payee_name"), 200) || null;
  const claimant = optionalUuid(pick("claimantUserId", "claimant_user_id"), "Employee");
  if (claimant && !(await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [context.organizationId, claimant])).rows[0])
    fail(404, "The employee isn't an active member of the company.", "ACCOUNTING_EXPENSE_CLAIMANT_INVALID", "claimantUserId");
  // An employee who paid from their own pocket is owed it: the expense is payable to them, never "paid from" a company account.
  const settlement = claimant ? "PAYABLE" : pick("settlement", "settlement") === "PAYABLE" ? "PAYABLE" : "PAID";
  const paidFrom = settlement === "PAID" ? await moneyAccount(client, context, ledger.id, pick("paidFromAccountId", "paid_from_account_id")) : null;
  const method = PAYMENT_METHODS.includes(pick("paymentMethod", "payment_method")) ? pick("paymentMethod", "payment_method") : settlement === "PAID" ? (paidFrom.account_type === "cash" ? "cash" : "bank_transfer") : null;
  const departmentId = optionalUuid(pick("departmentId", "department_id"), "Department");
  if (departmentId && !(await client.query("SELECT 1 FROM public.departments WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, departmentId])).rows[0])
    fail(404, "Choose an active department.", "ACCOUNTING_EXPENSE_DIMENSION_INVALID", "departmentId");
  const costCenterId = optionalUuid(pick("costCenterId", "cost_center_id"), "Cost centre");
  if (costCenterId && !(await client.query("SELECT 1 FROM public.cost_centers WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, costCenterId])).rows[0])
    fail(404, "Choose an active cost centre.", "ACCOUNTING_EXPENSE_DIMENSION_INVALID", "costCenterId");
  // The same supplier bill is never recorded twice (it would be expensed — and its GST claimed — twice).
  if (invoiceRef) {
    const twin = (await client.query(
      `SELECT expense_number FROM tenant.accounting_expenses
        WHERE organization_id = $1 AND upper(supplier_invoice_reference) = upper($2) AND status NOT IN ('CANCELLED', 'REVERSED') AND ($3::uuid IS NULL OR id <> $3)
          AND ((supplier_gstin IS NOT NULL AND supplier_gstin = $4) OR (party_id IS NOT NULL AND party_id = $5) OR (payee_name IS NOT NULL AND lower(payee_name) = lower($6)))
        LIMIT 1`, [context.organizationId, invoiceRef, current?.id ?? null, gstin, partyId, payeeName ?? ""])).rows[0];
    if (twin) fail(409, `This bill is already recorded as ${twin.expense_number}.`, "ACCOUNTING_EXPENSE_DUPLICATE", "supplierInvoiceReference");
  }
  return {
    ledger, category, description, date, amount, treatment, supply, rate, tax, gstin, invoiceRef, partyId, payeeName, claimant, settlement, paidFrom, method, departmentId, costCenterId,
    notes: text(pick("notes", "notes"), 2000) || null, noReceiptReason: text(pick("noReceiptReason", "no_receipt_reason"), 500) || null,
  };
}

// input: { categoryId, date, description, amount (before GST), gstTreatment: NO_GST | GST_CLAIM_ITC | GST_NO_ITC, gstSupply, gstRate, partyId? | payeeName?,
//          supplierGstin?, supplierInvoiceReference?, settlement: PAID | PAYABLE, paidFromAccountId?, paymentMethod?, claimantUserId?, departmentId?,
//          costCenterId?, notes?, noReceiptReason?, submit?, idempotencyKey? }
export async function createExpense(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.accounting_expenses WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (existing) return getExpenseRecord(client, context, existing.id);
  }
  const organization = await loadOrganization(client, context);
  const value = await shape(client, context, input);
  const number = await allocateNumber(client, context.organizationId, "accounting_expense");
  const row = (await client.query(
    `INSERT INTO tenant.accounting_expenses (organization_id, ledger_id, expense_number, expense_date, description, expense_account_id, category_id, party_id, payee_name,
       supplier_gstin, supplier_invoice_reference, currency_code, amount, gst_treatment, gst_supply, gst_rate, tax_amount, total_amount, settlement, paid_from_account_id,
       payment_method, claimant_user_id, department_id, cost_center_id, notes, no_receipt_reason, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING id`,
    [context.organizationId, value.ledger.id, number, value.date, value.description, value.category.account_id, value.category.id, value.partyId, value.payeeName,
      value.gstin, value.invoiceRef, String(organization.base_currency).trim(), out(value.amount), value.treatment, value.supply, String(value.rate), out(value.tax),
      out(value.amount + value.tax), value.settlement, value.paidFrom?.id ?? null, value.method, value.claimant, value.departmentId, value.costCenterId, value.notes,
      value.noReceiptReason, key, context.userId ?? null])).rows[0];
  await event(client, context, "expense", row.id, "accounting.expense.created", null, "DRAFT", { number, category: value.category.name });
  if (input.submit) return submitExpense(client, context, row.id);
  return getExpenseRecord(client, context, row.id);
}

// A draft, or one sent back, is corrected before it is submitted (again).
export async function updateExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const current = await lockExpense(client, context, idValue);
  if (!OPEN_STATES.includes(current.status)) fail(409, "Only a draft or an expense sent back can be edited. A posted one is reversed and recorded again.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (input.version !== undefined && Number(input.version) !== Number(current.version)) fail(409, "Someone else changed this expense; reload it and edit again.", "ACCOUNTING_EXPENSE_STALE");
  const value = await shape(client, context, input, current);
  await client.query(
    `UPDATE tenant.accounting_expenses SET expense_date = $3, description = $4, expense_account_id = $5, category_id = $6, party_id = $7, payee_name = $8, supplier_gstin = $9,
            supplier_invoice_reference = $10, amount = $11, gst_treatment = $12, gst_supply = $13, gst_rate = $14, tax_amount = $15, total_amount = $16, settlement = $17,
            paid_from_account_id = $18, payment_method = $19, claimant_user_id = $20, department_id = $21, cost_center_id = $22, notes = $23, no_receipt_reason = $24,
            version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, value.date, value.description, value.category.account_id, value.category.id, value.partyId, value.payeeName, value.gstin,
      value.invoiceRef, out(value.amount), value.treatment, value.supply, String(value.rate), out(value.tax), out(value.amount + value.tax), value.settlement,
      value.paidFrom?.id ?? null, value.method, value.claimant, value.departmentId, value.costCenterId, value.notes, value.noReceiptReason]);
  await event(client, context, "expense", current.id, "accounting.expense.updated", current.status, current.status, {});
  if (input.submit) return submitExpense(client, context, current.id);
  return getExpenseRecord(client, context, current.id);
}

// Whether the expense has the evidence its category asks for: a file, or the payer's declaration of why there is none.
export async function evidenceState(client, context, row) {
  const category = row.category_id ? (await client.query("SELECT receipt_required, receipt_threshold, name FROM tenant.expense_categories WHERE id = $1", [row.category_id])).rows[0] : null;
  const files = await evidenceFiles(client, context, row.id);
  const needed = category ? category.receipt_required && decimal(row.total_amount) > decimal(category.receipt_threshold) : true;
  return { needed, files: files.length, declared: Boolean(row.no_receipt_reason), satisfied: !needed || files.length > 0 || Boolean(row.no_receipt_reason),
    threshold: category ? Number(category.receipt_threshold) : 0, category: category?.name ?? null };
}

// Submitted for approval — or, when the company does not require expense approval, posted at once.
export async function submitExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "SUBMITTED" || row.status === "POSTED") return getExpenseRecord(client, context, row.id);
  if (!OPEN_STATES.includes(row.status)) fail(409, `A ${row.status.toLowerCase()} expense cannot be submitted.`, "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (!row.category_id) fail(400, "Choose the expense's category first.", "ACCOUNTING_EXPENSE_CATEGORY_NOT_FOUND", "categoryId");
  const evidence = await evidenceState(client, context, row);
  if (!evidence.satisfied)
    fail(400, `Attach the receipt or bill${evidence.threshold > 0 ? ` (${evidence.category} needs one above ₹${evidence.threshold.toLocaleString("en-IN")})` : ""}, or say why there is none.`,
      "ACCOUNTING_EXPENSE_EVIDENCE_REQUIRED", "files");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3, rejection_reason = NULL, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null]);
  await event(client, context, "expense", row.id, "accounting.expense.submitted", row.status, "SUBMITTED", {});
  const settings = (await client.query(`SELECT expense_approval_required FROM tenant.accounting_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (settings && settings.expense_approval_required === false) return postExpense(client, context, row.id, { selfApproved: true });
  return getExpenseRecord(client, context, row.id);
}

export async function approveExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "POSTED") return getExpenseRecord(client, context, row.id);
  if (row.status !== "SUBMITTED") fail(409, "Only a submitted expense is approved.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (row.submitted_by && row.submitted_by === context.userId) fail(409, "Someone other than the person who submitted it approves an expense.", "ACCOUNTING_EXPENSE_SELF_APPROVAL");
  if (row.claimant_user_id && row.claimant_user_id === context.userId) fail(409, "You can't approve an expense you are being reimbursed for.", "ACCOUNTING_EXPENSE_SELF_APPROVAL");
  return postExpense(client, context, row.id, {});
}

export async function rejectExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status !== "SUBMITTED") fail(409, "Only a submitted expense is sent back.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the expense is sent back.", "ACCOUNTING_EXPENSE_REASON_REQUIRED", "reason");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'REJECTED', rejection_reason = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason]);
  await event(client, context, "expense", row.id, "accounting.expense.rejected", "SUBMITTED", "REJECTED", { reason });
  return getExpenseRecord(client, context, row.id);
}

export async function cancelExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "CANCELLED") return getExpenseRecord(client, context, row.id);
  if (!["DRAFT", "REJECTED", "SUBMITTED"].includes(row.status)) fail(409, "A posted expense is reversed, not cancelled.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the expense is cancelled.", "ACCOUNTING_EXPENSE_REASON_REQUIRED", "reason");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null, reason]);
  await event(client, context, "expense", row.id, "accounting.expense.cancelled", row.status, "CANCELLED", { reason });
  return getExpenseRecord(client, context, row.id);
}

// The GST components of an expense, as a tax-engine line: intra-state CGST + SGST (half each, SGST taking the odd paisa), inter-state IGST.
function expenseTaxLine(row) {
  const tax = decimal(row.tax_amount);
  const half = roundMoney(div(tax, decimal(2)), 2);
  const components = row.gst_supply === "INTER_STATE"
    ? [{ taxType: "igst", taxableAmount: String(row.amount), taxAmount: out(tax) }]
    : [{ taxType: "cgst", taxableAmount: String(row.amount), taxAmount: out(half) }, { taxType: "sgst", taxableAmount: String(row.amount), taxAmount: out(tax - half) }];
  return { id: row.id, description: row.description, net_amount: String(row.amount), tax_amount: String(row.tax_amount), tax_details: components, tax_account_id: null, hsn_sac_code: null };
}

async function postExpense(client, context, id, { selfApproved }) {
  const row = await lockExpense(client, context, id);
  const ledger = await getPrimaryLedger(client, context);
  const date = dayText(row.expense_date);
  const internal = elevated(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const claim = row.gst_treatment === "GST_CLAIM_ITC";
  const expenseAmount = claim ? decimal(row.amount) : decimal(row.total_amount);
  const dims = { departmentId: row.department_id ?? undefined, costCenterId: row.cost_center_id ?? undefined };
  const lines = [{ accountId: row.expense_account_id, partyId: row.party_id ?? undefined, description: row.description, debit: out(expenseAmount), credit: 0, referenceType: "expense", referenceId: row.id,
    ...dims, metadata: { taxRole: "base", sourceLineId: row.id, taxableAmount: String(row.amount) } }];
  const taxLine = expenseTaxLine(row);
  if (claim) lines.push(...await taxPostingLines(client, internal, ledger.id, taxLine, { direction: "input", date, partyId: row.party_id ?? undefined,
    itcPending: await itcRequiresConfirmation(client, context.organizationId), referenceType: "expense", referenceId: row.id }));
  const credit = row.settlement === "PAID" ? { account_id: row.paid_from_account_id } : await getAccountMapping(client, internal, ledger.id, "expense_payable", { date });
  const claimant = row.claimant_user_id ? (await client.query("SELECT full_name FROM public.users WHERE id = $1", [row.claimant_user_id])).rows[0]?.full_name : null;
  lines.push({ accountId: credit.account_id, partyId: row.party_id ?? undefined, debit: 0, credit: String(row.total_amount), referenceType: "expense", referenceId: row.id,
    description: `${row.settlement === "PAID" ? "Paid" : claimant ? `Owed to ${claimant}` : "Payable"} · ${row.expense_number}` });
  const journal = await createJournalEntry(client, internal, {
    ledgerId: ledger.id, journalId: await journalOfType(client, context, ledger.id, row.settlement === "PAID" ? ["cash", "bank", "purchase", "general"] : ["purchase", "general"], "A Purchase or General"),
    entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger", reference: row.supplier_invoice_reference || row.expense_number,
    description: `Expense ${row.expense_number} · ${row.description}`, currencyCode: row.currency_code, lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "expense", sourceId: row.id, sourceNumber: row.expense_number });
  await postJournalEntry(client, internal, journal.entry.id, { internal: true, allowDraft: true });
  if (claim || decimal(row.tax_amount) === 0n) {
    await recordDocumentTaxLedger(client, internal, { id: row.id, party_id: row.party_id, accounting_date: date, supplier_gstin: row.supplier_gstin }, [taxLine], journal.entry.id, "input",
      { sourceType: "expense", supplyCategoryOf: () => (row.gst_treatment === "NO_GST" ? "non_gst" : "taxable") });
  }
  const approver = selfApproved ? row.submitted_by ?? context.userId : context.userId;
  await client.query(
    `UPDATE tenant.accounting_expenses SET status = 'POSTED', approved_at = now(), approved_by = $3, journal_entry_id = $4, posted_at = now(), posted_by = $5,
            paid_at = CASE WHEN settlement = 'PAID' THEN now() ELSE NULL END, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, approver ?? null, journal.entry.id, context.userId ?? null]);
  await event(client, context, "expense", row.id, selfApproved ? "accounting.expense.posted" : "accounting.expense.approved", "SUBMITTED", "POSTED", { journal: journal.entry.id });
  return getExpenseRecord(client, context, row.id);
}

// An expense still owed is paid: Dr Expense claims payable, Cr the cash or bank account it was paid from. input: { paidFromAccountId, date?, paymentMethod? }
export async function payExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const row = await lockExpense(client, context, idValue);
  if (row.status !== "POSTED" || row.settlement !== "PAYABLE") fail(409, "Only a posted expense that is still owed is paid here.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (row.payment_journal_entry_id) return getExpenseRecord(client, context, row.id);
  const ledger = await getPrimaryLedger(client, context);
  const from = await moneyAccount(client, context, ledger.id, input.paidFromAccountId);
  const date = dayText(input.date) ?? localToday();
  if (date < dayText(row.expense_date)) fail(400, "It can't be paid before the expense date.", "ACCOUNTING_EXPENSE_DATE_INVALID", "date");
  if (date > localToday()) fail(400, "A payment can't be dated in the future.", "ACCOUNTING_EXPENSE_DATE_FUTURE", "date");
  const internal = elevated(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const payable = await getAccountMapping(client, internal, ledger.id, "expense_payable", { date });
  const journal = await createJournalEntry(client, internal, {
    ledgerId: ledger.id, journalId: await journalOfType(client, context, ledger.id, ["bank", "cash", "general"], "A Bank, Cash or General"), entryDate: date, accountingDate: date, documentDate: date,
    entryType: "subledger", reference: row.expense_number, description: `Expense ${row.expense_number} paid`, currencyCode: row.currency_code,
    lines: [
      { accountId: payable.account_id, partyId: row.party_id ?? undefined, description: `Expense ${row.expense_number} paid`, debit: String(row.total_amount), credit: 0, referenceType: "expense", referenceId: row.id },
      { accountId: from.id, description: `Expense ${row.expense_number} paid`, debit: 0, credit: String(row.total_amount), referenceType: "expense", referenceId: row.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "expense_payment", sourceId: row.id, sourceNumber: row.expense_number });
  await postJournalEntry(client, internal, journal.entry.id, { internal: true, allowDraft: true });
  const method = PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : from.account_type === "cash" ? "cash" : "bank_transfer";
  await client.query(`UPDATE tenant.accounting_expenses SET paid_at = now(), paid_from_account_id = $3, payment_journal_entry_id = $4, payment_method = $5, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, from.id, journal.entry.id, method]);
  await event(client, context, "expense", row.id, "accounting.expense.paid", "POSTED", "POSTED", { from: from.code, date });
  return getExpenseRecord(client, context, row.id);
}

// A posted expense entered in error: its payment, any input tax credit decision and the expense itself are reversed, newest first.
export async function reverseExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "REVERSED") return getExpenseRecord(client, context, row.id);
  if (row.status !== "POSTED") fail(409, "Only a posted expense is reversed.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the expense is reversed.", "ACCOUNTING_EXPENSE_REASON_REQUIRED", "reason");
  const reversing = elevated(context, ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.journalCreate);
  if (row.payment_journal_entry_id) await reverseJournalEntry(client, reversing, row.payment_journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  const itc = (await client.query(`SELECT journal_entry_id FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'itc_decision' AND source_id = $2 AND status = 'POSTED'`,
    [context.organizationId, row.id])).rows[0];
  if (itc) await reverseJournalEntry(client, reversing, itc.journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  const reversal = await reverseJournalEntry(client, reversing, row.journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  await client.query(`UPDATE tenant.accounting_tax_ledger SET status = 'reversed' WHERE organization_id = $1 AND source_type = 'expense' AND source_id = $2 AND status = 'open'`, [context.organizationId, row.id]);
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'REVERSED', reversal_journal_entry_id = $3, reversed_at = now(), reversed_by = $4, reversal_reason = $5, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, reversal.entry?.id ?? reversal.id ?? null, context.userId ?? null, reason]);
  await event(client, context, "expense", row.id, "accounting.expense.reversed", "POSTED", "REVERSED", { reason });
  return getExpenseRecord(client, context, row.id);
}

export { EXPENSE_FILE_ENTITY };

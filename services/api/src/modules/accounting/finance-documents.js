// The finance documents that post through the shared posting service without belonging to Sales, Procurement or Inventory:
//
//   expenses          an expense recorded, approved by a second person (unless the company turns that off) and posted: the expense — with its
//                     input GST, waiting for confirmation, when the credit is claimable — against cash or bank when it was paid, or against
//                     expense claims payable when it is paid later (then "Pay" posts the payment).
//   fund transfers    money moved between cash and bank accounts, posted at once.
//   opening balances  a controlled opening journal: prepared, submitted, approved and posted by a second person; any difference goes to
//                     opening balance equity. Customer and supplier balances and stock are entered where they can be settled (opening
//                     invoices and bills, opening stock), not here.
//
// Each document posts once; a mistake is corrected by reversing it, never by editing what was posted.
import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  decimal,
  getAccountMapping,
  getPrimaryLedger,
  hasPermission,
  loadOrganization,
  optionalUuid,
  requirePermission,
  roundMoney,
  text,
  uuid,
} from "./core.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journals.js";
import { div, mul } from "./money.js";
import { itcRequiresConfirmation, recordDocumentTaxLedger, taxPostingLines } from "./tax.js";

const dayText = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const result = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new AccountingError(400, "The date is invalid.", "ACCOUNTING_DATE_INVALID");
  return result;
};
const todayText = () => dayText(new Date());
const money = (value) => roundMoney(decimal(value || 0), 2);
const out = (value) => asDatabaseDecimal(value);
const fail = (status, message, code) => { throw new AccountingError(status, message, code); };

async function journalOfType(client, context, ledgerId, types, label) {
  const row = (await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = ANY($3::text[]) AND status = 'active'
      ORDER BY array_position($3::text[], journal_type), created_at LIMIT 1`, [context.organizationId, ledgerId, types])).rows[0];
  if (!row) fail(409, `${label} journal is not configured in Accounting.`, "ACCOUNTING_JOURNAL_MISSING");
  return row.id;
}

// An account a document may post to: active, not a group heading, of an allowed type or class.
async function usableAccount(client, context, ledgerId, accountIdValue, { label, types = null, classes = null }) {
  const accountId = uuid(accountIdValue, label);
  const account = (await client.query(`SELECT id, code, name, account_class, account_type, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND id = $3`,
    [context.organizationId, ledgerId, accountId])).rows[0];
  if (!account) fail(404, `${label} was not found.`, "ACCOUNTING_ACCOUNT_NOT_FOUND");
  if (account.status !== "active" || account.is_group) fail(409, `${label} ${account.code} · ${account.name} is ${account.is_group ? "a group heading" : "disabled"}; choose another.`, "ACCOUNTING_ACCOUNT_UNUSABLE");
  if (types && !types.includes(account.account_type)) fail(409, `${label} must be a ${types.join(" or ")} account; ${account.code} · ${account.name} is not.`, "ACCOUNTING_ACCOUNT_INCOMPATIBLE");
  if (classes && !classes.includes(account.account_class)) fail(409, `${label} must be an ${classes.join(" or ")} account; ${account.code} · ${account.name} is not.`, "ACCOUNTING_ACCOUNT_INCOMPATIBLE");
  return account;
}

const elevated = (context, ...permissions) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ...permissions])] });

// ================================================================== expenses
const EXPENSE_SELECT = `SELECT expense.*, account.code AS expense_account_code, account.name AS expense_account_name, paid.code AS paid_from_code, paid.name AS paid_from_name,
       party.display_name AS party_name, submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name, creator.full_name AS created_by_name,
       entry.entry_number AS journal_number, payment.entry_number AS payment_journal_number
  FROM tenant.accounting_expenses expense
  JOIN tenant.accounting_accounts account ON account.id = expense.expense_account_id
  LEFT JOIN tenant.accounting_accounts paid ON paid.id = expense.paid_from_account_id
  LEFT JOIN tenant.business_parties party ON party.id = expense.party_id
  LEFT JOIN public.users submitter ON submitter.id = expense.submitted_by
  LEFT JOIN public.users approver ON approver.id = expense.approved_by
  LEFT JOIN public.users creator ON creator.id = expense.created_by
  LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = expense.journal_entry_id
  LEFT JOIN tenant.accounting_journal_entries payment ON payment.id = expense.payment_journal_entry_id`;

function expenseView(row, context) {
  return {
    id: row.id, number: row.expense_number, date: dayText(row.expense_date), description: row.description, status: row.status,
    expenseAccount: { id: row.expense_account_id, label: `${row.expense_account_code} · ${row.expense_account_name}` },
    payee: row.party_name ?? row.payee_name ?? null, partyId: row.party_id, supplierGstin: row.supplier_gstin, supplierInvoiceReference: row.supplier_invoice_reference,
    currency: row.currency_code, amount: String(row.amount), gstTreatment: row.gst_treatment, gstSupply: row.gst_supply, gstRate: String(row.gst_rate), taxAmount: String(row.tax_amount),
    total: String(row.total_amount), settlement: row.settlement, paidFrom: row.paid_from_account_id ? { id: row.paid_from_account_id, label: `${row.paid_from_code} · ${row.paid_from_name}` } : null,
    paidAt: row.paid_at, submittedBy: row.submitted_by_name, submittedAt: row.submitted_at, approvedBy: row.approved_by_name, approvedAt: row.approved_at, rejectionReason: row.rejection_reason,
    journalEntryId: row.journal_entry_id, journalNumber: row.journal_number, paymentJournalEntryId: row.payment_journal_entry_id, paymentJournalNumber: row.payment_journal_number,
    reversalJournalEntryId: row.reversal_journal_entry_id, reversedAt: row.reversed_at, reversalReason: row.reversal_reason, createdBy: row.created_by_name, createdAt: row.created_at, version: row.version,
    canApprove: row.status === "SUBMITTED" && hasPermission(context, ACCOUNTING_PERMISSIONS.payablesApprove) && row.submitted_by !== context.userId,
  };
}

export async function listExpenses(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 20).toUpperCase()); where.push(`expense.status = $${values.length}`); }
  if (filters.search) { values.push(`%${text(filters.search, 100)}%`); where.push(`(expense.expense_number ILIKE $${values.length} OR expense.description ILIKE $${values.length} OR expense.payee_name ILIKE $${values.length})`); }
  const rows = (await client.query(`${EXPENSE_SELECT} WHERE expense.organization_id = $1${where.length ? ` AND ${where.join(" AND ")}` : ""} ORDER BY expense.expense_date DESC, expense.created_at DESC LIMIT 300`, values)).rows;
  return rows.map((row) => expenseView(row, context));
}

export async function getExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(`${EXPENSE_SELECT} WHERE expense.organization_id = $1 AND expense.id = $2`, [context.organizationId, uuid(idValue, "Expense")])).rows[0];
  if (!row) fail(404, "Expense not found.", "ACCOUNTING_EXPENSE_NOT_FOUND");
  return expenseView(row, context);
}

// input: { date, description, expenseAccountId, partyId?, payeeName?, supplierGstin?, supplierInvoiceReference?, amount (before GST),
//          gstTreatment: NO_GST | GST_CLAIM_ITC | GST_NO_ITC, gstSupply: INTRA_STATE | INTER_STATE, gstRate, settlement: PAID | PAYABLE,
//          paidFromAccountId (cash / bank, when paid), departmentId?, costCenterId?, submit?, idempotencyKey? }
export async function createExpense(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.accounting_expenses WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (existing) return getExpense(client, context, existing.id);
  }
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context);
  const description = text(input.description, 500);
  if (!description) fail(400, "Say what the expense was for.", "ACCOUNTING_EXPENSE_DESCRIPTION_REQUIRED");
  const date = dayText(input.date) ?? todayText();
  const account = await usableAccount(client, context, ledger.id, input.expenseAccountId, { label: "The expense account", classes: ["expense", "asset"] });
  const amount = money(input.amount);
  if (amount <= 0n) fail(400, "The amount must be more than zero.", "ACCOUNTING_EXPENSE_AMOUNT_INVALID");
  const treatment = ["NO_GST", "GST_CLAIM_ITC", "GST_NO_ITC"].includes(input.gstTreatment) ? input.gstTreatment : "NO_GST";
  const supply = treatment === "NO_GST" ? null : input.gstSupply === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE";
  const rate = treatment === "NO_GST" ? 0 : Number(input.gstRate);
  if (treatment !== "NO_GST" && !(rate > 0 && rate <= 100)) fail(400, "Give the GST rate.", "ACCOUNTING_EXPENSE_GST_RATE_INVALID");
  const tax = treatment === "NO_GST" ? 0n : roundMoney(div(mul(amount, decimal(rate)), decimal(100)), 2);
  const gstin = text(input.supplierGstin, 15).toUpperCase() || null;
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) fail(400, "The supplier GSTIN should be 15 characters.", "ACCOUNTING_EXPENSE_GSTIN_INVALID");
  if (treatment === "GST_CLAIM_ITC" && !gstin) fail(400, "Input tax credit needs the supplier's GSTIN.", "ACCOUNTING_EXPENSE_GSTIN_REQUIRED");
  const settlement = input.settlement === "PAYABLE" ? "PAYABLE" : "PAID";
  const paidFrom = settlement === "PAID" ? await usableAccount(client, context, ledger.id, input.paidFromAccountId, { label: "Paid from", types: ["cash", "bank"] }) : null;
  const partyId = optionalUuid(input.partyId, "Payee");
  if (partyId && !(await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, partyId])).rows[0])
    fail(404, "The payee is inactive or unavailable.", "ACCOUNTING_EXPENSE_PAYEE_INVALID");
  const number = await allocateNumber(client, context.organizationId, "accounting_expense");
  const row = (await client.query(
    `INSERT INTO tenant.accounting_expenses (organization_id, ledger_id, expense_number, expense_date, description, expense_account_id, party_id, payee_name, supplier_gstin,
       supplier_invoice_reference, currency_code, amount, gst_treatment, gst_supply, gst_rate, tax_amount, total_amount, settlement, paid_from_account_id, department_id, cost_center_id,
       idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [context.organizationId, ledger.id, number, date, description, account.id, partyId, text(input.payeeName, 200) || null, gstin, text(input.supplierInvoiceReference, 100) || null,
      String(organization.base_currency).trim(), out(amount), treatment, supply, String(rate), out(tax), out(amount + tax), settlement, paidFrom?.id ?? null,
      optionalUuid(input.departmentId, "Department"), optionalUuid(input.costCenterId, "Cost centre"), key, context.userId ?? null])).rows[0];
  if (input.submit) return submitExpense(client, context, row.id);
  return getExpense(client, context, row.id);
}

async function lockExpense(client, context, idValue) {
  const row = (await client.query(`SELECT * FROM tenant.accounting_expenses WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(idValue, "Expense")])).rows[0];
  if (!row) fail(404, "Expense not found.", "ACCOUNTING_EXPENSE_NOT_FOUND");
  return row;
}

// Submitted for approval — or, when the company does not require expense approval, posted at once.
export async function submitExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "SUBMITTED" || row.status === "POSTED") return getExpense(client, context, row.id);
  if (!["DRAFT", "REJECTED"].includes(row.status)) fail(409, `A ${row.status.toLowerCase()} expense cannot be submitted.`, "ACCOUNTING_EXPENSE_STATE_INVALID");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3, rejection_reason = NULL, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null]);
  const settings = (await client.query(`SELECT expense_approval_required FROM tenant.accounting_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (settings && settings.expense_approval_required === false) return postExpense(client, context, row.id, { selfApproved: true });
  return getExpense(client, context, row.id);
}

export async function approveExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "POSTED") return getExpense(client, context, row.id);
  if (row.status !== "SUBMITTED") fail(409, "Only a submitted expense is approved.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (row.submitted_by && row.submitted_by === context.userId) fail(409, "Someone other than the person who submitted it approves an expense.", "ACCOUNTING_EXPENSE_SELF_APPROVAL");
  return postExpense(client, context, row.id, {});
}

export async function rejectExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status !== "SUBMITTED") fail(409, "Only a submitted expense is sent back.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the expense is sent back.", "ACCOUNTING_EXPENSE_REASON_REQUIRED");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'REJECTED', rejection_reason = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason]);
  return getExpense(client, context, row.id);
}

export async function cancelExpense(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const row = await lockExpense(client, context, idValue);
  if (!["DRAFT", "REJECTED", "SUBMITTED"].includes(row.status)) fail(409, "A posted expense is reversed, not cancelled.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  return getExpense(client, context, row.id);
}

// The GST components of an expense, as a tax-engine line: intra-state CGST + SGST (half each, SGST taking the odd paisa), inter-state IGST.
function expenseTaxLine(row) {
  const tax = decimal(row.tax_amount);
  const components = row.gst_supply === "INTER_STATE"
    ? [{ taxType: "igst", taxableAmount: String(row.amount), taxAmount: out(tax) }]
    : (() => { const half = roundMoney(div(tax, decimal(2)), 2); return [{ taxType: "cgst", taxableAmount: String(row.amount), taxAmount: out(half) }, { taxType: "sgst", taxableAmount: String(row.amount), taxAmount: out(tax - half) }]; })();
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
  lines.push({ accountId: credit.account_id, partyId: row.party_id ?? undefined, description: `${row.settlement === "PAID" ? "Paid" : "Payable"} · ${row.expense_number}`, debit: 0,
    credit: String(row.total_amount), referenceType: "expense", referenceId: row.id });
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
  await client.query(
    `UPDATE tenant.accounting_expenses SET status = 'POSTED', approved_at = now(), approved_by = $3, journal_entry_id = $4, posted_at = now(), posted_by = $3,
            paid_at = CASE WHEN settlement = 'PAID' THEN now() ELSE NULL END, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, selfApproved ? row.submitted_by ?? context.userId : context.userId, journal.entry.id]);
  return getExpense(client, context, row.id);
}

// An expense recorded as payable is paid: Dr expense claims payable, Cr the cash or bank account it was paid from.
export async function payExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const row = await lockExpense(client, context, idValue);
  if (row.status !== "POSTED" || row.settlement !== "PAYABLE") fail(409, "Only a posted expense recorded as payable is paid here.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  if (row.payment_journal_entry_id) return getExpense(client, context, row.id);
  const ledger = await getPrimaryLedger(client, context);
  const from = await usableAccount(client, context, ledger.id, input.paidFromAccountId, { label: "Paid from", types: ["cash", "bank"] });
  const date = dayText(input.date) ?? todayText();
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
  await client.query(`UPDATE tenant.accounting_expenses SET paid_at = now(), paid_from_account_id = $3, payment_journal_entry_id = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, from.id, journal.entry.id]);
  return getExpense(client, context, row.id);
}

// A posted expense entered in error: its payment, any input tax credit decision and the expense itself are reversed, newest first.
export async function reverseExpense(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const row = await lockExpense(client, context, idValue);
  if (row.status === "REVERSED") return getExpense(client, context, row.id);
  if (row.status !== "POSTED") fail(409, "Only a posted expense is reversed.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the expense is reversed.", "ACCOUNTING_EXPENSE_REASON_REQUIRED");
  const reversing = elevated(context, ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.journalCreate);
  if (row.payment_journal_entry_id) await reverseJournalEntry(client, reversing, row.payment_journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  const itc = (await client.query(`SELECT journal_entry_id FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'itc_decision' AND source_id = $2 AND status = 'POSTED'`,
    [context.organizationId, row.id])).rows[0];
  if (itc) await reverseJournalEntry(client, reversing, itc.journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  const reversal = await reverseJournalEntry(client, reversing, row.journal_entry_id, { reason: `${row.expense_number}: ${reason}` });
  await client.query(`UPDATE tenant.accounting_tax_ledger SET status = 'reversed' WHERE organization_id = $1 AND source_type = 'expense' AND source_id = $2 AND status = 'open'`, [context.organizationId, row.id]);
  await client.query(`UPDATE tenant.accounting_expenses SET status = 'REVERSED', reversal_journal_entry_id = $3, reversed_at = now(), reversed_by = $4, reversal_reason = $5, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, reversal.entry?.id ?? reversal.id ?? null, context.userId ?? null, reason]);
  return getExpense(client, context, row.id);
}

// ================================================================== fund transfers
const TRANSFER_SELECT = `SELECT transfer.*, source.code AS from_code, source.name AS from_name, target.code AS to_code, target.name AS to_name, entry.entry_number AS journal_number,
       creator.full_name AS created_by_name
  FROM tenant.accounting_fund_transfers transfer
  JOIN tenant.accounting_accounts source ON source.id = transfer.from_account_id
  JOIN tenant.accounting_accounts target ON target.id = transfer.to_account_id
  LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = transfer.journal_entry_id
  LEFT JOIN public.users creator ON creator.id = transfer.created_by`;
const transferView = (row) => ({
  id: row.id, number: row.transfer_number, date: dayText(row.transfer_date), from: { id: row.from_account_id, label: `${row.from_code} · ${row.from_name}` },
  to: { id: row.to_account_id, label: `${row.to_code} · ${row.to_name}` }, amount: String(row.amount), currency: row.currency_code, reference: row.reference, description: row.description,
  status: row.status, journalEntryId: row.journal_entry_id, journalNumber: row.journal_number, reversalJournalEntryId: row.reversal_journal_entry_id, reversedAt: row.reversed_at,
  reversalReason: row.reversal_reason, createdBy: row.created_by_name, createdAt: row.created_at,
});

export async function listFundTransfers(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  return (await client.query(`${TRANSFER_SELECT} WHERE transfer.organization_id = $1 ORDER BY transfer.transfer_date DESC, transfer.created_at DESC LIMIT 300`, [context.organizationId])).rows.map(transferView);
}

async function getFundTransfer(client, context, id) {
  return transferView((await client.query(`${TRANSFER_SELECT} WHERE transfer.organization_id = $1 AND transfer.id = $2`, [context.organizationId, id])).rows[0]);
}

// input: { date, fromAccountId, toAccountId (cash or bank accounts), amount, reference?, description?, idempotencyKey? }
export async function createFundTransfer(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.accounting_fund_transfers WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (existing) return getFundTransfer(client, context, existing.id);
  }
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context);
  const from = await usableAccount(client, context, ledger.id, input.fromAccountId, { label: "Transfer from", types: ["cash", "bank"] });
  const to = await usableAccount(client, context, ledger.id, input.toAccountId, { label: "Transfer to", types: ["cash", "bank"] });
  if (from.id === to.id) fail(400, "Choose two different accounts.", "ACCOUNTING_TRANSFER_SAME_ACCOUNT");
  const amount = money(input.amount);
  if (amount <= 0n) fail(400, "The amount must be more than zero.", "ACCOUNTING_TRANSFER_AMOUNT_INVALID");
  const date = dayText(input.date) ?? todayText();
  const number = await allocateNumber(client, context.organizationId, "accounting_fund_transfer");
  const currencyCode = String(organization.base_currency).trim();
  const row = (await client.query(
    `INSERT INTO tenant.accounting_fund_transfers (organization_id, ledger_id, transfer_number, transfer_date, from_account_id, to_account_id, amount, currency_code, reference, description,
       idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [context.organizationId, ledger.id, number, date, from.id, to.id, out(amount), currencyCode, text(input.reference, 200) || null, text(input.description, 500) || null, key, context.userId ?? null])).rows[0];
  const internal = elevated(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const what = text(input.description, 200) || `Transfer ${from.code} → ${to.code}`;
  const journal = await createJournalEntry(client, internal, {
    ledgerId: ledger.id, journalId: await journalOfType(client, context, ledger.id, ["bank", "cash", "general"], "A Bank, Cash or General"), entryDate: date, accountingDate: date, documentDate: date,
    entryType: "subledger", reference: text(input.reference, 200) || number, description: `${number} · ${what}`, currencyCode,
    lines: [
      { accountId: to.id, description: `${what} (in)`, debit: out(amount), credit: 0, referenceType: "fund_transfer", referenceId: row.id },
      { accountId: from.id, description: `${what} (out)`, debit: 0, credit: out(amount), referenceType: "fund_transfer", referenceId: row.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "fund_transfer", sourceId: row.id, sourceNumber: number });
  await postJournalEntry(client, internal, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(`UPDATE tenant.accounting_fund_transfers SET journal_entry_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, journal.entry.id]);
  return getFundTransfer(client, context, row.id);
}

export async function reverseFundTransfer(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const row = (await client.query(`SELECT * FROM tenant.accounting_fund_transfers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(idValue, "Transfer")])).rows[0];
  if (!row) fail(404, "Transfer not found.", "ACCOUNTING_TRANSFER_NOT_FOUND");
  if (row.status === "REVERSED") return getFundTransfer(client, context, row.id);
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why the transfer is reversed.", "ACCOUNTING_TRANSFER_REASON_REQUIRED");
  const reversal = await reverseJournalEntry(client, elevated(context, ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.journalCreate), row.journal_entry_id, { reason: `${row.transfer_number}: ${reason}` });
  await client.query(`UPDATE tenant.accounting_fund_transfers SET status = 'REVERSED', reversal_journal_entry_id = $3, reversed_at = now(), reversed_by = $4, reversal_reason = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reversal.entry?.id ?? reversal.id ?? null, context.userId ?? null, reason]);
  return getFundTransfer(client, context, row.id);
}

// ================================================================== opening balances
// Customer and supplier balances (so they can be collected and paid) and stock (so it can be issued) have their own opening documents.
const CONTROL_TYPES = Object.freeze({
  receivable: "Customer balances are entered as opening customer invoices, so they can be collected.",
  payable: "Supplier balances are entered as opening supplier bills, so they can be paid.",
  inventory: "Stock is entered in Inventory › Opening stock, so it has quantities and costs.",
});

async function openingView(client, context, id) {
  const row = (await client.query(
    `SELECT opening.*, submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name, creator.full_name AS created_by_name, entry.entry_number AS journal_number
       FROM tenant.accounting_opening_balances opening
       LEFT JOIN public.users submitter ON submitter.id = opening.submitted_by
       LEFT JOIN public.users approver ON approver.id = opening.approved_by
       LEFT JOIN public.users creator ON creator.id = opening.created_by
       LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = opening.journal_entry_id
      WHERE opening.organization_id = $1 AND opening.id = $2`, [context.organizationId, id])).rows[0];
  if (!row) fail(404, "Opening balances not found.", "ACCOUNTING_OPENING_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.*, account.code, account.name FROM tenant.accounting_opening_balance_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
      WHERE line.organization_id = $1 AND line.opening_balance_id = $2 ORDER BY line.sequence`, [context.organizationId, id])).rows;
  return {
    id: row.id, number: row.document_number, asOfDate: dayText(row.as_of_date), description: row.description, status: row.status,
    totalDebit: String(row.total_debit), totalCredit: String(row.total_credit), balancingAmount: String(row.balancing_amount),
    submittedBy: row.submitted_by_name, submittedAt: row.submitted_at, approvedBy: row.approved_by_name, approvedAt: row.approved_at, rejectionReason: row.rejection_reason,
    journalEntryId: row.journal_entry_id, journalNumber: row.journal_number, reversalJournalEntryId: row.reversal_journal_entry_id, reversedAt: row.reversed_at, reversalReason: row.reversal_reason,
    createdBy: row.created_by_name, createdAt: row.created_at, version: row.version,
    canApprove: row.status === "SUBMITTED" && hasPermission(context, ACCOUNTING_PERMISSIONS.journalApprove) && row.submitted_by !== context.userId,
    lines: lines.map((line) => ({ accountId: line.account_id, account: `${line.code} · ${line.name}`, description: line.description, debit: String(line.debit), credit: String(line.credit) })),
  };
}

export async function listOpeningBalances(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const rows = (await client.query(`SELECT id FROM tenant.accounting_opening_balances WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`, [context.organizationId])).rows;
  const result = [];
  for (const row of rows) result.push(await openingView(client, context, row.id));
  return result;
}

export async function getOpeningBalances(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  return openingView(client, context, uuid(idValue, "Opening balances"));
}

async function writeOpeningLines(client, context, ledgerId, openingId, linesInput) {
  if (!Array.isArray(linesInput) || !linesInput.length) fail(400, "Add at least one account balance.", "ACCOUNTING_OPENING_LINES_REQUIRED");
  await client.query(`DELETE FROM tenant.accounting_opening_balance_lines WHERE organization_id = $1 AND opening_balance_id = $2`, [context.organizationId, openingId]);
  let debitTotal = 0n;
  let creditTotal = 0n;
  const seen = new Set();
  for (const [index, line] of linesInput.entries()) {
    const account = await usableAccount(client, context, ledgerId, line.accountId, { label: `Line ${index + 1}: the account` });
    if (CONTROL_TYPES[account.account_type]) fail(409, `Line ${index + 1} (${account.code} · ${account.name}): ${CONTROL_TYPES[account.account_type]}`, "ACCOUNTING_OPENING_CONTROL_ACCOUNT");
    if (seen.has(account.id)) fail(409, `${account.code} · ${account.name} appears twice; enter one balance per account.`, "ACCOUNTING_OPENING_DUPLICATE_ACCOUNT");
    seen.add(account.id);
    const debit = money(line.debit);
    const credit = money(line.credit);
    if (debit < 0n || credit < 0n || (debit > 0n) === (credit > 0n)) fail(400, `Line ${index + 1}: enter either a debit or a credit balance.`, "ACCOUNTING_OPENING_LINE_INVALID");
    debitTotal += debit;
    creditTotal += credit;
    await client.query(`INSERT INTO tenant.accounting_opening_balance_lines (organization_id, opening_balance_id, sequence, account_id, description, debit, credit) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [context.organizationId, openingId, index + 1, account.id, text(line.description, 300) || null, out(debit), out(credit)]);
  }
  await client.query(`UPDATE tenant.accounting_opening_balances SET total_debit = $3, total_credit = $4, balancing_amount = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, openingId, out(debitTotal), out(creditTotal), out(debitTotal - creditTotal)]);
}

// input: { asOfDate, description, lines: [{ accountId, debit | credit, description? }] }
export async function saveOpeningBalances(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const ledger = await getPrimaryLedger(client, context);
  const asOfDate = dayText(input.asOfDate);
  if (!asOfDate) fail(400, "Give the date the balances are as of.", "ACCOUNTING_OPENING_DATE_REQUIRED");
  const description = text(input.description, 300) || `Opening balances as of ${asOfDate}`;
  let id = input.id ? uuid(input.id, "Opening balances") : null;
  if (id) {
    const row = (await client.query(`SELECT status FROM tenant.accounting_opening_balances WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, id])).rows[0];
    if (!row) fail(404, "Opening balances not found.", "ACCOUNTING_OPENING_NOT_FOUND");
    if (!["DRAFT", "REJECTED"].includes(row.status)) fail(409, "Only draft or sent-back opening balances are edited.", "ACCOUNTING_OPENING_STATE_INVALID");
    await client.query(`UPDATE tenant.accounting_opening_balances SET as_of_date = $3, description = $4, status = 'DRAFT', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, id, asOfDate, description]);
  } else {
    const number = await allocateNumber(client, context.organizationId, "accounting_opening_balance");
    id = (await client.query(`INSERT INTO tenant.accounting_opening_balances (organization_id, ledger_id, document_number, as_of_date, description, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [context.organizationId, ledger.id, number, asOfDate, description, context.userId ?? null])).rows[0].id;
  }
  await writeOpeningLines(client, context, ledger.id, id, input.lines);
  return openingView(client, context, id);
}

async function lockOpening(client, context, idValue) {
  const row = (await client.query(`SELECT * FROM tenant.accounting_opening_balances WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(idValue, "Opening balances")])).rows[0];
  if (!row) fail(404, "Opening balances not found.", "ACCOUNTING_OPENING_NOT_FOUND");
  return row;
}

export async function submitOpeningBalances(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalSubmit);
  const row = await lockOpening(client, context, idValue);
  if (row.status !== "DRAFT" && row.status !== "REJECTED") fail(409, "Only draft opening balances are submitted.", "ACCOUNTING_OPENING_STATE_INVALID");
  await client.query(`UPDATE tenant.accounting_opening_balances SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3, rejection_reason = NULL, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null]);
  return openingView(client, context, row.id);
}

export async function rejectOpeningBalances(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalApprove);
  const row = await lockOpening(client, context, idValue);
  if (row.status !== "SUBMITTED") fail(409, "Only submitted opening balances are sent back.", "ACCOUNTING_OPENING_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why they are sent back.", "ACCOUNTING_OPENING_REASON_REQUIRED");
  await client.query(`UPDATE tenant.accounting_opening_balances SET status = 'REJECTED', rejection_reason = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason]);
  return openingView(client, context, row.id);
}

// Approved by someone other than the person who submitted them, and posted: one opening journal, any difference to opening balance equity.
export async function approveOpeningBalances(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalApprove);
  const row = await lockOpening(client, context, idValue);
  if (row.status === "POSTED") return openingView(client, context, row.id);
  if (row.status !== "SUBMITTED") fail(409, "Only submitted opening balances are approved.", "ACCOUNTING_OPENING_STATE_INVALID");
  if (row.submitted_by === context.userId) fail(409, "Someone other than the person who submitted them approves opening balances.", "ACCOUNTING_OPENING_SELF_APPROVAL");
  const organization = await loadOrganization(client, context);
  const date = dayText(row.as_of_date);
  const internal = elevated(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const sourceLines = (await client.query(`SELECT * FROM tenant.accounting_opening_balance_lines WHERE organization_id = $1 AND opening_balance_id = $2 ORDER BY sequence`, [context.organizationId, row.id])).rows;
  const lines = sourceLines.map((line) => ({ accountId: line.account_id, description: line.description || row.description, debit: String(line.debit), credit: String(line.credit),
    referenceType: "opening_balance", referenceId: row.id }));
  const difference = decimal(row.total_debit) - decimal(row.total_credit);
  if (difference !== 0n) {
    const equity = await getAccountMapping(client, internal, row.ledger_id, "opening_balance_equity", { date });
    lines.push({ accountId: equity.account_id, description: `Opening balance difference · ${row.document_number}`, debit: difference < 0n ? out(-difference) : 0, credit: difference > 0n ? out(difference) : 0,
      referenceType: "opening_balance", referenceId: row.id });
  }
  if (lines.length < 2) fail(409, "Opening balances need at least one balance and its other side.", "ACCOUNTING_OPENING_LINES_REQUIRED");
  const journal = await createJournalEntry(client, internal, {
    ledgerId: row.ledger_id, journalId: await journalOfType(client, context, row.ledger_id, ["opening", "general"], "An Opening balance or General"), entryDate: date, accountingDate: date, documentDate: date,
    entryType: "opening", reference: row.document_number, description: row.description, currencyCode: String(organization.base_currency).trim(), lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "opening_balance", sourceId: row.id, sourceNumber: row.document_number });
  await postJournalEntry(client, internal, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(`UPDATE tenant.accounting_opening_balances SET status = 'POSTED', approved_at = now(), approved_by = $3, journal_entry_id = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null, journal.entry.id]);
  return openingView(client, context, row.id);
}

export async function reverseOpeningBalances(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalReverse);
  const row = await lockOpening(client, context, idValue);
  if (row.status === "REVERSED") return openingView(client, context, row.id);
  if (row.status !== "POSTED") fail(409, "Only posted opening balances are reversed.", "ACCOUNTING_OPENING_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) fail(400, "Say why they are reversed.", "ACCOUNTING_OPENING_REASON_REQUIRED");
  const reversal = await reverseJournalEntry(client, elevated(context, ACCOUNTING_PERMISSIONS.journalCreate), row.journal_entry_id, { reason: `${row.document_number}: ${reason}` });
  await client.query(`UPDATE tenant.accounting_opening_balances SET status = 'REVERSED', reversal_journal_entry_id = $3, reversed_at = now(), reversed_by = $4, reversal_reason = $5, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, reversal.entry?.id ?? reversal.id ?? null, context.userId ?? null, reason]);
  return openingView(client, context, row.id);
}

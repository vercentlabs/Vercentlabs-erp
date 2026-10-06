// A credit note's life: Draft → Posted, or a draft Cancelled; a posted credit
// note posted in error Reversed.
//
// Posting is one transaction under the source invoice's lock: the credit note
// is checked again (the invoice still posted, every line's quantity and value
// against what posted credit notes have left, so of two drafts for the same
// last units only the first posted goes through; the reason; the accounting
// period; the totals). Its values are worked out again over what is credited
// now, Finance makes it the customer's credit and enters it in the books
// (receivable, revenue and output tax taken back), and it is applied to the
// source invoice for as much as the invoice still owes. What is left is the
// customer's credit, for Finance to apply to other invoices or refund.
// Posting twice posts once. The invoice itself is never changed.
import { getOpenPeriod } from "../../accounting/core.js";
import { applyCustomerCreditNote, cancelCustomerInvoiceDraft, postCustomerInvoice, reverseCustomerCreditNote } from "../../accounting/receivables.js";
import { submitSubledgerDocument } from "../../accounting/subledger-approvals.js";
import { dayOf, text } from "../orders/constants.js";
import { financeContext, financeError, loadCreditNote, recordCreditNoteEvent, requireCreditNotePermission } from "./access.js";
import { EPSILON, creditNoteLines, creditableLines } from "./build.js";
import { CREDIT_NOTE_PERMISSIONS, CREDIT_NOTE_STATUS, CREDIT_TYPES, CreditNoteError, FINANCE_POSTED } from "./constants.js";
import { loadSourceInvoice, rewriteDraft } from "./records.js";

// Everything that stops the credit note being posted now, and the warnings.
export async function postingProblems(client, context, creditNote) {
  const problems = [];
  const warnings = [];
  const problem = (code, message) => problems.push({ code, message });
  const source = (await client.query(`SELECT status, invoice_number, invoice_date FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, creditNote.source_invoice_id])).rows[0];
  if (!source || !FINANCE_POSTED.includes(source.status))
    problem("SALES_INVOICE_NOT_POSTED", `Invoice ${source?.invoice_number ?? ""} is ${source?.status === "reversed" ? "reversed" : "no longer posted"}.`.replace("  ", " "));
  const lines = await creditNoteLines(client, context.organizationId, creditNote.id);
  if (!lines.length) problem("SALES_CREDIT_NOTE_EMPTY", "The credit note has no lines.");
  const left = new Map((await creditableLines(client, context.organizationId, creditNote.source_invoice_id, { exceptCreditNoteId: creditNote.id })).map((line) => [line.id, line]));
  for (const line of lines) {
    const state = left.get(line.source_invoice_line_id);
    if (!state) { problem("SALES_CREDIT_NOTE_LINE_NOT_FOUND", `${line.item_name_snapshot} is no longer on the invoice.`); continue; }
    if (line.credit_type === CREDIT_TYPES.quantity) {
      if (Number(line.quantity) > state.quantityLeft + EPSILON)
        problem("SALES_CREDIT_NOTE_EXCEEDS_QUANTITY", `${line.item_name_snapshot}: only ${state.quantityLeft} ${line.uom_snapshot ?? ""} is left to credit; the credit note credits ${Number(line.quantity)}.`.replace("  ", " "));
      else if (state.draftQuantity > EPSILON && Number(line.quantity) + state.draftQuantity > state.quantityLeft + EPSILON)
        warnings.push({ code: "SALES_CREDIT_NOTE_DRAFT_CONFLICT", message: `${line.item_name_snapshot}: draft ${state.draftCreditNotes.join(", ")} also credit this line; only ${state.quantityLeft} is left, so not all of them can be posted.` });
    }
    if (Number(line.net_amount) > state.valueLeft + 0.005)
      problem("SALES_CREDIT_NOTE_EXCEEDS_VALUE", `${line.item_name_snapshot}: only ${state.valueLeft.toFixed(2)} of its value is left to credit; the credit note credits ${Number(line.net_amount).toFixed(2)}.`);
  }
  if (creditNote.reason_code === "other" && !creditNote.reason_note) problem("SALES_CREDIT_NOTE_REASON_REQUIRED", "Explain the reason for the credit note.");
  const lineTotal = lines.reduce((total, line) => total + Number(line.line_total), 0);
  if (Number(creditNote.grand_total) <= 0) problem("SALES_CREDIT_NOTE_TOTAL_INVALID", "The credit note total must be more than zero.");
  else if (Math.abs(lineTotal - Number(creditNote.grand_total)) > 0.005) problem("SALES_CREDIT_NOTE_TOTAL_INVALID", "The credit note lines do not add up to its total.");
  if (source && dayOf(creditNote.invoice_date) < dayOf(source.invoice_date)) problem("SALES_CREDIT_NOTE_DATE_INVALID", "The credit note date is before the invoice date.");
  try {
    await getOpenPeriod(client, context, dayOf(creditNote.accounting_date));
  } catch (error) {
    problem("SALES_CREDIT_NOTE_PERIOD_CLOSED", `Posting date ${dayOf(creditNote.accounting_date)}: ${error.message}`);
  }
  return { problems, warnings };
}

// Whether the credit note can be posted now, and why not.
export async function validateCreditNoteForPosting(client, context, creditNoteId) {
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  if (!["draft", "approved"].includes(creditNote.status)) return { ready: false, problems: [{ code: "SALES_CREDIT_NOTE_LOCKED", message: "The credit note is not a draft." }], warnings: [] };
  const result = await postingProblems(client, context, creditNote);
  return { ready: result.problems.length === 0, ...result };
}

async function lockBoth(client, context, creditNoteId) {
  // The source invoice is locked first, as everything that credits it does, then the credit note.
  const seen = await loadCreditNote(client, context, creditNoteId);
  await loadSourceInvoice(client, context, seen.source_invoice_id, { lock: true });
  return loadCreditNote(client, context, creditNoteId, { lock: true });
}

// Posts the credit note and applies it to the source invoice. input: { expectedVersion? }
// Returns { creditNoteId, creditNoteNumber, status, applied, unapplied, replayed, awaitingApproval? }.
export async function postCreditNote(client, context, creditNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.post, "You do not have permission to post credit notes.");
  const creditNote = await lockBoth(client, context, creditNoteId);
  const result = (extra) => ({ creditNoteId: creditNote.id, creditNoteNumber: creditNote.invoice_number, ...extra });
  if (FINANCE_POSTED.includes(creditNote.status)) return result({ status: CREDIT_NOTE_STATUS.posted, replayed: true });
  if (creditNote.status === "pending_approval") return result({ status: CREDIT_NOTE_STATUS.draft, awaitingApproval: true, replayed: true });
  if (!["draft", "approved"].includes(creditNote.status)) throw new CreditNoteError(409, `A ${creditNote.status} credit note cannot be posted.`, "SALES_CREDIT_NOTE_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(creditNote.version))
    throw new CreditNoteError(409, "Someone else changed this credit note. Reload it and try again.", "SALES_CREDIT_NOTE_VERSION_CONFLICT");
  const { problems } = await postingProblems(client, context, creditNote);
  if (problems.length)
    throw new CreditNoteError(409, `The credit note cannot be posted: ${problems.map((entry) => entry.message).join(" ")}`, problems[0].code, { problems });
  // The shares of each invoice line over what is credited now: posted credit notes add up to the invoice exactly.
  if (creditNote.status === "draft") await rewriteDraft(client, context, creditNote, { creditDate: dayOf(creditNote.invoice_date) });
  const finance = financeContext(context);
  try {
    if (creditNote.status === "draft") {
      // Finance's approval policy still applies: above its threshold the credit note waits for a Finance approver.
      const submitted = await submitSubledgerDocument(client, finance, "customer_invoice", creditNote.id);
      if (submitted.status === "pending_approval") {
        await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.submitted_for_approval", CREDIT_NOTE_STATUS.draft, CREDIT_NOTE_STATUS.draft, {});
        return result({ status: CREDIT_NOTE_STATUS.draft, awaitingApproval: true, replayed: false });
      }
    }
    await postCustomerInvoice(client, finance, creditNote.id, { internal: true, fromSales: true });
  } catch (error) {
    throw financeError(error, "The credit note could not be posted");
  }
  // Applied to the source invoice for as much as it still owes; the rest is the customer's credit.
  const amounts = (await client.query(
    `SELECT credit.outstanding_amount AS credit_left, source.outstanding_amount AS source_left, source.status AS source_status, credit.grand_total, credit.journal_entry_id
       FROM tenant.accounting_customer_invoices credit JOIN tenant.accounting_customer_invoices source ON source.id = credit.source_invoice_id
      WHERE credit.organization_id = $1 AND credit.id = $2`, [context.organizationId, creditNote.id])).rows[0];
  const apply = Math.min(Number(amounts.credit_left), ["posted", "partially_paid", "overdue", "disputed"].includes(amounts.source_status) ? Number(amounts.source_left) : 0);
  const applied = Math.round(apply * 100) / 100;
  if (applied > 0.005) {
    try {
      await applyCustomerCreditNote(client, finance, creditNote.id, { allocations: [{ invoiceId: creditNote.source_invoice_id, amount: applied.toFixed(2) }] });
    } catch (error) {
      throw financeError(error, "The credit note could not be applied to the invoice");
    }
  }
  const unapplied = Math.round((Number(amounts.grand_total) - applied) * 100) / 100;
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.posted", CREDIT_NOTE_STATUS.draft, CREDIT_NOTE_STATUS.posted, {
    creditNoteNumber: creditNote.invoice_number, total: amounts.grand_total, journalEntryId: amounts.journal_entry_id, invoiceNumber: creditNote.source_invoice_number,
    applied, customerCredit: unapplied,
  });
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'invoice_request', $2, 'sales_invoice.credit_note_posted', 'posted', 'posted', $3::jsonb, $4, clock_timestamp())`,
    [context.organizationId, creditNote.source_invoice_id, JSON.stringify({ creditNoteId: creditNote.id, creditNoteNumber: creditNote.invoice_number, total: amounts.grand_total, applied }),
      context.userId ?? null]);
  return result({ status: CREDIT_NOTE_STATUS.posted, applied, unapplied, replayed: false });
}

// Cancels a draft. The number is kept, cancelled; nothing reached the books. input: { reason? }
export async function cancelDraftCreditNote(client, context, creditNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.edit, "You do not have permission to cancel credit notes.");
  const creditNote = await lockBoth(client, context, creditNoteId);
  if (creditNote.status === "cancelled") return { creditNoteId: creditNote.id, status: CREDIT_NOTE_STATUS.cancelled, changed: false };
  let result;
  try {
    result = await cancelCustomerInvoiceDraft(client, financeContext(context), creditNote.id, { reason: input.reason }, { internal: true });
  } catch (error) {
    throw financeError(error, "The credit note could not be cancelled");
  }
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.cancelled", CREDIT_NOTE_STATUS.draft, CREDIT_NOTE_STATUS.cancelled, { reason: text(input.reason, 1000) ?? undefined });
  return { creditNoteId: creditNote.id, status: CREDIT_NOTE_STATUS.cancelled, changed: result.changed };
}

// Reverses a posted credit note posted in error: it is unapplied from the invoices it was applied to (they
// owe it again), the journal is reversed, the output tax restored; it is kept, Reversed. input: { reason }
export async function reverseCreditNote(client, context, creditNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.reverse, "You do not have permission to reverse credit notes.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new CreditNoteError(400, "Give the reason for reversing the credit note.", "SALES_CREDIT_NOTE_REASON_REQUIRED", { field: "reason" });
  const creditNote = await lockBoth(client, context, creditNoteId);
  if (creditNote.status === "reversed") return { creditNoteId: creditNote.id, status: CREDIT_NOTE_STATUS.reversed, changed: false };
  let result;
  try {
    result = await reverseCustomerCreditNote(client, financeContext(context), creditNote.id, { reason }, { internal: true });
  } catch (error) {
    throw financeError(error, "The credit note could not be reversed");
  }
  await client.query(
    `UPDATE tenant.sales_credit_notes SET reversed_at = now(), reversed_by = $3, reversal_reason = $4, reversal_journal_entry_id = $5, updated_at = now()
      WHERE organization_id = $1 AND customer_invoice_id = $2`, [context.organizationId, creditNote.id, context.userId ?? null, reason, result.reversalEntryId ?? null]);
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.reversed", CREDIT_NOTE_STATUS.posted, CREDIT_NOTE_STATUS.reversed, { reason, unapplied: result.unapplied });
  return { creditNoteId: creditNote.id, status: CREDIT_NOTE_STATUS.reversed, changed: true, unapplied: result.unapplied };
}

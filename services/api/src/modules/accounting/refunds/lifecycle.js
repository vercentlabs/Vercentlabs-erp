// A refund's life: Draft → Posted, or a draft Cancelled; a posted refund
// entered in error Reversed.
//
// Posting is the financial event, in one transaction under the credit
// source's lock: the refund is checked again (the source still posted and
// the customer's; the amount against the credit left now, so of two drafts
// for the same credit only the first posted goes through; the bank or cash
// account; the date and accounting period), the credit is consumed, and the
// money movement is entered in the books: the customer's account is debited
// (the credit it carried is settled) and the bank or cash account credited,
// on Finance's own account mappings. No revenue, no tax, no stock: the
// credit note already did that. Posting twice posts once.
//
// Reversal takes the money movement back with a reversing entry and gives
// the credit back to its source; the refund is kept, Reversed. It never
// makes a new credit note.
import { ACCOUNTING_PERMISSIONS, asDatabaseDecimal, decimal, getAccountMapping, getOpenPeriod, isoDate, text } from "../core.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "../journals.js";
import { bankJournal, reduceInvoiceSchedules, restoreInvoiceSchedules } from "../receivables.js";
import {
  REFUND_METHODS, REFUND_PERMISSIONS, REFUND_SOURCE, REFUND_SOURCE_LABELS, REFUND_STATUS, RefundError, refundMethodLabel, requireRefundPermission,
} from "./constants.js";
import { loadRefund, loadRefundAccount, loadRefundSource, recordRefundEvent } from "./records.js";

const num = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const dayOf = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value ?? "").slice(0, 10));
// Finance's own steps run on the refund permission checked here.
const internal = (context) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.view, ACCOUNTING_PERMISSIONS.journalReverse])] });

// Everything that stops the refund being posted now, and the warnings.
export async function postingProblems(client, context, refund, source) {
  const problems = [];
  const warnings = [];
  const problem = (code, message, field) => problems.push({ code, message, field });
  const amount = num(refund.amount);
  if (!source.open) problem("ACCOUNTING_REFUND_SOURCE_INVALID", source.why);
  else if (amount > source.available + 0.005)
    problem("ACCOUNTING_REFUND_EXCEEDS_CREDIT", `Only ${source.available.toFixed(2)} ${source.currency_code} of ${source.number} can be refunded now; the refund is for ${amount.toFixed(2)}.`, "amount");
  if (source.party_id !== refund.party_id) problem("ACCOUNTING_REFUND_CUSTOMER_MISMATCH", `${source.number} belongs to another customer.`);
  if (String(source.currency_code).trim() !== String(refund.currency_code).trim()) problem("ACCOUNTING_REFUND_CURRENCY_MISMATCH", `${source.number} is in ${source.currency_code}; the refund must be in the same currency.`);
  if (amount <= 0) problem("ACCOUNTING_REFUND_AMOUNT_INVALID", "The refund amount must be more than zero.", "amount");
  if (!REFUND_METHODS.some((entry) => entry.code === refund.payment_method)) problem("ACCOUNTING_REFUND_METHOD_INVALID", "Choose how the refund is paid.", "paymentMethod");
  if (!refund.bank_account_id) problem("ACCOUNTING_REFUND_ACCOUNT_REQUIRED", "Choose the bank or cash account the refund is paid from.", "bankAccountId");
  else {
    try {
      await loadRefundAccount(client, context, refund.bank_account_id, refund);
    } catch (error) {
      if (!(error instanceof RefundError)) throw error;
      problem(error.code, error.message, "bankAccountId");
    }
  }
  if (refund.reason_code === "other" && !refund.reason_note) problem("ACCOUNTING_REFUND_REASON_REQUIRED", "Explain the reason for the refund.", "reasonNote");
  const refundDate = dayOf(refund.refund_date);
  if (refundDate < dayOf(source.date)) problem("ACCOUNTING_REFUND_DATE_INVALID", `The refund date is before ${source.number} (${dayOf(source.date)}).`, "refundDate");
  const today = (await client.query(`SELECT current_date::text AS day`)).rows[0].day;
  if (refundDate > today) problem("ACCOUNTING_REFUND_DATE_INVALID", "The refund date cannot be in the future: a refund is posted when the money is paid.", "refundDate");
  try {
    await getOpenPeriod(client, context, dayOf(refund.accounting_date));
  } catch (error) {
    problem("ACCOUNTING_REFUND_PERIOD_CLOSED", `Posting date ${dayOf(refund.accounting_date)}: ${error.message}`, "refundDate");
  }
  // The same bank reference on another refund is usually the same payment entered twice.
  if (refund.external_reference) {
    const twins = (await client.query(
      `SELECT refund_number FROM tenant.accounting_customer_refunds
        WHERE organization_id = $1 AND id <> $2 AND status IN ('draft', 'posted') AND lower(btrim(external_reference)) = lower(btrim($3))`,
      [context.organizationId, refund.id, refund.external_reference])).rows;
    if (twins.length)
      warnings.push({ code: "ACCOUNTING_REFUND_DUPLICATE_REFERENCE", message: `Reference ${refund.external_reference} is also on ${twins.map((row) => row.refund_number).join(", ")}. Check this is not the same payment entered twice.` });
  }
  // Credit can settle what the customer still owes instead of being paid back.
  const owed = (await client.query(
    `SELECT COALESCE(sum(outstanding_amount), 0) AS amount, count(*)::int AS invoices FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = $2 AND btrim(currency_code) = $3 AND invoice_type <> 'credit_note' AND status IN ('posted', 'partially_paid', 'overdue', 'disputed')
        AND outstanding_amount > 0`, [context.organizationId, refund.party_id, String(refund.currency_code).trim()])).rows[0];
  if (Number(owed.amount) > 0.005)
    warnings.push({ code: "ACCOUNTING_REFUND_CUSTOMER_OWES", message: `The customer still owes ${num(owed.amount).toFixed(2)} ${String(refund.currency_code).trim()} on ${owed.invoices} open invoice(s). The credit can be applied to them instead of being refunded.` });
  const drafts = (await client.query(
    `SELECT other.refund_number, allocation.amount FROM tenant.accounting_customer_refund_allocations allocation
       JOIN tenant.accounting_customer_refunds other ON other.id = allocation.refund_id AND other.status = 'draft' AND other.id <> $3
      WHERE allocation.organization_id = $1 AND allocation.${source.type === REFUND_SOURCE.creditNote ? "credit_note_id" : "receipt_id"} = $2`,
    [context.organizationId, source.id, refund.id])).rows;
  if (source.open && drafts.length && amount + drafts.reduce((total, row) => total + Number(row.amount), 0) > source.available + 0.005)
    warnings.push({ code: "ACCOUNTING_REFUND_DRAFT_CONFLICT", message: `Draft ${drafts.map((row) => row.refund_number).join(", ")} also refund ${source.number}; together they take more than the ${source.available.toFixed(2)} left, so only the first posted goes through.` });
  return { problems, warnings };
}

// Whether the refund can be posted now, and why not.
export async function validateRefundForPosting(client, context, refundId) {
  const refund = await loadRefund(client, context, refundId);
  if (refund.status !== REFUND_STATUS.draft) return { ready: false, problems: [{ code: "ACCOUNTING_REFUND_LOCKED", message: "The refund is not a draft." }], warnings: [] };
  const source = await loadRefundSource(client, context, refund.source);
  const result = await postingProblems(client, context, refund, source);
  return { ready: result.problems.length === 0, ...result };
}

// The credit source is locked first, as everything that consumes it does, then the refund.
async function lockBoth(client, context, refundId) {
  const seen = await loadRefund(client, context, refundId);
  const source = await loadRefundSource(client, context, seen.source, { lock: true });
  return { refund: await loadRefund(client, context, refundId, { lock: true }), source };
}

// Takes `amount` of the source's credit (negative gives it back).
async function allocateRefundAgainstCustomerCredit(client, context, source, amount, giveBack = false) {
  const value = decimal(amount);
  if (source.type === REFUND_SOURCE.creditNote) {
    const credit = (await client.query(`SELECT outstanding_amount, grand_total, status FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, source.id])).rows[0];
    const left = giveBack ? decimal(credit.outstanding_amount) + value : decimal(credit.outstanding_amount) - value;
    if (left < 0n || left > decimal(credit.grand_total)) throw new RefundError(409, `Credit note ${source.number} no longer has that credit.`, "ACCOUNTING_REFUND_EXCEEDS_CREDIT");
    if (giveBack) await restoreInvoiceSchedules(client, context, source.id, value);
    else await reduceInvoiceSchedules(client, context, source.id, value);
    const status = left === 0n ? "paid" : left === decimal(credit.grand_total) ? "posted" : "partially_paid";
    await client.query(`UPDATE tenant.accounting_customer_invoices SET outstanding_amount = $3, status = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, source.id, asDatabaseDecimal(left), status, context.userId ?? null]);
    return { from: credit.status, to: status, left: asDatabaseDecimal(left) };
  }
  const receipt = (await client.query(`SELECT unapplied_amount, amount, status FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, source.id])).rows[0];
  const left = giveBack ? decimal(receipt.unapplied_amount) + value : decimal(receipt.unapplied_amount) - value;
  if (left < 0n || left > decimal(receipt.amount)) throw new RefundError(409, `Receipt ${source.number} no longer has that amount unapplied.`, "ACCOUNTING_REFUND_EXCEEDS_CREDIT");
  const status = left === 0n ? "applied" : left === decimal(receipt.amount) ? "posted" : "partially_applied";
  await client.query(`UPDATE tenant.accounting_customer_receipts SET unapplied_amount = $3, status = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, source.id, asDatabaseDecimal(left), status, context.userId ?? null]);
  return { from: receipt.status, to: status, left: asDatabaseDecimal(left) };
}
const sourceEntity = (source) => (source.type === REFUND_SOURCE.creditNote ? "customer_invoice" : "customer_receipt");

// Posts the refund. The poster may complete the payment details as the money is paid.
// input: { expectedVersion?, bankAccountId?, paymentMethod?, externalReference?, refundDate? }
// Returns { refundId, refundNumber, status, replayed, creditLeft? }.
export async function postCustomerRefund(client, context, refundId, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.post, "You do not have permission to post refunds.");
  let { refund, source } = await lockBoth(client, context, refundId);
  const result = (extra) => ({ refundId: refund.id, refundNumber: refund.refund_number, ...extra });
  if (refund.status === REFUND_STATUS.posted) return result({ status: REFUND_STATUS.posted, replayed: true });
  if (refund.status !== REFUND_STATUS.draft) throw new RefundError(409, `A ${refund.status} refund cannot be posted.`, "ACCOUNTING_REFUND_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(refund.version))
    throw new RefundError(409, "Someone else changed this refund. Reload it and try again.", "ACCOUNTING_REFUND_VERSION_CONFLICT");
  // Payment details entered at posting are saved on the draft first, so what is posted is what is kept.
  const sets = [];
  const values = [context.organizationId, refund.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (input.bankAccountId && input.bankAccountId !== refund.bank_account_id) {
    requireRefundPermission(context, REFUND_PERMISSIONS.selectAccount, "You do not have permission to choose the bank or cash account.");
    set("bank_account_id", (await loadRefundAccount(client, context, input.bankAccountId, refund)).id);
  }
  if (input.paymentMethod && input.paymentMethod !== refund.payment_method) {
    if (!REFUND_METHODS.some((entry) => entry.code === input.paymentMethod)) throw new RefundError(400, "Choose how the refund is paid.", "ACCOUNTING_REFUND_METHOD_INVALID", { field: "paymentMethod" });
    set("payment_method", input.paymentMethod);
  }
  if (input.externalReference !== undefined && (text(input.externalReference, 200) || null) !== (refund.external_reference ?? null)) set("external_reference", text(input.externalReference, 200) || null);
  if (input.refundDate && isoDate(input.refundDate, "Refund date") !== dayOf(refund.refund_date)) { set("refund_date", isoDate(input.refundDate, "Refund date")); set("accounting_date", isoDate(input.refundDate, "Refund date")); }
  if (sets.length) {
    await client.query(`UPDATE tenant.accounting_customer_refunds SET ${sets.join(", ")}, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, values);
    refund = await loadRefund(client, context, refund.id, { lock: true });
  }
  const { problems } = await postingProblems(client, context, refund, source);
  if (problems.length) throw new RefundError(409, `The refund cannot be posted: ${problems.map((entry) => entry.message).join(" ")}`, problems[0].code, { problems });

  const finance = internal(context);
  const consumed = await allocateRefundAgainstCustomerCredit(client, finance, source, refund.amount);
  // The money movement: the customer's account is debited (its credit is settled), the bank or cash account credited.
  const bank = await bankJournal(client, finance, refund.ledger_id, refund.bank_account_id);
  if (!bank.journal_id) throw new RefundError(409, "A bank journal is not configured for this ledger.", "ACCOUNTING_REFUND_JOURNAL_MISSING");
  const customerAccount = await getAccountMapping(client, finance, refund.ledger_id, "receivable", { partyId: refund.party_id, date: refund.accounting_date });
  const reference = { referenceType: "customer_refund", referenceId: refund.id };
  const journal = await createJournalEntry(client, finance, {
    ledgerId: refund.ledger_id, journalId: bank.journal_id, entryDate: dayOf(refund.refund_date), accountingDate: dayOf(refund.accounting_date), documentDate: dayOf(refund.refund_date),
    entryType: "subledger", reference: refund.external_reference || refund.refund_number, description: `Customer refund ${refund.refund_number} (${REFUND_SOURCE_LABELS[source.type]} ${source.number})`,
    currencyCode: refund.currency_code, exchangeRate: refund.exchange_rate,
    lines: [
      { accountId: customerAccount.account_id, partyId: refund.party_id, description: `Customer credit refunded ${refund.refund_number}`, debit: refund.amount, credit: 0, ...reference },
      { accountId: bank.gl_account_id, description: `Refund paid ${refund.refund_number}`, debit: 0, credit: refund.amount, ...reference },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "customer_refund", sourceId: refund.id, sourceNumber: refund.refund_number });
  await postJournalEntry(client, finance, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(
    `UPDATE tenant.accounting_customer_refunds SET status = 'posted', journal_entry_id = $3, posted_at = now(), posted_by = $4, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, refund.id, journal.entry.id, context.userId ?? null]);
  const amount = asDatabaseDecimal(decimal(refund.amount));
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.posted", REFUND_STATUS.draft, REFUND_STATUS.posted, {
    refundNumber: refund.refund_number, amount, currencyCode: refund.currency_code, source: `${REFUND_SOURCE_LABELS[source.type]} ${source.number}`, creditLeft: consumed.left,
    paymentMethod: refundMethodLabel(refund.payment_method), reference: refund.external_reference ?? undefined, journalEntryId: journal.entry.id, journalEntryNumber: journal.entry.entry_number,
  });
  await client.query(
    `INSERT INTO tenant.accounting_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, 'accounting.customer_credit.refunded', $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, sourceEntity(source), source.id, consumed.from, consumed.to, JSON.stringify({ refundId: refund.id, refundNumber: refund.refund_number, amount, creditLeft: consumed.left }),
      context.userId ?? null]);
  return result({ status: REFUND_STATUS.posted, replayed: false, creditLeft: Number(consumed.left) });
}

// Cancels a draft: nothing was paid, nothing was consumed. The number is kept. input: { reason? }
export async function cancelDraftRefund(client, context, refundId, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.cancel, "You do not have permission to cancel refunds.");
  const refund = await loadRefund(client, context, refundId, { lock: true });
  if (refund.status === REFUND_STATUS.cancelled) return { refundId: refund.id, status: REFUND_STATUS.cancelled, changed: false };
  if (refund.status !== REFUND_STATUS.draft)
    throw new RefundError(409, "A posted refund is money that left: it is reversed, never cancelled.", "ACCOUNTING_REFUND_LOCKED");
  const reason = text(input.reason, 1000) || null;
  await client.query(
    `UPDATE tenant.accounting_customer_refunds SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, refund.id, context.userId ?? null, reason]);
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.cancelled", REFUND_STATUS.draft, REFUND_STATUS.cancelled, { reason: reason ?? undefined });
  return { refundId: refund.id, status: REFUND_STATUS.cancelled, changed: true };
}

// Reverses a posted refund entered in error: a reversing entry takes the money movement back and the
// credit returns to its source. The refund is kept, Reversed. input: { reason, accountingDate? }
export async function reverseCustomerRefund(client, context, refundId, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.reverse, "You do not have permission to reverse refunds.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new RefundError(400, "Give the reason for reversing the refund.", "ACCOUNTING_REFUND_REASON_REQUIRED", { field: "reason" });
  const { refund, source } = await lockBoth(client, context, refundId);
  if (refund.status === REFUND_STATUS.reversed) return { refundId: refund.id, status: REFUND_STATUS.reversed, changed: false };
  if (refund.status !== REFUND_STATUS.posted) throw new RefundError(409, "Only a posted refund can be reversed. Cancel a draft instead.", "ACCOUNTING_REFUND_NOT_POSTED");
  if (["reversed", "cancelled"].includes(source.status))
    throw new RefundError(409, `${source.number} is ${source.status}: its credit cannot be restored.`, "ACCOUNTING_REFUND_SOURCE_INVALID");
  const finance = internal(context);
  const reversal = await reverseJournalEntry(client, finance, refund.journal_entry_id, { reason: `Refund ${refund.refund_number} reversed: ${reason}`, accountingDate: input.accountingDate });
  const reversalEntryId = reversal.entry?.id ?? reversal.id;
  const restored = await allocateRefundAgainstCustomerCredit(client, finance, source, refund.amount, true);
  await client.query(
    `UPDATE tenant.accounting_customer_refunds SET status = 'reversed', reversed_at = now(), reversed_by = $3, reversal_reason = $4, reversal_journal_entry_id = $5, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, refund.id, context.userId ?? null, reason, reversalEntryId]);
  const amount = asDatabaseDecimal(decimal(refund.amount));
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.reversed", REFUND_STATUS.posted, REFUND_STATUS.reversed, {
    reason, amount, source: `${REFUND_SOURCE_LABELS[source.type]} ${source.number}`, creditRestored: amount, creditLeft: restored.left, reversalEntryId,
  });
  await client.query(
    `INSERT INTO tenant.accounting_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, 'accounting.customer_credit.refund_reversed', $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, sourceEntity(source), source.id, restored.from, restored.to, JSON.stringify({ refundId: refund.id, refundNumber: refund.refund_number, amount, creditLeft: restored.left, reason }),
      context.userId ?? null]);
  return { refundId: refund.id, status: REFUND_STATUS.reversed, changed: true, creditRestored: Number(amount), creditLeft: Number(restored.left) };
}

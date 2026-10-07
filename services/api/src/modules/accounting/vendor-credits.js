// Vendor credits in Finance: what happens to a posted vendor credit (a credit_note vendor document) after posting. A credit is not money: it
// reduces what the supplier is owed when applied to bills (applyVendorCreditNote), or the supplier pays it back (a refund). Neither ever
// takes more than the credit has left.
//
//   refund               Dr the bank account, Cr the supplier's payable account (the debit balance the credit left is settled); posted once —
//                        the same idempotency key returns the first refund
//   refund reversal      a refund entered in error: its entry is reversed and the credit gets the amount back
//   unapply              a credit taken off the bills it was applied to: each bill is owed again
//   credit reversal      a credit posted in error: never while a refund stands (reverse the refund first); applications are taken off the bills,
//                        then the credit's journals and tax entries are reversed
import {
  ACCOUNTING_PERMISSIONS, AccountingError, allocateNumber, asDatabaseDecimal, decimal, event, getAccountMapping, isoDate, positiveAmount, requirePermission, text, uuid,
} from "./core.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journals.js";
import { reduceBillSchedules, restoreBillSchedules, reverseVendorBill } from "./payables.js";
import { bankJournal } from "./receivables.js";

const OPEN_CREDIT = ["posted", "partially_paid"];
const reversing = (context) => ({ ...context, permissions: [...new Set([...(context.permissions || []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] });
const creditStatus = (credit, outstanding) => (outstanding <= 0n ? "paid" : outstanding >= decimal(credit.grand_total) ? "posted" : "partially_paid");

async function lockCredit(client, context, id) {
  const credit = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, uuid(id, "Vendor credit")])).rows[0];
  if (!credit || credit.bill_type !== "credit_note") throw new AccountingError(404, "Vendor credit not found.");
  return credit;
}

// recordVendorCreditRefund. input: { amount, refundDate?, bankAccountId?, reference, idempotencyKey? }
export async function recordVendorCreditRefund(client, context, creditNoteId, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT * FROM tenant.accounting_vendor_credit_refunds WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, key])).rows[0];
    if (existing) return { refund: existing, replayed: true };
  }
  const credit = await lockCredit(client, context, creditNoteId);
  if (!OPEN_CREDIT.includes(credit.status) || decimal(credit.outstanding_amount) <= 0n)
    throw new AccountingError(409, "Only a posted vendor credit with a balance left can be refunded.", "VENDOR_CREDIT_NOTHING_LEFT");
  const amount = positiveAmount(input.amount, "Refund amount");
  if (amount > decimal(credit.outstanding_amount))
    throw new AccountingError(409, `Only ${asDatabaseDecimal(decimal(credit.outstanding_amount))} of the credit is left to refund.`, "VENDOR_CREDIT_OVER_REFUND");
  const reference = text(input.reference, 200);
  if (!reference) throw new AccountingError(400, "Enter the bank reference of the refund.");
  const refundDate = isoDate(input.refundDate || new Date().toISOString().slice(0, 10), "Refund date");
  const bank = await bankJournal(client, context, credit.ledger_id, input.bankAccountId || null);
  const payable = await getAccountMapping(client, context, credit.ledger_id, "payable", { partyId: credit.party_id, date: refundDate });
  const number = await allocateNumber(client, context.organizationId, "vendor_credit_refund");
  const journal = await createJournalEntry(client, context, {
    ledgerId: credit.ledger_id, journalId: bank.journal_id, entryDate: refundDate, accountingDate: refundDate, entryType: "subledger", reference,
    description: `Supplier refund ${number} of ${credit.bill_number}`, currencyCode: credit.currency_code, exchangeRate: credit.exchange_rate, lines: [
      { accountId: bank.gl_account_id, description: `Refund received · ${credit.bill_number}`, debit: asDatabaseDecimal(amount), credit: 0, referenceType: "vendor_credit_refund", referenceId: credit.id },
      { accountId: payable.account_id, partyId: credit.party_id, description: `Supplier refund of credit ${credit.bill_number}`, debit: 0, credit: asDatabaseDecimal(amount),
        referenceType: "vendor_credit_refund", referenceId: credit.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "vendor_credit_refund", sourceId: credit.id, sourceNumber: number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const refund = (await client.query(
    `INSERT INTO tenant.accounting_vendor_credit_refunds (organization_id, credit_note_id, refund_number, amount, refund_date, bank_account_id, reference, journal_entry_id, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [context.organizationId, credit.id, number, asDatabaseDecimal(amount), refundDate, input.bankAccountId ? uuid(input.bankAccountId, "Bank account") : null, reference, journal.entry.id, key,
      context.userId ?? null])).rows[0];
  await reduceBillSchedules(client, context, credit.id, amount);
  const remaining = decimal(credit.outstanding_amount) - amount;
  const status = creditStatus(credit, remaining);
  await client.query(`UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3, status=$4, updated_by=$5, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, credit.id, asDatabaseDecimal(remaining), status, context.userId ?? null]);
  await event(client, context, "vendor_bill", credit.id, "accounting.vendor_credit.refunded", credit.status, status, { refundId: refund.id, amount: asDatabaseDecimal(amount), reference });
  return { refund, replayed: false };
}

// reverseVendorCreditRefund. input: { reason }
export async function reverseVendorCreditRefund(client, context, refundId, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const refund = (await client.query(`SELECT * FROM tenant.accounting_vendor_credit_refunds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, uuid(refundId, "Refund")])).rows[0];
  if (!refund) throw new AccountingError(404, "Refund not found.");
  if (refund.status === "reversed") return { refund, replayed: true };
  const reason = text(input.reason, 500);
  if (!reason) throw new AccountingError(400, "Give the reason for the reversal.");
  const credit = await lockCredit(client, context, refund.credit_note_id);
  const reversal = await reverseJournalEntry(client, reversing(context), refund.journal_entry_id, { reason: `Refund ${refund.refund_number} reversed: ${reason}` });
  await restoreBillSchedules(client, context, credit.id, refund.amount);
  const remaining = decimal(credit.outstanding_amount) + decimal(refund.amount);
  const status = creditStatus(credit, remaining);
  const updated = (await client.query(
    `UPDATE tenant.accounting_vendor_credit_refunds SET status='reversed', reversed_at=now(), reversal_reason=$3, reversal_journal_entry_id=$4 WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, refund.id, reason, reversal.entry?.id ?? reversal.id ?? null])).rows[0];
  await client.query(`UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3, status=$4, updated_by=$5, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, credit.id, asDatabaseDecimal(remaining), status, context.userId ?? null]);
  await event(client, context, "vendor_bill", credit.id, "accounting.vendor_credit.refund_reversed", credit.status, status, { refundId: refund.id, reason });
  return { refund: updated, replayed: false };
}

// unapplyVendorCreditNote: the credit taken off the bills it was applied to (one bill, or all). Each bill is owed again; the credit is
// available again. input: { billId?, reason }
export async function unapplyVendorCreditNote(client, context, creditNoteId, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const credit = await lockCredit(client, context, creditNoteId);
  const reason = text(input.reason, 500);
  if (!reason) throw new AccountingError(400, "Give the reason for taking the credit off the bill.");
  const values = [context.organizationId, credit.id];
  if (input.billId) values.push(uuid(input.billId, "Vendor bill"));
  const allocations = (await client.query(`SELECT * FROM tenant.accounting_vendor_credit_allocations WHERE organization_id=$1 AND credit_note_id=$2${input.billId ? " AND vendor_bill_id=$3" : ""} FOR UPDATE`,
    values)).rows;
  let total = 0n;
  for (const allocation of allocations) {
    const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, allocation.vendor_bill_id])).rows[0];
    const amount = decimal(allocation.allocated_amount);
    await restoreBillSchedules(client, context, bill.id, amount);
    const outstanding = decimal(bill.outstanding_amount) + amount;
    const status = outstanding >= decimal(bill.grand_total) ? "posted" : "partially_paid";
    await client.query(`UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3, status=$4, updated_by=$5, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, bill.id, asDatabaseDecimal(outstanding), status, context.userId ?? null]);
    await client.query(`DELETE FROM tenant.accounting_vendor_credit_allocations WHERE organization_id=$1 AND id=$2`, [context.organizationId, allocation.id]);
    await event(client, context, "vendor_bill", bill.id, "accounting.vendor_credit.unapplied", bill.status, status, { creditNoteId: credit.id, amount: asDatabaseDecimal(amount), reason });
    total += amount;
  }
  if (total > 0n) {
    await restoreBillSchedules(client, context, credit.id, total);
    const remaining = decimal(credit.outstanding_amount) + total;
    const status = creditStatus(credit, remaining);
    await client.query(`UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3, status=$4, updated_by=$5, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, credit.id, asDatabaseDecimal(remaining), status, context.userId ?? null]);
    await event(client, context, "vendor_bill", credit.id, "accounting.vendor_credit.unapplied", credit.status, status, { amount: asDatabaseDecimal(total), reason });
  }
  return { creditNoteId: credit.id, unapplied: asDatabaseDecimal(total), bills: allocations.map((allocation) => allocation.vendor_bill_id) };
}

// reverseVendorCreditNote: a posted credit entered in error. Blocked while a refund stands; applications are taken off their bills first.
// input: { reason }
export async function reverseVendorCreditNote(client, context, creditNoteId, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const credit = await lockCredit(client, context, creditNoteId);
  if (credit.status === "reversed") return { id: credit.id, status: "reversed", replayed: true };
  if (!["posted", "partially_paid", "paid"].includes(credit.status)) throw new AccountingError(409, "Only a posted vendor credit is reversed; a draft is cancelled.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new AccountingError(400, "Give the reason for the reversal.");
  const refunds = (await client.query(`SELECT count(*)::int AS count FROM tenant.accounting_vendor_credit_refunds WHERE organization_id=$1 AND credit_note_id=$2 AND status='posted'`,
    [context.organizationId, credit.id])).rows[0].count;
  if (refunds) throw new AccountingError(409, "The supplier refunded part of this credit: reverse the refund first.", "VENDOR_CREDIT_HAS_REFUNDS");
  const settling = { ...context, permissions: [...new Set([...(context.permissions || []), ACCOUNTING_PERMISSIONS.paymentsManage])] };
  const unapplied = await unapplyVendorCreditNote(client, settling, credit.id, { reason: `Credit ${credit.bill_number} reversed: ${reason}` });
  await reverseVendorBill(client, context, credit.id, { reason });
  return { id: credit.id, status: "reversed", unapplied: unapplied.unapplied, bills: unapplied.bills, replayed: false };
}

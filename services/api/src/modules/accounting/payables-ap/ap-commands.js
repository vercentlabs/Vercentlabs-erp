// Payables commands (Finance MVP F5): paying suppliers.
//
//   prepare     a payment is prepared with the bills it is meant to settle (or the oldest open ones). It is submitted at once: where the
//               company requires approval for supplier payments, a second person approves it — the amount, the supplier, the account and
//               the bills — before any money is recorded; otherwise it is approved and posted straight away.
//   post        an approved payment posts (Dr the supplier · Cr bank or cash) and applies its planned bills. A bill that has since been paid
//               by something else is settled only for what it still owes; whatever is not applied stays as an advance to the supplier
//               (never an expense).
//   apply       later money is applied like receipts: one payment settles many bills and many payments settle one bill, never beyond what a
//               bill owes or what the payment has left.
//   undo        an application made to the wrong bill is undone: the bill is owed again and the money is free again; the record stays.
//   discard     a draft or a payment sent back can be discarded with a reason; it never posts.
//   reverse     a posted payment that did not happen (a bounced cheque, a failed transfer) is reversed (payables.js reverseVendorPayment).
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, asDatabaseDecimal, event, requirePermission, requiredText, text, uuid } from "../core.js";
import { reverseJournalEntry } from "../journals.js";
import { allocateVendorPayment, createVendorPayment, postVendorPayment, restoreBillSchedules } from "../payables.js";
import { submitVendorPayment } from "../subledger-approvals.js";

const OPEN = ["posted", "partially_paid", "overdue", "disputed"];
const fail = (status, message, code, details) => { throw new AccountingError(status, message, code, details); };

async function lockPayment(client, context, idValue) {
  const payment = (await client.query("SELECT * FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, uuid(idValue, "Payment")])).rows[0];
  if (!payment) fail(404, "Payment not found.", "ACCOUNTING_PAYMENT_NOT_FOUND");
  return payment;
}

// A supplier's open bills in the payment's currency, oldest due first.
export async function openBillsFor(client, context, partyId, currencyCode) {
  return (await client.query(
    `SELECT id, bill_number, supplier_invoice_number, bill_date, due_date, grand_total, outstanding_amount, currency_code
       FROM tenant.accounting_vendor_bills
      WHERE organization_id = $1 AND party_id = $2 AND currency_code = $3 AND bill_type <> 'credit_note' AND status = ANY($4::text[]) AND outstanding_amount > 0
      ORDER BY due_date NULLS LAST, bill_date, bill_number`, [context.organizationId, partyId, currencyCode, OPEN])).rows;
}

function oldestFirst(bills, amount) {
  let left = amount;
  const plan = [];
  for (const bill of bills) {
    if (left <= 0n) break;
    const owed = decimal(bill.outstanding_amount);
    const take = owed < left ? owed : left;
    plan.push({ billId: bill.id, amount: formatDecimal(take) });
    left = sub(left, take);
  }
  return plan;
}

// Checks an application plan against the supplier's open bills and the money available.
async function checkPlan(client, context, payment, allocations, available) {
  const rows = (allocations ?? []).filter((entry) => decimal(entry.amount ?? 0) > 0n);
  const total = rows.reduce((sum, entry) => add(sum, decimal(entry.amount)), 0n);
  if (total > available) fail(409, `The payment has ${formatDecimal(available, 2)} to apply; ${formatDecimal(total, 2)} was entered.`, "ACCOUNTING_PAYMENT_OVER_APPLIED");
  const seen = new Set();
  for (const entry of rows) {
    const bill = (await client.query("SELECT bill_number, party_id, currency_code, outstanding_amount, status, bill_type FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2",
      [context.organizationId, uuid(entry.billId, "Bill")])).rows[0];
    if (!bill || bill.party_id !== payment.party_id || bill.bill_type === "credit_note" || !OPEN.includes(bill.status)) fail(409, "A bill is not open for this supplier.", "ACCOUNTING_BILL_NOT_OPEN");
    if (String(bill.currency_code).trim() !== String(payment.currency_code).trim()) fail(409, `${bill.bill_number} is in ${String(bill.currency_code).trim()}; this payment is in ${String(payment.currency_code).trim()}.`, "ACCOUNTING_PAYMENT_CURRENCY");
    if (decimal(entry.amount) > decimal(bill.outstanding_amount)) fail(409, `${bill.bill_number} still owes ${formatDecimal(bill.outstanding_amount, 2)}; it can't be paid ${formatDecimal(entry.amount, 2)}.`, "ACCOUNTING_BILL_OVER_SETTLED");
    if (seen.has(entry.billId)) fail(409, `${bill.bill_number} appears twice; enter it once.`, "ACCOUNTING_PAYMENT_ALLOCATION_INVALID");
    seen.add(entry.billId);
  }
  return rows.map((entry) => ({ billId: entry.billId, amount: formatDecimal(decimal(entry.amount)) }));
}

// input: { partyId, paymentDate, amount, currencyCode?, exchangeRate?, bankAccountId?, paymentMethod, reference?, notes?, allocations?, applyToOldest? }
export async function prepareVendorPayment(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const created = await createVendorPayment(client, context, {
    partyId: input.partyId, paymentDate: input.paymentDate, accountingDate: input.paymentDate, amount: input.amount, currencyCode: input.currencyCode || undefined,
    exchangeRate: input.exchangeRate || undefined, bankAccountId: input.bankAccountId || undefined, paymentMethod: input.paymentMethod, externalReference: input.reference,
  });
  const available = decimal(created.amount);
  const plan = input.applyToOldest === true
    ? oldestFirst(await openBillsFor(client, context, created.party_id, String(created.currency_code).trim()), available)
    : await checkPlan(client, context, created, input.allocations, available);
  await client.query("UPDATE tenant.accounting_vendor_payments SET planned_allocations = $3::jsonb, notes = $4 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, created.id, JSON.stringify(plan), text(input.notes, 2000) || null]);
  const submitted = await submitVendorPayment(client, context, created.id);
  if (submitted.status === "approved") await postApprovedPayment(client, context, created.id);
  return { id: created.id, number: created.payment_number, status: submitted.status === "approved" ? "posted" : submitted.status };
}

// Posts an approved payment and applies the bills it was approved for (each only for what it still owes).
export async function postApprovedPayment(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const payment = await lockPayment(client, context, idValue);
  if (payment.status !== "approved") fail(409, payment.status === "pending_approval" ? "This payment is still awaiting approval." : "Only an approved payment is posted.", "ACCOUNTING_PAYMENT_NOT_APPROVED");
  await postVendorPayment(client, context, payment.id);
  const skipped = [];
  const allocations = [];
  for (const planned of payment.planned_allocations ?? []) {
    const bill = (await client.query("SELECT bill_number, outstanding_amount, status FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2",
      [context.organizationId, planned.billId])).rows[0];
    const owed = bill && OPEN.includes(bill.status) ? decimal(bill.outstanding_amount) : 0n;
    const amount = decimal(planned.amount) < owed ? decimal(planned.amount) : owed;
    if (amount > 0n) allocations.push({ billId: planned.billId, paymentAmount: formatDecimal(amount), billAmount: formatDecimal(amount) });
    if (amount < decimal(planned.amount)) skipped.push(bill?.bill_number ?? "a bill");
  }
  if (allocations.length) await allocateVendorPayment(client, context, payment.id, { allocations });
  if (skipped.length) await event(client, context, "vendor_payment", payment.id, "accounting.vendor_payment.plan_adjusted", "posted", "posted",
    { reason: `Already paid in part since approval: ${skipped.join(", ")}. The rest stays as an advance.` });
  return { id: payment.id, skipped };
}

// Applies (part of) a posted payment to bills. allocations: [{ billId, amount }]
export async function applyPayment(client, context, paymentIdValue, { allocations } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const payment = await lockPayment(client, context, paymentIdValue);
  if (!["posted", "partially_applied"].includes(payment.status)) fail(409, "Only a posted payment with money left can be applied.", "ACCOUNTING_PAYMENT_NOT_APPLICABLE");
  const plan = await checkPlan(client, context, payment, allocations, decimal(payment.unapplied_amount));
  if (!plan.length) fail(400, "Enter the amount to apply to at least one bill.", "ACCOUNTING_PAYMENT_ALLOCATION_INVALID");
  await allocateVendorPayment(client, context, payment.id, { allocations: plan.map((entry) => ({ billId: entry.billId, paymentAmount: entry.amount, billAmount: entry.amount })) });
  return { id: payment.id };
}

export async function applyPaymentToOldest(client, context, paymentIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const payment = await lockPayment(client, context, paymentIdValue);
  const plan = oldestFirst(await openBillsFor(client, context, payment.party_id, String(payment.currency_code).trim()), decimal(payment.unapplied_amount));
  if (!plan.length) fail(409, "This supplier has no open bill in the payment's currency.", "ACCOUNTING_PAYMENT_NOTHING_OPEN");
  return applyPayment(client, context, payment.id, { allocations: plan });
}

// Undoes one application of a payment to a bill.
export async function undoPaymentAllocation(client, context, allocationIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const why = requiredText(reason, "Reason", 500);
  const allocation = (await client.query(
    `SELECT allocation.* FROM tenant.accounting_vendor_payment_allocations allocation
      WHERE allocation.organization_id = $1 AND allocation.id = $2
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals undone WHERE undone.organization_id = $1 AND undone.allocation_id = allocation.id)`,
    [context.organizationId, uuid(allocationIdValue, "Application")])).rows[0];
  if (!allocation) fail(409, "That application was not found, or was already undone.", "ACCOUNTING_ALLOCATION_UNDONE");
  const payment = await lockPayment(client, context, allocation.payment_id);
  if (payment.status === "reversed") fail(409, "The payment is reversed.", "ACCOUNTING_PAYMENT_REVERSED");
  const bill = (await client.query("SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, allocation.vendor_bill_id])).rows[0];
  const outstanding = add(decimal(bill.outstanding_amount), decimal(allocation.allocated_amount));
  await restoreBillSchedules(client, context, bill.id, allocation.allocated_amount);
  const billStatus = outstanding >= decimal(bill.grand_total) ? "posted" : "partially_paid";
  await client.query("UPDATE tenant.accounting_vendor_bills SET outstanding_amount = $3, status = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, bill.id, asDatabaseDecimal(outstanding), billStatus, context.userId ?? null]);
  if (allocation.adjustment_journal_entry_id) {
    const reversing = { ...context, permissions: [...new Set([...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] };
    await reverseJournalEntry(client, reversing, allocation.adjustment_journal_entry_id, { reason: `${payment.payment_number} / ${bill.bill_number} undone: ${why}` });
  }
  await client.query(
    `INSERT INTO tenant.accounting_vendor_payment_allocation_reversals (organization_id, allocation_id, payment_id, vendor_bill_id, amount, payment_amount, reason, reversed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, allocation.id, payment.id, bill.id, allocation.allocated_amount, allocation.payment_amount, why, context.userId ?? null]);
  const unapplied = add(decimal(payment.unapplied_amount), decimal(allocation.payment_amount));
  const status = unapplied >= decimal(payment.amount) ? "posted" : "partially_applied";
  await client.query("UPDATE tenant.accounting_vendor_payments SET unapplied_amount = $3, status = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, payment.id, asDatabaseDecimal(unapplied), status, context.userId ?? null]);
  await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.payment_undone", bill.status, billStatus, { paymentId: payment.id, reason: why });
  await event(client, context, "vendor_payment", payment.id, "accounting.vendor_payment.application_undone", payment.status, status, { allocationId: allocation.id, reason: why });
  return { id: payment.id };
}

// Discards a draft (or a payment sent back by the approver): kept, marked cancelled, never posts.
export async function discardVendorPayment(client, context, paymentIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const why = requiredText(reason, "Reason", 500);
  const payment = await lockPayment(client, context, paymentIdValue);
  if (payment.status !== "draft") fail(409, payment.status === "pending_approval" ? "This payment is awaiting approval; ask the approver to send it back first." : "Only a draft payment can be discarded.",
    "ACCOUNTING_PAYMENT_NOT_DRAFT");
  await client.query("UPDATE tenant.accounting_vendor_payments SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, updated_by = $3 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, payment.id, context.userId ?? null, why]);
  await event(client, context, "vendor_payment", payment.id, "accounting.vendor_payment.discarded", "draft", "cancelled", { reason: why });
  return { id: payment.id };
}

// Resubmits a payment sent back for changes (its bills or amount unchanged; to change them, discard it and prepare a new one).
export async function resubmitVendorPayment(client, context, paymentIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const payment = await lockPayment(client, context, paymentIdValue);
  if (payment.status !== "draft") fail(409, "Only a payment sent back for changes is resubmitted.", "ACCOUNTING_PAYMENT_NOT_DRAFT");
  const submitted = await submitVendorPayment(client, context, payment.id);
  if (submitted.status === "approved") await postApprovedPayment(client, context, payment.id);
  return { id: payment.id };
}

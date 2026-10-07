// Paying a supplier bill, from the bill, through Finance: a supplier payment (bank, cash, cheque, UPI…) recorded, submitted to Finance's
// approval policy, posted and allocated to the bill; a supplier advance (a posted payment not yet allocated) or a posted vendor credit
// with credit left applied to it. The bill's paid amount and balance are what Finance's allocations leave — never set by hand.
import { decimal, formatDecimal } from "../../../core/decimal.js";
import {
  AccountingError, allocateVendorPayment, createVendorPayment, postVendorPayment, reverseVendorPayment, submitSubledgerDocument,
} from "../../accounting/index.js";
import { requirePoPermission } from "../purchase-orders/access.js";
import { allocateVendorCreditToBills } from "../vendor-credits/settlement.js";
import { fin, loadBill } from "./bills.js";
import { BILL_PERMISSIONS, SupplierBillError, fail, optionalUuid, readDate, requireUuid, text } from "./constants.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const OPEN = ["posted", "partially_paid", "overdue", "disputed"];

async function finance(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountingError) throw new SupplierBillError(error.status ?? 409, error.message, error.code === "ACCOUNTING_ERROR" ? "SUPPLIER_PAYMENT_FINANCE" : error.code);
    throw error;
  }
}

async function openBill(client, context, billId) {
  const bill = await loadBill(client, context, billId, { lock: true });
  if (bill.bill_type !== "bill" || !OPEN.includes(bill.status) || decimal(bill.outstanding_amount) <= 0n)
    throw new SupplierBillError(409, "Only a posted bill with a balance due can be paid.", "SUPPLIER_BILL_NOT_PAYABLE");
  return bill;
}

// recordSupplierBillPayment. input: { amount, paymentDate?, paymentMethod?, bankAccountId?, reference?, idempotencyKey? }
export async function recordSupplierBillPayment(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to record supplier payments.");
  const bill = await openBill(client, context, billId);
  const raw = String(input.amount ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || decimal(raw) <= 0n) fail("Enter the amount paid.", "amount", "SUPPLIER_PAYMENT_AMOUNT_INVALID");
  if (decimal(raw) > decimal(bill.outstanding_amount)) fail(`Only ${dec(bill.outstanding_amount)} is due on ${bill.bill_number}. Record any advance from Finance.`, "amount", "SUPPLIER_PAYMENT_EXCEEDS_DUE", 409);
  const method = ["cash", "bank_transfer", "card", "upi", "cheque", "gateway", "other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer";
  const payment = await finance(() => createVendorPayment(client, fin(context), {
    partyId: bill.party_id, paymentDate: readDate(input.paymentDate, "Payment date") ?? undefined, currencyCode: bill.currency_code.trim(), amount: raw, paymentMethod: method,
    bankAccountId: optionalUuid(input.bankAccountId, "Bank account") ?? undefined, externalReference: text(input.reference, 120) ?? undefined,
  }));
  const submitted = await finance(() => submitSubledgerDocument(client, fin(context), "vendor_payment", payment.id));
  if (submitted.status === "pending_approval") return { paymentId: payment.id, paymentNumber: payment.payment_number, status: "awaiting_approval" };
  await finance(() => postVendorPayment(client, fin(context), payment.id));
  await finance(() => allocateVendorPayment(client, fin(context), payment.id, { allocations: [{ billId: bill.id, amount: raw }] }));
  return { paymentId: payment.id, paymentNumber: payment.payment_number, status: "posted", amount: raw };
}

// completeSupplierBillPayment: once Finance approved a payment recorded from the bill, it is posted and allocated to the bill. input: { paymentId }
export async function completeSupplierBillPayment(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to record supplier payments.");
  const bill = await openBill(client, context, billId);
  const payment = (await client.query(`SELECT id, party_id, status, unapplied_amount, amount FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(input.paymentId, "Payment")])).rows[0];
  if (!payment || payment.party_id !== bill.party_id) fail("The payment must be one made to this supplier.", "paymentId", "SUPPLIER_PAYMENT_INVALID", 409);
  if (payment.status === "pending_approval") throw new SupplierBillError(409, "The payment is still awaiting Finance's approval.", "SUPPLIER_PAYMENT_PENDING");
  if (payment.status === "approved") await finance(() => postVendorPayment(client, fin(context), payment.id));
  const unapplied = (await client.query(`SELECT unapplied_amount FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2`, [context.organizationId, payment.id])).rows[0].unapplied_amount;
  const amount = decimal(unapplied) < decimal(bill.outstanding_amount) ? decimal(unapplied) : decimal(bill.outstanding_amount);
  if (amount > 0n) await finance(() => allocateVendorPayment(client, fin(context), payment.id, { allocations: [{ billId: bill.id, amount: dec(amount) }] }));
  return { paymentId: payment.id, status: "posted", amount: dec(amount) };
}

// applySupplierAdvance: an advance already paid to the supplier (a posted payment with an unapplied amount) settles part of the bill. input: { paymentId, amount }
export async function applySupplierAdvance(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to apply supplier advances.");
  const bill = await openBill(client, context, billId);
  const payment = (await client.query(`SELECT id, party_id, unapplied_amount, status FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(input.paymentId, "Advance")])).rows[0];
  if (!payment || payment.party_id !== bill.party_id) fail("The advance must be one paid to this supplier.", "paymentId", "SUPPLIER_ADVANCE_INVALID", 409);
  const amount = input.amount ? String(input.amount).trim() : dec(decimal(payment.unapplied_amount) < decimal(bill.outstanding_amount) ? payment.unapplied_amount : bill.outstanding_amount);
  await finance(() => allocateVendorPayment(client, fin(context), payment.id, { allocations: [{ billId: bill.id, amount }] }));
  return { billId: bill.id, applied: amount };
}

// applySupplierCredit: a posted vendor credit with credit left reduces the bill (the same checks as applying it from the credit). input: { creditId, amount? }
export async function applySupplierCredit(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to apply supplier credits.");
  const bill = await openBill(client, context, billId);
  const note = (await client.query(`SELECT id, party_id, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2 AND bill_type = 'credit_note'`,
    [context.organizationId, requireUuid(input.creditId, "Vendor credit")])).rows[0];
  if (!note || note.party_id !== bill.party_id) fail("The credit must be one of this supplier's.", "creditId", "SUPPLIER_CREDIT_INVALID", 409);
  const amount = input.amount ? String(input.amount).trim() : dec(decimal(note.outstanding_amount) < decimal(bill.outstanding_amount) ? note.outstanding_amount : bill.outstanding_amount);
  await allocateVendorCreditToBills(client, context, note.id, { allocations: [{ billId: bill.id, amount }], idempotencyKey: input.idempotencyKey });
  return { billId: bill.id, applied: amount };
}

// reverseSupplierPayment: a payment that did not happen (bounced, in error). Finance reverses it and the bills it settled are owed again. input: { reason }
export async function reverseSupplierPayment(client, context, paymentId, input = {}) {
  requirePoPermission(context, "accounting.payments.approve", "You do not have permission to reverse supplier payments.");
  return finance(() => reverseVendorPayment(client, fin(context), requireUuid(paymentId, "Payment"), { reason: input.reason }));
}

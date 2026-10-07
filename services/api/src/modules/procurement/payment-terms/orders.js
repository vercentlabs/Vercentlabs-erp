// A purchase order's payment terms: the agreed term (its snapshot), the advance it expects and where that advance stands, and the statutory
// warning for a qualifying micro or small supplier. A confirmed order is a commitment, not a payable: nothing here posts to Accounts Payable.
//
// Advances are Finance's supplier advances — a supplier payment not yet allocated to a bill — recorded against the order. When the bill
// posts, Finance applies the advance to it; the bill keeps its full value and the advance settles part of it. An advance is never a bill
// instalment and never counted twice.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { readTermSnapshot } from "../../../core/payment-terms/index.js";
import { AccountingError, createVendorPayment, postVendorPayment, submitSubledgerDocument } from "../../accounting/index.js";
import { loadPurchaseOrder, poCan } from "../purchase-orders/access.js";
import { PurchaseOrderError, dayOf, fail, optionalUuid, readDate, text } from "../purchase-orders/constants.js";
import { recordPoEvent } from "../purchase-orders/persist.js";
import { validateStatutoryPaymentDeadline } from "./statutory.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const fin = (context) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), "accounting.view"])] });
async function finance(work) {
  try { return await work(); } catch (error) {
    if (error instanceof AccountingError) throw new PurchaseOrderError(error.status ?? 409, error.message, error.code === "ACCOUNTING_ERROR" ? "PURCHASE_ORDER_ADVANCE_FINANCE" : error.code);
    throw error;
  }
}

// What the order's advances stand at: requested (the order), paid (posted supplier advances recorded against it), allocated to bills, remaining.
async function advanceTracking(client, context, order) {
  const requested = order.advance_amount === null ? 0n : decimal(order.advance_amount);
  const payments = (await client.query(
    `SELECT id, payment_number, payment_date, amount, unapplied_amount, status FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY payment_date, created_at`,
    [context.organizationId, order.id])).rows;
  const live = payments.filter((payment) => ["posted", "partially_applied", "applied"].includes(payment.status));
  const paid = live.reduce((total, payment) => add(total, decimal(payment.amount)), 0n);
  const unapplied = live.reduce((total, payment) => add(total, decimal(payment.unapplied_amount)), 0n);
  return {
    requested: dec(requested), paid: dec(paid), allocated: dec(sub(paid, unapplied)), unapplied: dec(unapplied), remaining: dec(requested > paid ? sub(requested, paid) : 0n),
    payments: payments.map((payment) => ({ id: payment.id, number: payment.payment_number, date: dayOf(payment.payment_date), amount: dec(payment.amount), unapplied: dec(payment.unapplied_amount),
      status: payment.status })),
  };
}

// getPurchaseOrderPaymentTerms: the order's terms, advance and statutory warning.
export async function getPurchaseOrderPaymentTerms(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId);
  const term = readTermSnapshot(order.payment_term_snapshot);
  const statutory = await validateStatutoryPaymentDeadline(client, context, { supplierId: order.supplier_id, termSnapshot: order.payment_term_snapshot, referenceDate: dayOf(order.order_date) });
  const canSeeMoney = poCan(context, "procurement.po.view") || poCan(context, "accounting.payables.manage");
  const advance = order.advance_percentage === null ? null : {
    percentage: String(Number(order.advance_percentage)), amount: dec(order.advance_amount), ...(canSeeMoney ? await advanceTracking(client, context, order) : {}),
  };
  return {
    orderId: order.id, paymentTerm: term && { id: term.id, code: term.code, name: term.name, termType: term.termType, termTypeLabel: term.termTypeLabel, summary: term.summary, version: term.version,
      rules: term.rules },
    paymentAgreement: term ? term.rules.map((rule) => ({ invoice_date: "From the supplier invoice date", invoice_received: "From the invoice received date", posting_date: "From the posting date" }[rule.basis]))
      .filter((value, index, all) => all.indexOf(value) === index).join("; ") : null,
    advance, notes: order.payment_terms_note, changeReason: order.payment_term_change_reason,
    statutory: statutory.applies ? { statutoryDays: statutory.statutoryDays, exceeds: statutory.exceeds, message: statutory.message, classification: statutory.rule.classification,
      basis: statutory.rule.reason } : null,
    actions: { recordAdvance: Boolean(advance) && order.status === "confirmed" && poCan(context, "accounting.payments.manage") },
  };
}

// recordPurchaseOrderAdvance: Finance pays the supplier the advance the confirmed order expects — a supplier advance (a supplier payment not
// allocated to any bill) recorded against the order. Never more than the advance still requested. The same idempotency key records it once.
// input: { amount, paymentDate?, paymentMethod?, bankAccountId?, reference?, idempotencyKey? }
export async function recordPurchaseOrderAdvance(client, context, orderId, input = {}) {
  if (!poCan(context, "accounting.payments.manage")) throw new PurchaseOrderError(403, "You do not have permission to record supplier advances.", "PERMISSION_DENIED");
  // Finance pays the advance: it reads the order it pays against.
  const order = await loadPurchaseOrder(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "procurement.po.view", "procurement.po.view_all"])] }, orderId, { lock: true });
  if (order.status !== "confirmed") throw new PurchaseOrderError(409, "An advance is paid against a confirmed order.", "PURCHASE_ORDER_NOT_CONFIRMED");
  if (order.advance_percentage === null) throw new PurchaseOrderError(409, "The order's payment terms expect no advance.", "PURCHASE_ORDER_NO_ADVANCE");
  const idempotency = await beginIdempotentOperation(client, context, { operation: "procurement.purchase_order.advance", key: text(input.idempotencyKey, 200),
    payload: { orderId: order.id, ...input, idempotencyKey: undefined } });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const raw = String(input.amount ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || decimal(raw) <= 0n) fail("Enter the advance paid.", "amount", "PURCHASE_ORDER_ADVANCE_INVALID");
  const tracking = await advanceTracking(client, context, order);
  if (decimal(raw) > decimal(tracking.remaining)) fail(`Only ${tracking.remaining} of the ${tracking.requested} advance is still to be paid.`, "amount", "PURCHASE_ORDER_ADVANCE_EXCEEDED", 409);
  const method = ["cash", "bank_transfer", "card", "upi", "cheque", "gateway", "other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer";
  const reference = text(input.reference, 100);
  const payment = await finance(() => createVendorPayment(client, fin(context), {
    partyId: order.party_id, paymentDate: readDate(input.paymentDate, "Payment date") ?? undefined, currencyCode: order.currency_code.trim(), amount: raw, paymentMethod: method,
    bankAccountId: optionalUuid(input.bankAccountId, "Bank account") ?? undefined, externalReference: reference ?? `Advance ${order.purchase_order_number}`,
  }));
  await client.query(`UPDATE tenant.accounting_vendor_payments SET purchase_order_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, payment.id, order.id]);
  const submitted = await finance(() => submitSubledgerDocument(client, fin(context), "vendor_payment", payment.id));
  let status = "awaiting_approval";
  if (submitted.status !== "pending_approval") { await finance(() => postVendorPayment(client, fin(context), payment.id)); status = "posted"; }
  await recordPoEvent(client, context, order.id, "purchase_order.advance_recorded", `Supplier advance ${payment.payment_number} of ${raw} ${status === "posted" ? "paid" : "recorded, awaiting approval"}`,
    { details: { paymentId: payment.id, amount: raw } });
  const response = { paymentId: payment.id, paymentNumber: payment.payment_number, status, amount: raw, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "vendor_payment", aggregateId: payment.id });
  return response;
}

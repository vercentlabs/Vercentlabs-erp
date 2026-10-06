// getSalesOrderTracking: everything about where one sales order stands.
//
// A read model, rebuilt on every call from the documents that own each fact:
// the order and its line quantities, stock reservations, deliveries, posted
// invoices, Finance's receipts, received returns, credit notes and refunds.
// Nothing is stored for it, so it cannot drift from them. The same
// derivations (./derive.js) serve the list and the reports (./summary.js).
// Finance figures are shown only to those allowed to see an invoice's
// payments; never accounts, journals or bank details.
import { assertOrderVisible, orderCan } from "../orders/access.js";
import { ORDER_PERMISSIONS, OrderError, STATUS, dayOf, requireUuid } from "../orders/constants.js";
import { loadOrderLineProgress } from "../orders/progress.js";
import { invoicingOfLine } from "../invoices/build.js";
import { basisOfSetting } from "../invoices/constants.js";
import { computeOrderAvailability } from "../availability/service.js";
import { CREDIT_DUE_SQL } from "../returns/records.js";
import {
  EPSILON, calculateOrderPaymentSummary, calculateOrderWarnings, deriveFulfillmentStatus, deriveInvoiceStatus, deriveOrderStatus, deriveReservationStatus, isOrderReadyToClose,
  isOrderReadyToDeliver, isOrderReadyToInvoice, trackLines,
} from "./derive.js";
import { invoicingBasisSetting, orderFinance } from "./summary.js";
import { buildOrderTimeline } from "./timeline.js";

export const TRACKING_PERMISSIONS = Object.freeze({ close: "sales.order.close", reopenClosed: "sales.order.reopen_closed", money: "sales.invoice.payments.view" });
const POSTED = ["posted", "partially_paid", "paid", "overdue", "disputed"];
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

async function loadOrder(client, context, orderId) {
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  const order = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.lifecycle_status, sales_order.party_id, sales_order.owner_user_id, sales_order.current_version_id,
            sales_order.order_date, sales_order.requested_delivery_date, sales_order.created_at, sales_order.confirmed_at, sales_order.closed_at, sales_order.cancelled_at,
            sales_order.cancel_reason_code, sales_order.cancel_reason, sales_order.closed_manually, sales_order.close_reason, sales_order.source_quotation_id,
            (sales_order.requested_delivery_date < current_date) AS requested_delivery_overdue, quotation.quotation_number AS source_quotation_number,
            version.grand_total, btrim(version.currency_code) AS currency_code, version.customer_snapshot->>'displayName' AS customer_name, version.customer_po_number,
            owner.full_name AS owner_name
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
       LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [context.organizationId, id])).rows[0];
  if (!order) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  return { ...order, requested_delivery_day: dayOf(order.requested_delivery_date) };
}

// The documents the order led to, each from its own table, within the organisation.
async function relatedDocuments(client, context, order, { canSeeMoney }) {
  const args = [context.organizationId, order.id];
  const rows = async (sql) => (await client.query(sql, args)).rows;
  const reservations = (await rows(
    `SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total, min(created_at) AS first_reserved_at
       FROM tenant.stock_reservations WHERE organization_id = $1 AND sales_order_id = $2`))[0];
  const deliveries = await rows(
    `SELECT delivery.id, delivery.request_number AS number, delivery.delivery_status AS status, delivery.dispatch_date, delivery.dispatched_at, delivery.delivered_at,
            (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_delivery_lines line WHERE line.delivery_id = delivery.id) AS quantity
       FROM tenant.sales_fulfillment_requests delivery
      WHERE delivery.organization_id = $1 AND delivery.sales_order_id = $2 AND delivery.delivery_status <> 'cancelled' ORDER BY delivery.requested_at`);
  const invoices = await rows(
    `SELECT invoice.id, invoice.invoice_number AS number, invoice.status, invoice.invoice_date, invoice.due_date, invoice.grand_total, invoice.outstanding_amount, invoice.posted_at,
            (invoice.status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND invoice.outstanding_amount > 0 AND invoice.due_date < current_date) AS overdue,
            sales_invoice.reversed_at, sales_invoice.reversal_reason
       FROM tenant.accounting_customer_invoices invoice
       LEFT JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = invoice.id
      WHERE invoice.organization_id = $1 AND invoice.source_sales_order_id = $2 AND invoice.invoice_type = 'invoice' AND invoice.status <> 'cancelled' ORDER BY invoice.created_at`);
  const receipts = canSeeMoney ? await rows(
    `SELECT allocation.id, receipt.id AS receipt_id, receipt.receipt_number AS number, receipt.receipt_date, allocation.allocated_amount AS amount, allocation.allocated_at,
            invoice.invoice_number
       FROM tenant.accounting_customer_receipt_allocations allocation
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
       JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id
      WHERE allocation.organization_id = $1 AND invoice.source_sales_order_id = $2 AND invoice.invoice_type = 'invoice' ORDER BY allocation.allocated_at`) : [];
  const returns = await rows(
    `SELECT sales_return.id, sales_return.return_number AS number, sales_return.status, sales_return.return_date, sales_return.received_at,
            (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS quantity,
            (sales_return.status = 'received' AND ${CREDIT_DUE_SQL}) AS awaiting_credit
       FROM tenant.sales_returns sales_return
      WHERE sales_return.organization_id = $1 AND sales_return.sales_order_id = $2 AND sales_return.status <> 'cancelled' ORDER BY sales_return.created_at`);
  const creditNotes = await rows(
    `SELECT credit.id, credit.invoice_number AS number, credit.status, credit.invoice_date, credit.grand_total, credit.outstanding_amount, credit.posted_at, note.reason_code,
            note.reversed_at, original.invoice_number AS invoice_number,
            COALESCE((SELECT sum(allocation.allocated_amount) FROM tenant.accounting_customer_credit_allocations allocation WHERE allocation.credit_note_id = credit.id), 0) AS applied,
            COALESCE((SELECT sum(allocation.amount) FROM tenant.accounting_customer_refund_allocations allocation
                        JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'posted'
                       WHERE allocation.credit_note_id = credit.id), 0) AS refunded
       FROM tenant.sales_credit_notes note
       JOIN tenant.accounting_customer_invoices credit ON credit.id = note.customer_invoice_id
       JOIN tenant.accounting_customer_invoices original ON original.id = note.source_invoice_id
      WHERE note.organization_id = $1 AND note.sales_order_id = $2 AND credit.status <> 'cancelled' ORDER BY credit.created_at`);
  const refunds = canSeeMoney ? await rows(
    `SELECT refund.id, refund.refund_number AS number, refund.status, refund.refund_date, allocation.amount, refund.posted_at, refund.reversed_at, credit.invoice_number AS credit_note_number
       FROM tenant.accounting_customer_refund_allocations allocation
       JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status IN ('posted', 'reversed')
       JOIN tenant.accounting_customer_invoices credit ON credit.id = allocation.credit_note_id
       JOIN tenant.sales_credit_notes note ON note.customer_invoice_id = credit.id
      WHERE allocation.organization_id = $1 AND note.sales_order_id = $2 ORDER BY refund.created_at`) : [];
  return { reservations, deliveries, invoices, receipts, returns, creditNotes, refunds };
}

// Everything the order's tracking view shows.
export async function getSalesOrderTracking(client, context, orderId) {
  const order = await loadOrder(client, context, orderId);
  const canSeeMoney = orderCan(context, TRACKING_PERMISSIONS.money);
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const basis = basisOfSetting(await invoicingBasisSetting(client, context.organizationId));
  const positions = new Map(lines.map((line) => [line.lineId, invoicingOfLine(line, basis)]));

  const status = deriveOrderStatus(order);
  const reservation = deriveReservationStatus(order, lines);
  const fulfillment = deriveFulfillmentStatus(order, lines);
  const invoicing = { ...deriveInvoiceStatus(order, lines, positions, basis), orderValue: Number(order.grand_total) };
  const finance = await orderFinance(client, context.organizationId, order.id);
  const payment = calculateOrderPaymentSummary(finance);
  const documents = await relatedDocuments(client, context, order, { canSeeMoney });

  const postedCredits = documents.creditNotes.filter((credit) => POSTED.includes(credit.status));
  const credited = money(postedCredits.reduce((total, credit) => total + Number(credit.grand_total), 0));
  const refunded = money(postedCredits.reduce((total, credit) => total + Number(credit.refunded), 0));
  const customerCredit = money(postedCredits.filter((credit) => ["posted", "partially_paid"].includes(credit.status)).reduce((total, credit) => total + Number(credit.outstanding_amount), 0));
  const returnsAwaitingCredit = documents.returns.filter((entry) => entry.awaiting_credit).length;
  // Whether stock can cover what is not reserved yet: asked of Inventory only when it matters.
  const shortageLines = order.lifecycle_status === STATUS.confirmed && ["not_reserved", "partially_reserved"].includes(reservation.status)
    ? (await computeOrderAvailability(client, context, order.id)).shortages : 0;

  const flags = {
    deliveryOverdue: fulfillment.overdue,
    readyToDeliver: isOrderReadyToDeliver(order, lines),
    readyToInvoice: isOrderReadyToInvoice(order, invoicing),
    readyToClose: isOrderReadyToClose(order, fulfillment, invoicing),
  };
  const warnings = calculateOrderWarnings(order, { reservation, fulfillment, invoicing, payment: canSeeMoney ? payment : null, shortageLines, returnsAwaitingCredit, customerCredit: canSeeMoney ? customerCredit : 0 });
  const timeline = await buildOrderTimeline(client, context, order, documents, { canSeeMoney });
  const dispatched = documents.deliveries.filter((delivery) => delivery.dispatched_at);
  const posted = documents.invoices.filter((invoice) => invoice.posted_at && POSTED.includes(invoice.status));
  const at = (values, pick) => (values.length ? new Date(pick(...values.map((value) => new Date(value).getTime()))).toISOString() : null);
  const confirmed = order.lifecycle_status === STATUS.confirmed;
  const cancelledPart = lines.some((line) => line.cancelled > EPSILON);

  return {
    order: {
      id: order.id, number: order.sales_order_number, customerName: order.customer_name, partyId: order.party_id, ownerName: order.owner_name, customerPoNumber: order.customer_po_number,
      status: status.status, statusLabel: status.label, orderDate: order.order_date, requestedDeliveryDate: order.requested_delivery_date, currencyCode: order.currency_code,
      orderValue: Number(order.grand_total),
      // How it ended, when it has: cancelled before anything happened, or closed with part of it cancelled, or closed by hand.
      outcome: order.lifecycle_status === STATUS.cancelled ? "cancelled_before_execution"
        : order.lifecycle_status === STATUS.closed ? (order.closed_manually ? "closed_manually" : cancelledPart ? "closed_with_cancellations" : "completed") : null,
      closedManually: order.closed_manually, closeReason: order.close_reason, cancelReason: order.cancel_reason, cancelReasonCode: order.cancel_reason_code,
    },
    // Which dimensions mean something for this order: a service order has no inventory or delivery to track.
    applies: { inventory: reservation.applies, fulfillment: fulfillment.applies, invoicing: true, payment: true },
    reservation, fulfillment, invoicing,
    payment: canSeeMoney ? payment : { status: payment.status, label: payment.label },
    returns: { delivered: fulfillment.delivered, returned: fulfillment.returned, netWithCustomer: fulfillment.netWithCustomer, count: documents.returns.length, awaitingCredit: returnsAwaitingCredit },
    credits: canSeeMoney ? { invoiced: payment.invoiced, credited, netBilled: money(payment.invoiced - credited), count: postedCredits.length } : { count: postedCredits.length },
    refunds: canSeeMoney ? { credits: credited, refunded, remainingCustomerCredit: customerCredit, count: documents.refunds.filter((refund) => refund.status === "posted").length } : null,
    lines: trackLines(order, lines, positions),
    flags, warnings,
    milestones: {
      createdAt: order.created_at, confirmedAt: order.confirmed_at, firstReservedAt: documents.reservations.first_reserved_at,
      firstDeliveryAt: at(dispatched.map((delivery) => delivery.dispatched_at), Math.min), lastDeliveryAt: at(dispatched.map((delivery) => delivery.dispatched_at), Math.max),
      firstInvoiceAt: at(posted.map((invoice) => invoice.posted_at), Math.min),
      fullyInvoicedAt: invoicing.status === "fully_invoiced" ? at(posted.map((invoice) => invoice.posted_at), Math.max) : null,
      closedAt: order.closed_at, cancelledAt: order.cancelled_at,
    },
    documents: {
      quotation: order.source_quotation_id ? { id: order.source_quotation_id, number: order.source_quotation_number } : null,
      reservations: { active: documents.reservations.active, total: documents.reservations.total },
      deliveries: documents.deliveries.map((delivery) => ({ ...delivery, quantity: Number(delivery.quantity) })),
      invoices: documents.invoices.map((invoice) => ({
        id: invoice.id, number: invoice.number, status: invoice.status, invoice_date: invoice.invoice_date, due_date: invoice.due_date, overdue: Boolean(invoice.overdue),
        grand_total: canSeeMoney ? Number(invoice.grand_total) : null, outstanding_amount: canSeeMoney ? Number(invoice.outstanding_amount) : null,
        // Each invoice has its own payment state: one paid, another overdue, a third not yet due.
        paymentState: !POSTED.includes(invoice.status) ? invoice.status : Number(invoice.outstanding_amount) <= 0.005 ? "paid" : invoice.overdue ? "overdue"
          : Number(invoice.outstanding_amount) + 0.005 < Number(invoice.grand_total) ? "partially_paid" : "unpaid",
      })),
      receipts: documents.receipts.map((receipt) => ({ ...receipt, amount: Number(receipt.amount) })),
      returns: documents.returns.map((entry) => ({ ...entry, quantity: Number(entry.quantity), awaiting_credit: Boolean(entry.awaiting_credit) })),
      creditNotes: documents.creditNotes.map((credit) => ({
        id: credit.id, number: credit.number, status: credit.status, invoice_date: credit.invoice_date, invoice_number: credit.invoice_number, reason_code: credit.reason_code,
        grand_total: canSeeMoney ? Number(credit.grand_total) : null, applied: canSeeMoney ? Number(credit.applied) : null, refunded: canSeeMoney ? Number(credit.refunded) : null,
        remaining: canSeeMoney && ["posted", "partially_paid"].includes(credit.status) ? Number(credit.outstanding_amount) : canSeeMoney ? 0 : null,
      })),
      refunds: documents.refunds.map((refund) => ({ ...refund, amount: Number(refund.amount) })),
      counts: {
        deliveries: documents.deliveries.length, invoices: documents.invoices.length, receipts: new Set(documents.receipts.map((receipt) => receipt.receipt_id)).size,
        returns: documents.returns.length, creditNotes: documents.creditNotes.length, refunds: documents.refunds.length,
      },
    },
    timeline,
    actions: {
      close: confirmed && orderCan(context, TRACKING_PERMISSIONS.close),
      reopenClosed: order.lifecycle_status === STATUS.closed && order.closed_manually && orderCan(context, TRACKING_PERMISSIONS.reopenClosed),
      viewMoney: canSeeMoney,
      openRefunds: orderCan(context, "accounting.refund.view"),
      viewReservations: orderCan(context, ORDER_PERMISSIONS.viewReservations),
    },
  };
}

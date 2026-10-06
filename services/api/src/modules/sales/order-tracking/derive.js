// Where a sales order stands, worked out in one place.
//
// An order never has one status. It has a lifecycle of its own (Draft,
// Confirmed, Cancelled, Closed) and, beside it, independent dimensions that
// are each derived from the documents that own them, never typed:
//   reservation  from the active stock reservations of its lines
//   fulfilment   from its dispatched deliveries and its cancelled quantities
//   invoicing    from its posted invoices (credit notes never reduce it)
//   payment      from Finance: receipts and credits applied to its invoices
//   returns      from its received returns (never reducing what was delivered)
//   credits      from its posted credit notes; refunds from posted refunds
// Everything here is a pure function of those quantities, so the order
// page, the list, the customer, the dashboard and the reports cannot
// disagree. The functions take the line quantities of ../orders/progress.js.
import { STATUS, STATUS_LABELS } from "../orders/constants.js";

export const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const sum = (lines, pick) => round(lines.reduce((total, line) => total + Number(pick(line) ?? 0), 0));
const percentOf = (part, whole) => (whole > EPSILON ? Math.max(0, Math.min(100, Math.round((100 * part) / whole))) : 0);

export const RESERVATION_LABELS = Object.freeze({ not_required: "Not required", not_reserved: "Not reserved", partially_reserved: "Partially reserved", fully_reserved: "Fully reserved" });
export const FULFILLMENT_LABELS = Object.freeze({
  not_required: "Not required", not_delivered: "Not delivered", partially_delivered: "Partially delivered", delivered: "Delivered",
  // Nothing is left to deliver, but not everything ordered was delivered: the rest was cancelled.
  complete: "Complete", cancelled: "Cancelled",
});
export const INVOICE_LABELS = Object.freeze({ not_invoiced: "Not invoiced", partially_invoiced: "Partially invoiced", fully_invoiced: "Fully invoiced" });
export const PAYMENT_LABELS = Object.freeze({
  not_invoiced: "Not invoiced", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid", overdue: "Has overdue balance",
});

export function deriveOrderStatus(order) {
  const status = order.lifecycle_status;
  // A closed order that lost part of its quantity was not cancelled: what was delivered and invoiced stands.
  return { status, label: STATUS_LABELS[status] ?? status, executing: [STATUS.confirmed, STATUS.closed].includes(status) };
}

// Reservation, from the stock-tracked lines that still have something to deliver. Counts, so the list (which reads the
// same quantities per order) derives the same status: { openLines, fullLines, reservedLines }.
export function reservationStatusOfCounts({ openLines, fullLines, reservedLines }) {
  if (!openLines) return "not_required";
  if (fullLines >= openLines) return "fully_reserved";
  return reservedLines > 0 ? "partially_reserved" : "not_reserved";
}
export function deriveReservationStatus(order, lines) {
  const executing = order.lifecycle_status === STATUS.confirmed;
  const open = executing ? lines.filter((line) => line.stockTracked && line.remainingToDeliver > EPSILON) : [];
  const status = reservationStatusOfCounts({
    openLines: open.length, fullLines: open.filter((line) => line.reserved + EPSILON >= line.remainingToDeliver).length, reservedLines: open.filter((line) => line.reserved > EPSILON).length,
  });
  const required = sum(open, (line) => line.remainingToDeliver);
  const reserved = sum(open, (line) => Math.min(line.reserved, line.remainingToDeliver));
  return {
    status, label: RESERVATION_LABELS[status], applies: lines.some((line) => line.stockTracked),
    // Of what is still to deliver from stock: how much is held for this order.
    required, reserved, remainingToReserve: round(Math.max(0, required - reserved)), percent: percentOf(reserved, required),
  };
}

// Fulfilment, from the physical lines: ordered = delivered + cancelled + remaining, always. A return never changes it.
export function fulfillmentStatusOf({ deliverable, lifecycle, delivered, cancelled, remaining }) {
  if (lifecycle === STATUS.cancelled) return "cancelled";
  if (!deliverable) return "not_required";
  // Nothing left: delivered in full; or part delivered and the rest cancelled (complete, never "delivered 10 of 10"); or every unit cancelled.
  if (remaining <= EPSILON) return cancelled <= EPSILON ? "delivered" : delivered > EPSILON ? "complete" : "cancelled";
  return delivered > EPSILON ? "partially_delivered" : "not_delivered";
}
export function deriveFulfillmentStatus(order, lines) {
  const goods = lines.filter((line) => line.deliverable);
  const ordered = sum(goods, (line) => line.ordered);
  const delivered = sum(goods, (line) => line.delivered);
  const cancelled = sum(goods, (line) => line.cancelled);
  const remaining = sum(goods, (line) => line.remainingToDeliver);
  const returned = sum(goods, (line) => line.returned);
  const status = fulfillmentStatusOf({ deliverable: goods.length > 0, lifecycle: order.lifecycle_status, delivered, cancelled, remaining });
  const overdue = order.lifecycle_status === STATUS.confirmed && remaining > EPSILON && Boolean(order.requested_delivery_overdue);
  return {
    status, label: FULFILLMENT_LABELS[status], applies: goods.length > 0, ordered, delivered, cancelled, remaining,
    returned, netWithCustomer: round(delivered - returned),
    // Of what was ordered. 6 of 10 delivered with 4 cancelled is complete, and still 6 of 10.
    percent: percentOf(delivered, ordered), overdue,
  };
}

// Invoicing, from posted invoices only. Fully invoiced means the whole order (less cancellations), never just what was delivered so far.
export function invoiceStatusOf({ open, invoiced }) {
  if (invoiced <= EPSILON) return "not_invoiced";
  return invoiced + EPSILON >= open ? "fully_invoiced" : "partially_invoiced";
}
export function deriveInvoiceStatus(order, lines, positions, basis) {
  const ordered = sum(lines, (line) => line.ordered);
  const cancelled = sum(lines, (line) => line.cancelled);
  const invoiced = sum(lines, (line) => line.invoiced);
  const remaining = sum(lines, (line) => line.remainingToInvoice);
  const position = (line) => positions.get(line.lineId) ?? { invoiceableNow: 0, pendingDelivery: 0 };
  const invoiceableNow = order.lifecycle_status === STATUS.confirmed ? sum(lines, (line) => position(line).invoiceableNow) : 0;
  const share = (line, quantity) => (line.ordered > EPSILON ? (line.lineTotal * quantity) / line.ordered : 0);
  // An order whose every line was cancelled has nothing to invoice.
  const complete = lines.every((line) => line.remainingToInvoice <= EPSILON);
  const status = complete && invoiced > EPSILON ? "fully_invoiced" : invoiceStatusOf({ open: ordered - cancelled, invoiced });
  return {
    status, label: INVOICE_LABELS[status], basis, ordered, cancelled, invoiced, remaining, invoiceableNow,
    // Delivery-based: what waits for delivery before it can be invoiced.
    pendingDelivery: sum(lines, (line) => position(line).pendingDelivery),
    percent: percentOf(invoiced, ordered - cancelled),
    remainingValue: money(lines.reduce((total, line) => total + share(line, line.remainingToInvoice), 0)),
    invoiceableNowValue: money(lines.reduce((total, line) => total + share(line, order.lifecycle_status === STATUS.confirmed ? position(line).invoiceableNow : 0), 0)),
  };
}

// Payment is Finance's, read from the order's invoices: never a status of the order, never typed.
// finance: { invoiced, credits, paid, balanceDue, overdueBalance, invoices }
export function paymentStatusOf({ invoiced, balanceDue, overdueBalance, paid, credits }) {
  if (invoiced <= 0.005) return "not_invoiced";
  if (overdueBalance > 0.005) return "overdue";
  if (balanceDue <= 0.005) return "paid";
  return paid + credits > 0.005 ? "partially_paid" : "unpaid";
}
export function calculateOrderPaymentSummary(finance) {
  const status = paymentStatusOf(finance);
  return {
    status, label: PAYMENT_LABELS[status], invoiced: money(finance.invoiced), credits: money(finance.credits), netBilled: money(finance.invoiced - finance.credits),
    paid: money(finance.paid), balanceDue: money(finance.balanceDue), overdueBalance: money(finance.overdueBalance),
    percent: percentOf(finance.paid, finance.invoiced - finance.credits),
  };
}

// What still has to happen, per line. Reconciles: ordered = delivered + cancelled + remainingToDeliver; netWithCustomer = delivered − returned.
export function trackLines(order, lines, positions) {
  const confirmed = order.lifecycle_status === STATUS.confirmed;
  return lines.map((line) => {
    const position = positions.get(line.lineId) ?? { invoiceableNow: 0, pendingDelivery: 0 };
    const needsStock = confirmed && line.stockTracked;
    return {
      lineId: line.lineId, sequence: line.sequence, itemId: line.itemId, itemName: line.itemName, unit: line.unit,
      kind: line.deliverable ? (line.stockTracked ? "stock" : "goods") : "service",
      ordered: line.ordered, reserved: line.stockTracked ? round(line.reserved) : null, delivered: line.deliverable ? line.delivered : null,
      returned: line.deliverable ? line.returned : null, cancelled: line.cancelled, invoiced: line.invoiced,
      remainingToReserve: needsStock ? round(Math.max(0, line.remainingToDeliver - line.reserved)) : line.stockTracked ? 0 : null,
      remainingToDeliver: line.deliverable ? line.remainingToDeliver : null,
      invoiceableNow: confirmed ? position.invoiceableNow : 0, remainingToInvoice: line.remainingToInvoice,
      netWithCustomer: line.deliverable ? round(line.delivered - line.returned) : null,
      // What can still come back: what the customer holds.
      returnable: line.deliverable ? round(Math.max(0, line.delivered - line.returned)) : null,
    };
  });
}

export const isOrderReadyToDeliver = (order, lines) =>
  order.lifecycle_status === STATUS.confirmed && lines.some((line) => line.deliverable && line.remainingToDeliver > EPSILON && (!line.stockTracked || line.reserved > EPSILON));
export const isOrderReadyToInvoice = (order, invoicing) => order.lifecycle_status === STATUS.confirmed && invoicing.invoiceableNow > EPSILON;
// Nothing left to deliver and nothing left to invoice. Payment is not part of it: collections continue after the order closes.
export const isOrderReadyToClose = (order, fulfillment, invoicing) =>
  order.lifecycle_status === STATUS.confirmed && fulfillment.remaining <= EPSILON && invoicing.remaining <= EPSILON;

// Conditions that need someone, derived each time: flags, never another status.
// facts: { reservation, fulfillment, invoicing, payment, shortageLines, returnsAwaitingCredit, customerCredit }
export function calculateOrderWarnings(order, facts) {
  const warnings = [];
  const warn = (code, label, detail) => warnings.push({ code, label, detail });
  const confirmed = order.lifecycle_status === STATUS.confirmed;
  if (confirmed && facts.shortageLines > 0) warn("stock_shortage", "Stock shortage", `${facts.shortageLines} line(s) cannot be covered from stock now.`);
  if (confirmed && facts.reservation.status === "partially_reserved")
    warn("partially_reserved", "Partially reserved", `${facts.reservation.reserved} of ${facts.reservation.required} still to deliver is reserved.`);
  if (facts.fulfillment.overdue) warn("delivery_overdue", "Delivery overdue", `${facts.fulfillment.remaining} still to deliver; the customer asked for ${order.requested_delivery_day ?? "an earlier date"}.`);
  if (isOrderReadyToInvoice(order, facts.invoicing)) warn("ready_to_invoice", "Ready to invoice", `${facts.invoicing.invoiceableNow} can be invoiced now.`);
  if (facts.payment && facts.payment.overdueBalance > 0.005) warn("invoice_overdue", "Invoice overdue", `${facts.payment.overdueBalance.toFixed(2)} is past its due date.`);
  if (facts.customerCredit > 0.005) warn("customer_credit", "Customer credit exists", `${facts.customerCredit.toFixed(2)} of credit from this order's credit notes is not applied or refunded.`);
  if (facts.returnsAwaitingCredit > 0) warn("return_awaiting_credit", "Return awaiting credit note", `${facts.returnsAwaitingCredit} received return(s) of invoiced goods have no credit note yet.`);
  return warnings;
}

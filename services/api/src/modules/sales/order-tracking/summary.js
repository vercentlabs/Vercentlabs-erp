// The tracking summary of many orders at once: the list, the customer's
// orders, the dashboard and the reports.
//
// It reads each order's line quantities as ../orders/progress.js keeps them
// (recalculated from reservations, deliveries, invoices, returns and
// cancellations whenever one changes) and its money from Finance's invoices,
// then applies the same derivations as the order page (./derive.js). The
// SQL below only gathers quantities; it decides no status of its own, except
// the filters, which restate the derivations for the database.
import { STATUS } from "../orders/constants.js";
import {
  FULFILLMENT_LABELS, INVOICE_LABELS, PAYMENT_LABELS, RESERVATION_LABELS, calculateOrderPaymentSummary, fulfillmentStatusOf, invoiceStatusOf, reservationStatusOfCounts,
} from "./derive.js";

const POSTED = `('posted', 'partially_paid', 'paid', 'overdue', 'disputed')`;
const num = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const percentOf = (part, whole) => (whole > 1e-6 ? Math.max(0, Math.min(100, Math.round((100 * part) / whole))) : 0);

// What is invoiceable now on one line, on the company's basis ($basis is the bound Sales setting: 'fulfilled' = delivery-based).
// Delivery-based goods bill what the customer kept (delivered less returned); services and order-based lines what is ordered.
const invoiceableLineSql = (basis) => `GREATEST(0, (CASE WHEN ${basis} = 'fulfilled' AND item.item_type <> 'service'
        THEN LEAST(GREATEST(progress.fulfilled_quantity - progress.returned_quantity, 0), line.quantity - progress.cancelled_quantity)
        ELSE line.quantity - progress.cancelled_quantity END) - progress.invoiced_quantity)`;

// Per order: the quantities of its lines. alias: the sales_orders alias; basis: the bound invoicing basis.
export const quantitiesJoin = (alias, basis) => `
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE item.item_type <> 'service') AS goods_lines,
           count(*) FILTER (WHERE stock.tracked) AS stock_lines,
           count(*) FILTER (WHERE stock.tracked AND stock.remaining > 0.000001) AS open_lines,
           count(*) FILTER (WHERE stock.tracked AND stock.remaining > 0.000001 AND progress.reserved_quantity + 0.000001 >= stock.remaining) AS full_lines,
           count(*) FILTER (WHERE stock.tracked AND stock.remaining > 0.000001 AND progress.reserved_quantity > 0.000001) AS reserved_lines,
           COALESCE(sum(stock.remaining) FILTER (WHERE stock.tracked), 0) AS reserve_required,
           COALESCE(sum(LEAST(progress.reserved_quantity, stock.remaining)) FILTER (WHERE stock.tracked), 0) AS reserve_held,
           COALESCE(sum(line.quantity) FILTER (WHERE item.item_type <> 'service'), 0) AS goods_ordered,
           COALESCE(sum(progress.fulfilled_quantity) FILTER (WHERE item.item_type <> 'service'), 0) AS goods_delivered,
           COALESCE(sum(progress.cancelled_quantity) FILTER (WHERE item.item_type <> 'service'), 0) AS goods_cancelled,
           COALESCE(sum(stock.remaining) FILTER (WHERE item.item_type <> 'service'), 0) AS goods_remaining,
           COALESCE(sum(progress.returned_quantity) FILTER (WHERE item.item_type <> 'service'), 0) AS goods_returned,
           COALESCE(sum(line.quantity), 0) AS quantity_ordered,
           COALESCE(sum(progress.cancelled_quantity), 0) AS quantity_cancelled,
           COALESCE(sum(progress.invoiced_quantity), 0) AS quantity_invoiced,
           count(*) FILTER (WHERE line.quantity - progress.cancelled_quantity - progress.invoiced_quantity > 0.000001) AS uninvoiced_lines,
           COALESCE(sum(${invoiceableLineSql(basis)}), 0) AS invoiceable_now,
           COALESCE(sum(line.line_total * GREATEST(line.quantity - progress.cancelled_quantity - progress.invoiced_quantity, 0) / NULLIF(line.quantity, 0)), 0) AS uninvoiced_value
      FROM tenant.sales_order_lines line
      JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
      CROSS JOIN LATERAL (SELECT GREATEST(line.quantity - progress.cancelled_quantity - progress.fulfilled_quantity, 0) AS remaining,
                                 (COALESCE(item.track_inventory, false) AND item.item_type <> 'service') AS tracked) stock
     WHERE line.organization_id = ${alias}.organization_id AND line.sales_order_version_id = ${alias}.current_version_id
  ) quantities ON true`;

// Per order: its money in Finance. Posted invoices (never reduced by credit notes), posted credit notes, what was paid and what is still owed.
export const financeJoin = (alias) => `
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(invoice.grand_total) FILTER (WHERE invoice.invoice_type = 'invoice'), 0) AS invoiced,
           COALESCE(sum(invoice.grand_total) FILTER (WHERE invoice.invoice_type = 'credit_note'), 0) AS credits,
           COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.invoice_type = 'invoice'), 0) AS balance_due,
           COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.invoice_type = 'invoice' AND invoice.due_date < current_date), 0) AS overdue_balance,
           COALESCE(sum((SELECT sum(allocation.allocated_amount) FROM tenant.accounting_customer_receipt_allocations allocation
                          WHERE allocation.organization_id = invoice.organization_id AND allocation.customer_invoice_id = invoice.id)) FILTER (WHERE invoice.invoice_type = 'invoice'), 0) AS paid,
           COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.invoice_type = 'credit_note' AND invoice.status IN ('posted', 'partially_paid')), 0) AS customer_credit,
           count(*) FILTER (WHERE invoice.invoice_type = 'invoice') AS invoices
      FROM tenant.accounting_customer_invoices invoice
     WHERE invoice.organization_id = ${alias}.organization_id AND invoice.source_sales_order_id = ${alias}.id AND invoice.invoice_type IN ('invoice', 'credit_note')
       AND invoice.status IN ${POSTED}
  ) finance ON true`;

// The same conditions the derivations decide, for the database: used only to choose which orders a view shows.
const CONFIRMED = (alias) => `${alias}.lifecycle_status = 'confirmed'`;
export const trackingConditions = (alias) => ({
  awaitingReservation: `(${CONFIRMED(alias)} AND quantities.open_lines > 0 AND quantities.reserved_lines = 0)`,
  partiallyReserved: `(${CONFIRMED(alias)} AND quantities.open_lines > 0 AND quantities.reserved_lines > 0 AND quantities.full_lines < quantities.open_lines)`,
  fullyReserved: `(${CONFIRMED(alias)} AND quantities.open_lines > 0 AND quantities.full_lines >= quantities.open_lines)`,
  reservationNotRequired: `(NOT ${CONFIRMED(alias)} OR quantities.open_lines = 0)`,
  deliveryOverdue: `(${CONFIRMED(alias)} AND quantities.goods_remaining > 0.000001 AND ${alias}.requested_delivery_date < current_date)`,
  readyToInvoice: `(${CONFIRMED(alias)} AND quantities.invoiceable_now > 0.000001)`,
  readyToClose: `(${CONFIRMED(alias)} AND quantities.goods_remaining <= 0.000001 AND quantities.uninvoiced_lines = 0)`,
  hasBalance: `(finance.balance_due > 0.005)`,
  hasOverdueBalance: `(finance.overdue_balance > 0.005)`,
});
// Orders that need someone: deterministic rules, no scoring.
export const needsAttentionSql = (alias) => {
  const is = trackingConditions(alias);
  return `(${is.partiallyReserved} OR ${is.deliveryOverdue} OR ${is.readyToInvoice} OR (${alias}.lifecycle_status IN ('confirmed', 'closed') AND ${is.hasOverdueBalance}))`;
};

export const TRACKING_COLUMNS = `quantities.goods_lines, quantities.stock_lines, quantities.open_lines, quantities.full_lines, quantities.reserved_lines, quantities.reserve_required,
  quantities.reserve_held, quantities.goods_ordered, quantities.goods_delivered, quantities.goods_cancelled, quantities.goods_remaining, quantities.goods_returned, quantities.quantity_ordered,
  quantities.quantity_cancelled, quantities.quantity_invoiced, quantities.uninvoiced_lines, quantities.invoiceable_now, finance.invoiced AS finance_invoiced, finance.credits AS finance_credits,
  finance.balance_due AS finance_balance_due, finance.overdue_balance AS finance_overdue_balance, finance.paid AS finance_paid, finance.customer_credit AS finance_customer_credit`;

// One order's summary from a row carrying TRACKING_COLUMNS, lifecycle_status and requested_delivery_date. canSeeMoney: Finance figures are shown.
export function summaryFromRow(row, { canSeeMoney = true } = {}) {
  const lifecycle = row.lifecycle_status;
  const confirmed = lifecycle === STATUS.confirmed;
  const executing = confirmed || lifecycle === STATUS.closed;
  const goodsOrdered = num(row.goods_ordered);
  const delivered = num(row.goods_delivered);
  const cancelled = num(row.goods_cancelled);
  const remaining = num(row.goods_remaining);
  const reservation = confirmed
    ? reservationStatusOfCounts({ openLines: Number(row.open_lines), fullLines: Number(row.full_lines), reservedLines: Number(row.reserved_lines) })
    : "not_required";
  const fulfillment = fulfillmentStatusOf({ deliverable: Number(row.goods_lines) > 0, lifecycle, delivered, cancelled, remaining });
  const ordered = num(row.quantity_ordered);
  const invoiced = num(row.quantity_invoiced);
  const open = ordered - num(row.quantity_cancelled);
  const invoicing = Number(row.uninvoiced_lines) === 0 && invoiced > 1e-6 ? "fully_invoiced" : invoiceStatusOf({ open, invoiced });
  const payment = calculateOrderPaymentSummary({
    invoiced: Number(row.finance_invoiced), credits: Number(row.finance_credits), paid: Number(row.finance_paid), balanceDue: Number(row.finance_balance_due),
    overdueBalance: Number(row.finance_overdue_balance),
  });
  const deliveryOverdue = confirmed && remaining > 1e-6 && Boolean(row.requested_delivery_overdue);
  const invoiceableNow = confirmed ? num(row.invoiceable_now) : 0;
  return {
    reservation: { status: reservation, label: RESERVATION_LABELS[reservation], applies: Number(row.stock_lines) > 0, required: confirmed ? num(row.reserve_required) : 0, reserved: confirmed ? num(row.reserve_held) : 0,
      percent: confirmed ? percentOf(num(row.reserve_held), num(row.reserve_required)) : 0 },
    fulfillment: { status: fulfillment, label: FULFILLMENT_LABELS[fulfillment], applies: Number(row.goods_lines) > 0, ordered: goodsOrdered, delivered, cancelled, remaining, returned: num(row.goods_returned),
      netWithCustomer: num(delivered - num(row.goods_returned)), percent: percentOf(delivered, goodsOrdered), overdue: deliveryOverdue },
    invoicing: { status: invoicing, label: INVOICE_LABELS[invoicing], ordered, cancelled: num(row.quantity_cancelled), invoiced, remaining: num(Math.max(0, open - invoiced)), invoiceableNow, percent: percentOf(invoiced, open) },
    payment: canSeeMoney ? payment : { status: payment.status, label: PAYMENT_LABELS[payment.status] },
    customerCredit: canSeeMoney ? money(row.finance_customer_credit) : null,
    flags: {
      deliveryOverdue, readyToInvoice: invoiceableNow > 1e-6,
      readyToClose: confirmed && remaining <= 1e-6 && Number(row.uninvoiced_lines) === 0,
      needsAttention: (confirmed && (reservation === "partially_reserved" || deliveryOverdue || invoiceableNow > 1e-6)) || (executing && payment.overdueBalance > 0.005),
    },
  };
}

// The invoicing basis as the Sales setting stores it ('fulfilled' = delivery-based).
export async function invoicingBasisSetting(client, organizationId) {
  return (await client.query(`SELECT invoice_quantity_basis FROM tenant.sales_settings WHERE organization_id = $1`, [organizationId])).rows[0]?.invoice_quantity_basis ?? "ordered";
}

// Finance's figures for one order: the same query the list joins.
export async function orderFinance(client, organizationId, orderId) {
  const row = (await client.query(
    `SELECT finance.* FROM tenant.sales_orders sales_order ${financeJoin("sales_order")} WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [organizationId, orderId])).rows[0] ?? {};
  return { invoiced: Number(row.invoiced ?? 0), credits: Number(row.credits ?? 0), paid: Number(row.paid ?? 0), balanceDue: Number(row.balance_due ?? 0), overdueBalance: Number(row.overdue_balance ?? 0),
    customerCredit: Number(row.customer_credit ?? 0), invoices: Number(row.invoices ?? 0) };
}

const ORDERS_FROM = (basis) => `FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       ${quantitiesJoin("sales_order", basis)}
       ${financeJoin("sales_order")}`;

// "Delivered 6 / 10 · Invoiced 40% · Balance 2,000.00": one line for an order among others (the customer's orders).
export function summaryLine(summary, { canSeeMoney = true } = {}) {
  const parts = [];
  if (summary.reservation.applies && summary.reservation.status !== "not_required") parts.push(summary.reservation.label);
  if (summary.fulfillment.applies) parts.push(`${summary.fulfillment.label} ${summary.fulfillment.delivered} / ${summary.fulfillment.ordered}${summary.fulfillment.overdue ? " (overdue)" : ""}`);
  parts.push(`${summary.invoicing.label}${summary.invoicing.status === "partially_invoiced" ? ` ${summary.invoicing.percent}%` : ""}`);
  if (canSeeMoney && summary.payment.invoiced > 0.005)
    parts.push(summary.payment.balanceDue > 0.005 ? `Balance ${summary.payment.balanceDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}${summary.payment.overdueBalance > 0.005 ? " (overdue)" : ""}` : "Paid");
  return parts.join(" · ");
}

// Every confirmed or closed order with each dimension of its progress: the Order Status report. One row never squeezes them into one stage.
export async function salesOrderTrackingReport(client, organizationId, { canSeeMoney = true } = {}) {
  const rows = (await client.query(
    `SELECT sales_order.id AS sales_order_id, sales_order.sales_order_number, version.customer_snapshot->>'displayName' AS customer, sales_order.lifecycle_status,
            sales_order.requested_delivery_date, (sales_order.requested_delivery_date < current_date) AS requested_delivery_overdue, ${TRACKING_COLUMNS}
       ${ORDERS_FROM("$2")}
      WHERE sales_order.organization_id = $1 AND sales_order.lifecycle_status IN ('confirmed', 'closed')
      ORDER BY (sales_order.lifecycle_status = 'confirmed') DESC, sales_order.sales_order_number DESC LIMIT 500`, [organizationId, await invoicingBasisSetting(client, organizationId)])).rows;
  return rows.map((row) => {
    const summary = summaryFromRow(row, { canSeeMoney });
    const attention = [summary.reservation.status === "partially_reserved" ? "Partially reserved" : null, summary.flags.deliveryOverdue ? "Delivery overdue" : null,
      summary.flags.readyToInvoice ? "Ready to invoice" : null, canSeeMoney && summary.payment.overdueBalance > 0.005 ? "Invoice overdue" : null,
      summary.flags.readyToClose ? "Ready to close" : null, summary.fulfillment.cancelled > 0 ? "Part cancelled" : null].filter(Boolean).join("; ");
    return {
      sales_order_id: row.sales_order_id, sales_order_number: row.sales_order_number, customer: row.customer, order_status: row.lifecycle_status === "closed" ? "Closed" : "Confirmed",
      reservation: summary.reservation.applies ? summary.reservation.label : "Not required",
      fulfillment: summary.fulfillment.label, delivered: summary.fulfillment.applies ? `${summary.fulfillment.delivered} / ${summary.fulfillment.ordered}` : "",
      invoicing: summary.invoicing.label, invoiced: `${summary.invoicing.invoiced} / ${summary.invoicing.ordered}`,
      ...(canSeeMoney ? { payment: summary.payment.label, balance_due: summary.payment.balanceDue } : {}),
      requested_delivery_date: row.requested_delivery_date, attention,
    };
  });
}

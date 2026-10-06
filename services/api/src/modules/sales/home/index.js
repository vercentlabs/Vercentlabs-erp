// The Sales home: what needs doing now, each figure opening the list view it
// counts, and what happened last. Every count is the list's own view rule
// (the order list's views, the quotation list, the invoice balances), scoped
// to what the person may see, so the home never shows a number the list it
// opens disagrees with. Nothing is stored for it.
import { orderCan, orderScopeSql } from "../orders/access.js";
import { ORDER_PERMISSIONS, OrderError } from "../orders/constants.js";
import { countSalesOrderViews } from "../orders/records.js";
import { listQuotations } from "../quotations/records.js";
import { quotationScopeSql } from "../quotations/access.js";
import { QUOTATION_PERMISSIONS } from "../quotations/constants.js";
import { salesInvoiceBalance } from "../invoices/records.js";
import { invoiceScopeSql } from "../invoices/access.js";
import { INVOICE_PERMISSIONS } from "../invoices/constants.js";
import { DELIVERY_PERMISSIONS } from "../deliveries/constants.js";
import { deliveryScopeSql } from "../deliveries/access.js";
import { RETURN_PERMISSIONS } from "../returns/constants.js";
import { returnScopeSql } from "../returns/access.js";
import { CREDIT_NOTE_PERMISSIONS } from "../credit-notes/constants.js";
import { creditNoteScopeSql } from "../credit-notes/access.js";

// The order list views the home counts, in the order the home shows them.
export const HOME_ORDER_VIEWS = Object.freeze([
  "confirmed", "awaiting_reservation", "partially_reserved", "awaiting_delivery", "partially_delivered", "overdue_delivery", "ready_to_invoice", "partially_invoiced", "needs_attention",
]);
const sees = (context, permissions) => orderCan(context, permissions.view) || orderCan(context, permissions.viewAll);

export async function getSalesHome(client, context) {
  if (!orderCan(context, "sales.view")) throw new OrderError(403, "You do not have permission to view Sales.", "PERMISSION_DENIED");
  const access = {
    quotations: sees(context, QUOTATION_PERMISSIONS),
    orders: sees(context, ORDER_PERMISSIONS),
    deliveries: sees(context, DELIVERY_PERMISSIONS),
    invoices: sees(context, INVOICE_PERMISSIONS),
    returns: sees(context, RETURN_PERMISSIONS),
    creditNotes: sees(context, CREDIT_NOTE_PERMISSIONS),
  };
  const balances = access.invoices && orderCan(context, INVOICE_PERMISSIONS.paymentsView);
  const organization = (await client.query(`SELECT btrim(base_currency) AS currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0];
  return {
    quotationsAwaitingResponse: access.quotations ? (await listQuotations(client, context, { view: "awaiting", limit: 1 })).total : null,
    orders: access.orders ? await countSalesOrderViews(client, context, HOME_ORDER_VIEWS) : null,
    invoiceBalance: balances ? { ...(await salesInvoiceBalance(client, context)), currencyCode: organization?.currency ?? null } : null,
    activity: await recentSalesActivity(client, context, access),
  };
}

// The last things that happened to Sales documents: quotations confirmed,
// orders confirmed or closed, deliveries dispatched, invoices posted, returns
// received, credit notes posted. Only documents the person may open.
async function recentSalesActivity(client, context, access, limit = 12) {
  const values = [context.organizationId];
  const parts = [];
  const actor = "LEFT JOIN public.users actor ON actor.id = event.actor_user_id";
  const ofOrder = (alias, column) => `JOIN tenant.sales_orders sales_order ON sales_order.organization_id = ${alias}.organization_id AND sales_order.id = ${alias}.${column}`;
  if (access.quotations) {
    const scope = quotationScopeSql(context, values, "quotation");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'quotation' AS kind, quotation.id AS document_id, quotation.quotation_number AS number, actor.full_name AS actor
       FROM tenant.sales_document_events event
       JOIN tenant.sales_quotations quotation ON quotation.organization_id = event.organization_id AND quotation.id = event.entity_id ${actor}
      WHERE event.organization_id = $1 AND event.entity_type = 'quotation' AND event.event_type IN ('quotation.confirmed', 'quotation.order_created')${scope}`);
  }
  if (access.orders) {
    const scope = orderScopeSql(context, values, "sales_order");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'order', sales_order.id, sales_order.sales_order_number, actor.full_name
       FROM tenant.sales_document_events event
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = event.organization_id AND sales_order.id = event.entity_id ${actor}
      WHERE event.organization_id = $1 AND event.entity_type = 'sales_order' AND event.event_type IN ('sales_order.confirmed', 'sales_order.closed', 'sales_order.cancelled')${scope}`);
  }
  if (access.deliveries) {
    const scope = deliveryScopeSql(context, values, "sales_order");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'delivery', delivery.id, delivery.request_number, actor.full_name
       FROM tenant.sales_document_events event
       JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = event.organization_id AND delivery.id = event.entity_id
       ${ofOrder("delivery", "sales_order_id")} ${actor}
      WHERE event.organization_id = $1 AND event.entity_type = 'fulfillment_request' AND event.event_type IN ('sales_delivery.dispatched', 'sales_delivery.delivered')${scope}`);
  }
  if (access.invoices) {
    const scope = invoiceScopeSql(context, values, "sales_order");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'invoice', invoice.id, invoice.invoice_number, actor.full_name
       FROM tenant.sales_document_events event
       JOIN tenant.sales_invoices sales_invoice ON sales_invoice.organization_id = event.organization_id AND sales_invoice.customer_invoice_id = event.entity_id
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       ${ofOrder("sales_invoice", "sales_order_id")} ${actor}
      WHERE event.organization_id = $1 AND event.entity_type = 'invoice_request' AND event.event_type IN ('sales_invoice.posted', 'sales_invoice.reversed')${scope}`);
  }
  if (access.returns) {
    const scope = returnScopeSql(context, values, "sales_order");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'return', sales_return.id, sales_return.return_number, actor.full_name
       FROM tenant.sales_return_events event
       JOIN tenant.sales_returns sales_return ON sales_return.organization_id = event.organization_id AND sales_return.id = event.sales_return_id
       ${ofOrder("sales_return", "sales_order_id")} ${actor}
      WHERE event.organization_id = $1 AND event.event_type = 'sales_return.received'${scope}`);
  }
  if (access.creditNotes) {
    const scope = creditNoteScopeSql(context, values, "sales_order");
    parts.push(`SELECT event.id, event.occurred_at, event.event_type, 'credit_note', credit.id, credit.invoice_number, actor.full_name
       FROM tenant.sales_credit_note_events event
       JOIN tenant.sales_credit_notes note ON note.organization_id = event.organization_id AND note.customer_invoice_id = event.customer_invoice_id
       JOIN tenant.accounting_customer_invoices credit ON credit.organization_id = note.organization_id AND credit.id = note.customer_invoice_id
       ${ofOrder("note", "sales_order_id")} ${actor}
      WHERE event.organization_id = $1 AND event.event_type IN ('sales_credit_note.posted', 'sales_credit_note.reversed')${scope}`);
  }
  if (!parts.length) return [];
  values.push(limit);
  const cap = `$${values.length}`;
  const rows = (await client.query(
    `SELECT * FROM (${parts.map((part) => `(${part} ORDER BY event.occurred_at DESC LIMIT ${cap})`).join("\n UNION ALL ")}) activity
      ORDER BY occurred_at DESC, id LIMIT ${cap}`, values)).rows;
  return rows.map((row) => ({
    id: row.id, at: row.occurred_at, kind: row.kind, documentId: row.document_id, number: row.number, verb: VERBS[row.event_type] ?? row.event_type, actor: row.actor ?? null,
  }));
}

const VERBS = Object.freeze({
  "quotation.confirmed": "confirmed",
  "quotation.order_created": "converted to a sales order",
  "sales_order.confirmed": "confirmed",
  "sales_order.closed": "closed",
  "sales_order.cancelled": "cancelled",
  "sales_delivery.dispatched": "dispatched",
  "sales_delivery.delivered": "delivered",
  "sales_invoice.posted": "posted",
  "sales_invoice.reversed": "reversed",
  "sales_return.received": "received",
  "sales_credit_note.posted": "posted",
  "sales_credit_note.reversed": "reversed",
});

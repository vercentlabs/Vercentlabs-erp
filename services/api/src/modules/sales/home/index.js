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
import { PAID_SQL, POSTED_SQL, salesInvoiceBalance } from "../invoices/records.js";
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
  // The work views (Sales plan, the owner's morning): to confirm, held for credit, to dispatch, to bill.
  "to_confirm", "credit_hold", "to_dispatch", "to_bill",
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
    money: balances ? { ...(await salesHomeMoney(client, context)), currencyCode: organization?.currency ?? null } : null,
    today: await salesHomeToday(client, context, access, balances),
    activity: await recentSalesActivity(client, context, access),
  };
}

// The figures an owner looks for first (Line-by-line audit): invoiced today and this month (net of discounts, before tax), what falls
// due today, and the customers owing the most overdue — in the company's currency, from the invoices the person may see.
async function salesHomeMoney(client, context) {
  const values = [context.organizationId];
  const scope = invoiceScopeSql(context, values, "sales_order");
  const from = `FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_invoice.organization_id AND sales_order.id = sales_invoice.sales_order_id
       CROSS JOIN LATERAL (SELECT invoice.grand_total - ${PAID_SQL} AS balance) due
      WHERE sales_invoice.organization_id = $1 AND ${POSTED_SQL}${scope}`;
  const figures = (await client.query(
    `SELECT COALESCE(sum((invoice.subtotal - invoice.discount_total) * COALESCE(invoice.exchange_rate, 1)) FILTER (WHERE invoice.invoice_date = tenant.company_today()), 0) AS today,
            COALESCE(sum((invoice.subtotal - invoice.discount_total) * COALESCE(invoice.exchange_rate, 1)) FILTER (WHERE invoice.invoice_date >= date_trunc('month', tenant.company_today())::date), 0) AS month,
            COALESCE(sum(due.balance * COALESCE(invoice.exchange_rate, 1)) FILTER (WHERE due.balance > 0.005 AND invoice.due_date = tenant.company_today()), 0) AS due_today,
            count(*) FILTER (WHERE due.balance > 0.005 AND invoice.due_date = tenant.company_today())::int AS due_today_count
       ${from}`, values)).rows[0];
  const overdue = (await client.query(
    `SELECT invoice.party_id, COALESCE(sales_invoice.customer_snapshot->>'displayName', invoice.customer_snapshot->>'displayName') AS name,
            sum(due.balance * COALESCE(invoice.exchange_rate, 1)) AS amount, min(invoice.due_date)::text AS oldest_due
       ${from} AND due.balance > 0.005 AND invoice.due_date < tenant.company_today()
      GROUP BY invoice.party_id, 2 ORDER BY amount DESC LIMIT 5`, values)).rows;
  return {
    invoicedToday: Number(figures.today), invoicedThisMonth: Number(figures.month), dueToday: Number(figures.due_today), dueTodayCount: figures.due_today_count,
    topOverdue: overdue.map((row) => ({ customerId: row.party_id, name: row.name, amount: Number(row.amount), oldestDue: row.oldest_due })),
  };
}

// Today and the month so far (Sales plan, Flow 6): orders taken today, money received today, invoiced this month against the month's
// target (the person's own, or everyone's for whoever sees every order), and invoices still waiting for their IRN. Company currency.
async function salesHomeToday(client, context, access, balances) {
  const result = { ordersToday: null, orderValueToday: null, collectedToday: null, monthTarget: null, einvoicePending: null };
  if (access.orders) {
    const values = [context.organizationId];
    const scope = orderScopeSql(context, values, "sales_order");
    const row = (await client.query(
      `SELECT count(*)::int AS orders, COALESCE(sum(version.grand_total * COALESCE(version.exchange_rate, 1)), 0) AS value
         FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
        WHERE sales_order.organization_id = $1 AND sales_order.order_date = tenant.company_today() AND sales_order.lifecycle_status <> 'cancelled'${scope}`, values)).rows[0];
    result.ordersToday = row.orders;
    result.orderValueToday = Number(row.value);
  }
  if (balances) {
    const values = [context.organizationId];
    const scope = invoiceScopeSql(context, values, "sales_order");
    // Money applied today to the bills the person may see; with every invoice in view, all money received today (advances too).
    result.collectedToday = Number((await client.query(scope
      ? `SELECT COALESCE(sum(allocation.receipt_amount * COALESCE(receipt.exchange_rate, 1)), 0) AS amount
           FROM tenant.accounting_customer_receipt_allocations allocation
           JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id AND receipt.receipt_date = tenant.company_today() AND receipt.status <> 'draft'
           JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = allocation.customer_invoice_id
           JOIN tenant.sales_orders sales_order ON sales_order.id = sales_invoice.sales_order_id
          WHERE allocation.organization_id = $1${scope}`
      : `SELECT COALESCE(sum(receipt.base_amount), 0) AS amount FROM tenant.accounting_customer_receipts receipt
          WHERE receipt.organization_id = $1 AND receipt.receipt_date = tenant.company_today() AND receipt.status NOT IN ('draft', 'reversed')`, values)).rows[0].amount);
    const everyone = orderCan(context, ORDER_PERMISSIONS.viewAll);
    const target = (await client.query(
      `SELECT sum(target) AS target FROM tenant.crm_sales_targets WHERE organization_id = $1 AND metric = 'invoiced_value'
          AND month = date_trunc('month', tenant.company_today())::date AND ($2 OR user_id = $3)`, [context.organizationId, everyone, context.userId ?? null])).rows[0].target;
    result.monthTarget = target == null ? null : Number(target);
    // Only for a company that e-invoices (switched on, or has issued an IRN): posted invoices to registered customers still without one.
    const einvoicing = (await client.query(
      `SELECT EXISTS (SELECT 1 FROM tenant.sales_settings WHERE organization_id = $1 AND (einvoice_on_post OR einvoice_30_day_limit))
           OR EXISTS (SELECT 1 FROM tenant.einvoice_documents WHERE organization_id = $1 AND status = 'generated') AS einvoicing`, [context.organizationId])).rows[0].einvoicing;
    if (einvoicing) {
      const pending = [context.organizationId];
      const pendingScope = invoiceScopeSql(context, pending, "sales_order");
      result.einvoicePending = (await client.query(
        `SELECT count(*)::int AS count FROM tenant.sales_invoices sales_invoice
           JOIN tenant.accounting_customer_invoices invoice ON invoice.id = sales_invoice.customer_invoice_id
           JOIN tenant.sales_orders sales_order ON sales_order.id = sales_invoice.sales_order_id
          WHERE sales_invoice.organization_id = $1 AND invoice.posted_at IS NOT NULL AND invoice.status NOT IN ('cancelled', 'reversed')
            AND COALESCE(invoice.customer_snapshot->>'gstin', '') <> '' AND invoice.invoice_date >= tenant.company_today() - 60
            AND NOT EXISTS (SELECT 1 FROM tenant.einvoice_documents doc WHERE doc.organization_id = invoice.organization_id AND doc.document_id = invoice.id AND doc.status = 'generated')${pendingScope}`,
        pending)).rows[0].count;
    }
  }
  return result;
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

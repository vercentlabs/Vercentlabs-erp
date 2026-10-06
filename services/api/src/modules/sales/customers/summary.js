// The customer page beyond the record itself: the overview's CRM, financial
// and sales summaries, the related lists behind each tab, and the history.
//
// Everything here is read from the module that owns it. Receivable figures
// come from Accounting's invoices and receipts and are shown only to callers
// who may see customer financials; nothing is stored on the customer.
import { TRACKING_COLUMNS, financeJoin, invoicingBasisSetting, quantitiesJoin, summaryFromRow, summaryLine } from "../order-tracking/summary.js";
import { listAccountHistory } from "../../crm/accounts/history.js";
import { canViewCustomerFinancials, customerCan, requireCustomerPermission } from "./access.js";
import { CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { loadCustomerRow } from "./records.js";

const OPEN_QUOTATION = "('draft', 'pending_approval', 'approved', 'sent', 'viewed')";
const OPEN_ORDER = "('confirmed')";
const OPEN_INVOICE = "('posted', 'partially_paid', 'overdue', 'disputed')";
const DEAD_RECEIPT = "('draft', 'cancelled', 'reversed')";
const PENDING_DELIVERY = "('pending', 'processing', 'failed')";
const num = (value) => Number(value ?? 0);

function access(context) {
  return {
    sales: customerCan(context, "sales.view"),
    finance: canViewCustomerFinancials(context),
    crm: customerCan(context, "crm.opportunities.view"),
    projects: customerCan(context, "projects.view"),
    support: customerCan(context, "support.view"),
    notes: customerCan(context, "crm.notes.view"),
  };
}

export async function getCustomerOverview(client, context, customerId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const customer = await loadCustomerRow(client, context, customerId);
  const can = access(context);
  const values = [context.organizationId, customer.id];
  const one = async (sql) => (await client.query(sql, values)).rows[0];
  const overview = { access: can };

  overview.crm = {
    accountId: customer.id,
    accountNumber: customer.code,
    accountName: customer.display_name,
    ownerName: customer.owner_name ?? null,
    openOpportunities: [],
  };
  if (can.crm) {
    const { rows } = await client.query(
      `SELECT opportunity.id, opportunity.code, opportunity.name, opportunity.amount, opportunity.currency_code, opportunity.expected_close_date, stage.name AS stage_name
         FROM tenant.crm_opportunities opportunity
         LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
        WHERE opportunity.organization_id = $1 AND opportunity.party_id = $2 AND opportunity.status = 'open'
        ORDER BY opportunity.expected_close_date NULLS LAST LIMIT 10`, values);
    overview.crm.openOpportunities = rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, amount: row.amount === null ? null : num(row.amount), currencyCode: row.currency_code?.trim() ?? null,
      expectedCloseDate: row.expected_close_date, stageName: row.stage_name, href: `/crm/opportunities/${row.id}`,
    }));
  }

  if (can.sales) {
    const sales = await one(
      `SELECT (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status IN ${OPEN_QUOTATION})::int AS open_quotations,
              (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status IN ${OPEN_ORDER})::int AS open_orders,
              (SELECT count(*) FROM tenant.sales_fulfillment_requests request
                 JOIN tenant.sales_orders sales_order ON sales_order.organization_id = request.organization_id AND sales_order.id = request.sales_order_id
                WHERE request.organization_id = $1 AND sales_order.party_id = $2 AND request.status IN ${PENDING_DELIVERY})::int AS pending_deliveries,
              (SELECT max(order_date) FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status NOT IN ('draft', 'cancelled')) AS last_order_date`);
    overview.sales = { openQuotations: sales.open_quotations, openSalesOrders: sales.open_orders, pendingDeliveries: sales.pending_deliveries, lastOrderDate: sales.last_order_date };
  }

  if (can.finance) {
    const open = `invoice_type <> 'credit_note' AND status IN ${OPEN_INVOICE}`;
    const finance = await one(
      `SELECT COALESCE(sum(outstanding_amount) FILTER (WHERE ${open}), 0) AS outstanding,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND due_date < current_date), 0) AS overdue,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND due_date >= current_date), 0) AS not_due,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND current_date - due_date BETWEEN 1 AND 30), 0) AS days_1_30,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND current_date - due_date BETWEEN 31 AND 60), 0) AS days_31_60,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND current_date - due_date BETWEEN 61 AND 90), 0) AS days_61_90,
              COALESCE(sum(outstanding_amount) FILTER (WHERE ${open} AND current_date - due_date > 90), 0) AS days_over_90,
              count(*) FILTER (WHERE ${open})::int AS open_invoices
         FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2`);
    const receipts = await one(
      `SELECT COALESCE(sum(unapplied_amount), 0) AS unallocated,
              (SELECT jsonb_build_object('date', receipt_date, 'amount', amount, 'number', receipt_number) FROM tenant.accounting_customer_receipts
                WHERE organization_id = $1 AND party_id = $2 AND status NOT IN ${DEAD_RECEIPT} ORDER BY receipt_date DESC, created_at DESC LIMIT 1) AS last_payment
         FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2 AND status NOT IN ${DEAD_RECEIPT}`);
    const credit = await one(
      `SELECT (SELECT COALESCE(sum(outstanding_amount), 0) FROM tenant.accounting_customer_invoices
                WHERE organization_id = $1 AND party_id = $2 AND invoice_type = 'credit_note' AND status IN ('posted', 'partially_paid')) AS amount,
              (SELECT COALESCE(sum(amount), 0) FROM tenant.accounting_customer_refunds WHERE organization_id = $1 AND party_id = $2 AND status = 'posted') AS refunded`);
    overview.finance = {
      currencyCode: customer.currency_code?.trim() ?? null,
      outstanding: num(finance.outstanding),
      overdue: num(finance.overdue),
      unallocatedAdvance: num(receipts.unallocated),
      // What is left on posted credit notes: with unapplied receipts, the credit Finance can apply or refund.
      creditNoteCredit: num(credit.amount),
      refunded: num(credit.refunded),
      openInvoices: finance.open_invoices,
      lastPaymentDate: receipts.last_payment?.date ?? null,
      lastPaymentAmount: receipts.last_payment ? num(receipts.last_payment.amount) : null,
      lastPaymentNumber: receipts.last_payment?.number ?? null,
      aging: [
        { key: "not_due", label: "Not due", amount: num(finance.not_due) },
        { key: "1_30", label: "1–30 days", amount: num(finance.days_1_30) },
        { key: "31_60", label: "31–60 days", amount: num(finance.days_31_60) },
        { key: "61_90", label: "61–90 days", amount: num(finance.days_61_90) },
        { key: "over_90", label: "Over 90 days", amount: num(finance.days_over_90) },
      ],
    };
  }
  return overview;
}

// The related lists. Each entry: the access it needs, the query, and the
// page a row opens.
const RELATED = Object.freeze({
  quotations: {
    needs: "sales",
    sql: `SELECT quotation.id, quotation.quotation_number AS code, quotation.lifecycle_status AS status, version.grand_total AS amount, version.currency_code,
                 quotation.created_at AS date, quotation.valid_until AS due_date
            FROM tenant.sales_quotations quotation
            LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
           WHERE quotation.organization_id = $1 AND quotation.party_id = $2 ORDER BY quotation.created_at DESC LIMIT 200`,
    href: (row) => `/sales/quotations/${row.id}`,
  },
  orders: {
    needs: "sales",
    // Each order with where it stands, from the order tracking service: the same summary the order list and the order page show.
    tracking: true,
    sql: `SELECT sales_order.id, sales_order.sales_order_number AS code, sales_order.lifecycle_status AS status, sales_order.lifecycle_status,
                 (sales_order.requested_delivery_date < current_date) AS requested_delivery_overdue, ${TRACKING_COLUMNS},
                 version.grand_total AS amount,
                 version.currency_code, sales_order.order_date AS date
            FROM tenant.sales_orders sales_order
            LEFT JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
            ${quantitiesJoin("sales_order", "$3")}
            ${financeJoin("sales_order")}
           WHERE sales_order.organization_id = $1 AND sales_order.party_id = $2 ORDER BY sales_order.order_date DESC NULLS LAST, sales_order.created_at DESC LIMIT 200`,
    href: (row) => `/sales/orders/${row.id}`,
  },
  deliveries: {
    needs: "sales",
    sql: `SELECT request.id, request.request_number AS code, request.status, sales_order.sales_order_number AS title, sales_order.id AS parent_id,
                 COALESCE(request.delivered_at, request.shipped_at, request.requested_at) AS date, request.tracking_number AS detail
            FROM tenant.sales_fulfillment_requests request
            JOIN tenant.sales_orders sales_order ON sales_order.organization_id = request.organization_id AND sales_order.id = request.sales_order_id
           WHERE request.organization_id = $1 AND sales_order.party_id = $2 ORDER BY request.requested_at DESC LIMIT 200`,
    href: (row) => `/sales/deliveries/${row.id}`,
  },
  invoices: {
    needs: "finance",
    sql: `SELECT invoice.id, invoice.invoice_number AS code, invoice.status, invoice.grand_total AS amount, invoice.outstanding_amount AS outstanding, invoice.currency_code,
                 invoice.invoice_date AS date, invoice.due_date, sales_invoice.customer_invoice_id IS NOT NULL AS from_sales
            FROM tenant.accounting_customer_invoices invoice
            LEFT JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = invoice.id
           WHERE invoice.organization_id = $1 AND invoice.party_id = $2 AND invoice.invoice_type <> 'credit_note'
           ORDER BY invoice.invoice_date DESC, invoice.created_at DESC LIMIT 200`,
    // Each invoice is its own document; a Sales invoice opens in Sales.
    href: (row) => (row.from_sales ? `/sales/invoices/${row.id}` : null),
  },
  payments: {
    needs: "finance",
    // Receipts (with what is left unapplied) and the refunds paid back to the customer.
    sql: `SELECT id, receipt_number AS code, status, amount, unapplied_amount AS outstanding, currency_code, receipt_date::timestamptz AS date,
                 concat_ws(' · ', 'Receipt', replace(payment_method, '_', ' ')) AS detail, 'receipt' AS parent_id
            FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2
          UNION ALL
          SELECT refund.id, refund.refund_number, refund.status, refund.amount, NULL, refund.currency_code, refund.refund_date::timestamptz,
                 concat_ws(' · ', 'Refund', replace(refund.payment_method, '_', ' '), refund.external_reference), 'refund'
            FROM tenant.accounting_customer_refunds refund WHERE refund.organization_id = $1 AND refund.party_id = $2
           ORDER BY date DESC LIMIT 200`,
    href: (row) => (row.parent_id === "refund" ? `/accounting/customer-refunds/${row.id}` : null),
  },
  returns: {
    needs: "sales",
    // Each return with what came back, its order and the credit notes made for it; then the credit notes themselves.
    sql: `SELECT sales_return.id, sales_return.return_number AS code, sales_return.status,
                 (SELECT string_agg(line.item_name_snapshot || ' × ' || trim(trailing '.' from trim(trailing '0' from line.quantity::text)), ', ' ORDER BY line.sequence)
                    FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS title,
                 sales_return.return_date::timestamptz AS date,
                 concat_ws(' · ', sales_order.sales_order_number,
                   (SELECT string_agg(DISTINCT credit_note.invoice_number, ', ') FROM tenant.sales_return_credits credit
                      JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id WHERE credit.sales_return_id = sales_return.id)) AS detail,
                 'return' AS parent_id, NULL::numeric AS amount, NULL::text AS currency_code
            FROM tenant.sales_returns sales_return
            JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_return.organization_id AND sales_order.id = sales_return.sales_order_id
           WHERE sales_return.organization_id = $1 AND sales_return.party_id = $2
          UNION ALL
          SELECT invoice.id, invoice.invoice_number, invoice.status, NULL, invoice.invoice_date::timestamptz, 'Credit note',
                 CASE WHEN EXISTS (SELECT 1 FROM tenant.sales_credit_notes note WHERE note.customer_invoice_id = invoice.id) THEN 'credit_note' END, invoice.grand_total, invoice.currency_code
            FROM tenant.accounting_customer_invoices invoice
           WHERE invoice.organization_id = $1 AND invoice.party_id = $2 AND invoice.invoice_type = 'credit_note' AND $3::boolean
           ORDER BY date DESC LIMIT 200`,
    finance: true,
    href: (row) => (row.parent_id === "return" ? `/sales/returns/${row.id}` : row.parent_id === "credit_note" ? `/sales/credit-notes/${row.id}` : null),
  },
  projects: {
    needs: "projects",
    sql: `SELECT project.id, project.project_number AS code, project.name AS title, project.status, project.planned_end_date AS date, manager.full_name AS detail
            FROM tenant.projects project LEFT JOIN public.users manager ON manager.id = project.project_manager_id
           WHERE project.organization_id = $1 AND project.customer_id = $2 ORDER BY project.created_at DESC LIMIT 200`,
    href: () => null,
  },
  support: {
    needs: "support",
    sql: `SELECT ticket.id, ticket.ticket_number AS code, ticket.subject AS title, ticket.status, ticket.priority AS detail, ticket.created_at AS date
            FROM tenant.support_tickets ticket WHERE ticket.organization_id = $1 AND ticket.customer_id = $2 ORDER BY ticket.created_at DESC LIMIT 200`,
    href: (row) => `/support/ticket/${row.id}`,
  },
});

export const CUSTOMER_RELATED_LISTS = Object.freeze(Object.keys(RELATED));

export async function listCustomerRelated(client, context, customerId, list) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const definition = RELATED[list];
  if (!definition) throw new CustomerError(404, "Unknown list.", "SALES_CUSTOMER_RELATED_UNKNOWN");
  const can = access(context);
  if (!can[definition.needs]) throw new CustomerError(403, "You do not have access to this information.", "PERMISSION_DENIED");
  const customer = await loadCustomerRow(client, context, customerId);
  const values = [context.organizationId, customer.id];
  if (definition.finance) values.push(can.finance);
  if (definition.tracking) values.push(await invoicingBasisSetting(client, context.organizationId));
  const { rows } = await client.query(definition.sql, values);
  return rows.map((row) => ({
    id: row.id,
    code: row.code ?? null,
    title: row.title ?? null,
    status: row.status ?? null,
    detail: definition.tracking
      ? (["draft", "cancelled"].includes(row.lifecycle_status) ? null : summaryLine(summaryFromRow(row, { canSeeMoney: Boolean(can.finance) }), { canSeeMoney: Boolean(can.finance) }))
      : row.detail ?? null,
    amount: row.amount === null || row.amount === undefined ? null : num(row.amount),
    // For an order: what is still owed on its invoices, from Finance.
    outstanding: definition.tracking ? (can.finance && !["draft", "cancelled"].includes(row.lifecycle_status) ? num(row.finance_balance_due) : null)
      : row.outstanding === null || row.outstanding === undefined ? null : num(row.outstanding),
    currencyCode: row.currency_code?.trim() ?? null,
    date: row.date ?? null,
    dueDate: row.due_date ?? null,
    href: definition.href(row),
  }));
}

// The audit trail and business history: who changed what, when, with the old
// and new values. It is the same timeline the CRM account shows.
export async function listCustomerHistory(client, context, customerId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const customer = await loadCustomerRow(client, context, customerId);
  return listAccountHistory(client, context, customer.id);
}

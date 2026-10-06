// Who may see and act on sales invoices. An invoice is seen by whoever can see
// its sales order (own / team / all), or by anyone allowed to see every
// invoice (Finance). What the caller sees of payments and of the books is
// decided separately: a salesperson sees the balance, not the ledger.
import { orderCan, orderScopeSql } from "../orders/access.js";
import { requireUuid } from "../orders/constants.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";

export const invoiceCan = orderCan;

export function requireInvoicePermission(context, permission, message = "You do not have permission to do this.") {
  if (!invoiceCan(context, permission)) throw new InvoiceError(403, message, "PERMISSION_DENIED");
}

export function requireInvoiceAccess(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.view) && !invoiceCan(context, INVOICE_PERMISSIONS.viewAll))
    throw new InvoiceError(403, "You do not have permission to view sales invoices.", "PERMISSION_DENIED");
}

// " AND (…)" limiting `alias` (a sales_orders alias) to what the caller may see; "" with view-all.
export function invoiceScopeSql(context, values, alias = "sales_order") {
  if (invoiceCan(context, INVOICE_PERMISSIONS.viewAll)) return "";
  return orderScopeSql(context, values, alias);
}

// The invoice (Finance's row joined with its Sales record), after checking the caller may see it; locked for a change when asked.
export async function loadInvoice(client, context, invoiceId, { lock = false } = {}) {
  requireInvoiceAccess(context);
  const values = [context.organizationId, requireUuid(invoiceId, "Invoice")];
  const scope = invoiceScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT invoice.*, btrim(invoice.currency_code) AS currency_code, sales_invoice.sales_order_id, sales_invoice.sales_order_version_id, sales_invoice.quantity_basis,
            sales_invoice.customer_snapshot AS sales_customer_snapshot, sales_invoice.contact_id, sales_invoice.contact_snapshot, sales_invoice.shipping_address_snapshot,
            sales_invoice.seller_registration_id, sales_invoice.seller_snapshot, sales_invoice.place_of_supply_name, sales_invoice.supply_nature, sales_invoice.customer_po_number,
            sales_invoice.owner_user_id, sales_invoice.customer_notes, sales_invoice.internal_notes, sales_invoice.version, sales_invoice.sent_at, sales_invoice.sent_by,
            sales_invoice.sent_to, sales_invoice.sent_channel, sales_invoice.reversed_at, sales_invoice.reversed_by, sales_invoice.reversal_reason,
            sales_invoice.reversal_journal_entry_id, sales_invoice.idempotency_key,
            sales_invoice.calculated_due_date, sales_invoice.due_date_overridden, sales_invoice.due_date_override_reason, sales_order.sales_order_number, sales_order.lifecycle_status AS order_status,
            sales_order.current_version_id AS order_version_id
       FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_invoice.organization_id AND sales_order.id = sales_invoice.sales_order_id
      WHERE sales_invoice.organization_id = $1 AND sales_invoice.customer_invoice_id = $2${scope}${lock ? " FOR UPDATE OF sales_invoice, invoice" : ""}`, values);
  if (!rows[0]) throw new InvoiceError(404, "Invoice not found.", "SALES_INVOICE_NOT_FOUND");
  return rows[0];
}

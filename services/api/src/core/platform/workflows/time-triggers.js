// Time-based automation triggers (Shared Platform plan 6): "N days before or after a date on a record" — an invoice's due date, a
// quotation's valid-until date, a purchase order's expected delivery, a supplier bill's due date. Once a day the worker finds, for each
// active automation on one of these, the records whose date plus the offset is today, and runs the automation once per record and day.
// Each trigger reads only what its condition fields name, and only records still open (an invoice paid, a quotation decided or a PO
// received in full no longer triggers).
const fields = (...entries) => Object.freeze(entries.map((entry) => Object.freeze(entry)));

export const TIME_TRIGGERS = Object.freeze([
  Object.freeze({
    key: "time.sales.invoice.due",
    moduleKey: "sales",
    label: "Days from an unpaid invoice's due date",
    description: "A posted invoice with money still due, the given number of days before (negative) or after its due date.",
    entityType: "sales.invoice",
    conditionFields: fields({ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, { key: "balanceDue", label: "Balance due", type: "number" }),
    sql: `SELECT sales_invoice.customer_invoice_id AS entity_id, invoice.invoice_number AS "invoiceNumber", invoice.party_id AS "customerId", sales_invoice.owner_user_id AS "ownerUserId",
                 invoice.outstanding_amount::text AS "balanceDue", to_char(invoice.due_date, 'YYYY-MM-DD') AS "dueDate"
            FROM tenant.sales_invoices sales_invoice
            JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
           WHERE sales_invoice.organization_id = $1 AND invoice.status = 'posted' AND invoice.outstanding_amount > 0 AND invoice.due_date = $2::date`,
  }),
  Object.freeze({
    key: "time.sales.quotation.valid_until",
    moduleKey: "sales",
    label: "Days from an open quotation's valid-until date",
    description: "A sent quotation the customer has not answered, the given number of days before (negative) or after its valid-until date.",
    entityType: "sales.quotation",
    conditionFields: fields({ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }),
    sql: `SELECT quote.id AS entity_id, quote.quotation_number AS "quotationNumber", quote.party_id AS "customerId", quote.owner_user_id AS "ownerUserId",
                 to_char(quote.valid_until, 'YYYY-MM-DD') AS "validUntil"
            FROM tenant.sales_quotations quote
           WHERE quote.organization_id = $1 AND quote.lifecycle_status IN ('approved', 'sent', 'viewed') AND quote.valid_until = $2::date`,
  }),
  Object.freeze({
    key: "time.procurement.purchase_order.expected",
    moduleKey: "procurement",
    label: "Days from a purchase order's expected delivery",
    description: "A confirmed purchase order not yet received in full, the given number of days before (negative) or after its expected delivery date.",
    entityType: "procurement.purchase_order",
    conditionFields: fields({ key: "buyerUserId", label: "Buyer", type: "user" }, { key: "supplierId", label: "Supplier" }),
    sql: `SELECT po.id AS entity_id, po.purchase_order_number AS "purchaseOrderNumber", po.supplier_id AS "supplierId", po.buyer_user_id AS "buyerUserId",
                 to_char(po.expected_delivery_date, 'YYYY-MM-DD') AS "expectedDeliveryDate"
            FROM tenant.purchase_orders po
           WHERE po.organization_id = $1 AND po.status = 'confirmed' AND po.expected_delivery_date = $2::date
             AND EXISTS (SELECT 1 FROM tenant.purchase_order_line_status status WHERE status.organization_id = po.organization_id AND status.purchase_order_id = po.id
                          AND status.receipt_required AND status.remaining_to_receive > 0)`,
  }),
  Object.freeze({
    key: "time.procurement.supplier_bill.due",
    moduleKey: "procurement",
    label: "Days from an unpaid supplier bill's due date",
    description: "A posted supplier bill not yet paid in full, the given number of days before (negative) or after its due date.",
    entityType: "procurement.supplier_bill",
    conditionFields: fields({ key: "supplierId", label: "Supplier" }, { key: "balanceDue", label: "Balance due", type: "number" }),
    sql: `SELECT bill.id AS entity_id, bill.bill_number AS "billNumber", COALESCE(bill.supplier_id, bill.party_id) AS "supplierId", bill.outstanding_amount::text AS "balanceDue",
                 to_char(bill.due_date, 'YYYY-MM-DD') AS "dueDate"
            FROM tenant.accounting_vendor_bills bill
           WHERE bill.organization_id = $1 AND bill.status = 'posted' AND bill.outstanding_amount > 0 AND bill.due_date = $2::date`,
  }),
]);

const BY_KEY = new Map(TIME_TRIGGERS.map((trigger) => [trigger.key, trigger]));
export function getTimeTrigger(key) {
  return BY_KEY.get(String(key || "")) || null;
}
export const TIME_TRIGGER_OFFSET = Object.freeze({ min: -90, max: 365 });

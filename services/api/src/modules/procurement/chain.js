// The document chain (Procurement plan Phases 1–2): every Procurement document shows where it sits in Indent → RFQ → Quotation → PO → GRN →
// Bill → Payment, each step with its documents (number, status, address) or greyed out when not reached. Read from the documents' own
// links: order lines naming indent lines, quotations answering an RFQ and converted to an order, the orders' receipts and bills, the
// payments allocated (or planned) to those bills and the advances paid against the orders. An indent or an RFQ can lead to several orders;
// a direct bill (no order) has only Bill → Payment. Documents the person may not open are counted without an address.
import { decimal } from "../../core/decimal.js";
import { PurchaseOrderError, isUuid } from "./purchase-orders/constants.js";
import { poCan, poScopeSql, requirePoAccess } from "./purchase-orders/access.js";
import { BILL_PERMISSIONS } from "./supplier-bills/constants.js";

export const PROCUREMENT_CHAIN_TYPES = Object.freeze(["purchase_indent", "purchase_rfq", "supplier_quotation", "purchase_order", "goods_receipt", "supplier_bill", "supplier_payment",
  "purchase_return"]);
const one = async (client, sql, values) => (await client.query(sql, values)).rows[0] ?? null;
const ids = async (client, sql, values, key = "id") => (await client.query(sql, values)).rows.map((row) => row[key]).filter(Boolean);
const STATUS = {
  draft: "Draft", confirmed: "Confirmed", closed: "Closed", cancelled: "Cancelled", posted: "Posted", reversed: "Reversed", received: "Received", converted: "Converted",
  pending_approval: "Awaiting approval", approved: "Approved", partially_paid: "Part paid", paid: "Paid", overdue: "Overdue", disputed: "Disputed", partially_applied: "Paid",
  applied: "Paid", submitted: "To approve", rejected: "Rejected", sent: "Sent", awarded: "Awarded",
};
const statusLabel = (status) => STATUS[status] ?? String(status ?? "").replace(/_/g, " ");

// getProcurementDocumentChain(type, id) → { current: { type, id }, direct, steps: [{ key, label, reached, documents: [{ id, number, status, statusLabel, href }] }] }
export async function getProcurementDocumentChain(client, context, type, id) {
  if (!PROCUREMENT_CHAIN_TYPES.includes(type)) throw new PurchaseOrderError(400, "Unknown document type.", "CHAIN_TYPE_INVALID");
  if (!isUuid(id)) throw new PurchaseOrderError(404, "Document not found.", "CHAIN_DOCUMENT_NOT_FOUND");
  const org = context.organizationId;
  const seesOrders = poCan(context, "procurement.po.view") || poCan(context, "procurement.po.view_all");
  const seesBills = poCan(context, BILL_PERMISSIONS.view) || poCan(context, BILL_PERMISSIONS.manage) || poCan(context, BILL_PERMISSIONS.approve);
  if (!seesOrders && !seesBills) requirePoAccess(context);

  // Where the document leads: its orders (several for an indent or an RFQ), and the bills and payments it is itself.
  let orderIds = [];
  let billIds = [];
  let paymentIds = [];
  let indentIds = [];
  let rfqIds = [];
  let quotationIds = [];
  if (type === "purchase_order") orderIds = [id];
  else if (type === "goods_receipt") orderIds = await ids(client, `SELECT purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [org, id], "purchase_order_id");
  else if (type === "purchase_return") orderIds = await ids(client, `SELECT purchase_order_id FROM tenant.purchase_returns WHERE organization_id = $1 AND id = $2`, [org, id], "purchase_order_id");
  else if (type === "supplier_quotation") {
    quotationIds = [id];
    orderIds = await ids(client, `SELECT converted_purchase_order_id FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = $2`, [org, id], "converted_purchase_order_id");
    rfqIds = await ids(client, `SELECT rfq_id FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = $2`, [org, id], "rfq_id");
  } else if (type === "purchase_indent") {
    indentIds = [id];
    orderIds = await ids(client,
      `SELECT DISTINCT po_line.purchase_order_id FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_indent_lines line ON line.organization_id = po_line.organization_id
          AND line.id = po_line.source_indent_line_id WHERE line.organization_id = $1 AND line.indent_id = $2`, [org, id], "purchase_order_id");
    rfqIds = await ids(client, `SELECT DISTINCT rfq_line.rfq_id FROM tenant.purchase_rfq_lines rfq_line JOIN tenant.purchase_indent_lines line ON line.organization_id = rfq_line.organization_id
          AND line.id = rfq_line.indent_line_id WHERE line.organization_id = $1 AND line.indent_id = $2`, [org, id], "rfq_id");
  } else if (type === "purchase_rfq") {
    rfqIds = [id];
    orderIds = await ids(client, `SELECT DISTINCT converted_purchase_order_id FROM tenant.supplier_quotations WHERE organization_id = $1 AND rfq_id = $2`, [org, id], "converted_purchase_order_id");
  } else if (type === "supplier_bill") {
    const bill = await one(client, `SELECT id, source_purchase_order_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [org, id]);
    if (!bill) throw new PurchaseOrderError(404, "Document not found.", "CHAIN_DOCUMENT_NOT_FOUND");
    orderIds = bill.source_purchase_order_id ? [bill.source_purchase_order_id] : [];
    billIds = [bill.id];
  } else if (type === "supplier_payment") {
    const payment = await one(client, `SELECT id, purchase_order_id FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2`, [org, id]);
    if (!payment) throw new PurchaseOrderError(404, "Document not found.", "CHAIN_DOCUMENT_NOT_FOUND");
    paymentIds = [payment.id];
    billIds = await ids(client, `SELECT DISTINCT vendor_bill_id FROM tenant.accounting_vendor_payment_allocations WHERE organization_id = $1 AND payment_id = $2`, [org, id], "vendor_bill_id");
    orderIds = payment.purchase_order_id ? [payment.purchase_order_id] : billIds.length ? await ids(client,
      `SELECT DISTINCT source_purchase_order_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND source_purchase_order_id IS NOT NULL`, [org, billIds],
      "source_purchase_order_id") : [];
  }
  orderIds = [...new Set(orderIds)];

  // Upstream of the orders: the indents their lines buy for, the quotations they came from and the RFQs those answered.
  if (orderIds.length) {
    indentIds = [...new Set([...indentIds, ...await ids(client,
      `SELECT DISTINCT line.indent_id FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_indent_lines line ON line.organization_id = po_line.organization_id
          AND line.id = po_line.source_indent_line_id WHERE po_line.organization_id = $1 AND po_line.purchase_order_id = ANY($2::uuid[])`, [org, orderIds], "indent_id")])];
    quotationIds = [...new Set([...quotationIds, ...await ids(client,
      `SELECT id FROM tenant.supplier_quotations WHERE organization_id = $1 AND converted_purchase_order_id = ANY($2::uuid[])`, [org, orderIds])])];
  }
  if (quotationIds.length) rfqIds = [...new Set([...rfqIds, ...await ids(client,
    `SELECT rfq_id FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND rfq_id IS NOT NULL`, [org, quotationIds], "rfq_id")])];
  if (rfqIds.length) indentIds = [...new Set([...indentIds, ...await ids(client,
    `SELECT DISTINCT line.indent_id FROM tenant.purchase_rfq_lines rfq_line JOIN tenant.purchase_indent_lines line ON line.organization_id = rfq_line.organization_id
        AND line.id = rfq_line.indent_line_id WHERE rfq_line.organization_id = $1 AND rfq_line.rfq_id = ANY($2::uuid[])`, [org, rfqIds], "indent_id")])];

  const rows = async (sql, list) => (list.length ? (await client.query(sql, [org, list])).rows : []);
  const indents = await rows(`SELECT id, indent_number AS number, status FROM tenant.purchase_indents WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at`, indentIds);
  const rfqList = await rows(`SELECT id, rfq_number AS number, status FROM tenant.purchase_rfqs WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at`, rfqIds);
  const quotations = await rows(`SELECT id, quotation_number AS number, status FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY quotation_date`, quotationIds);
  // Orders the person may not see are steps reached, without their numbers.
  const values = [org, orderIds];
  const scope = seesOrders ? poScopeSql(context, values, "po") : " AND false";
  const visible = orderIds.length ? (await client.query(`SELECT po.id, po.purchase_order_number AS number, po.status FROM tenant.purchase_orders po WHERE po.organization_id = $1
      AND po.id = ANY($2::uuid[])${scope} ORDER BY po.order_date, po.created_at`, values)).rows : [];
  const hidden = orderIds.filter((orderId) => !visible.some((order) => order.id === orderId));
  const hiddenOrders = await rows(`SELECT id, status FROM tenant.purchase_orders WHERE organization_id = $1 AND id = ANY($2::uuid[])`, hidden);
  const receipts = await rows(`SELECT id, receipt_number AS number, CASE WHEN reversed_at IS NOT NULL THEN 'reversed' ELSE status END AS status FROM tenant.goods_receipts
      WHERE organization_id = $1 AND purchase_order_id = ANY($2::uuid[]) AND status <> 'cancelled' ORDER BY receipt_date, created_at`, orderIds);
  billIds = [...new Set([...billIds, ...await ids(client, `SELECT id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_order_id = ANY($2::uuid[])
      AND bill_type = 'bill' AND status NOT IN ('cancelled')`, [org, orderIds])])];
  const bills = await rows(`SELECT id, bill_number AS number, status, outstanding_amount, grand_total FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = ANY($2::uuid[])
      ORDER BY bill_date, created_at`, billIds);
  if (bills.length) paymentIds = [...new Set([...paymentIds, ...await ids(client,
    `SELECT DISTINCT payment_id AS id FROM tenant.accounting_vendor_payment_allocations WHERE organization_id = $1 AND vendor_bill_id = ANY($2::uuid[])
     UNION
     -- A payment awaiting Finance's approval is planned for the bills, not yet allocated to them.
     SELECT payment.id FROM tenant.accounting_vendor_payments payment, jsonb_array_elements(COALESCE(payment.planned_allocations, '[]'::jsonb)) planned
      WHERE payment.organization_id = $1 AND payment.status IN ('draft', 'pending_approval', 'approved') AND planned->>'billId' = ANY($2::uuid[]::text[])`, [org, bills.map((bill) => bill.id)])])];
  if (orderIds.length) paymentIds = [...new Set([...paymentIds, ...await ids(client,
    `SELECT id FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND purchase_order_id = ANY($2::uuid[]) AND status NOT IN ('cancelled')`, [org, orderIds])])];
  const payments = await rows(`SELECT id, payment_number AS number, status FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = ANY($2::uuid[])
      ORDER BY payment_date, created_at`, paymentIds);

  const doc = (row, href) => ({ id: row.id, number: row.number, status: row.status, statusLabel: statusLabel(row.status), href });
  const billStatus = (bill) => (["posted", "partially_paid", "overdue", "disputed"].includes(bill.status) && decimal(bill.outstanding_amount) <= 0n ? "paid"
    : bill.status === "posted" && decimal(bill.outstanding_amount) < decimal(bill.grand_total) ? "partially_paid" : bill.status);
  const purchaseFlow = orderIds.length > 0 || ["purchase_indent", "purchase_rfq", "supplier_quotation"].includes(type);
  const steps = [];
  if (purchaseFlow) {
    steps.push({ key: "indent", label: "Indent", documents: indents.map((row) => doc(row, `/procurement/indents/${row.id}`)) });
    steps.push({ key: "rfq", label: "RFQ", documents: rfqList.map((row) => doc(row, seesOrders ? `/procurement/rfqs/${row.id}` : null)) });
    steps.push({ key: "quotation", label: "Quotation", documents: quotations.map((row) => doc(row, seesOrders ? `/procurement/purchase-orders/quotations/${row.id}` : null)) });
    steps.push({ key: "purchase_order", label: "PO", documents: [...visible.map((row) => doc(row, `/procurement/purchase-orders/${row.id}`)),
      ...hiddenOrders.map((row) => ({ id: row.id, number: "Purchase order", status: row.status, statusLabel: statusLabel(row.status), href: null }))] });
    steps.push({ key: "goods_receipt", label: "GRN", documents: receipts.map((row) => doc(row, seesOrders ? `/procurement/goods-receipts/${row.id}` : null)) });
  }
  steps.push({ key: "supplier_bill", label: "Bill", documents: bills.map((row) => doc({ ...row, status: billStatus(row) }, seesBills ? `/procurement/supplier-bills/${row.id}` : null)) });
  steps.push({ key: "supplier_payment", label: "Payment", documents: payments.map((row) => doc(row, seesBills ? `/procurement/payments/${row.id}` : null)) });
  // Indent and RFQ are optional: a chain that never used them does not show them as missing.
  const shown = steps.filter((step) => !["indent", "rfq", "quotation"].includes(step.key) || step.documents.length > 0 || step.key === typeKey(type));
  return { current: { type, id }, direct: !purchaseFlow, steps: shown.map((step) => ({ ...step, reached: step.documents.length > 0 })) };
}

const typeKey = (type) => ({ purchase_indent: "indent", purchase_rfq: "rfq", supplier_quotation: "quotation" })[type] ?? type;

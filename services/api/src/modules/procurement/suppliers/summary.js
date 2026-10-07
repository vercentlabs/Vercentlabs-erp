// The supplier's 360°: what was bought, received, billed, paid and returned,
// read from the documents that own each fact. Nothing here is stored on the
// supplier: purchase figures come from procurement documents, and what is
// owed and paid from Accounts Payable, through the supplier's party. Amounts
// owed and paid are shown only to whoever may see a supplier's payables;
// others see how many bills are open.
import { SUPPLIER_PERMISSIONS } from "./constants.js";
import { loadSupplier, supplierCan } from "./access.js";

const OPEN_ORDER = ["draft", "confirmed"];
const OPEN_BILL = ["posted", "partially_paid", "overdue", "disputed"];

export async function getSupplierPurchaseSummary(client, context, supplierId) {
  const supplier = await loadSupplier(client, context, supplierId);
  const row = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.purchase_orders po WHERE po.organization_id = $1 AND po.supplier_id = $2 AND po.status <> 'cancelled')::int AS purchase_orders,
            (SELECT count(*) FROM tenant.purchase_orders po WHERE po.organization_id = $1 AND po.supplier_id = $2 AND po.status = ANY($3::text[]))::int AS open_purchase_orders,
            (SELECT max(po.order_date) FROM tenant.purchase_orders po WHERE po.organization_id = $1 AND po.supplier_id = $2 AND po.status <> 'cancelled') AS last_purchase_at,
            (SELECT count(*) FROM tenant.goods_receipts receipt WHERE receipt.organization_id = $1 AND receipt.supplier_id = $2 AND receipt.status = 'draft')::int AS open_receipts,
            (SELECT count(*) FROM tenant.purchase_returns ret WHERE ret.organization_id = $1 AND ret.supplier_id = $2 AND ret.document_status = 'posted')::int AS returns`,
    [context.organizationId, supplier.id, OPEN_ORDER])).rows[0];
  return {
    purchaseOrders: row.purchase_orders, openPurchaseOrders: row.open_purchase_orders, lastPurchaseAt: row.last_purchase_at, openGoodsReceipts: row.open_receipts, purchaseReturns: row.returns,
  };
}

// From Accounts Payable. Amounts in the base currency.
export async function getSupplierPayablesSummary(client, context, supplierId) {
  const supplier = await loadSupplier(client, context, supplierId);
  const money = supplierCan(context, SUPPLIER_PERMISSIONS.payablesView);
  const row = (await client.query(
    `SELECT count(*) FILTER (WHERE bill.bill_type IN ('bill', 'opening') AND bill.status = ANY($3::text[]) AND bill.outstanding_amount > 0.005)::int AS open_bills,
            count(*) FILTER (WHERE bill.bill_type IN ('bill', 'opening') AND bill.status = ANY($3::text[]) AND bill.outstanding_amount > 0.005 AND bill.due_date < current_date)::int AS overdue_bills,
            COALESCE(sum(bill.outstanding_amount * bill.exchange_rate) FILTER (WHERE bill.bill_type IN ('bill', 'opening') AND bill.status = ANY($3::text[])), 0) AS open_payables,
            COALESCE(sum(bill.outstanding_amount * bill.exchange_rate) FILTER (WHERE bill.bill_type IN ('bill', 'opening') AND bill.status = ANY($3::text[]) AND bill.due_date < current_date), 0) AS overdue_payables,
            COALESCE(sum(bill.outstanding_amount * bill.exchange_rate) FILTER (WHERE bill.bill_type IN ('credit_note', 'debit_note') AND bill.status = ANY($3::text[])), 0) AS unapplied_credit_notes
       FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = $1 AND bill.party_id = $2`, [context.organizationId, supplier.party_id, OPEN_BILL])).rows[0];
  const payments = (await client.query(
    `SELECT COALESCE(sum(payment.unapplied_amount * payment.exchange_rate) FILTER (WHERE payment.status IN ('posted', 'partially_applied')), 0) AS unapplied_payments,
            (SELECT jsonb_build_object('number', last.payment_number, 'date', last.payment_date, 'amount', last.amount, 'currency', btrim(last.currency_code))
               FROM tenant.accounting_vendor_payments last WHERE last.organization_id = $1 AND last.party_id = $2 AND last.status IN ('posted', 'partially_applied', 'applied')
              ORDER BY last.payment_date DESC, last.created_at DESC LIMIT 1) AS last_payment
       FROM tenant.accounting_vendor_payments payment WHERE payment.organization_id = $1 AND payment.party_id = $2`, [context.organizationId, supplier.party_id])).rows[0];
  const base = { openBills: row.open_bills, overdueBills: row.overdue_bills, amountsVisible: money };
  if (!money) return base;
  return {
    ...base, openPayables: Number(row.open_payables), overduePayables: Number(row.overdue_payables),
    unappliedCredits: Number(row.unapplied_credit_notes) + Number(payments.unapplied_payments), lastPayment: payments.last_payment ?? null,
  };
}

// The documents themselves, newest first, each opening its own page. kind: orders | receipts | returns | bills | payments.
export async function listSupplierDocuments(client, context, supplierId, kind) {
  const supplier = await loadSupplier(client, context, supplierId);
  const values = [context.organizationId, supplier.id];
  const money = supplierCan(context, SUPPLIER_PERMISSIONS.payablesView);
  switch (kind) {
    case "orders":
      return (await client.query(
        `SELECT id, status, order_date, purchase_order_number AS number, supplier_reference AS title, btrim(currency_code) AS currency, grand_total AS total, expected_delivery_date AS expected
           FROM tenant.purchase_orders WHERE organization_id = $1 AND supplier_id = $2 ORDER BY order_date DESC, created_at DESC LIMIT 200`, values)).rows
        .map((row) => ({ id: row.id, number: row.number, title: row.title, status: row.status, date: row.order_date, expected: row.expected, currency: row.currency,
          total: row.total === null ? null : Number(row.total), href: `/procurement/purchase-orders/${row.id}` }));
    case "receipts":
      return (await client.query(
        `SELECT receipt.id, receipt.status, receipt.receipt_number AS number, receipt.receipt_date, po.purchase_order_number AS order_number
           FROM tenant.goods_receipts receipt JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
          WHERE receipt.organization_id = $1 AND receipt.supplier_id = $2 ORDER BY receipt.receipt_date DESC, receipt.created_at DESC LIMIT 200`, values)).rows
        .map((row) => ({ id: row.id, number: row.number, status: row.status, date: row.receipt_date, orderNumber: row.order_number || null, href: `/procurement/goods-receipts/${row.id}` }));
    case "returns":
      return (await client.query(
        `SELECT purchase_return.id, purchase_return.document_status AS status, purchase_return.return_date, purchase_return.return_number AS number, po.purchase_order_number AS order_number
           FROM tenant.purchase_returns purchase_return JOIN tenant.purchase_orders po ON po.organization_id = purchase_return.organization_id AND po.id = purchase_return.purchase_order_id
          WHERE purchase_return.organization_id = $1 AND purchase_return.supplier_id = $2 ORDER BY purchase_return.return_date DESC, purchase_return.created_at DESC LIMIT 200`, values)).rows
        .map((row) => ({ id: row.id, number: row.number, status: row.status, date: row.return_date, orderNumber: row.order_number, href: `/procurement/purchase-returns/${row.id}` }));
    case "bills":
      return (await client.query(
        `SELECT id, bill_number, COALESCE(supplier_invoice_reference, supplier_invoice_number) AS supplier_invoice_number, bill_type, status, bill_date, due_date, btrim(currency_code) AS currency, grand_total, outstanding_amount
           FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2 ORDER BY bill_date DESC, created_at DESC LIMIT 200`, [context.organizationId, supplier.party_id])).rows
        .map((row) => ({ id: row.id, number: row.bill_number, supplierInvoiceNumber: row.supplier_invoice_number, type: row.bill_type, status: row.status, date: row.bill_date, dueDate: row.due_date,
          currency: row.currency, total: money ? Number(row.grand_total) : null, outstanding: money ? Number(row.outstanding_amount) : null, href: `/procurement/supplier-bills/${row.id}` }));
    case "payments":
      if (!money) return [];
      return (await client.query(
        `SELECT id, payment_number, status, payment_date, btrim(currency_code) AS currency, amount, unapplied_amount FROM tenant.accounting_vendor_payments
          WHERE organization_id = $1 AND party_id = $2 ORDER BY payment_date DESC, created_at DESC LIMIT 200`, [context.organizationId, supplier.party_id])).rows
        .map((row) => ({ id: row.id, number: row.payment_number, status: row.status, date: row.payment_date, currency: row.currency, amount: Number(row.amount),
          unapplied: Number(row.unapplied_amount), href: "/accounting/payments" }));
    default:
      return [];
  }
}

// The supplier's business history, newest first.
export async function listSupplierHistory(client, context, supplierId) {
  const supplier = await loadSupplier(client, context, supplierId);
  return (await client.query(
    `SELECT event.id, event.event_type, event.summary, event.changes, event.occurred_at, actor.full_name AS actor_name
       FROM tenant.procurement_supplier_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.supplier_id = $2 ORDER BY event.occurred_at DESC, event.id LIMIT 500`, [context.organizationId, supplier.id])).rows
    .map((row) => ({ id: row.id, type: row.event_type, summary: row.summary, at: row.occurred_at, actor: row.actor_name ?? null }));
}

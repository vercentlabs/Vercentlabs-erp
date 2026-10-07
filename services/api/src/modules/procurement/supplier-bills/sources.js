// What a purchase order and its goods receipts may still be billed for. Eligibility follows the company's matching policy: goods once
// received (receipt basis — the received, accepted quantities, net of returns and rejections, held goods only when allowed) or as ordered
// (PO basis, for advance invoicing); services as ordered, by quantity or — fixed-value services — by amount of the agreed value.
//
// Only POSTED bills consume eligibility: they are authoritative. Drafts (and bills awaiting approval) are shown as warnings, never reserved,
// so two drafts may be prepared for the same remaining quantity; posting checks again under the order's lock and the second is refused.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { loadPurchaseOrder } from "../purchase-orders/access.js";
import { loadLineProgress } from "../purchase-orders/progress.js";
import { POSTED_STATUSES, requireUuid } from "./constants.js";

const dec = (value) => formatDecimal(value);
const POSTED_SQL = `(${POSTED_STATUSES.map((status) => `'${status}'`).join(", ")})`;

// Per order line: what this bill holds (own), what posted bills billed before (quantity, taxable value, discounts — the basis for the order's
// discounts and the final bill's remainder) and what other unposted bills hold (drafts: a warning, not a reservation).
export async function billedOnLines(client, organizationId, orderId, excludeBillId = null) {
  const { rows } = await client.query(
    `SELECT line.purchase_order_line_id, bill.id = $3::uuid AS own, bill.status IN ${POSTED_SQL} AS posted, sum(line.quantity) AS quantity, sum(line.net_amount) AS taxable,
            sum(line.line_discount_amount) AS line_discount, sum(line.allocated_document_discount) AS allocated, array_agg(DISTINCT bill.bill_number) AS numbers
       FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
      WHERE line.organization_id = $1 AND bill.source_purchase_order_id = $2 AND bill.bill_type = 'bill' AND bill.status NOT IN ('cancelled', 'reversed') AND line.purchase_order_line_id IS NOT NULL
      GROUP BY line.purchase_order_line_id, bill.id = $3::uuid, bill.status IN ${POSTED_SQL}`, [organizationId, orderId, excludeBillId]);
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.purchase_order_line_id) ?? { own: 0n, before: { quantity: 0n, taxable: 0n, lineDiscount: 0n, allocated: 0n }, drafts: { quantity: 0n, numbers: [] } };
    if (row.own) entry.own = add(entry.own, row.quantity);
    else if (row.posted) entry.before = { quantity: add(entry.before.quantity, row.quantity), taxable: add(entry.before.taxable, row.taxable),
      lineDiscount: add(entry.before.lineDiscount, row.line_discount), allocated: add(entry.before.allocated, row.allocated) };
    else entry.drafts = { quantity: add(entry.drafts.quantity, row.quantity), numbers: [...entry.drafts.numbers, ...row.numbers] };
    map.set(row.purchase_order_line_id, entry);
  }
  return map;
}

// What each posted receipt line may still be billed for (receipt basis): its billable quantity less what POSTED bills allocated to it — this bill
// aside. draftAllocated: what other unposted bills drew on it (a warning).
export async function receiptLineEligibility(client, organizationId, orderId, excludeBillId = null) {
  const { rows } = await client.query(
    `SELECT billing.goods_receipt_line_id, billing.goods_receipt_id, billing.purchase_order_line_id, billing.receipt_number, billing.receipt_date, billing.billable_quantity,
            billing.allocated_quantity AS allocated,
            COALESCE((SELECT sum(allocation.quantity) FROM tenant.supplier_bill_receipt_allocations allocation
                        JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
                       WHERE allocation.organization_id = billing.organization_id AND allocation.goods_receipt_line_id = billing.goods_receipt_line_id
                         AND bill.status IN ('draft', 'pending_approval', 'approved') AND bill.id IS DISTINCT FROM $3::uuid), 0) AS draft_allocated
       FROM tenant.goods_receipt_line_billing billing
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = billing.organization_id AND receipt.id = billing.goods_receipt_id
      WHERE billing.organization_id = $1 AND receipt.purchase_order_id = $2 ORDER BY billing.receipt_date, billing.receipt_number`, [organizationId, orderId, excludeBillId]);
  return rows.map((row) => {
    const remaining = sub(row.billable_quantity, row.allocated);
    return { goodsReceiptLineId: row.goods_receipt_line_id, goodsReceiptId: row.goods_receipt_id, receiptNumber: row.receipt_number, receiptDate: row.receipt_date,
      purchaseOrderLineId: row.purchase_order_line_id, billable: decimal(row.billable_quantity), allocated: decimal(row.allocated), draftAllocated: decimal(row.draft_allocated),
      remaining: remaining > 0n ? remaining : 0n };
  });
}

// What a buyer or Finance should see before billing a line that had goods refused or rejected: never silently approved.
function rejectionWarning(state, adding = 0n) {
  const acceptable = sub(state.received, state.qualityRejected);
  const parts = [];
  if (state.refusedAtDock > 0n) parts.push(`${dec(state.refusedAtDock)} refused at the dock (never received)`);
  if (state.qualityRejected > 0n) parts.push(`${dec(state.qualityRejected)} rejected after receipt`);
  if (state.openRejections > 0) parts.push(`${state.openRejections} rejection${state.openRejections === 1 ? "" : "s"} still open`);
  if (state.returned > 0n) parts.push(`${dec(state.returned)} returned to the supplier`);
  const billing = state.billed + adding;
  if (state.receiptRequired && billing > acceptable) parts.push(`billed ${dec(billing)} against ${dec(acceptable > 0n ? acceptable : 0n)} acceptable`);
  return parts.length ? `Line ${state.lineNumber}: ${parts.join("; ")}.` : null;
}
export { rejectionWarning };

// getBillablePurchaseOrderQuantity (getPurchaseOrderLineBillingEligibility for every line): per order line, ordered, received, cancelled,
// returned, posted billed, the remaining commitment and what may be billed now — this bill aside — plus drafts holding it and, for services,
// the agreed value and what is left of it.
export async function getBillablePurchaseOrderQuantity(client, context, orderId, { excludeBillId = null } = {}) {
  const order = await loadPurchaseOrder(client, context, orderId);
  const organizationId = context.organizationId;
  const orderLines = (await client.query(
    `SELECT id, line_number, description, unit_price, uom_snapshot, product_type, product_snapshot, ordered_quantity, discount_type, discount_value, line_discount,
            allocated_document_discount, taxable_amount, tax_total FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`,
    [organizationId, order.id])).rows;
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  const billed = await billedOnLines(client, organizationId, order.id, excludeBillId);
  const receipts = await receiptLineEligibility(client, organizationId, order.id, excludeBillId);
  return {
    order: { id: order.id, purchaseOrderNumber: order.purchase_order_number, status: order.status, currencyCode: order.currency_code.trim(), priceMode: order.price_mode, supplierId: order.supplier_id,
      matchingPolicy: order.matching_policy ?? null },
    lines: orderLines.map((row) => {
      const state = progress.get(row.id);
      const drafts = billed.get(row.id)?.drafts ?? { quantity: 0n, numbers: [] };
      const remainingValue = sub(state.agreedAmount, state.billedAmount);
      return {
        purchaseOrderLineId: row.id, lineNumber: row.line_number, description: row.description, productType: row.product_type, product: row.product_snapshot, uom: row.uom_snapshot?.code ?? null,
        orderedUnitPrice: dec(row.unit_price), ordered: dec(state.ordered), received: dec(state.received), accepted: dec(state.accepted), held: dec(state.held),
        cancelled: dec(state.cancelled), returned: dec(state.returned), billable: dec(state.billable), billed: dec(state.billed), remainingToBill: dec(state.remainingToBill),
        remainingCommitment: dec(state.remainingCommitment), draftBilled: dec(drafts.quantity), draftBills: drafts.numbers,
        basis: state.receiptRequired ? state.billingBasis : "order",
        // Services may be billed by amount of their agreed value (fixed-fee services): never a fake quantity or receipt.
        amountBillable: !state.receiptRequired, agreedAmount: dec(state.agreedAmount), billedAmount: dec(state.billedAmount), remainingAmount: dec(remainingValue > 0n ? remainingValue : 0n),
        amountBased: state.amountBased,
        refusedAtDock: dec(state.refusedAtDock), qualityRejected: dec(state.qualityRejected), openRejections: state.openRejections, rejectionWarning: rejectionWarning(state),
        receipts: receipts.filter((entry) => entry.purchaseOrderLineId === row.id).map((entry) => ({ goodsReceiptLineId: entry.goodsReceiptLineId, goodsReceiptId: entry.goodsReceiptId,
          receiptNumber: entry.receiptNumber, billable: dec(entry.billable), allocated: dec(entry.allocated), draftAllocated: dec(entry.draftAllocated), remaining: dec(entry.remaining) })),
        zeroPrice: decimal(row.unit_price) === 0n,
      };
    }),
  };
}
export const getPurchaseOrderLineBillingEligibility = async (client, context, orderId, lineId) => {
  const result = await getBillablePurchaseOrderQuantity(client, context, orderId);
  const line = result.lines.find((entry) => entry.purchaseOrderLineId === requireUuid(lineId, "Order line"));
  if (!line) return null;
  return { order: result.order, line };
};

// getBillableGoodsReceiptQuantity: per receipt line of the chosen posted receipts (one order), what may still be billed against it.
export async function getBillableGoodsReceiptQuantity(client, context, receiptIds) {
  const ids = [...new Set((Array.isArray(receiptIds) ? receiptIds : [receiptIds]).map((id) => requireUuid(id, "Goods receipt")))];
  const receipts = (await client.query(`SELECT id, purchase_order_id, receipt_number, status, reversed_at FROM tenant.goods_receipts WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [context.organizationId, ids])).rows;
  return { receipts, ids };
}

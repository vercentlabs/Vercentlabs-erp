// Where an order stands, worked out from its documents (the
// purchase_order_line_status view: goods receipts, supplier bills, returns
// and cancellations). Nothing here is stored on the order, so it is always
// rebuildable and can never disagree with the documents.
//
// Four independent dimensions: the lifecycle (on the order), receiving,
// billing and payment (from Accounts Payable). Billed means posted: a draft
// bill (or one awaiting approval) is shown, but never counts as billed.
import { decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { STATUS, dayOf } from "./constants.js";

const dec = (value) => formatDecimal(value);
const ZERO = 0n;

export async function loadLineProgress(client, organizationId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`, [organizationId, orderId]);
  return rows.map((row) => {
    const remainingToBill = decimal(row.billable_quantity) - decimal(row.billed_quantity);
    return {
      lineId: row.purchase_order_line_id, lineNumber: row.line_number, productType: row.product_type, receiptRequired: row.receipt_required,
      expectedDeliveryDate: row.expected_delivery_date,
      ordered: decimal(row.ordered_quantity), accepted: decimal(row.accepted_quantity), held: decimal(row.held_quantity), rejected: decimal(row.rejected_quantity),
      received: decimal(row.received_quantity), draftReceipt: decimal(row.draft_receipt_quantity), returned: decimal(row.returned_quantity),
      cancelled: decimal(row.cancelled_quantity), damaged: decimal(row.damaged_quantity), released: decimal(row.released_quantity),
      openInspection: decimal(row.open_inspection_quantity), openDamaged: decimal(row.open_damaged_quantity), returnedFromStock: decimal(row.returned_from_stock_quantity),
      netRetained: decimal(row.net_retained_quantity),
      billed: decimal(row.billed_quantity), postedBilled: decimal(row.posted_billed_quantity), unpostedBilled: decimal(row.unposted_billed_quantity),
      remainingToReceive: decimal(row.remaining_to_receive), billable: decimal(row.billable_quantity), billTarget: decimal(row.bill_target_quantity),
      remainingToBill: remainingToBill > ZERO ? remainingToBill : ZERO, overbilled: remainingToBill < ZERO,
      billingBasis: row.billing_basis,
      refusedAtDock: decimal(row.refused_at_dock_quantity ?? 0), qualityRejected: decimal(row.quality_rejected_quantity ?? 0),
      rejectedFromStock: decimal(row.rejected_from_stock_quantity ?? 0), openRejections: Number(row.open_rejection_cases ?? 0),
      // The agreed value (quantity still committed × agreed price) and what posted bills consumed of it: fixed-value services bill by amount.
      unitPrice: decimal(row.unit_price ?? 0), agreedAmount: decimal(row.agreed_amount ?? 0), billedAmount: decimal(row.billed_amount ?? 0),
      unpostedBilledAmount: decimal(row.unposted_billed_amount ?? 0), amountBased: Number(row.amount_billed_lines ?? 0) > 0,
      remainingCommitment: decimal(row.bill_target_quantity) - decimal(row.billed_quantity) > ZERO ? decimal(row.bill_target_quantity) - decimal(row.billed_quantity) : ZERO,
    };
  });
}

// calculateRemainingReceivableQty / calculateRemainingBillableQty for one line.
export const remainingReceivable = (line) => line.remainingToReceive;
export const remainingBillable = (line) => line.remainingToBill;

export function deriveReceiptStatus(lines) {
  const goods = lines.filter((line) => line.receiptRequired);
  if (!goods.length) return "not_required";
  if (goods.every((line) => line.remainingToReceive === ZERO)) {
    return goods.some((line) => line.cancelled > ZERO) ? "complete_with_cancellations" : "fully_received";
  }
  return goods.some((line) => line.received > ZERO) ? "partially_received" : "not_received";
}

// derivePurchaseOrderBillingStatus, from posted bills only: Not billed / Partially billed / Fully billed / Complete with cancellation (everything
// still committed is billed and the rest was cancelled — never counted as billed) / Overbilled (posted bills exceed what may now be billed,
// after returns or cancellations: Finance corrects it with a debit note).
export function deriveBillingStatus(lines) {
  if (lines.some((line) => line.overbilled || line.billed > line.billTarget)) return "overbilled";
  if (lines.every((line) => line.billed <= ZERO)) return lines.length && lines.every((line) => line.billTarget <= ZERO) ? "complete_with_cancellation" : "not_billed";
  if (!lines.every((line) => line.billed >= line.billTarget)) return "partially_billed";
  return lines.some((line) => line.cancelled > ZERO) ? "complete_with_cancellation" : "fully_billed";
}

// From Accounts Payable: the posted bills of the order and what is still owed on them.
export async function derivePaymentStatus(client, organizationId, orderId) {
  const row = (await client.query(
    `SELECT COALESCE(sum(grand_total), 0) AS total, COALESCE(sum(outstanding_amount), 0) AS outstanding, count(*)::int AS bills
       FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_order_id = $2 AND bill_type = 'bill'
        AND status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')`, [organizationId, orderId])).rows[0];
  if (!row.bills) return { status: "no_payable", total: "0", outstanding: "0" };
  const total = decimal(row.total); const outstanding = decimal(row.outstanding);
  return { status: outstanding <= ZERO ? "paid" : outstanding >= total ? "unpaid" : "partially_paid", total: dec(total), outstanding: dec(outstanding) };
}

// Ready to close: confirmed, nothing left to receive or bill, nothing billed in excess, and no receipt or bill still in progress.
export function calculateClosureEligibility(order, lines, { draftReceipts = 0 } = {}) {
  const reasons = [];
  if (order.status !== STATUS.confirmed) reasons.push(`The order is ${order.status}.`);
  for (const line of lines) {
    if (line.remainingToReceive > ZERO) reasons.push(`Line ${line.lineNumber}: ${dec(line.remainingToReceive)} still to receive (receive it or cancel the remaining quantity).`);
    if (line.overbilled) reasons.push(`Line ${line.lineNumber}: billed ${dec(sub(line.billed, line.billable))} more than may be billed. Finance must correct the bill.`);
    else if (line.billed < line.billTarget) reasons.push(`Line ${line.lineNumber}: ${dec(sub(line.billTarget, line.billed))} still to bill.`);
    if (line.openInspection > ZERO) reasons.push(`Line ${line.lineNumber}: ${dec(line.openInspection)} still on inspection hold (release or return it).`);
    if (line.openDamaged > ZERO) reasons.push(`Line ${line.lineNumber}: ${dec(line.openDamaged)} damaged goods still held (return or release them).`);
    if (line.unpostedBilled > ZERO) reasons.push(`Line ${line.lineNumber}: a supplier bill is not posted yet.`);
    if (line.openRejections > 0) reasons.push(`Line ${line.lineNumber}: ${line.openRejections} rejection${line.openRejections === 1 ? " is" : "s are"} still open (resolve ${line.openRejections === 1 ? "it" : "them"}).`);
  }
  if (draftReceipts) reasons.push(`${draftReceipts} goods receipt${draftReceipts === 1 ? " is" : "s are"} still a draft.`);
  return { eligible: reasons.length === 0, reasons };
}

export function lineProgressView(line) {
  return {
    lineId: line.lineId, lineNumber: line.lineNumber, receiptRequired: line.receiptRequired, ordered: dec(line.ordered), accepted: dec(line.accepted), held: dec(line.held),
    rejected: dec(line.rejected), received: dec(line.received), returned: dec(line.returned), cancelled: dec(line.cancelled), damaged: dec(line.damaged),
    released: dec(line.released), openInspection: dec(line.openInspection), openDamaged: dec(line.openDamaged), netRetained: dec(line.netRetained),
    billed: dec(line.billed), postedBilled: dec(line.postedBilled), remainingToReceive: dec(line.remainingToReceive), billable: dec(line.billable),
    remainingToBill: dec(line.remainingToBill), overbilled: line.overbilled, draftReceipt: dec(line.draftReceipt), unpostedBilled: dec(line.unpostedBilled),
    remainingCommitment: dec(line.remainingCommitment), billTarget: dec(line.billTarget), agreedAmount: dec(line.agreedAmount), billedAmount: dec(line.billedAmount),
    unpostedBilledAmount: dec(line.unpostedBilledAmount), amountBased: line.amountBased,
    refusedAtDock: dec(line.refusedAtDock), qualityRejected: dec(line.qualityRejected), rejectedFromStock: dec(line.rejectedFromStock), openRejections: line.openRejections,
  };
}

// getPurchaseOrderTracking: the four dimensions and the derived indicators.
export async function trackingFor(client, organizationId, order, lines = null) {
  const progress = lines ?? await loadLineProgress(client, organizationId, order.id);
  const draftReceipts = Number((await client.query(
    `SELECT count(*) FROM tenant.goods_receipts WHERE organization_id = $1 AND purchase_order_id = $2 AND status = 'draft'`, [organizationId, order.id])).rows[0].count);
  const today = (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
  const confirmed = order.status === STATUS.confirmed;
  const overdue = confirmed && progress.some((line) => line.remainingToReceive > ZERO
    && (dayOf(line.expectedDeliveryDate ?? order.expected_delivery_date) ?? "9999-12-31") < today);
  const closure = calculateClosureEligibility(order, progress, { draftReceipts });
  const payment = await derivePaymentStatus(client, organizationId, order.id);
  return {
    lifecycle: order.status,
    communication: order.communication_status,
    receipt: deriveReceiptStatus(progress),
    billing: deriveBillingStatus(progress),
    payment: payment.status,
    payable: payment,
    receivingComplete: progress.some((line) => line.receiptRequired) && progress.filter((line) => line.receiptRequired).every((line) => line.remainingToReceive === ZERO),
    readyToReceive: confirmed && progress.some((line) => line.remainingToReceive > ZERO),
    readyToBill: confirmed && progress.some((line) => line.remainingToBill > ZERO),
    readyToClose: closure.eligible,
    closureBlockers: closure.reasons,
    overdueReceipt: overdue,
    draftReceipts,
    openRejections: progress.reduce((total, line) => total + line.openRejections, 0),
    lines: progress.map(lineProgressView),
  };
}

// The same indicators for a list, in SQL, per order alias `po`.
export const LIST_PROGRESS_SQL = `
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status.receipt_required) AS goods_lines,
           count(*) FILTER (WHERE status.receipt_required AND status.remaining_to_receive > 0) AS open_receipt_lines,
           count(*) FILTER (WHERE status.receipt_required AND status.received_quantity > 0) AS received_lines,
           count(*) FILTER (WHERE status.cancelled_quantity > 0) AS cancelled_lines,
           count(*) FILTER (WHERE status.billed_quantity > 0) AS billed_lines,
           count(*) FILTER (WHERE status.billed_quantity < status.bill_target_quantity) AS unbilled_lines,
           count(*) FILTER (WHERE status.billable_quantity - status.billed_quantity > 0) AS billable_lines,
           count(*) FILTER (WHERE status.billed_quantity > status.billable_quantity OR status.billed_quantity > status.bill_target_quantity) AS overbilled_lines,
           count(*) FILTER (WHERE status.cancelled_quantity > 0) AS cancelled_any,
           count(*) AS all_lines, count(*) FILTER (WHERE status.bill_target_quantity <= 0) AS nothing_to_bill_lines,
           count(*) FILTER (WHERE status.unposted_billed_quantity <> 0) AS unposted_bill_lines,
           count(*) FILTER (WHERE status.open_inspection_quantity + status.open_damaged_quantity > 0) AS held_lines,
           COALESCE(sum(status.open_rejection_cases), 0) AS open_rejections,
           count(*) FILTER (WHERE status.receipt_required AND status.remaining_to_receive > 0
                              AND COALESCE(status.expected_delivery_date, po.expected_delivery_date) < current_date) AS overdue_lines
      FROM tenant.purchase_order_line_status status WHERE status.organization_id = po.organization_id AND status.purchase_order_id = po.id) progress ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS draft_receipts FROM tenant.goods_receipts receipt WHERE receipt.organization_id = po.organization_id AND receipt.purchase_order_id = po.id AND receipt.status = 'draft') drafts ON true`;
export const LIST_PROGRESS_COLUMNS = `
  CASE WHEN progress.goods_lines = 0 THEN 'not_required'
       WHEN progress.open_receipt_lines = 0 THEN CASE WHEN progress.cancelled_lines > 0 THEN 'complete_with_cancellations' ELSE 'fully_received' END
       WHEN progress.received_lines > 0 THEN 'partially_received' ELSE 'not_received' END AS receipt_status,
  CASE WHEN progress.overbilled_lines > 0 THEN 'overbilled'
       WHEN progress.billed_lines = 0 THEN CASE WHEN progress.all_lines > 0 AND progress.nothing_to_bill_lines = progress.all_lines THEN 'complete_with_cancellation' ELSE 'not_billed' END
       WHEN progress.unbilled_lines > 0 THEN 'partially_billed'
       WHEN progress.cancelled_any > 0 THEN 'complete_with_cancellation' ELSE 'fully_billed' END AS billing_status,
  (progress.goods_lines > 0 AND progress.open_receipt_lines = 0) AS receiving_complete,
  (po.status = 'confirmed' AND progress.open_receipt_lines > 0) AS ready_to_receive,
  (po.status = 'confirmed' AND progress.billable_lines > 0) AS ready_to_bill,
  (po.status = 'confirmed' AND progress.overdue_lines > 0) AS overdue_receipt,
  (po.status = 'confirmed' AND progress.open_receipt_lines = 0 AND progress.unbilled_lines = 0 AND progress.overbilled_lines = 0
     AND progress.unposted_bill_lines = 0 AND progress.held_lines = 0 AND progress.open_rejections = 0 AND drafts.draft_receipts = 0) AS ready_to_close,
  progress.open_rejections::int AS open_rejections,
  (progress.overbilled_lines > 0 OR (po.status = 'confirmed' AND progress.overdue_lines > 0) OR progress.open_rejections > 0
     OR (po.status = 'confirmed' AND po.communication_status = 'not_sent')) AS needs_attention`;

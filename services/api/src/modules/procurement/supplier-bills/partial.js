// Partial supplier billing: where a purchase order (and each goods receipt) stands against its supplier bills. Nothing here is stored: every
// figure is derived from posted bills, their receipt allocations and Finance's outstanding amounts, so it can always be rebuilt and never
// disagrees with the documents. Ordered, received, accepted, cancelled and returned quantities, what posted bills billed, what the order still
// commits and what may be billed now are kept apart — never one editable status.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { loadPurchaseOrder, poCan } from "../purchase-orders/access.js";
import { deriveBillingStatus, loadLineProgress } from "../purchase-orders/progress.js";
import { calculateSupplierBillTotals } from "./calculate.js";
import { BILL_PERMISSIONS, POSTED_STATUSES, SupplierBillError, dayOf, documentStatus, dueStatus, matchingResult, paymentStatus, requireUuid } from "./constants.js";
import { billedOnLines, receiptLineEligibility } from "./sources.js";
import { MATCHING_POLICIES, TWO_WAY_SQL, policyOf } from "./matching.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const positive = (value) => (value > 0n ? value : 0n);
const BILLING_LABELS = { not_billed: "Not billed", partially_billed: "Partially billed", fully_billed: "Fully billed", complete_with_cancellation: "Complete with cancellation",
  overbilled: "Overbilled" };
const seesBills = (context) => poCan(context, BILL_PERMISSIONS.view) || poCan(context, BILL_PERMISSIONS.manage) || poCan(context, BILL_PERMISSIONS.approve);

// The order's matching policy (fixed at confirmation): 3-Way on accepted or received goods, or 2-Way.
function policyView(order, settings) {
  const policy = policyOf(order, settings);
  return { policy, label: MATCHING_POLICIES[policy], basis: policy === "two_way" ? "order" : "receipt", billHeldGoods: policy === "three_way_received",
    reason: order.matching_policy_reason ?? null };
}

// derivePurchaseOrderBillingStatus: from posted bills only (see progress.js).
export const derivePurchaseOrderBillingStatus = deriveBillingStatus;

// getRelatedSupplierBills: every bill of the order (drafts, posted, cancelled, reversed) with its own status, totals and Finance's balance.
export async function getRelatedSupplierBills(client, context, orderId, { today = null } = {}) {
  const day = today ?? (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
  const { rows } = await client.query(
    `SELECT bill.id, bill.bill_number, bill.bill_type, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice, bill.status, bill.bill_date,
            bill.accounting_date, bill.due_date, bill.currency_code, bill.invoice_total, bill.grand_total, bill.outstanding_amount, bill.matching_status, bill.matching_basis,
            bill.source_type, bill.source_bill_id, ${TWO_WAY_SQL} AS two_way,
            (SELECT count(*) FROM tenant.supplier_bill_match_evaluations evaluation, jsonb_array_elements(evaluation.discrepancies) entry
              WHERE evaluation.organization_id = bill.organization_id AND evaluation.id = bill.two_way_evaluation_id AND NOT COALESCE((entry->>'approved')::boolean, false))::int AS open_discrepancies,
            (SELECT sum(line.quantity) FROM tenant.accounting_vendor_bill_lines line WHERE line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id
                AND line.purchase_order_line_id IS NOT NULL AND line.billing_basis = 'quantity') AS quantity,
            (SELECT sum(line.billed_amount) FROM tenant.accounting_vendor_bill_lines line WHERE line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id
                AND line.billing_basis = 'amount') AS amount,
            (SELECT array_agg(DISTINCT receipt.receipt_number) FROM tenant.supplier_bill_receipt_allocations allocation
               JOIN tenant.goods_receipts receipt ON receipt.organization_id = allocation.organization_id
               JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
                AND receipt.id = receipt_line.goods_receipt_id
              WHERE allocation.organization_id = bill.organization_id AND allocation.vendor_bill_id = bill.id) AS receipts
       FROM tenant.accounting_vendor_bills bill
       JOIN tenant.purchase_orders po ON po.organization_id = bill.organization_id AND po.id = bill.source_purchase_order_id
      WHERE bill.organization_id = $1 AND bill.source_purchase_order_id = $2 ORDER BY bill.bill_date, bill.bill_number`, [context.organizationId, orderId]);
  return rows.map((row) => {
    const posted = POSTED_STATUSES.includes(row.status);
    return {
      id: row.id, billNumber: row.bill_number, type: row.bill_type === "credit_note" ? "vendor_credit" : "bill", supplierInvoiceNumber: row.supplier_invoice, status: row.status,
      documentStatus: documentStatus(row), paymentStatus: paymentStatus(row), dueStatus: dueStatus(row, day), matchingResult: matchingResult(row), matchingBasis: row.matching_basis,
      twoWayResult: row.bill_type === "credit_note" ? "not_applicable" : row.two_way, openDiscrepancies: row.open_discrepancies,
      billDate: dayOf(row.bill_date), postingDate: dayOf(row.accounting_date), dueDate: dayOf(row.due_date), currencyCode: row.currency_code.trim(),
      quantity: row.quantity === null ? null : dec(row.quantity), amount: row.amount === null ? null : dec(row.amount), receipts: row.receipts ?? [],
      invoiceTotal: dec(row.invoice_total), payable: dec(row.grand_total), paid: posted ? dec(sub(row.grand_total, row.outstanding_amount)) : "0",
      outstanding: posted ? dec(row.outstanding_amount) : "0",
      href: row.bill_type === "credit_note" ? `/procurement/debit-notes-credits/vendor-credits/${row.id}` : `/procurement/supplier-bills/${row.id}`,
    };
  });
}

// getPurchaseOrderBillingProgress: the order's billing progress — status, values, per line (ordered, cancelled, received, posted billed, drafts,
// remaining commitment, eligible now; agreed and billed value for services billed by amount) and, for those who may see supplier bills, the
// bills with Finance's paid and outstanding amounts.
export async function getPurchaseOrderBillingProgress(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, requireUuid(orderId, "Purchase order"));
  const organizationId = context.organizationId;
  const orderLines = new Map((await client.query(
    `SELECT id, line_number, description, product_type, uom_snapshot, unit_price, taxable_amount, ordered_quantity FROM tenant.purchase_order_lines
      WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, order.id])).rows.map((row) => [row.id, row]));
  const progress = await loadLineProgress(client, organizationId, order.id);
  const billed = await billedOnLines(client, organizationId, order.id, null);
  const settings = (await client.query(`SELECT billing_basis, bill_held_goods FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  const confirmed = order.status === "confirmed";
  const lines = progress.map((line) => {
    const row = orderLines.get(line.lineId);
    const drafts = billed.get(line.lineId)?.drafts ?? { quantity: 0n, numbers: [] };
    return {
      lineId: line.lineId, lineNumber: line.lineNumber, description: row.description, productType: row.product_type, uom: row.uom_snapshot?.code ?? null,
      basis: line.amountBased ? "amount" : "quantity", matching: line.receiptRequired ? line.billingBasis : "order", receiptRequired: line.receiptRequired,
      ordered: dec(line.ordered), cancelled: dec(line.cancelled), received: dec(line.received), accepted: dec(line.accepted), held: dec(line.held), returned: dec(line.returned),
      committed: dec(line.billTarget), billed: dec(line.billed), draftBilled: dec(drafts.quantity), draftBills: drafts.numbers,
      remainingCommitment: dec(line.remainingCommitment), eligibleNow: dec(line.remainingToBill), overbilled: line.overbilled || line.billed > line.billTarget,
      unitPrice: dec(line.unitPrice), agreedAmount: dec(line.agreedAmount), billedAmount: dec(line.billedAmount), remainingAmount: dec(positive(sub(line.agreedAmount, line.billedAmount))),
      readyToBill: confirmed && line.remainingToBill > 0n && decimal(row.unit_price) > 0n,
    };
  });
  const sum = (key) => progress.reduce((total, line) => add(total, line[key]), 0n);
  const status = deriveBillingStatus(progress);
  const warnings = [];
  for (const line of lines) {
    if (line.overbilled) warnings.push(`Line ${line.lineNumber}: posted bills exceed what may now be billed (after returns or cancellations). a vendor credit corrects it.`);
    if (decimal(line.draftBilled) > 0n) warnings.push(`Line ${line.lineNumber}: ${line.draftBilled} on unposted bill${line.draftBills.length === 1 ? "" : "s"} ${line.draftBills.join(", ")} (not billed until posted).`);
  }
  const result = {
    order: { id: order.id, purchaseOrderNumber: order.purchase_order_number, status: order.status, currencyCode: order.currency_code.trim(), supplierId: order.supplier_id },
    status, statusLabel: BILLING_LABELS[status] ?? status, matchingPolicy: policyView(order, settings),
    totals: {
      ordered: dec(sum("ordered")), cancelled: dec(sum("cancelled")), received: dec(sum("received")), committed: dec(sum("billTarget")), billed: dec(sum("billed")),
      remainingCommitment: dec(sum("remainingCommitment")), eligibleNow: dec(sum("remainingToBill")), draftBilled: dec(sum("unpostedBilled")),
    },
    readyToBill: lines.some((line) => line.readyToBill), lines, warnings,
  };
  if (!seesBills(context)) return { ...result, values: null, bills: null, payments: null };
  const bills = await getRelatedSupplierBills(client, context, order.id);
  const committedValue = sum("agreedAmount");
  const billedValue = sum("billedAmount");
  const postedBills = bills.filter((bill) => bill.type === "bill" && POSTED_STATUSES.includes(bill.status));
  const money = (key) => postedBills.reduce((total, bill) => add(total, bill[key]), 0n);
  return {
    ...result,
    values: { committed: dec(committedValue), billed: dec(billedValue), unbilled: dec(positive(sub(committedValue, billedValue))), drafts: dec(sum("unpostedBilledAmount")) },
    bills, matching: await getPurchaseOrderBillingMatchingSummary(client, context, order.id),
    payments: { invoiced: dec(money("invoiceTotal")), payable: dec(money("payable")), paid: dec(money("paid")), outstanding: dec(money("outstanding")), bills: postedBills.length },
  };
}

// getFixedValueServiceBillingEligibility: a service line billed by amount — its agreed value, what posted bills billed of it, drafts, what is left.
export async function getFixedValueServiceBillingEligibility(client, context, orderId, lineId) {
  const progress = await getPurchaseOrderBillingProgress(client, context, orderId);
  const line = progress.lines.find((entry) => entry.lineId === requireUuid(lineId, "Order line"));
  if (!line) throw new SupplierBillError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
  if (line.receiptRequired) throw new SupplierBillError(409, "Goods are billed by quantity; only a service is billed by amount.", "SUPPLIER_BILL_AMOUNT_BASIS_INVALID");
  return { lineId: line.lineId, lineNumber: line.lineNumber, description: line.description, agreedAmount: line.agreedAmount, billedAmount: line.billedAmount,
    remainingAmount: line.remainingAmount, draftBills: line.draftBills, eligible: progress.order.status === "confirmed" && decimal(line.remainingAmount) > 0n };
}

// getGoodsReceiptBillingEligibility: a posted goods receipt against supplier bills — per receipt line what may be billed (accepted, released,
// net of returns and open rejections; held goods only when the policy allows), what posted bills allocated, drafts, what is left, and the bills.
export async function getGoodsReceiptBillingEligibility(client, context, receiptId) {
  const organizationId = context.organizationId;
  const receipt = (await client.query(`SELECT id, purchase_order_id, receipt_number, status, reversed_at, receipt_date FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`,
    [organizationId, requireUuid(receiptId, "Goods receipt")])).rows[0];
  if (!receipt) throw new SupplierBillError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
  const order = await loadPurchaseOrder(client, context, receipt.purchase_order_id);
  const settings = (await client.query(`SELECT billing_basis, bill_held_goods FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  const eligibility = new Map((await receiptLineEligibility(client, organizationId, order.id)).filter((entry) => entry.goodsReceiptId === receipt.id)
    .map((entry) => [entry.goodsReceiptLineId, entry]));
  const lines = (await client.query(
    `SELECT receipt_line.id, receipt_line.purchase_order_line_id, receipt_line.accepted_quantity, receipt_line.held_quantity, receipt_line.rejected_quantity, receipt_line.product_type,
            order_line.line_number, order_line.description, order_line.uom_snapshot
       FROM tenant.goods_receipt_lines receipt_line
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = receipt_line.organization_id AND order_line.id = receipt_line.purchase_order_line_id
      WHERE receipt_line.organization_id = $1 AND receipt_line.goods_receipt_id = $2 ORDER BY order_line.line_number`, [organizationId, receipt.id])).rows;
  const view = lines.map((line) => {
    const entry = eligibility.get(line.id);
    return {
      receiptLineId: line.id, purchaseOrderLineId: line.purchase_order_line_id, lineNumber: line.line_number, description: line.description, uom: line.uom_snapshot?.code ?? null,
      accepted: dec(line.accepted_quantity), held: dec(line.held_quantity), rejected: dec(line.rejected_quantity),
      billable: dec(entry?.billable ?? 0n), billed: dec(entry?.allocated ?? 0n), draftBilled: dec(entry?.draftAllocated ?? 0n), remaining: dec(entry?.remaining ?? 0n),
    };
  });
  let bills = null;
  if (seesBills(context)) {
    const { rows } = await client.query(
      `SELECT bill.id, bill.bill_number, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice, bill.status, bill.outstanding_amount, bill.grand_total,
              bill.matching_status, bill.bill_date, sum(allocation.quantity) AS quantity
         FROM tenant.supplier_bill_receipt_allocations allocation
         JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
         JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
        WHERE allocation.organization_id = $1 AND receipt_line.goods_receipt_id = $2
        GROUP BY bill.id ORDER BY bill.bill_date, bill.bill_number`, [organizationId, receipt.id]);
    bills = rows.map((row) => ({ id: row.id, billNumber: row.bill_number, supplierInvoiceNumber: row.supplier_invoice, status: row.status, documentStatus: documentStatus(row),
      paymentStatus: paymentStatus(row), matchingResult: matchingResult(row), billDate: dayOf(row.bill_date), quantity: dec(row.quantity), href: `/procurement/supplier-bills/${row.id}` }));
  }
  const receiptBased = policyOf(order, settings) !== "two_way";
  const open = receipt.status === "posted" && !receipt.reversed_at;
  return {
    receipt: { id: receipt.id, receiptNumber: receipt.receipt_number, status: receipt.status, reversed: Boolean(receipt.reversed_at), purchaseOrderId: order.id,
      purchaseOrderNumber: order.purchase_order_number },
    matchingPolicy: policyView(order, settings),
    lines: view, bills,
    canBill: open && order.status === "confirmed" && receiptBased && view.some((line) => decimal(line.remaining) > 0n),
    note: receiptBased ? null : "Bills are matched against the purchase order's commitment (PO-based billing), not against individual receipts.",
  };
}

// calculateSupplierBillTaxes / calculatePartialBillDiscounts: the shared calculation (tax engine, the order's discounts in proportion, the final
// bill's remainder) — one implementation for every bill.
export const calculateSupplierBillTaxes = calculateSupplierBillTotals;
export const calculatePartialBillDiscounts = calculateSupplierBillTotals;

// getPurchaseOrderBillingMatchingSummary: the 2-Way Matching results of the order's live bills (vendor credits aside).
export async function getPurchaseOrderBillingMatchingSummary(client, context, orderId) {
  const bills = (await getRelatedSupplierBills(client, context, requireUuid(orderId, "Purchase order"))).filter((bill) => bill.type === "bill" && !["cancelled"].includes(bill.status));
  const counts = { matched: 0, mismatch: 0, approved_exception: 0, not_checked: 0, not_applicable: 0 };
  for (const bill of bills) counts[bill.twoWayResult] = (counts[bill.twoWayResult] ?? 0) + 1;
  return { counts, issues: bills.filter((bill) => ["mismatch", "not_checked"].includes(bill.twoWayResult)).map((bill) => ({ id: bill.id, billNumber: bill.billNumber,
    result: bill.twoWayResult, openDiscrepancies: bill.openDiscrepancies, href: bill.href })) };
}

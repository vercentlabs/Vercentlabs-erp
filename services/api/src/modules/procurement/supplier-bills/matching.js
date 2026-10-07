// 2-Way Matching: a supplier bill against its confirmed purchase order. One engine, used when a draft is saved or rechecked, when it is
// posted (again, under the order's lock, whatever an earlier check said) and when results are reported. It compares:
//
//   header   the order is confirmed; the bill's supplier, buying company and currency are the order's
//   lines    each line is on the order (a product or charge the order does not include is flagged), is the order line's product, in its
//            unit (normalised through the item's conversion when invoiced in another unit), within what the order still commits
//            (ordered − cancelled − returned − POSTED bills; drafts never count), and — its net value after discounts — the agreed value:
//            the order's price and discounts, in proportion to the quantity (the final bill of a line takes the remainder). A supplier who
//            shows the agreed discount as a lower price matches; a different price or discount does not.
//   total    the total on the supplier's invoice reconciles with the bill's lines.
//
// Matching is exact: only a currency rounding difference (one minor unit per line) is accepted. A price, discount or extra-charge variance
// may be accepted as an exception by someone allowed to (never the bill's creator), with a reason and its accounting treatment; the
// exception holds only while the line stays as approved. Supplier, company, currency, order, product, unit and quantity problems are never
// overridable. A match does not mean the goods arrived, the tax is right or the bill may be paid: those are separate checks.
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { loadLineProgress } from "../purchase-orders/progress.js";
import { receiptLineEligibility } from "./sources.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const absolute = (value) => (value < 0n ? -value : value);

export const MATCH_RESULTS = Object.freeze({ matched: "Matched", mismatch: "Mismatch", approved_exception: "Approved exception", not_checked: "Not checked", not_applicable: "Not applicable" });
export const DISCREPANCY_LABELS = Object.freeze({
  SUPPLIER_MISMATCH: "Supplier differs", COMPANY_MISMATCH: "Buying company differs", CURRENCY_MISMATCH: "Currency differs", INVALID_PO: "Order not billable",
  UNMATCHED_PO_LINE: "Not on the order", PRODUCT_MISMATCH: "Product differs", UOM_MISMATCH: "Unit not convertible", QUANTITY_EXCEEDED: "Quantity exceeds the order",
  VALUE_EXCEEDED: "Value exceeds the agreed service value", PRICE_MISMATCH: "Price differs", DISCOUNT_MISMATCH: "Discount differs",
  AMOUNT_MISMATCH: "Invoice total differs", UNAUTHORIZED_CHARGE: "Charge not on the order",
  MISSING_GOODS_RECEIPT: "No goods receipt", INSUFFICIENT_RECEIVED_QUANTITY: "More than received", INSUFFICIENT_ACCEPTED_QUANTITY: "Awaiting quality acceptance",
  RECEIPT_ALREADY_ALLOCATED: "Receipt already billed", REJECTED_RETURNED_GOODS: "Rejected or returned goods", INVALID_GRN_STATUS: "Receipt not valid",
});
// The goods-receipt (3-Way) discrepancies: never accepted as an exception — a price approval cannot manufacture received goods.
export const RECEIPT_CODES = Object.freeze(["MISSING_GOODS_RECEIPT", "INSUFFICIENT_RECEIVED_QUANTITY", "INSUFFICIENT_ACCEPTED_QUANTITY", "RECEIPT_ALREADY_ALLOCATED",
  "REJECTED_RETURNED_GOODS", "INVALID_GRN_STATUS"]);
// The order's matching policy: 3-Way on accepted goods (default for stock), 3-Way on physically received goods, or 2-Way (billing before receipt).
export const MATCHING_POLICIES = Object.freeze({ three_way_accepted: "3-Way — acceptance required", three_way_received: "3-Way — physical receipt", two_way: "2-Way — PO-based billing" });
export const policyOf = (order, settings = null) => order.matching_policy
  ?? (settings?.billing_basis === "order" ? "two_way" : settings?.bill_held_goods ? "three_way_received" : "three_way_accepted");
// What may be accepted as an exception (with its accounting): commercial value differences only.
export const APPROVABLE_CODES = Object.freeze(["PRICE_MISMATCH", "DISCOUNT_MISMATCH", "UNAUTHORIZED_CHARGE"]);
const GUIDANCE = {
  SUPPLIER_MISMATCH: "Record the invoice against the order of the supplier that issued it. A supplier difference cannot be accepted as an exception.",
  COMPANY_MISMATCH: "Use the order's buying company (the invoice must be addressed to it). A company difference cannot be accepted as an exception.",
  CURRENCY_MISMATCH: "Bill in the order's currency, or have the order amended.",
  INVALID_PO: "Only a confirmed order is billed: reconfirm an amended order; a cancelled or closed order takes no new bills.",
  UNMATCHED_PO_LINE: "Remove the line, or amend the order to include the product. It cannot be accepted as an exception.",
  PRODUCT_MISMATCH: "Correct the draft line to the ordered product, or ask the supplier for a corrected invoice.",
  UOM_MISMATCH: "Enter the quantity in the order's unit, or set up the item's unit conversion.",
  QUANTITY_EXCEEDED: "Bill only what the order still commits: ask the supplier for a corrected invoice, or amend the order.",
  VALUE_EXCEEDED: "Bill only the service's remaining agreed value: ask for a corrected invoice, or amend the order.",
  PRICE_MISMATCH: "Correct the draft if mistyped, amend the order if the price was agreed, ask for a corrected invoice — or have an authorised approver accept the variance.",
  DISCOUNT_MISMATCH: "Enter the discount the invoice shows; if it differs from the agreed one, amend the order, ask for a corrected invoice or have the variance accepted.",
  AMOUNT_MISMATCH: "The supplier's invoice total does not reconcile with the lines: check quantities, prices, discounts and taxes.",
  UNAUTHORIZED_CHARGE: "Amend the order to include the charge, ask for a corrected invoice, or have an authorised approver accept it as a charge.",
  MISSING_GOODS_RECEIPT: "Wait for the goods and post their goods receipt. Billing before receipt needs the order's policy changed to 2-Way by an authorised user.",
  INSUFFICIENT_RECEIVED_QUANTITY: "Bill only what was received: ask for a corrected invoice, or wait for the rest of the goods and post their receipt.",
  INSUFFICIENT_ACCEPTED_QUANTITY: "Part of the goods is still on inspection hold: complete the quality acceptance (release), then check matching again.",
  RECEIPT_ALREADY_ALLOCATED: "Those received goods are already billed by another posted bill: ask the supplier for a corrected invoice.",
  REJECTED_RETURNED_GOODS: "Part of the goods was rejected or returned: bill only what was kept, or record a replacement receipt.",
  INVALID_GRN_STATUS: "A goods receipt this bill drew on is no longer valid (reversed): check matching again to draw on valid receipts.",
};

// The fingerprint an approved exception is bound to: the line's order line, the discrepancy, quantity, price, discount, net value and the
// order revision. Any of them changing expires the approval.
export const matchFingerprint = (line, code, revision) =>
  [line.purchaseOrderLineId ?? `charge:${line.sequence}:${line.description ?? ""}`, code, dec(line.quantity), dec(line.unitPrice), dec(line.lineDiscount), dec(line.actualNet), revision ?? ""].join("|");

// normalizeMatchingQuantities: a bill line as the engine compares it — from a calculated draft (built) or a stored bill line (row).
export function linesFromCalculated(calculated) {
  return calculated.lines.map((line, index) => ({
    sequence: index + 1, purchaseOrderLineId: line.order?.id ?? null, productId: line.input.productId ?? null, uomId: line.input.uomId ?? null,
    quantity: line.quantity, unitPrice: line.unitPrice, lineDiscount: line.lineDiscount, allocated: line.allocated, actualNet: line.taxable,
    tax: add(line.chargedTax, line.reverseChargeTax), billingBasis: line.input.billingBasis ?? "quantity", billedAmount: line.input.billedAmount ?? null,
    description: line.description ?? line.input.description, invoicedUomId: line.input.invoicedUomId ?? null, invoicedQuantity: line.input.invoicedQuantity ?? null,
    hasAllocations: (line.input.allocations ?? []).length > 0, expenseAccountId: line.input.expenseAccountId ?? null,
    allocations: (line.input.allocations ?? []).map((allocation) => ({ goodsReceiptLineId: allocation.goodsReceiptLineId, receiptNumber: allocation.receiptNumber, quantity: allocation.quantity })),
  }));
}
export function linesFromStored(rows) {
  return rows.map((row) => ({
    sequence: row.sequence, billLineId: row.id, purchaseOrderLineId: row.purchase_order_line_id, productId: row.item_id, uomId: row.uom_id,
    quantity: decimal(row.quantity), unitPrice: decimal(row.unit_price), lineDiscount: decimal(row.line_discount_amount ?? 0), allocated: decimal(row.allocated_document_discount ?? 0),
    actualNet: decimal(row.net_amount), tax: add(row.tax_amount ?? 0, row.reverse_charge_tax ?? 0), billingBasis: row.billing_basis ?? "quantity",
    billedAmount: row.billed_amount === null || row.billed_amount === undefined ? null : decimal(row.billed_amount), description: row.description,
    invoicedUomId: row.invoiced_uom_id, invoicedQuantity: row.invoiced_quantity === null ? null : decimal(row.invoiced_quantity), hasAllocations: false,
    expenseAccountId: row.expense_account_id,
  }));
}

// The agreed net value of a quantity of an order line: its taxable value in proportion, the final bill of the line taking the remainder of
// what earlier posted bills' shares left (so partial bills add up to the order exactly).
function expectedNetFor(orderLine, quantity, postedQuantities, places) {
  const ordered = decimal(orderLine.ordered_quantity);
  const taxable = decimal(orderLine.taxable_amount);
  const share = (q) => roundMoney(div(mul(taxable, q), ordered), places);
  const beforeQuantity = postedQuantities.reduce((total, q) => add(total, q), 0n);
  if (add(beforeQuantity, quantity) === ordered) return sub(taxable, postedQuantities.reduce((total, q) => add(total, share(q)), 0n));
  return share(quantity);
}

async function partyNames(client, organizationId, supplierIds) {
  const { rows } = await client.query(
    `SELECT supplier.id, party.display_name FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = ANY($2::uuid[])`, [organizationId, supplierIds.filter(Boolean)]);
  return new Map(rows.map((row) => [row.id, row.display_name]));
}

// validatePurchaseOrderForMatching / validateSupplierAndCompanyMatch: the header checks, each with what the order says and what the bill says.
async function headerChecks(client, context, order, header, lineCount) {
  const organizationId = context.organizationId;
  const names = await partyNames(client, organizationId, [order.supplier_id, header.supplierId]);
  const registrations = (await client.query(`SELECT id, name, registration_number, is_default FROM tenant.tax_registrations WHERE organization_id = $1`, [organizationId])).rows;
  const fallback = registrations.find((row) => row.is_default)?.id ?? null;
  const registration = (id) => registrations.find((row) => row.id === id);
  const orderCompany = order.buying_registration_id ?? fallback;
  const billCompany = header.buyingRegistrationId ?? fallback;
  const minor = 10n ** BigInt(6 - header.places);
  const checks = [
    { check: "purchase_order", label: "Purchase order", expected: "Confirmed", actual: order.status, passed: order.status === "confirmed", code: "INVALID_PO",
      message: `${order.purchase_order_number} is ${order.status}: only a confirmed order is billed.` },
    { check: "supplier", label: "Supplier", expected: names.get(order.supplier_id) ?? order.supplier_id, actual: names.get(header.supplierId) ?? header.supplierId,
      passed: header.supplierId === order.supplier_id, code: "SUPPLIER_MISMATCH", message: "The bill's supplier is not the order's supplier." },
    { check: "company", label: "Buying company", expected: registration(orderCompany)?.name ?? "—", actual: registration(billCompany)?.name ?? "—",
      passed: (orderCompany ?? null) === (billCompany ?? null), code: "COMPANY_MISMATCH", message: "The bill is for a different buying company than the order." },
    { check: "currency", label: "Currency", expected: order.currency_code.trim(), actual: header.currencyCode, passed: header.currencyCode === order.currency_code.trim(),
      code: "CURRENCY_MISMATCH", message: `The order is in ${order.currency_code.trim()}, the bill in ${header.currencyCode}.` },
  ];
  if (header.statedTotal !== null && header.statedTotal !== undefined) {
    const difference = sub(header.statedTotal, header.invoiceTotal);
    checks.push({ check: "invoice_total", label: "Invoice total", expected: dec(header.invoiceTotal), actual: dec(header.statedTotal), difference: dec(difference),
      passed: absolute(difference) <= minor * BigInt(Math.max(lineCount, 1)), code: "AMOUNT_MISMATCH",
      message: `The supplier's invoice total ${dec(header.statedTotal)} differs from the bill's ${dec(header.invoiceTotal)} by ${dec(difference)}.` });
  }
  return checks;
}

// evaluateTwoWayMatch: the bill (header + normalised lines) against its order. Returns the overall result, header checks, line results and
// every discrepancy found (all of them, not the first), with expected and actual values, the difference and what to do.
export async function evaluateTwoWayMatch(client, context, { order, header, lines, billId = null }) {
  const organizationId = context.organizationId;
  const settings = (await client.query(`SELECT billing_basis, bill_held_goods FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0] ?? null;
  const policy = policyOf(order, settings);
  // 3-Way: what each posted receipt line may still be billed for (posted bills' allocations aside) — and, for a stored bill, its own allocations.
  const receipts = await receiptLineEligibility(client, organizationId, order.id, billId);
  const storedAllocations = billId && lines.some((line) => line.allocations === undefined) ? (await client.query(
    `SELECT allocation.vendor_bill_line_id, allocation.goods_receipt_line_id, allocation.quantity, receipt.receipt_number FROM tenant.supplier_bill_receipt_allocations allocation
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
      WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2`, [organizationId, billId])).rows : [];
  const places = header.places;
  const minor = 10n ** BigInt(6 - places);
  const revision = Number(order.revision);
  const checks = await headerChecks(client, context, order, header, lines.length);
  const orderLines = new Map((await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, order.id])).rows
    .map((row) => [row.id, row]));
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  // The quantities earlier posted bills billed on each line (quantity basis): the base of the final bill's remainder.
  const posted = (await client.query(
    `SELECT line.purchase_order_line_id, line.quantity FROM tenant.accounting_vendor_bill_lines line
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
      WHERE line.organization_id = $1 AND bill.source_purchase_order_id = $2 AND bill.bill_type = 'bill' AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
        AND bill.id IS DISTINCT FROM $3::uuid AND line.purchase_order_line_id IS NOT NULL AND line.billing_basis = 'quantity'`, [organizationId, order.id, billId])).rows;
  const postedOf = (lineId) => posted.filter((row) => row.purchase_order_line_id === lineId).map((row) => decimal(row.quantity));
  const exceptions = billId ? (await client.query(`SELECT * FROM tenant.supplier_bill_match_exceptions WHERE organization_id = $1 AND vendor_bill_id = $2 AND status = 'approved'`,
    [organizationId, billId])).rows : [];
  const discrepancies = [];
  for (const check of checks.filter((entry) => !entry.passed))
    discrepancies.push({ code: check.code, label: DISCREPANCY_LABELS[check.code], level: "header", lineSequence: null, expected: check.expected, actual: check.actual,
      difference: check.difference ?? null, message: check.message, guidance: GUIDANCE[check.code], approvable: false, approved: false });
  let expectedAmount = 0n; let actualAmount = 0n;
  const lineResults = lines.map((line) => {
    const orderLine = line.purchaseOrderLineId ? orderLines.get(line.purchaseOrderLineId) : null;
    const state = orderLine ? progress.get(orderLine.id) : null;
    const label = `Line ${line.sequence}${orderLine ? ` (order line ${orderLine.line_number})` : ""}`;
    const found = [];
    const flag = (code, message, values = {}) => found.push({ code, message, ...values });
    let expected = 0n; let expectedTax = null; let expectedUnit = null;
    const figures = {};
    if (!orderLine) {
      if (line.productId) flag("UNMATCHED_PO_LINE", `${label}: ${line.description ?? "this product"} is not on the order.`);
      else flag("UNAUTHORIZED_CHARGE", `${label}: ${line.description ?? "a charge"} (${dec(line.actualNet)}) is not on the order.`);
    } else {
      if (line.productId && orderLine.product_id && line.productId !== orderLine.product_id) flag("PRODUCT_MISMATCH", `${label}: the billed product is not the ordered one (${orderLine.description}).`);
      const uomOk = !line.uomId || !orderLine.purchase_uom_id || line.uomId === orderLine.purchase_uom_id;
      if (!uomOk) flag("UOM_MISMATCH", `${label}: the invoice unit cannot be converted to the order's ${orderLine.uom_snapshot?.code ?? "unit"}.`);
      Object.assign(figures, { ordered: state.ordered, cancelled: state.cancelled, previouslyBilled: state.billed, remaining: state.remainingCommitment,
        agreedAmount: state.agreedAmount, previouslyBilledAmount: state.billedAmount, remainingAmount: sub(state.agreedAmount, state.billedAmount) });
      expectedTax = roundMoney(div(mul(orderLine.tax_total ?? 0, line.quantity), orderLine.ordered_quantity), places);
      // 3-Way for goods on a receipt policy (validateGoodsReceiptMatch): the bill's quantity against what posted receipts still support.
      const threeWay = state.receiptRequired && state.billingBasis === "receipt" && line.billingBasis !== "amount";
      figures.basis = threeWay ? policy : "two_way";
      if (threeWay && uomOk) {
        const available = receipts.filter((entry) => entry.purchaseOrderLineId === orderLine.id);
        const remaining = available.reduce((total, entry) => add(total, entry.remaining), 0n);
        const eligibleTotal = available.reduce((total, entry) => add(total, entry.billable), 0n);
        const allocatedOthers = available.reduce((total, entry) => add(total, entry.allocated), 0n);
        Object.assign(figures, { received: state.received, eligibleReceipt: eligibleTotal, previouslyAllocated: allocatedOthers, receiptRemaining: remaining,
          currentlyEligible: remaining < state.remainingCommitment ? remaining : state.remainingCommitment });
        const allocations = line.allocations ?? storedAllocations.filter((row) => row.vendor_bill_line_id === line.billLineId)
          .map((row) => ({ goodsReceiptLineId: row.goods_receipt_line_id, receiptNumber: row.receipt_number, quantity: decimal(row.quantity) }));
        figures.allocations = allocations;
        for (const allocation of allocations) {
          const entry = receipts.find((candidate) => candidate.goodsReceiptLineId === allocation.goodsReceiptLineId);
          if (!entry) flag("INVALID_GRN_STATUS", `${label}: goods receipt ${allocation.receiptNumber ?? ""} is no longer posted (reversed or cancelled).`.replace("  ", " "));
          else if (decimal(allocation.quantity) > entry.remaining)
            flag("RECEIPT_ALREADY_ALLOCATED", `${label}: only ${dec(entry.remaining)} of ${entry.receiptNumber} is still unbilled; ${dec(allocation.quantity)} is claimed — another posted bill already took the rest.`,
              { expected: dec(entry.remaining), actual: dec(allocation.quantity), difference: dec(sub(allocation.quantity, entry.remaining)) });
        }
        if (line.quantity > remaining && !found.some((entry) => RECEIPT_CODES.includes(entry.code))) {
          const values = { expected: dec(remaining), actual: dec(line.quantity), difference: dec(sub(line.quantity, remaining)) };
          const shortBy = `invoice quantity ${dec(line.quantity)}, ${dec(remaining)} eligible (difference ${dec(sub(line.quantity, remaining))})`;
          if (state.received <= 0n) flag("MISSING_GOODS_RECEIPT", `${label}: no goods received yet against this order line — ${shortBy}.`, values);
          else if (allocatedOthers > 0n && line.quantity <= eligibleTotal) flag("RECEIPT_ALREADY_ALLOCATED", `${label}: the received quantity is already allocated to other posted bills — ${shortBy}.`, values);
          else if (policy === "three_way_accepted" && line.quantity <= add(remaining, state.openInspection))
            flag("INSUFFICIENT_ACCEPTED_QUANTITY", `${label}: ${dec(state.openInspection)} received is still on inspection hold — ${shortBy}.`, values);
          else if (add(state.returned, state.qualityRejected) > 0n && line.quantity <= sub(state.received, allocatedOthers))
            flag("REJECTED_RETURNED_GOODS", `${label}: part of the received goods was rejected or returned — ${shortBy}.`, values);
          else flag("INSUFFICIENT_RECEIVED_QUANTITY", `${label}: more invoiced than received — ${shortBy}.`, values);
        }
      }
      if (line.billingBasis === "amount") {
        const remainingValue = sub(state.agreedAmount, state.billedAmount);
        if ((line.billedAmount ?? 0n) > remainingValue)
          flag("VALUE_EXCEEDED", `${label}: ${dec(line.billedAmount)} billed, only ${dec(remainingValue > 0n ? remainingValue : 0n)} of the agreed value is left (excess ${dec(sub(line.billedAmount, remainingValue))}).`,
            { expected: dec(remainingValue), actual: dec(line.billedAmount), difference: dec(sub(line.billedAmount, remainingValue)) });
        expected = line.actualNet;
      } else {
        if (uomOk && line.quantity > state.remainingCommitment)
          flag("QUANTITY_EXCEEDED", `${label}: invoice quantity ${dec(line.quantity)} exceeds the ${dec(state.remainingCommitment)} the order still commits (excess ${dec(sub(line.quantity, state.remainingCommitment))}).`,
            { expected: dec(state.remainingCommitment), actual: dec(line.quantity), difference: dec(sub(line.quantity, state.remainingCommitment)) });
        expected = uomOk ? expectedNetFor(orderLine, line.quantity, postedOf(orderLine.id), places) : line.actualNet;
        expectedUnit = line.quantity > 0n ? div(expected, line.quantity) : null;
        const variance = sub(line.actualNet, expected);
        if (uomOk && absolute(variance) > minor) {
          const samePrice = line.unitPrice === decimal(orderLine.unit_price);
          flag(samePrice ? "DISCOUNT_MISMATCH" : "PRICE_MISMATCH",
            `${label}: agreed ${dec(expected)} (${dec(orderLine.unit_price)} a unit${Number(orderLine.discount_value ?? 0) > 0 ? ` less ${orderLine.discount_type === "percent" ? `${dec(orderLine.discount_value)}%` : dec(orderLine.discount_value)}` : ""}), invoiced ${dec(line.actualNet)} (${dec(line.unitPrice)} a unit) — ${variance > 0n ? "over" : "under"} by ${dec(absolute(variance))}.`,
            { expected: dec(expected), actual: dec(line.actualNet), difference: dec(variance), direction: variance > 0n ? "adverse" : "favorable" });
        }
      }
    }
    if (!orderLine) expected = 0n;
    expectedAmount = add(expectedAmount, expected); actualAmount = add(actualAmount, line.actualNet);
    const codes = found.map((entry) => {
      const fingerprint = matchFingerprint(line, entry.code, revision);
      const approvable = APPROVABLE_CODES.includes(entry.code);
      const exception = approvable ? exceptions.find((row) => row.fingerprint === fingerprint) : null;
      discrepancies.push({ code: entry.code, label: DISCREPANCY_LABELS[entry.code], level: "line", lineSequence: line.sequence, purchaseOrderLineId: line.purchaseOrderLineId,
        expected: entry.expected ?? (orderLine ? dec(expected) : "0"), actual: entry.actual ?? dec(line.actualNet), difference: entry.difference ?? dec(sub(line.actualNet, expected)),
        direction: entry.direction ?? null, message: entry.message, guidance: GUIDANCE[entry.code], approvable, approved: Boolean(exception), exceptionId: exception?.id ?? null,
        approvedBy: exception?.approved_by ?? null, approvedAt: exception?.approved_at ?? null, reason: exception?.reason ?? null, fingerprint });
      return { code: entry.code, approved: Boolean(exception) };
    });
    const result = !codes.length ? "matched" : codes.every((entry) => entry.approved) ? "approved_exception" : "mismatch";
    return {
      sequence: line.sequence, billLineId: line.billLineId ?? null, purchaseOrderLineId: line.purchaseOrderLineId, orderLineNumber: orderLine?.line_number ?? null,
      description: line.description, billingBasis: line.billingBasis, product: orderLine ? orderLine.description : null,
      ordered: dec(figures.ordered ?? null), cancelled: dec(figures.cancelled ?? null), previouslyBilled: dec(figures.previouslyBilled ?? null), remaining: dec(figures.remaining ?? null),
      agreedAmount: dec(figures.agreedAmount ?? null), previouslyBilledAmount: dec(figures.previouslyBilledAmount ?? null), remainingAmount: dec(figures.remainingAmount ?? null),
      quantity: dec(line.quantity), invoicedQuantity: dec(line.invoicedQuantity), billedAmount: dec(line.billedAmount),
      expectedUnitPrice: orderLine ? dec(orderLine.unit_price) : null, expectedNetUnitPrice: dec(expectedUnit), actualUnitPrice: dec(line.unitPrice),
      expectedNet: dec(expected), actualNet: dec(line.actualNet), variance: dec(sub(line.actualNet, expected)), expectedTax: dec(expectedTax), actualTax: dec(line.tax),
      codes: codes.map((entry) => entry.code), result,
      matchingBasis: figures.basis ?? (orderLine ? "two_way" : null), received: dec(figures.received ?? null), eligibleReceipt: dec(figures.eligibleReceipt ?? null),
      previouslyAllocated: dec(figures.previouslyAllocated ?? null), receiptRemaining: dec(figures.receiptRemaining ?? null), currentlyEligible: dec(figures.currentlyEligible ?? null),
      allocations: (figures.allocations ?? []).map((allocation) => ({ goodsReceiptLineId: allocation.goodsReceiptLineId, receiptNumber: allocation.receiptNumber ?? null, quantity: dec(allocation.quantity) })),
    };
  });
  const headerFailed = discrepancies.some((entry) => entry.level === "header");
  const result = headerFailed || lineResults.some((line) => line.result === "mismatch") ? "mismatch" : lineResults.some((line) => line.result === "approved_exception") ? "approved_exception" : "matched";
  const threeWay = lineResults.some((line) => line.matchingBasis && line.matchingBasis.startsWith("three_way"));
  return {
    result, purchaseOrderId: order.id, purchaseOrderNumber: order.purchase_order_number, purchaseOrderRevision: revision, header: checks, lines: lineResults, discrepancies,
    matchingType: threeWay ? "three_way" : "two_way", policy, receiptBasis: threeWay ? (policy === "three_way_received" ? "physical_received" : "accepted") : null,
    expectedAmount: dec(expectedAmount), actualAmount: dec(actualAmount), varianceAmount: dec(sub(actualAmount, expectedAmount)),
    blocking: discrepancies.filter((entry) => !entry.approved),
  };
}

// persistPostingMatchEvidence (posted) / a draft's latest evaluation (not posted: it becomes the bill's current result, and approvals whose
// line changed expire — invalidateDraftMatchPreview).
export async function persistMatchEvaluation(client, context, billId, evaluation, { posted = false } = {}) {
  const organizationId = context.organizationId;
  const row = (await client.query(
    `INSERT INTO tenant.supplier_bill_match_evaluations (organization_id, vendor_bill_id, purchase_order_id, purchase_order_revision, result, expected_amount, actual_amount,
       variance_amount, header_checks, discrepancies, posted_evidence, evaluated_by, evaluated_at, match_scope, receipt_eligibility_basis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, clock_timestamp(), $13, $14) RETURNING id, evaluated_at`,
    [organizationId, billId, evaluation.purchaseOrderId, evaluation.purchaseOrderRevision, evaluation.result, evaluation.expectedAmount, evaluation.actualAmount,
      evaluation.varianceAmount, JSON.stringify(evaluation.header), JSON.stringify(evaluation.discrepancies), posted, context.userId ?? null,
      evaluation.matchingType ?? "two_way", evaluation.receiptBasis ?? null])).rows[0];
  for (const line of evaluation.lines)
    await client.query(
      `INSERT INTO tenant.supplier_bill_match_line_results (organization_id, evaluation_id, line_sequence, vendor_bill_line_id, purchase_order_line_id, billing_basis,
         po_ordered_quantity, po_cancelled_quantity, previously_billed_quantity, remaining_eligible_quantity, bill_quantity, agreed_amount, previously_billed_amount,
         remaining_eligible_amount, expected_unit_price, actual_unit_price, expected_net_amount, actual_net_amount, variance_amount, expected_tax_amount, actual_tax_amount,
         discrepancy_codes, result, details, matching_basis, valid_received_quantity, eligible_receipt_quantity, previously_allocated_quantity, currently_eligible_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27, $28, $29)`,
      [organizationId, row.id, line.sequence, line.billLineId, line.purchaseOrderLineId, line.billingBasis, line.ordered, line.cancelled, line.previouslyBilled, line.remaining,
        line.quantity, line.agreedAmount, line.previouslyBilledAmount, line.remainingAmount, line.expectedUnitPrice, line.actualUnitPrice, line.expectedNet, line.actualNet,
        line.variance, line.expectedTax, line.actualTax, line.codes, line.result, JSON.stringify({ description: line.description, orderLineNumber: line.orderLineNumber,
          invoicedQuantity: line.invoicedQuantity, billedAmount: line.billedAmount, expectedNetUnitPrice: line.expectedNetUnitPrice, allocations: line.allocations ?? [],
          receiptRemaining: line.receiptRemaining ?? null }), line.matchingBasis ?? null, line.received ?? null, line.eligibleReceipt ?? null, line.previouslyAllocated ?? null,
        line.currentlyEligible ?? null]);
  if (!posted) {
    await client.query(`UPDATE tenant.accounting_vendor_bills SET two_way_result = $3, two_way_checked_at = $4, two_way_evaluation_id = $5 WHERE organization_id = $1 AND id = $2`,
      [organizationId, billId, evaluation.result, row.evaluated_at, row.id]);
    const live = evaluation.discrepancies.map((entry) => entry.fingerprint).filter(Boolean);
    await client.query(`UPDATE tenant.supplier_bill_match_exceptions SET status = 'expired', expired_at = now()
       WHERE organization_id = $1 AND vendor_bill_id = $2 AND status = 'approved' AND NOT (fingerprint = ANY($3::text[]))`, [organizationId, billId, live]);
  }
  return row.id;
}

export const evaluateThreeWayMatch = (client, context, input) => evaluateTwoWayMatch(client, context, input);

// The result shown for a bill: Not applicable (direct), the stored result — or Not checked for a draft not evaluated against the order's current
// revision (amended, cancelled quantities, reconfirmed since). Needs the order as `po`.
export const TWO_WAY_SQL = `CASE WHEN bill.source_purchase_order_id IS NULL THEN 'not_applicable'
  WHEN bill.status IN ('draft', 'pending_approval', 'approved') AND (bill.two_way_result IS NULL OR (SELECT checked.purchase_order_revision FROM tenant.supplier_bill_match_evaluations checked
    WHERE checked.organization_id = bill.organization_id AND checked.id = bill.two_way_evaluation_id) IS DISTINCT FROM po.revision) THEN 'not_checked'
  ELSE COALESCE(bill.two_way_result, CASE bill.matching_status WHEN 'exception' THEN 'mismatch' WHEN 'overridden' THEN 'approved_exception' ELSE 'matched' END) END`;

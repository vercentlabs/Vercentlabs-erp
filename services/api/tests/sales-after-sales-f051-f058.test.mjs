import assert from "node:assert/strict";
import test from "node:test";

import {
  applySalesAdvancesToInvoiceRequest,
  approveSalesCommission,
  assertSalesCreditAdjustmentAllowed,
  cancelSalesAdvancePayment,
  completeSalesReturnRequest,
  decideSalesCreditAdjustment,
  decideSalesReturnRequest,
  getSalesCustomerCreditExposure,
  updateSalesDropShipStatus,
} from "../src/modules/sales/after-sales.js";
import { createInvoiceRequest, SalesError, submitSalesOrder } from "../src/modules/sales/index.js";
import { accrueSalesCommission } from "../src/modules/sales/pass1-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const otherUser = "55555555-5555-4555-8555-555555555555";
const recordId = "66666666-6666-4666-8666-666666666666";
const partyId = "77777777-7777-4777-8777-777777777777";
const versionId = "88888888-8888-4888-8888-888888888888";
const context = { organizationId: org, userId, activeCompanyId: "c1", allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] };
const rejectsWith = (code) => (error) => error instanceof SalesError && error.code === code;

// A small router: the first matching fragment answers.
function client(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      for (const [fragment, rows] of routes) if (sql.includes(fragment)) return { rows: typeof rows === "function" ? rows(sql, values) : rows };
      return { rows: [] };
    },
  };
}

test("F053: exposure = unpaid invoices net of receipts + the uninvoiced part of open orders", async () => {
  const c = client([["FROM tenant.business_parties party", [{ credit_limit: "100000", currency_code: "INR", ar_outstanding: "30000", unapplied_receipts: "5000", open_orders: "40000" }]]]);
  const exposure = await getSalesCustomerCreditExposure(c, context, partyId);
  assert.equal(exposure.netExposure, 65000);
  assert.equal(exposure.availableCredit, 35000);
  assert.match(c.calls[0].sql, /line\.quantity-progress\.invoiced_quantity-progress\.cancelled_quantity/);
});

test("F052: advances apply oldest first, never more than the invoice bills", async () => {
  const c = client([["FROM tenant.sales_advance_payments WHERE organization_id=$1 AND sales_order_id=$2 AND status='recorded'", [{ id: "a1", amount: "5000", payment_reference: "NEFT-1" }, { id: "a2", amount: "8000", payment_reference: "NEFT-2" }]]]);
  const result = await applySalesAdvancesToInvoiceRequest(c, context, orderId, recordId, 9000);
  assert.deepEqual(result.applied.map((a) => a.reference), ["NEFT-1"]);
  assert.equal(result.amountDue, 4000);
});

test("F052: an advance already deducted on an invoice cannot be refunded", async () => {
  const c = client([["FROM tenant.sales_advance_payments WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "applied", sales_order_id: orderId }]]]);
  await assert.rejects(cancelSalesAdvancePayment(c, context, recordId, { reason: "Customer changed mind", refunded: true }), rejectsWith("SALES_ADVANCE_NOT_OPEN"));
});

test("F054: the requester cannot decide their own return, and a rejection needs a reason", async () => {
  const own = client([["FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "pending", requested_by: userId, sales_order_id: orderId }]]]);
  await assert.rejects(decideSalesReturnRequest(own, context, recordId, { decision: "approved" }), rejectsWith("SALES_RETURN_SELF_DECISION"));
  await assert.rejects(decideSalesReturnRequest(own, context, recordId, { decision: "rejected", note: "" }), rejectsWith("SALES_REASON_REQUIRED"));
});

test("F054: receiving a return records the quantity and restocks base units; never more than delivered", async () => {
  const request = { id: recordId, status: "approved", sales_order_id: orderId, request_number: "RET-1", lines: [{ salesOrderLineId: lineId, quantity: "2" }] };
  const ok = client([
    ["FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2", [request]],
    ["FOR UPDATE OF progress", [{ item_id: "i1", warehouse_id: "w1", conversion_factor: "12", fulfilled_quantity: "12", returned_quantity: "0" }]],
  ]);
  const result = await completeSalesReturnRequest(ok, context, recordId, {});
  assert.deepEqual(result.restock, [{ salesOrderLineId: lineId, itemId: "i1", warehouseId: "w1", baseQuantity: 24 }]);
  const tooMany = client([
    ["FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2", [request]],
    ["FOR UPDATE OF progress", [{ item_id: "i1", warehouse_id: "w1", conversion_factor: "12", fulfilled_quantity: "1", returned_quantity: "0" }]],
  ]);
  await assert.rejects(completeSalesReturnRequest(tooMany, context, recordId, {}), /more than was delivered/);
});

test("F055: a credit note can't exceed what was invoiced less what is already credited", async () => {
  const position = (invoiced, credited) => client([["AS invoiced", [{ invoiced, paid: "0", advances: "0", credited, refunded: "0" }]]]);
  await assert.rejects(assertSalesCreditAdjustmentAllowed(position("0", "0"), context, { id: orderId }, { type: "credit_note", amount: 100 }), rejectsWith("SALES_ADJUSTMENT_NOTHING_INVOICED"));
  await assert.rejects(assertSalesCreditAdjustmentAllowed(position("12000", "11000"), context, { id: orderId }, { type: "credit_note", amount: 2000 }), rejectsWith("SALES_ADJUSTMENT_EXCEEDS_INVOICED"));
  await assertSalesCreditAdjustmentAllowed(position("12000", "0"), context, { id: orderId }, { type: "credit_note", amount: 2000 });
  await assert.rejects(assertSalesCreditAdjustmentAllowed(position("12000", "0"), context, { id: orderId }, { type: "refund", amount: 1 }), rejectsWith("SALES_ADJUSTMENT_EXCEEDS_PAID"));
});

test("F055: the requester cannot approve their own credit note", async () => {
  const c = client([["FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "pending", created_by: userId, sales_order_id: orderId, adjustment_type: "credit_note", amount: "500" }]]]);
  await assert.rejects(decideSalesCreditAdjustment(c, context, recordId, { decision: "approved" }), rejectsWith("SALES_ADJUSTMENT_SELF_DECISION"));
});

test("F056: drop-ships follow ordered → shipped → delivered; delivery counts as fulfilled without stock", async () => {
  const skip = client([["FROM tenant.sales_drop_ship_requests WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "requested", sales_order_id: orderId, sales_order_line_id: lineId, quantity: "5" }]]]);
  await assert.rejects(updateSalesDropShipStatus(skip, context, recordId, { status: "delivered" }), rejectsWith("SALES_DROP_SHIP_TRANSITION_INVALID"));
  const deliver = client([["FROM tenant.sales_drop_ship_requests WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "shipped", sales_order_id: orderId, sales_order_line_id: lineId, quantity: "5" }]]]);
  await updateSalesDropShipStatus(deliver, context, recordId, { status: "delivered" });
  const progress = deliver.calls.find((call) => call.sql.includes("fulfilled_quantity=fulfilled_quantity+$3"));
  assert.equal(progress.values[2], "5");
  assert.ok(!deliver.calls.some((call) => call.sql.includes("stock_")), "no stock touched");
});

test("F057: commission accrues only on confirmed orders, and nobody approves their own", async () => {
  const draft = client([["FROM tenant.sales_orders record", [{ id: orderId, lifecycle_status: "draft", owner_user_id: userId, company_id: "c1" }]]]);
  await assert.rejects(accrueSalesCommission(draft, context, { salesOrderId: orderId }), rejectsWith("SALES_COMMISSION_ORDER_NOT_CONFIRMED"));
  const own = client([["FROM tenant.sales_commission_entries WHERE organization_id=$1 AND id=$2", [{ id: recordId, status: "accrued", owner_user_id: userId }]]]);
  await assert.rejects(approveSalesCommission(own, context, recordId), rejectsWith("SALES_COMMISSION_SELF_APPROVAL"));
});

test("F051: a partial invoice can't bill more than remains on a line", async () => {
  const c = client([
    ["FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE", [{ id: orderId, lifecycle_status: "confirmed", current_version_id: versionId, sales_order_number: "SO-1" }]],
    ["AS sales_order_id,sales_order.created_at", [{ id: orderId, sales_order_id: orderId, current_version_id: versionId }]],
    ["SELECT invoice_quantity_basis", [{ invoice_quantity_basis: "ordered" }]],
    ["jsonb_array_elements(request.payload->'lines')", []],
    ["FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress", [{ id: lineId, quantity: "20", invoiced_quantity: "12", fulfilled_quantity: "12", cancelled_quantity: "0", unit_price: "600", line_total: "12600" }]],
  ]);
  await assert.rejects(
    createInvoiceRequest(c, context, orderId, { idempotencyKey: "partial-1", lines: [{ salesOrderLineId: lineId, quantity: 10 }] }),
    rejectsWith("SALES_INVOICE_EXCEEDS_REMAINING"),
  );
});

test("F058: terms longer than the customer's default send the order for approval", async () => {
  const c = client([
    ["FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE", [{ id: orderId, lifecycle_status: "draft", current_version_id: versionId, source_quotation_id: null, sales_order_number: "SO-1" }]],
    ["max(line.discount_percent)", [{ grand_total: "1000", subtotal: "1000", discount_total: "0", margin_percent: "30", max_line_discount: "0", line_discount_total: "0" }]],
    ["SELECT order_approval_amount", [{ order_approval_amount: "0", quotation_approval_discount: "10", minimum_margin_percent: "0" }]],
    ["AS document_days", [{ document_days: 60, customer_days: 30 }]],
  ]);
  const result = await submitSalesOrder(c, context, orderId, otherUser);
  assert.equal(result.approvalRequired, true);
  assert.deepEqual(result.triggers, ["payment_terms"]);
});

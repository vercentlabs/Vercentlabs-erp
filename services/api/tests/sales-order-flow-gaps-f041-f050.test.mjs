import assert from "node:assert/strict";
import test from "node:test";

import {
  amendSalesOrder,
  confirmSalesOrder,
  createInvoiceRequest,
  rejectSalesOrderApproval,
  SalesError,
  submitSalesOrder,
} from "../src/modules/sales/index.js";
import {
  createSalesApprovalDelegation,
  recordFulfillmentDelivery,
  recordFulfillmentShipment,
  setSalesOrderLinePromise,
} from "../src/modules/sales/order-execution.js";
import { checkSalesOrderLineAvailability } from "../src/orchestration/sales-stock-reservation.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const approver = "55555555-5555-4555-8555-555555555555";
const delegate = "66666666-6666-4666-8666-666666666666";
const userId = "77777777-7777-4777-8777-777777777777";
const requestId = "88888888-8888-4888-8888-888888888888";
const context = { organizationId: org, userId, activeCompanyId: "c1", allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] };
const rejectsWith = (code) => (error) => error instanceof SalesError && error.code === code;

// One mock for the whole order flow; `o` sets the state of each table it reads.
function client(o = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE"))
        return { rows: [{ id: orderId, organization_id: org, sales_order_number: "SO-00002", party_id: "p1", company_id: "c1", current_version_id: versionId, lifecycle_status: "draft", source_quotation_id: null, ...o.order }] };
      if (sql.includes("FROM tenant.sales_order_versions version") && sql.includes("max(line.discount_percent)"))
        return { rows: [{ grand_total: "10000", subtotal: "10000", discount_total: "2000", margin_percent: "30", max_line_discount: "20", line_discount_total: "2000", ...o.version }] };
      if (sql.includes("SELECT order_approval_amount,quotation_approval_discount,minimum_margin_percent")) return { rows: [{ order_approval_amount: "0", quotation_approval_discount: "10", minimum_margin_percent: "8" }] };
      if (sql.includes("FROM tenant.sales_approval_delegations") && sql.includes("delegate_user_id FROM")) return { rows: o.delegation ? [{ delegate_user_id: delegate }] : [] };
      if (sql.includes("SELECT display_name,status,sales_block,sales_block_reason,credit_limit"))
        return { rows: [{ display_name: "Greenfield Foods", status: "active", sales_block: "none", credit_limit: "0", ...o.customer }] };
      if (sql.includes("count(*) FROM tenant.stock_reservations")) return { rows: [{ reservations: o.reservations ?? 0, fulfilment: 0, invoicing: 0 }] };
      if (sql.includes("sum(progress.fulfilled_quantity+progress.invoiced_quantity+progress.returned_quantity)")) return { rows: [{ consumed: "0" }] };
      if (sql.includes("SELECT invoice_quantity_basis FROM tenant.sales_settings")) return { rows: [{ invoice_quantity_basis: "ordered" }] };
      if (sql.includes("FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND idempotency_key=$2")) return { rows: [] };
      if (sql.includes("jsonb_array_elements(request.payload->'lines')")) return { rows: o.openRequests ?? [] };
      if (sql.includes("FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress") && !sql.includes("conversion_factor"))
        return { rows: [{ id: lineId, item_id: "i1", quantity: "20", fulfilled_quantity: "0", invoiced_quantity: "0", cancelled_quantity: "0", unit_price: "600" }] };
      if (sql.includes("FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions") || sql.includes("SELECT sales_order.*,version.*"))
        return { rows: [{ id: orderId, current_version_id: versionId, lifecycle_status: "confirmed", sales_order_number: "SO-00002" }] };
      if (sql.includes("SELECT id,sales_order_id,status,delivered_at FROM tenant.sales_fulfillment_requests")) return { rows: [{ id: requestId, sales_order_id: orderId, status: o.requestStatus ?? "pending", delivered_at: null }] };
      if (sql.includes("SELECT id,sales_order_id,shipped_at,delivered_at FROM tenant.sales_fulfillment_requests")) return { rows: [{ id: requestId, sales_order_id: orderId, shipped_at: o.shippedAt ?? null, delivered_at: null }] };
      if (sql.includes("FROM public.organization_memberships WHERE organization_id=$1 AND status='active' AND user_id = ANY")) return { rows: [{ user_id: approver }, { user_id: delegate }] };
      // Shared approval lifecycle (core/platform/approvals).
      if (sql.includes("SELECT 1 FROM organization_memberships")) return { rows: [{ 1: 1 }] };
      if (sql.includes("INSERT INTO public.approval_requests")) return { rows: [{ id: "a1", status: "pending", version: 1 }] };
      if (sql.includes("SELECT * FROM public.approval_requests")) return { rows: o.pendingApproval ? [{ id: "a1", organization_id: org, status: "pending", version: 1 }] : [] };
      if (sql.includes("UPDATE public.approval_requests")) return { rows: [{ id: "a1", status: values[2], version: 2 }] };
      if (sql.includes("FROM tenant.sales_approval_delegations WHERE organization_id=$1 AND delegator_user_id=$2 AND status='active' AND starts_on<=$4")) return { rows: o.overlap ? [{ 1: 1 }] : [] };
      // Availability orchestration
      if (sql.includes("SELECT line.id,line.item_id,line.warehouse_id,line.quantity,line.conversion_factor"))
        return { rows: [{ id: lineId, item_id: "i1", warehouse_id: "w1", quantity: "20", conversion_factor: "12", uom_snapshot: "CTN", item_name_snapshot: "Toned milk", reserved_quantity: "0", fulfilled_quantity: "0", cancelled_quantity: "0", confirmed_quantity: "20" }] };
      if (sql.includes("FROM tenant.sales_orders record")) return { rows: [{ id: orderId, company_id: "c1", lifecycle_status: "confirmed", current_version_id: versionId }] };
      if (sql.includes("FROM tenant.stock_balances")) return { rows: [{ item_id: "i1", warehouse_id: "w1", on_hand_quantity: "100", reserved_quantity: "0", available_quantity: "100", available_to_promise: "100" }] };
      if (sql.includes("FROM tenant.quality_holds")) return { rows: [{ scope_blocked: false, held_quantity: "0" }] };
      if (sql.includes("FROM tenant.procurement_purchase_order_lines pol")) return { rows: [{ purchase_order_number: "PO-00031", expected_date: "2026-10-05", open_quantity: "200" }] };
      if (sql.includes("FROM tenant.procurement_supplier_lead_times")) return { rows: [{ days: 7 }] };
      return { rows: [] };
    },
  };
}

test("F041: a direct order with a 20% discount needs approval even under the amount threshold", async () => {
  const c = client();
  const result = await submitSalesOrder(c, context, orderId);
  assert.equal(result.approvalRequired, true);
  assert.deepEqual(result.triggers, ["discount"]);
});

test("F041: an order converted from a quotation is not re-gated on discount (the quotation already was)", async () => {
  const result = await submitSalesOrder(client({ order: { source_quotation_id: "q1" } }), context, orderId);
  assert.equal(result.approvalRequired, false);
});

test("F041: an approver away on delegation has the request routed to their delegate", async () => {
  const c = client({ delegation: true });
  await submitSalesOrder(c, context, orderId, approver);
  const insert = c.calls.find((call) => call.sql.includes("INSERT INTO public.approval_requests"));
  assert.equal(insert.values[6], delegate, "assigned_to");
  const submitted = c.calls.find((call) => call.sql.includes("INSERT INTO tenant.sales_document_events") && call.values.includes("sales_order.submitted"));
  assert.equal(JSON.parse(submitted.values[6]).delegatedFrom, approver);
});

test("F041: a rejection records its reason on the inbox request and the order trail", async () => {
  const c = client({ order: { lifecycle_status: "pending_approval" }, pendingApproval: true });
  await rejectSalesOrderApproval(c, context, orderId, "Discount above policy for this customer");
  const close = c.calls.find((call) => call.sql.includes("UPDATE public.approval_requests"));
  assert.equal(close.values[2], "rejected");
  assert.equal(close.values[4], "Discount above policy for this customer", "decision_note");
});

test("F041: overlapping delegations for one approver are refused", async () => {
  await assert.rejects(
    createSalesApprovalDelegation(client({ overlap: true }), context, { delegatorUserId: approver, delegateUserId: delegate, startsOn: "2099-01-01", endsOn: "2099-01-10", reason: "On leave" }),
    rejectsWith("SALES_DELEGATION_OVERLAP"),
  );
});

test("F043: confirming an already-confirmed order replays instead of failing", async () => {
  const result = await confirmSalesOrder(client({ order: { lifecycle_status: "confirmed", confirmed_at: new Date(), credit_status: "passed" } }), context, orderId);
  assert.equal(result.replayed, true);
});

test("F043: a customer blocked after the order was keyed stops confirmation", async () => {
  await assert.rejects(
    confirmSalesOrder(client({ order: { lifecycle_status: "approved" }, customer: { sales_block: "orders", sales_block_reason: "Overdue invoices" } }), context, orderId),
    rejectsWith("SALES_CUSTOMER_BLOCKED"),
  );
});

test("F044: an order with reserved stock cannot be amended until it is released", async () => {
  await assert.rejects(
    amendSalesOrder(client({ order: { lifecycle_status: "confirmed" }, reservations: 1 }), context, orderId, { amendmentReason: "Customer wants 25 cartons" }),
    rejectsWith("SALES_AMENDMENT_RESERVED"),
  );
});

test("F045: availability converts cartons to base units and explains the promise", async () => {
  const stock = { organizationId: org, companyId: "c1", userId, permissions: ["stock.view"], roleSlugs: [] };
  const result = await checkSalesOrderLineAvailability(client(), context, stock, { salesOrderId: orderId, salesOrderLineId: lineId });
  assert.equal(result.requestedBaseQuantity, 240);
  assert.equal(result.availability.canPromise, false);
  assert.equal(result.promise.basis, "incoming_supply");
  assert.equal(result.promise.promisedDate, "2026-10-05");
});

test("F050: quantity already in an open invoice request is not invoiced again", async () => {
  const c = client({ order: { lifecycle_status: "confirmed" }, openRequests: [{ line_id: lineId, quantity: "20" }] });
  await assert.rejects(createInvoiceRequest(c, context, orderId, { idempotencyKey: "second-click" }), /No quantity remains to invoice/);
});

test("F048: a promise date needs a reason and cannot be in the past", async () => {
  await assert.rejects(setSalesOrderLinePromise(client(), context, { salesOrderLineId: lineId, promisedDate: "2020-01-01", note: "PO due" }), rejectsWith("SALES_PROMISE_DATE_PAST"));
  await assert.rejects(setSalesOrderLinePromise(client(), context, { salesOrderLineId: lineId, promisedDate: "2099-01-01", note: "" }), rejectsWith("SALES_PROMISE_NOTE_REQUIRED"));
});

test("F049: shipment only after the warehouse completes, delivery only after shipment", async () => {
  await assert.rejects(recordFulfillmentShipment(client({ requestStatus: "pending" }), context, requestId, { carrier: "Blue Dart" }), rejectsWith("SALES_SHIPMENT_NOT_PICKED"));
  await assert.rejects(recordFulfillmentDelivery(client(), context, requestId, { receivedBy: "Meera Kulkarni" }), rejectsWith("SALES_DELIVERY_NOT_SHIPPED"));
});

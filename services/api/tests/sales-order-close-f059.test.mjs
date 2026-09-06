import assert from "node:assert/strict";
import test from "node:test";

import { closeSalesOrder } from "../src/modules/sales/order-governance.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";

const manager = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.order.confirm"],
  roleSlugs: [],
};

function baseOrderRow(overrides = {}) {
  return {
    id: orderId,
    company_id: "company-1",
    sales_order_number: "SO-0001",
    party_id: "party-1",
    current_version_id: versionId,
    lifecycle_status: "confirmed",
    approval_status: "approved",
    credit_status: "passed",
    fulfillment_status: "fulfilled",
    billing_status: "fully_invoiced",
    payment_status: "not_due",
    requested_delivery_date: null,
    confirmed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    order_updated_at: "2026-01-01T00:00:00Z",
    version_number: 1,
    grand_total: "1000",
    base_currency_total: "1000",
    margin_percent: "20",
    customer_status: "active",
    line_count: 1,
    missing_warehouse_count: 0,
    confirmed_quantity: 10,
    reserved_quantity: 10,
    fulfilled_quantity: 10,
    remaining_to_fulfill: 0,
    remaining_to_invoice: 0,
    active_hold_count: 0,
    pending_fulfillment_requests: 0,
    failed_fulfillment_requests: 0,
    pending_invoice_requests: 0,
    failed_invoice_requests: 0,
    pending_return_requests: 0,
    ...overrides,
  };
}

function closeClient({ orderRow, updateSucceeds = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders sales_order") && sql.includes("JOIN tenant.sales_order_versions version"))
        return { rows: orderRow ? [orderRow] : [] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("SET lifecycle_status='closed'"))
        return { rows: updateSucceeds ? [{ id: orderId }] : [] };
      if (sql.includes("INSERT INTO tenant.sales_document_events"))
        return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F059: a fully fulfilled and invoiced order with no holds/returns closes successfully", async () => {
  const client = closeClient({ orderRow: baseOrderRow() });
  const result = await closeSalesOrder(client, manager, orderId);
  assert.equal(result.status, "closed");
  const update = client.calls.find((c) => c.sql.startsWith("UPDATE tenant.sales_orders"));
  assert.ok(update, "expected the close UPDATE to run");
  const insert = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.sales_document_events"));
  assert.ok(insert, "expected a sales_order.closed audit event");
});

test("F059: an order with remaining fulfilment cannot be closed", async () => {
  const client = closeClient({ orderRow: baseOrderRow({ remaining_to_fulfill: 5, fulfillment_status: "partially_fulfilled" }) });
  await assert.rejects(
    closeSalesOrder(client, manager, orderId),
    (error) => error.status === 409 && error.code === "SALES_ORDER_NOT_READY_TO_CLOSE",
  );
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.sales_orders")), false);
});

test("F059: an order with an active hold cannot be closed", async () => {
  const client = closeClient({ orderRow: baseOrderRow({ active_hold_count: 1 }) });
  await assert.rejects(
    closeSalesOrder(client, manager, orderId),
    (error) => error.status === 409 && error.code === "SALES_ORDER_NOT_READY_TO_CLOSE",
  );
});

test("F059: an order with a pending return request cannot be closed", async () => {
  const client = closeClient({ orderRow: baseOrderRow({ pending_return_requests: 1 }) });
  await assert.rejects(
    closeSalesOrder(client, manager, orderId),
    (error) => error.status === 409 && error.code === "SALES_ORDER_NOT_READY_TO_CLOSE",
  );
});

test("F059: a concurrent change during close throws a version-conflict error", async () => {
  const client = closeClient({ orderRow: baseOrderRow(), updateSucceeds: false });
  await assert.rejects(
    closeSalesOrder(client, manager, orderId),
    (error) => error.status === 409 && error.code === "SALES_ORDER_VERSION_CONFLICT",
  );
});

test("F059: closing requires sales.order.confirm permission", async () => {
  const restricted = { ...manager, permissions: ["sales.view"] };
  const client = closeClient({ orderRow: baseOrderRow() });
  await assert.rejects(
    closeSalesOrder(client, restricted, orderId),
    (error) => error.status === 403,
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesOrderGovernanceSummary,
  bulkUpdateSalesOrders,
  createSalesReturnRequest,
  evaluateSalesOrderHealth,
} from "../src/sales/order-governance.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.order.create", "sales.order.amend"],
  roleSlugs: [],
};

test("sales-order health blocks incomplete commercial and fulfilment data", () => {
  const health = evaluateSalesOrderHealth(
    {
      lifecycle_status: "confirmed",
      approval_status: "approved",
      credit_status: "blocked",
      fulfillment_status: "not_started",
      billing_status: "ready",
      customer_status: "inactive",
      line_count: 0,
      grand_total: 0,
      customer_snapshot: {},
      payment_term_snapshot: {},
      shipping_address_snapshot: {},
      missing_warehouse_count: 1,
      confirmed_quantity: 10,
      reserved_quantity: 0,
      fulfilled_quantity: 0,
      remaining_to_fulfill: 10,
      remaining_to_invoice: 10,
      active_hold_count: 1,
      requested_delivery_date: "2025-01-01",
      confirmed_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    },
    {},
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.length >= 7);
  assert.equal(health.readyToFulfill, false);
  assert.equal(health.readyToInvoice, false);
});

test("sales-order summary exposes fulfilment and invoicing queues", () => {
  const summary = buildSalesOrderGovernanceSummary(
    [
      {
        lifecycle_status: "confirmed",
        approval_status: "approved",
        credit_status: "passed",
        fulfillment_status: "allocated",
        billing_status: "ready",
        customer_status: "active",
        line_count: 1,
        grand_total: 1000,
        base_currency_total: 1000,
        customer_snapshot: { displayName: "Acme" },
        payment_term_snapshot: { code: "NET-30" },
        shipping_address_snapshot: { city: "Pune" },
        missing_warehouse_count: 0,
        confirmed_quantity: 10,
        reserved_quantity: 10,
        fulfilled_quantity: 0,
        remaining_to_fulfill: 10,
        remaining_to_invoice: 10,
        active_hold_count: 0,
        requested_delivery_date: "2026-03-01",
        confirmed_at: "2026-02-14T00:00:00Z",
        updated_at: "2026-02-14T00:00:00Z",
      },
    ],
    {},
    new Date("2026-02-15T00:00:00Z"),
  );
  assert.equal(summary.active, 1);
  assert.equal(summary.activeValue, 1000);
  assert.equal(summary.readyToFulfill, 1);
  assert.equal(summary.readyToInvoice, 1);
});

test("sales-order bulk update rejects an empty selection before mutation", async () => {
  await assert.rejects(
    () =>
      bulkUpdateSalesOrders({ query: async () => ({ rows: [] }) }, context, {
        ids: [],
        changes: { requestedDeliveryDate: "2026-12-31" },
      }),
    /Select between 1 and 200 sales orders/,
  );
});

test("sales return request rejects missing idempotency before database mutation", async () => {
  const queries = [];
  await assert.rejects(
    () =>
      createSalesReturnRequest(
        {
          query: async (sql) => {
            queries.push(sql);
            return {
              rows: [
                {
                  id: "00000000-0000-4000-8000-000000000003",
                  company_id: "00000000-0000-4000-8000-000000000004",
                  sales_order_number: "SO-1",
                  party_id: "00000000-0000-4000-8000-000000000005",
                  current_version_id: "00000000-0000-4000-8000-000000000006",
                  lifecycle_status: "confirmed",
                  approval_status: "approved",
                  credit_status: "passed",
                  fulfillment_status: "fulfilled",
                  billing_status: "ready",
                  customer_status: "active",
                  line_count: 1,
                  grand_total: 10,
                  customer_snapshot: { displayName: "Acme" },
                  payment_term_snapshot: { code: "NET-30" },
                  shipping_address_snapshot: { city: "Pune" },
                },
              ],
            };
          },
        },
        context,
        "00000000-0000-4000-8000-000000000003",
        { idempotencyKey: "", reason: "Damaged", lines: [{}] },
      ),
    /idempotency key/,
  );
  assert.equal(queries.length, 1);
});

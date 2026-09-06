import assert from "node:assert/strict";
import test from "node:test";

import { cancelSalesOrderWithCrmSync } from "../src/orchestration/sales-crm-opportunity-sync.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const partyId = "44444444-4444-4444-8444-444444444444";
const companyId = "company-1";
const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const itemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const warehouseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const salesContext = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.order.cancel"],
  roleSlugs: [],
};

function orderRow(overrides = {}) {
  return {
    id: orderId,
    organization_id: org,
    company_id: companyId,
    party_id: partyId,
    current_version_id: versionId,
    lifecycle_status: "confirmed",
    source_opportunity_id: null,
    ...overrides,
  };
}

function reservationRow(overrides = {}) {
  return {
    id: reservationId,
    organization_id: org,
    company_id: companyId,
    item_id: itemId,
    warehouse_id: warehouseId,
    warehouse_location_id: null,
    batch_id: null,
    quantity: "5",
    reference_type: "sales_order",
    reference_id: orderId,
    status: "active",
    ...overrides,
  };
}

function client({ order = orderRow(), reservations = [reservationRow()] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders") && sql.includes("FOR UPDATE"))
        return { rows: [order] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("lifecycle_status='cancelled'"))
        return { rows: [] };
      if (sql.includes("FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress"))
        return { rows: [{ fulfilled: "0", invoiced: "0" }] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      if (sql.includes("reference_type=$3 AND reference_id=$4 AND status='active'"))
        return { rows: reservations };
      if (sql.includes("FROM tenant.stock_reservations") && sql.includes("FOR UPDATE"))
        return { rows: reservations.filter((r) => r.id === values[2]) };
      if (sql.includes("FROM tenant.stock_balances") && sql.includes("FOR UPDATE"))
        return { rows: [{ reserved_quantity: "5" }] };
      if (sql.startsWith("UPDATE tenant.stock_balances")) return { rows: [] };
      if (sql.startsWith("UPDATE tenant.stock_reservations"))
        return { rows: [{ ...reservations[0], status: values[3] }] };
      return { rows: [] };
    },
  };
}

test("F046: cancelling a Sales order releases its active stock reservation(s)", async () => {
  const c = client();
  const result = await cancelSalesOrderWithCrmSync(c, salesContext, orderId, "Customer withdrew.");
  assert.equal(result.status, "cancelled");
  const lookup = c.calls.find((call) =>
    call.sql.includes("reference_type=$3 AND reference_id=$4 AND status='active'"),
  );
  assert.ok(lookup, "expected the reservation lookup by reference to run");
  assert.deepEqual(lookup.values, [org, companyId, "sales_order", orderId]);
  const release = c.calls.find((call) => call.sql.startsWith("UPDATE tenant.stock_reservations"));
  assert.ok(release, "expected the reservation to be released");
  assert.equal(release.values[3], "cancelled");
  const balanceDecrement = c.calls.find((call) => call.sql.startsWith("UPDATE tenant.stock_balances"));
  assert.ok(balanceDecrement, "expected reserved_quantity to be decremented");
});

test("F046: cancelling an order with no active stock reservation does not fail", async () => {
  const c = client({ reservations: [] });
  const result = await cancelSalesOrderWithCrmSync(c, salesContext, orderId, "Customer withdrew.");
  assert.equal(result.status, "cancelled");
  assert.equal(
    c.calls.some((call) => call.sql.startsWith("UPDATE tenant.stock_reservations")),
    false,
  );
});

test("F046: a Stock-side failure releasing the reservation does not block cancellation (best-effort)", async () => {
  const c = client();
  const originalQuery = c.query.bind(c);
  c.query = async (sql, values) => {
    if (sql.includes("FROM tenant.stock_balances") && sql.includes("FOR UPDATE"))
      throw new Error("stock unavailable");
    return originalQuery(sql, values);
  };
  const result = await cancelSalesOrderWithCrmSync(c, salesContext, orderId, "Customer withdrew.");
  assert.equal(result.status, "cancelled");
});

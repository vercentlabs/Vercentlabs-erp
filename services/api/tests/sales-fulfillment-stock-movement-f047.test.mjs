import assert from "node:assert/strict";
import test from "node:test";

import { completeFulfillmentRequestWithStockMovement } from "../src/orchestration/sales-stock-fulfillment.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const itemId = "66666666-6666-4666-8666-666666666666";
const warehouseId = "77777777-7777-4777-8777-777777777777";
const companyId = "company-1";

const salesContext = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.fulfillment.request", "sales.margin.view"],
  roleSlugs: [],
};

function stockContext(overrides = {}) {
  return {
    organizationId: org,
    companyId,
    userId: "user-1",
    permissions: ["stock.view", "stock.issue"],
    roleSlugs: [],
    ...overrides,
  };
}

function client({
  fulfilledSoFar = "0",
  confirmedQuantity = "10",
  warehouse = warehouseId,
} = {}) {
  const calls = [];
  let fulfilled = fulfilledSoFar;
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_order_lines line") && sql.includes("sales_order.company_id"))
        return { rows: [{ id: lineId, item_id: itemId, warehouse_id: warehouse, company_id: companyId }] };
      if (sql.includes("FROM tenant.sales_fulfillment_requests request") && sql.includes("FOR UPDATE"))
        return {
          rows: [
            {
              id: requestId,
              organization_id: org,
              sales_order_id: orderId,
              sales_order_version_id: versionId,
              status: "pending",
              lifecycle_status: "confirmed",
              fulfillment_status: "not_started",
            },
          ],
        };
      if (sql.includes("FROM tenant.sales_order_line_progress progress") && sql.includes("FOR UPDATE"))
        return {
          rows: [
            {
              sales_order_line_id: lineId,
              fulfilled_quantity: fulfilled,
              confirmed_quantity: confirmedQuantity,
              cancelled_quantity: "0",
              returned_quantity: "0",
              quantity: confirmedQuantity,
              sales_order_version_id: versionId,
            },
          ],
        };
      if (sql.startsWith("UPDATE tenant.sales_order_line_progress")) {
        fulfilled = values[2];
        return { rows: [] };
      }
      if (sql.includes("bool_and(progress.fulfilled_quantity"))
        return { rows: [{ complete: fulfilled === confirmedQuantity, any_fulfilled: Number(fulfilled) > 0 }] };
      if (sql.startsWith("UPDATE tenant.sales_fulfillment_requests")) return { rows: [] };
      if (sql.startsWith("UPDATE tenant.sales_orders")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version"))
        return { rows: [{ id: orderId, company_id: companyId, sales_order_id: orderId, current_version_id: versionId }] };
      if (sql.includes("FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress"))
        return { rows: [] };
      if (sql.startsWith("SELECT * FROM tenant.sales_order_holds")) return { rows: [] };
      if (sql.startsWith("SELECT id,request_number,status,retry_count") && sql.includes("sales_fulfillment_requests"))
        return { rows: [] };
      if (sql.startsWith("SELECT id,request_number,quantity_basis")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM tenant.sales_document_events")) return { rows: [] };
      if (sql.includes("AS q FROM tenant.stock_balances"))
        return { rows: [{ q: sql.includes("sum(quantity-reserved_quantity)") ? "0" : "100" }] };
      if (sql.includes("FROM tenant.stock_balances") && sql.includes("FOR UPDATE"))
        return { rows: [{ quantity: "100", reserved_quantity: "0", average_cost: "10" }] };
      if (sql.startsWith("SELECT id,company_id,track_inventory") && sql.includes("FROM tenant.items"))
        return { rows: [{ id: itemId, company_id: companyId, track_inventory: true, allow_negative_stock: false, standard_cost: "10" }] };
      if (sql.startsWith("SELECT id,company_id,allow_negative_stock") && sql.includes("FROM tenant.warehouses"))
        return { rows: [{ id: warehouseId, company_id: companyId, allow_negative_stock: false }] };
      if (sql.includes("INSERT INTO tenant.operation_idempotency")) return { rows: [{ id: "idem-1" }] };
      if (sql.startsWith("UPDATE tenant.operation_idempotency")) return { rows: [{ id: "idem-1" }] };
      if (sql.includes("INSERT INTO tenant.document_sequences"))
        return { rows: [{ allocated_value: "1", prefix: "STK", padding: 6 }] };
      if (sql.includes("INSERT INTO tenant.stock_movements"))
        return { rows: [{ id: "movement-1", ...Object.fromEntries(["organization_id","company_id","movement_number","movement_type","item_id","warehouse_id","warehouse_location_id","batch_id","serial_id","quantity","unit_cost","reference_type","reference_id","reason","created_by","idempotency_key"].map((key, index) => [key, values[index]]))}] };
      if (sql.includes("INSERT INTO tenant.stock_valuation_layers")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F047: completing a fulfilment posts a real Stock issue movement for each stock-tracked line", async () => {
  const c = client();
  await completeFulfillmentRequestWithStockMovement(
    c,
    salesContext,
    stockContext(),
    requestId,
    { lines: [{ salesOrderLineId: lineId, fulfilledQuantity: 4 }] },
  );
  const insertMovement = c.calls.find((call) => call.sql.includes("INSERT INTO tenant.stock_movements"));
  assert.ok(insertMovement, "expected a real stock movement to be posted");
  assert.equal(insertMovement.values[3], "issue");
  assert.equal(insertMovement.values[4], itemId);
  assert.equal(insertMovement.values[5], warehouseId);
  assert.equal(insertMovement.values[9], -4);
  assert.equal(insertMovement.values[11], "sales_fulfillment_request");
  assert.equal(insertMovement.values[12], requestId);
});

test("F047: a line with no warehouse (not stock-tracked) posts no movement", async () => {
  const c = client({ warehouse: null });
  await completeFulfillmentRequestWithStockMovement(
    c,
    salesContext,
    stockContext(),
    requestId,
    { lines: [{ salesOrderLineId: lineId, fulfilledQuantity: 4 }] },
  );
  assert.equal(
    c.calls.some((call) => call.sql.includes("INSERT INTO tenant.stock_movements")),
    false,
  );
});

test("F047: insufficient physical stock blocks the whole fulfilment completion (not best-effort)", async () => {
  const c = client();
  const original = c.query.bind(c);
  c.query = async (sql, values) => {
    if (sql.includes("FROM tenant.stock_balances") && sql.includes("FOR UPDATE"))
      return { rows: [{ quantity: "2", reserved_quantity: "0", average_cost: "10" }] };
    return original(sql, values);
  };
  await assert.rejects(
    () =>
      completeFulfillmentRequestWithStockMovement(
        c,
        salesContext,
        stockContext(),
        requestId,
        { lines: [{ salesOrderLineId: lineId, fulfilledQuantity: 4 }] },
      ),
    (error) => {
      assert.equal(error.code, "INSUFFICIENT_STOCK");
      return true;
    },
  );
});

test("F047: a Sales/Stock active-company mismatch is rejected before any state changes", async () => {
  const c = client();
  await assert.rejects(
    () =>
      completeFulfillmentRequestWithStockMovement(
        c,
        salesContext,
        stockContext({ companyId: "company-2" }),
        requestId,
        { lines: [{ salesOrderLineId: lineId, fulfilledQuantity: 4 }] },
      ),
    (error) => {
      assert.equal(error.code, "SALES_STOCK_COMPANY_MISMATCH");
      return true;
    },
  );
  assert.equal(
    c.calls.some((call) => call.sql.startsWith("UPDATE tenant.sales_order_line_progress")),
    false,
    "no line progress should be updated when the company context mismatches",
  );
});

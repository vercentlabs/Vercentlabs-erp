import assert from "node:assert/strict";
import test from "node:test";

import { createSalesCommissionRule } from "../src/modules/sales/pass1-operations.js";
import { createSalesDropShipWithSupplierValidation } from "../src/orchestration/sales-pass1-options.js";
import { upsertSupplierLeadTime } from "../src/modules/procurement/pass1-operations.js";
import { reserveStock } from "../src/modules/stock/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const owner = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const versionId = "66666666-6666-4666-8666-666666666666";
const lineId = "77777777-7777-4777-8777-777777777777";
const supplierId = "88888888-8888-4888-8888-888888888888";
const itemId = "99999999-9999-4999-8999-999999999999";
const warehouseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function salesContext(permissions = []) {
  return { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: [], permissions };
}
function procurementContext(permissions = []) {
  return { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: [], permissions };
}
function stockContext(permissions = []) {
  return { organizationId: org, companyId: company, userId: user, roleSlugs: [], permissions };
}

test("Pass1 Sales commission owner is an active organisation member before persistence", async () => {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push(sql);
    if (/organization_memberships/.test(sql)) return { rows: [{ id: owner, full_name: "Seller" }] };
    if (/INSERT INTO tenant\.sales_commission_rules/.test(sql)) return { rows: [{ id: "rule-1", owner_user_id: params[3], rate_percent: params[4] }] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const row = await createSalesCommissionRule(client, salesContext(["sales.settings.manage"]), {
    name: "Default commission", ownerUserId: owner, ratePercent: 5, basis: "net_sales",
  });
  assert.equal(row.owner_user_id, owner);
  assert.ok(queries.some((sql) => /organization_memberships/.test(sql)));
});

test("Pass1 drop-ship validates supplier through Procurement public contract before Sales insert", async () => {
  const orderRow = { id: orderId, company_id: company, lifecycle_status: "confirmed", current_version_id: versionId, currency_code: "INR", grand_total: "1000", margin_amount: "100", subtotal: "900" };
  const client = { async query(sql, params) {
    if (/FROM tenant\.procurement_suppliers/.test(sql)) return { rows: [{ id: supplierId, company_id: company, status: "active", data: { displayName: "Supplier A" } }] };
    if (/FROM tenant\.procurement_supplier_(?:sites|qualifications|certifications|scorecards)/.test(sql)) return { rows: [] };
    if (/FROM tenant\.sales_orders record/.test(sql)) return { rows: [orderRow] };
    if (/FROM tenant\.sales_order_lines line/.test(sql)) return { rows: [{ id: lineId, quantity: "5" }] };
    if (/INSERT INTO tenant\.sales_drop_ship_requests/.test(sql)) return { rows: [{ id: "drop-1", supplier_id: params[4], sales_order_id: params[2] }] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const result = await createSalesDropShipWithSupplierValidation(
    client,
    salesContext(["sales.fulfillment.request"]),
    procurementContext(["procurement.suppliers.view"]),
    { salesOrderId: orderId, salesOrderLineId: lineId, supplierId, quantity: 2 },
  );
  assert.equal(result.supplier_id, supplierId);
  assert.equal(result.sales_order_id, orderId);
});

test("Pass1 supplier lead time validates item scope and persists an effective catalogue row", async () => {
  const client = { async query(sql, params) {
    if (/FROM tenant\.procurement_suppliers record/.test(sql)) return { rows: [{ id: supplierId, company_id: company, status: "active" }] };
    if (/FROM tenant\.items WHERE/.test(sql)) return { rows: [{ id: itemId, company_id: company, uom_id: null }] };
    if (/SELECT id FROM tenant\.procurement_supplier_lead_times/.test(sql)) return { rows: [] };
    if (/INSERT INTO tenant\.procurement_supplier_lead_times/.test(sql)) return { rows: [{ id: "lead-1", supplier_id: params[2], item_id: params[3], lead_time_days: params[4] }] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const row = await upsertSupplierLeadTime(client, procurementContext(["procurement.suppliers.manage"]), {
    supplierId, itemId, leadTimeDays: 7, effectiveFrom: "2026-08-30", effectiveTo: "2026-09-30",
  });
  assert.equal(row.item_id, itemId);
  assert.equal(row.lead_time_days, 7);
});

test("Pass1 stock reservation validates the inventory dimension and updates reserved balance once", async () => {
  let balanceUpdates = 0;
  const wave0 = createWave0PrimitiveHarness();
  const client = { async query(sql, params) {
    const wave0Result = wave0.handle(sql, params);
    if (wave0Result) return wave0Result;
    if (/SELECT id,company_id,track_inventory/.test(sql)) return { rows: [{ id: itemId, company_id: company, track_inventory: true, allow_negative_stock: false, standard_cost: "10" }] };
    if (/SELECT id,company_id,allow_negative_stock FROM tenant\.warehouses/.test(sql)) return { rows: [{ id: warehouseId, company_id: company, allow_negative_stock: false }] };
    if (/FROM tenant\.stock_balances[\s\S]*quantity-reserved_quantity >=/.test(sql)) return { rows: [{ warehouse_location_id: null, batch_id: null, quantity: "10", reserved_quantity: "0" }] };
    if (/INSERT INTO tenant\.stock_reservations/.test(sql)) return { rows: [{ id: "reservation-1", item_id: itemId, warehouse_id: warehouseId, quantity: "2", status: "active" }] };
    if (/UPDATE tenant\.stock_balances SET reserved_quantity=reserved_quantity\+/.test(sql)) { balanceUpdates += 1; return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const row = await reserveStock(client, stockContext(["stock.reserve"]), {
    itemId, warehouseId, quantity: 2, referenceType: "sales_order", referenceId: orderId,
  });
  assert.equal(row.status, "active");
  assert.equal(balanceUpdates, 1);
});

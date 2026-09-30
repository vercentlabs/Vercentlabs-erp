import assert from "node:assert/strict";
import test from "node:test";

import { reserveStock } from "../src/modules/stock/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const orderId = "55555555-5555-4555-8555-555555555555";
const supplierId = "88888888-8888-4888-8888-888888888888";
const itemId = "99999999-9999-4999-8999-999999999999";
const warehouseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function procurementContext(permissions = []) {
  return { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: [], permissions };
}
function stockContext(permissions = []) {
  return { organizationId: org, companyId: company, userId: user, roleSlugs: [], permissions };
}

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

import assert from "node:assert/strict";
import test from "node:test";

import { completePointOfSale } from "../src/modules/point-of-sale/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

// POS Implementation Tracker (docs/03-modules/point-of-sale/
// POS_IMPLEMENTATION_TRACKER.md), Tranche 1 (F276): pos_sales.customer_id
// previously had no FK and no domain-level validation at all — any UUID
// (or none) was accepted, alongside an always-trusted free-text
// customer_name. This suite covers the fix: customerId must resolve to an
// active customer/both business_parties record, shared or company-scoped.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const shiftId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "66666666-6666-4666-8666-666666666666";
const saleId = "77777777-7777-4777-8777-777777777777";
const activeCustomerId = "88888888-8888-4888-8888-888888888888";
const archivedCustomerId = "99999999-9999-4999-8999-999999999999";
const unknownCustomerId = "00000000-0000-4000-8000-000000000000";

function baseContext(permissions = ["pos.sale.create"]) {
  return { organizationId: org, companyId: company, userId: user, roleSlugs: [], permissions };
}

function shiftRow() {
  return {
    id: shiftId,
    organization_id: org,
    company_id: company,
    status: "open",
    store_id: "store-1",
    terminal_id: "terminal-1",
    warehouse_id: warehouseId,
    currency_code: "INR",
    receipt_prefix: "POS",
    price_list_id: "price-list-1",
  };
}

function saleInput(overrides = {}) {
  return {
    shiftId,
    idempotencyKey: "sale-1",
    lines: [{ itemId, quantity: 1, unitPrice: 100 }],
    payments: [{ method: "cash", amount: 100 }],
    ...overrides,
  };
}

function client() {
  const wave0 = createWave0PrimitiveHarness();
  return {
    async query(sql, params) {
      const wave0Result = wave0.handle(sql, params);
      if (wave0Result) return wave0Result;
      if (/FROM tenant\.pos_shifts shift[\s\S]*FOR UPDATE/.test(sql)) return { rows: [shiftRow()] };
      if (/FROM tenant\.pos_store_access/.test(sql)) return { rows: [] };
      if (/SELECT allow_negative_stock,allow_price_override\s+FROM tenant\.pos_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, allow_price_override: false }] };
      if (/SELECT price_item\.rate/.test(sql)) return { rows: [{ rate: "100" }] };
      if (/SELECT coalesce\(sum\(quantity-reserved_quantity\),0\)::text AS available/.test(sql)) return { rows: [{ available: "1000" }] };
      if (/SELECT id,name,tax_category_id FROM tenant\.items WHERE organization_id=\$1 AND id=ANY/.test(sql))
        return { rows: params[1].filter((id) => id === itemId).map((id) => ({ id, name: "Test Item", tax_category_id: null })) };
      if (/SELECT decimal_places FROM tenant\.currencies/.test(sql)) return { rows: [{ decimal_places: 2 }] };
      if (/SELECT seller_state_code FROM tenant\.sales_settings/.test(sql)) return { rows: [] };
      if (/SELECT state_code FROM tenant\.addresses/.test(sql)) return { rows: [] };
      if (/SELECT tax_inclusive FROM tenant\.price_lists/.test(sql)) return { rows: [{ tax_inclusive: false }] };
      if (/FROM tenant\.tax_rates WHERE/.test(sql)) return { rows: [] };
      if (/SELECT id FROM tenant\.business_parties/.test(sql)) {
        const requestedId = params[2];
        if (requestedId === activeCustomerId) return { rows: [{ id: activeCustomerId }] };
        return { rows: [] }; // archived or unknown customer id both resolve to "not found"
      }
      if (/INSERT INTO tenant\.pos_sales/.test(sql)) return { rows: [{ id: saleId, store_id: "store-1", terminal_id: "terminal-1" }] };
      if (/SELECT \* FROM tenant\.stock_movements WHERE organization_id=\$1 AND idempotency_key=\$2/.test(sql)) return { rows: [] };
      if (/SELECT id,company_id,track_inventory,allow_negative_stock,standard_cost FROM tenant\.items/.test(sql))
        return { rows: [{ id: itemId, company_id: company, track_inventory: true, allow_negative_stock: false, standard_cost: "50" }] };
      if (/SELECT id,company_id,allow_negative_stock FROM tenant\.warehouses/.test(sql))
        return { rows: [{ id: warehouseId, company_id: company, allow_negative_stock: false }] };
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost FROM tenant\.stock_balances.*FOR UPDATE/.test(sql))
        return { rows: [{ quantity: "1000", reserved_quantity: "0", average_cost: "50" }] };
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) return { rows: [{ id: "movement-1" }] };
      if (/INSERT INTO tenant\.stock_balances/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.stock_valuation_layers/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_sale_lines/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_payments/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_cash_movements/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_events/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("POS: a sale with no customerId completes without querying business_parties (walk-in customer)", async () => {
  const result = await completePointOfSale(client(), baseContext(), saleInput());
  assert.equal(result.id, saleId);
});

test("POS: a sale with an active, eligible customerId completes", async () => {
  const result = await completePointOfSale(client(), baseContext(), saleInput({ customerId: activeCustomerId }));
  assert.equal(result.id, saleId);
});

test("POS: an unknown customerId is rejected, not silently accepted", async () => {
  await assert.rejects(
    () => completePointOfSale(client(), baseContext(), saleInput({ customerId: unknownCustomerId })),
    (error) => error?.status === 404 && error?.code === "POS_CUSTOMER_NOT_FOUND",
  );
});

test("POS: an archived/ineligible customerId is rejected the same as an unknown one", async () => {
  await assert.rejects(
    () => completePointOfSale(client(), baseContext(), saleInput({ customerId: archivedCustomerId })),
    (error) => error?.status === 404 && error?.code === "POS_CUSTOMER_NOT_FOUND",
  );
});

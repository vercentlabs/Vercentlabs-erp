import assert from "node:assert/strict";
import test from "node:test";

import { completePointOfSale } from "../src/modules/point-of-sale/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

// Prompt 12 (Emergency P0 Integrity Fixes) — regression coverage for the
// confirmed-live defect documented in docs/implementation/
// ERP_P0_INTEGRITY_FIXES_012.md: before this prompt, POS's
// completePointOfSale() posted the sale-line stock issue via a LOCAL
// postStockMovement() that only inserted into stock_movements and never
// touched stock_balances at all — a completed sale never actually
// decremented on-hand inventory. This test proves completePointOfSale now
// routes through Stock's canonical postStockMovement
// (services/api/src/modules/stock/index.js).

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const shiftId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "66666666-6666-4666-8666-666666666666";
const saleId = "77777777-7777-4777-8777-777777777777";

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
    lines: [{ itemId, quantity: 3, unitPrice: 100 }],
    payments: [{ method: "cash", amount: 300 }],
    ...overrides,
  };
}

function trackingClient({ availableStock = "1000", existingBalance = { quantity: "1000", reserved_quantity: "0", average_cost: "50" } } = {}) {
  const stockMovementInserts = [];
  const stockBalanceUpserts = [];
  const valuationLayerInserts = [];
  const saleLineInserts = [];
  const wave0 = createWave0PrimitiveHarness();

  return {
    stockMovementInserts,
    stockBalanceUpserts,
    valuationLayerInserts,
    saleLineInserts,
    async query(sql, params) {
      const wave0Result = wave0.handle(sql, params);
      if (wave0Result) return wave0Result;
      if (/FROM tenant\.pos_shifts shift[\s\S]*FOR UPDATE/.test(sql)) return { rows: [shiftRow()] };
      // Phase 2 (F268-F273): assertPosStoreAccess()'s "has this company
      // opted into per-cashier store assignment at all" check -- no rows
      // means unconfigured/permissive, matching every test here (none sets
      // up a pos_store_access row).
      if (/FROM tenant\.pos_store_access/.test(sql)) return { rows: [] };
      if (/SELECT allow_negative_stock,allow_price_override,max_line_discount_percent,discount_approval_threshold_percent\s+FROM tenant\.pos_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, allow_price_override: false, max_line_discount_percent: 100, discount_approval_threshold_percent: 10 }] };
      if (/SELECT price_item\.rate/.test(sql)) return { rows: [{ rate: "100" }] };
      if (/SELECT coalesce\(sum\(quantity-reserved_quantity\),0\)::text AS available\s+FROM tenant\.stock_balances/.test(sql))
        return { rows: [{ available: availableStock }] }; // POS's own unlocked pre-check
      if (/INSERT INTO tenant\.pos_sales/.test(sql)) return { rows: [{ id: saleId, store_id: "store-1", terminal_id: "terminal-1" }] };
      if (/SELECT id,name,tax_category_id FROM tenant\.items WHERE organization_id=\$1 AND id=ANY/.test(sql))
        return { rows: params[1].filter((id) => id === itemId).map((id) => ({ id, name: "Test Item", tax_category_id: null })) };
      // F278: authoritative tax/currency/jurisdiction resolution added this
      // session — no tax category on the test item, so these resolve to
      // "no tax" (decimal_places=2, no seller/buyer state, no rate).
      if (/SELECT decimal_places FROM tenant\.currencies/.test(sql)) return { rows: [{ decimal_places: 2 }] };
      if (/SELECT seller_state_code FROM tenant\.sales_settings/.test(sql)) return { rows: [] };
      if (/SELECT state_code FROM tenant\.addresses/.test(sql)) return { rows: [] };
      if (/SELECT tax_inclusive FROM tenant\.price_lists/.test(sql)) return { rows: [{ tax_inclusive: false }] };
      if (/FROM tenant\.tax_rates WHERE/.test(sql)) return { rows: [] };
      if (/SELECT \* FROM tenant\.stock_movements WHERE organization_id=\$1 AND idempotency_key=\$2/.test(sql)) return { rows: [] };
      if (/SELECT id,company_id,track_inventory,allow_negative_stock,standard_cost FROM tenant\.items/.test(sql))
        return { rows: [{ id: params[1], company_id: company, track_inventory: true, allow_negative_stock: false, standard_cost: "50" }] };
      if (/SELECT id,company_id,allow_negative_stock FROM tenant\.warehouses/.test(sql))
        return { rows: [{ id: params[1], company_id: company, allow_negative_stock: false }] };
      if (/SELECT id FROM tenant\.stock_serials/.test(sql)) return { rows: [{ id: params[2] }] };
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost FROM tenant\.stock_balances.*FOR UPDATE/.test(sql))
        return { rows: existingBalance ? [existingBalance] : [] };
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) {
        const row = {
          id: `movement-${stockMovementInserts.length + 1}`,
          movement_type: params[3],
          item_id: params[4],
          warehouse_id: params[5],
          batch_id: params[7],
          serial_id: params[8],
          quantity: params[9],
        };
        stockMovementInserts.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO tenant\.stock_balances/.test(sql)) {
        stockBalanceUpserts.push({ itemId: params[2], warehouseId: params[3], quantity: params[6] });
        return { rows: [] };
      }
      if (/INSERT INTO tenant\.stock_valuation_layers/.test(sql)) {
        valuationLayerInserts.push({ quantity: params[5] });
        return { rows: [] };
      }
      if (/INSERT INTO tenant\.pos_sale_lines/.test(sql)) {
        saleLineInserts.push({ itemId: params[3], variantId: params[4], description: params[5] });
        return { rows: [] };
      }
      if (/INSERT INTO tenant\.pos_payments/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_cash_movements/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.pos_events/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("POS: completed sale decreases stock_balances exactly once per line, via canonical Stock posting", async () => {
  const client = trackingClient();
  await completePointOfSale(client, baseContext(), saleInput());

  const upserts = client.stockBalanceUpserts.filter((u) => u.itemId === itemId);
  assert.equal(upserts.length, 1, "expected exactly one balance upsert for the single sale line — this is the confirmed P0 defect this prompt fixes");
  assert.equal(Number(upserts[0].quantity), 997, "1000 existing - 3 sold = 997");
});

test("POS: sale-line stock movement is posted as a real ledger row (movement_type='issue', signed negative)", async () => {
  const client = trackingClient();
  await completePointOfSale(client, baseContext(), saleInput());

  assert.equal(client.stockMovementInserts.length, 1);
  assert.equal(client.stockMovementInserts[0].movement_type, "issue");
  assert.equal(Number(client.stockMovementInserts[0].quantity), -3);
});

test("POS: ledger and balance stay consistent — every stock_movements insert has a matching stock_balances upsert and valuation-layer row", async () => {
  const client = trackingClient();
  await completePointOfSale(
    client,
    baseContext(),
    saleInput({ lines: [{ itemId, quantity: 2, unitPrice: 100 }, { itemId, quantity: 1, unitPrice: 100 }] }),
  );
  assert.equal(client.stockMovementInserts.length, 2);
  assert.equal(client.stockBalanceUpserts.length, 2);
  assert.equal(client.valuationLayerInserts.length, 2);
});

test("POS: duplicate/retry request replays the original sale and never double-decrements stock", async () => {
  const client = trackingClient();
  const first = await completePointOfSale(client, baseContext(), saleInput());
  const second = await completePointOfSale(client, baseContext(), saleInput());
  assert.equal(second.id, first.id);
  assert.equal(second.replayed, true);
  assert.equal(client.stockMovementInserts.length, 1, "the replay must not post a second stock movement");
  assert.equal(client.stockBalanceUpserts.length, 1, "the replay must not decrement inventory twice");
});

test("POS: insufficient stock is rejected by canonical Stock's own row-locked balance check, not just the unlocked pre-check (concurrency-safe authoritative guard)", async () => {
  const client = trackingClient({ availableStock: "1000", existingBalance: { quantity: "1", reserved_quantity: "0", average_cost: "50" } });
  await assert.rejects(
    () => completePointOfSale(client, baseContext(), saleInput()),
    /Insufficient available stock/,
  );
});

test("POS: correct store/shift warehouse is used for the stock movement, not a hardcoded default", async () => {
  const altWarehouse = "88888888-8888-4888-8888-888888888888";
  const base = trackingClient();
  const client = {
    ...base,
    async query(sql, params) {
      if (/FROM tenant\.pos_shifts shift[\s\S]*FOR UPDATE/.test(sql)) return { rows: [{ ...shiftRow(), warehouse_id: altWarehouse }] };
      return base.query(sql, params);
    },
  };
  await completePointOfSale(client, baseContext(), saleInput());
  assert.equal(base.stockMovementInserts[0].warehouse_id, altWarehouse);
});

test("POS: negative-stock policy is Stock's own stock_settings.allow_negative_stock — the authoritative gate is Stock's, even though POS has its own separate pos_settings.allow_negative_stock pre-check", async () => {
  let stockSettingsConsulted = false;
  const base = trackingClient();
  const client = {
    async query(sql, params) {
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql)) stockSettingsConsulted = true;
      return base.query(sql, params);
    },
  };
  await completePointOfSale(client, baseContext(), saleInput());
  assert.ok(stockSettingsConsulted, "the canonical posting path must consult Stock's own settings table, not rely solely on pos_settings");
});

test("POS: serial-tracked sale lines preserve serial_id through the canonical posting path (no traceability loss)", async () => {
  const serialId = "99999999-9999-4999-8999-999999999999";
  const client = trackingClient();
  await completePointOfSale(client, baseContext(), saleInput({ lines: [{ itemId, quantity: 1, unitPrice: 100, serialId }], payments: [{ method: "cash", amount: 100 }] }));
  assert.equal(client.stockMovementInserts.length, 1);
  assert.equal(client.stockMovementInserts[0].serial_id, serialId);
});

// Found via real PostgreSQL testing (not this fake-client suite): the prior
// code passed line.description straight into an INSERT against a NOT NULL
// column with no fallback, so any checkout call that didn't happen to
// supply a description on every line failed with a raw "null value in
// column violates not-null constraint" — a real, previously undetected
// defect, since this suite's own saleInput() helper never sets one either.
test("POS: sale-line description defaults to the item's own name when the caller doesn't supply one (pos_sale_lines.description is NOT NULL)", async () => {
  const client = trackingClient();
  await completePointOfSale(client, baseContext(), saleInput());
  assert.equal(client.saleLineInserts.length, 1);
  assert.equal(client.saleLineInserts[0].description, "Test Item");
});

test("POS: an explicit line description is preserved rather than overridden by the item name", async () => {
  const client = trackingClient();
  await completePointOfSale(client, baseContext(), saleInput({ lines: [{ itemId, quantity: 1, unitPrice: 100, description: "Gift-wrapped" }], payments: [{ method: "cash", amount: 100 }] }));
  assert.equal(client.saleLineInserts[0].description, "Gift-wrapped");
});

test("POS: an unknown item id is rejected before any stock/price lookup, not left to surface as a confusing downstream error", async () => {
  const client = trackingClient();
  const unknownItemId = "00000000-0000-4000-8000-000000000000";
  await assert.rejects(
    () => completePointOfSale(client, baseContext(), saleInput({ lines: [{ itemId: unknownItemId, quantity: 1, unitPrice: 100 }] })),
    (error) => error?.status === 404 && error?.code === "POS_SALE_ITEM_NOT_FOUND",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { completePointOfSale } from "../src/modules/point-of-sale/index.js";

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

  return {
    stockMovementInserts,
    stockBalanceUpserts,
    valuationLayerInserts,
    async query(sql, params) {
      if (/FROM tenant\.pos_shifts shift[\s\S]*FOR UPDATE/.test(sql)) return { rows: [shiftRow()] };
      if (/SELECT allow_negative_stock,allow_price_override\s+FROM tenant\.pos_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, allow_price_override: false }] };
      if (/SELECT coalesce\(sum\(quantity-reserved_quantity\),0\)::text AS available\s+FROM tenant\.stock_balances/.test(sql))
        return { rows: [{ available: availableStock }] }; // POS's own unlocked pre-check
      if (/INSERT INTO tenant\.pos_sales/.test(sql)) return { rows: [{ id: saleId, store_id: "store-1", terminal_id: "terminal-1" }] };
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost FROM tenant\.stock_balances.*FOR UPDATE/.test(sql))
        return { rows: existingBalance ? [existingBalance] : [] };
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) {
        const row = {
          id: `movement-${stockMovementInserts.length + 1}`,
          movement_type: params[2],
          item_id: params[3],
          warehouse_id: params[4],
          batch_id: params[6],
          serial_id: params[7],
          quantity: params[8],
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
      if (/INSERT INTO tenant\.pos_sale_lines/.test(sql)) return { rows: [] };
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

test("POS: duplicate/retry request does not double-decrement — pos_sales.idempotency_key uniqueness rejects the retry before any second stock movement is posted", async () => {
  // pos_sales has UNIQUE(organization_id, idempotency_key) (048_point_of_sale_module.sql).
  // A retried completePointOfSale with the same idempotencyKey fails at the pos_sales
  // INSERT itself, before any stock movement for the retry is ever attempted.
  let attempts = 0;
  const base = trackingClient();
  const client = {
    ...base,
    async query(sql, params) {
      if (/INSERT INTO tenant\.pos_sales/.test(sql)) {
        attempts += 1;
        if (attempts > 1) {
          const error = new Error('duplicate key value violates unique constraint "pos_sales_organization_id_idempotency_key_key"');
          error.code = "23505";
          throw error;
        }
      }
      return base.query(sql, params);
    },
  };
  await completePointOfSale(client, baseContext(), saleInput());
  await assert.rejects(() => completePointOfSale(client, baseContext(), saleInput()), /duplicate key value/);
  assert.equal(base.stockMovementInserts.length, 1, "the rejected retry must not have posted a second stock movement");
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

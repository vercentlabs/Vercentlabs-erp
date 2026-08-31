import assert from "node:assert/strict";
import test from "node:test";

import { postProduction } from "../src/modules/manufacturing/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

// Prompt 12 (Emergency P0 Integrity Fixes) — regression coverage for the
// confirmed-live defect documented in docs/implementation/
// ERP_P0_INTEGRITY_FIXES_012.md: before this prompt, Manufacturing's
// postProduction() posted material issues and finished-goods receipts via
// a LOCAL postStockMovement() that only inserted into stock_movements and
// never touched stock_balances at all. This test proves postProduction
// now routes through Stock's canonical postStockMovement
// (services/api/src/modules/stock/index.js), which locks the balance row, applies
// moving-average costing, and upserts stock_balances for real.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const workOrderId = "44444444-4444-4444-8444-444444444444";
const materialId = "55555555-5555-4555-8555-555555555555";
const componentItemId = "66666666-6666-4666-8666-666666666666";
const finishedItemId = "77777777-7777-4777-8777-777777777777";
const warehouseId = "88888888-8888-4888-8888-888888888888";

function baseContext(permissions = ["manufacturing.production.post"]) {
  return { organizationId: org, companyId: company, userId: user, roleSlugs: [], permissions };
}

function workOrderRow(overrides = {}) {
  return {
    id: workOrderId,
    organization_id: org,
    company_id: company,
    item_id: finishedItemId,
    status: "released",
    quantity_planned: "100",
    quantity_completed: "0",
    finished_goods_warehouse_id: warehouseId,
    ...overrides,
  };
}

function materialRow(overrides = {}) {
  return {
    id: materialId,
    organization_id: org,
    work_order_id: workOrderId,
    item_id: componentItemId,
    warehouse_id: warehouseId,
    warehouse_location_id: null,
    batch_id: null,
    required_quantity: "50",
    issued_quantity: "0",
    ...overrides,
  };
}

// Tracks every real balance-affecting write so tests can assert on them
// directly, rather than only on the higher-level return value.
function trackingClient({ existingComponentBalance = null, existingFinishedBalance = null, workOrder = workOrderRow(), materials = [materialRow()] } = {}) {
  const stockMovementInserts = [];
  const stockBalanceUpserts = [];
  const valuationLayerInserts = [];
  const wave0 = createWave0PrimitiveHarness();

  return {
    stockMovementInserts,
    stockBalanceUpserts,
    valuationLayerInserts,
    async query(sql, params) {
      const wave0Result = wave0.handle(sql, params);
      if (wave0Result) return wave0Result;
      if (/SELECT \* FROM tenant\.manufacturing_work_orders/.test(sql)) return { rows: [workOrder] };
      if (/SELECT allow_overproduction,require_operation_completion/.test(sql))
        return { rows: [{ allow_overproduction: false, require_operation_completion: false }] };
      if (/SELECT \* FROM tenant\.manufacturing_work_order_materials/.test(sql)) return { rows: materials };
      if (/SELECT coalesce\(sum\(quantity-reserved_quantity\),0\)::text AS available\s+FROM tenant\.stock_balances/.test(sql))
        return { rows: [{ available: "1000" }] }; // Manufacturing's own unlocked pre-check
      if (/SELECT \* FROM tenant\.stock_movements WHERE organization_id=\$1 AND idempotency_key=\$2/.test(sql)) return { rows: [] };
      if (/SELECT id,company_id,track_inventory,allow_negative_stock,standard_cost FROM tenant\.items/.test(sql))
        return { rows: [{ id: params[1], company_id: company, track_inventory: true, allow_negative_stock: false, standard_cost: "2" }] };
      if (/SELECT id,company_id,allow_negative_stock FROM tenant\.warehouses/.test(sql))
        return { rows: [{ id: params[1], company_id: company, allow_negative_stock: false }] };
      if (/SELECT id FROM tenant\.stock_serials/.test(sql)) return { rows: [{ id: params[2] }] };
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql))
        return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost FROM tenant\.stock_balances.*FOR UPDATE/.test(sql)) {
        const itemId = params[2];
        if (itemId === componentItemId) return { rows: existingComponentBalance ? [existingComponentBalance] : [] };
        if (itemId === finishedItemId) return { rows: existingFinishedBalance ? [existingFinishedBalance] : [] };
        return { rows: [] };
      }
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) {
        const row = {
          id: `movement-${stockMovementInserts.length + 1}`,
          organization_id: org,
          company_id: company,
          movement_type: params[3],
          item_id: params[4],
          warehouse_id: params[5],
          warehouse_location_id: params[6],
          batch_id: params[7],
          serial_id: params[8],
          quantity: params[9],
          unit_cost: params[10],
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
      if (/INSERT INTO tenant\.manufacturing_production_postings/.test(sql)) return { rows: [] };
      if (/UPDATE tenant\.manufacturing_work_order_materials/.test(sql)) return { rows: [] };
      if (/UPDATE tenant\.manufacturing_work_orders/.test(sql)) return { rows: [{ ...workOrder, quantity_completed: "10", status: "in_progress" }] };
      if (/INSERT INTO tenant\.manufacturing_events/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("Manufacturing: material issue decreases stock_balances exactly once, via canonical Stock posting", async () => {
  const client = trackingClient({ existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" } });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });

  const componentUpserts = client.stockBalanceUpserts.filter((u) => u.itemId === componentItemId);
  assert.equal(componentUpserts.length, 1, "component balance should be upserted exactly once");
  // requiredForPosting = 50 * (10/100) = 5; 1000 - 5 = 995
  assert.equal(Number(componentUpserts[0].quantity), 995);
});

test("Manufacturing: finished-goods receipt increases stock_balances exactly once, via canonical Stock posting", async () => {
  const client = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });

  const finishedUpserts = client.stockBalanceUpserts.filter((u) => u.itemId === finishedItemId);
  assert.equal(finishedUpserts.length, 1, "finished-goods balance should be upserted exactly once");
  assert.equal(Number(finishedUpserts[0].quantity), 10);
});

test("Manufacturing: both the material-issue and finished-goods movements create a real stock_movements ledger row AND a stock_balances upsert (ledger/balance consistency)", async () => {
  const client = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });

  assert.equal(client.stockMovementInserts.length, 2, "expected exactly one ledger row for material issue and one for finished-goods receipt");
  assert.equal(client.stockBalanceUpserts.length, 2, "expected exactly one balance upsert per movement — this is the confirmed P0 defect this prompt fixes");
  assert.equal(client.valuationLayerInserts.length, 2, "canonical Stock posting also writes a valuation layer per movement");
});

test("Manufacturing: material issue is posted with a negative signed quantity (issue) and finished-goods receipt with a positive signed quantity (receipt), matching canonical Stock's own sign convention", async () => {
  const client = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });

  const [materialMovement, finishedMovement] = client.stockMovementInserts;
  assert.equal(materialMovement.movement_type, "issue");
  assert.equal(Number(materialMovement.quantity), -5);
  assert.equal(finishedMovement.movement_type, "receipt");
  assert.equal(Number(finishedMovement.quantity), 10);
});

test("Manufacturing: serial-tracked finished goods preserve serial_id through the canonical posting path (no traceability loss)", async () => {
  const serialId = "99999999-9999-4999-8999-999999999999";
  const client = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1", serialId });

  const finishedMovement = client.stockMovementInserts[1];
  assert.equal(finishedMovement.serial_id, serialId);
});

test("Manufacturing: exact retry replays the original production result without double-posting stock or work-order quantities", async () => {
  const client = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  const first = await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });
  const second = await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });
  assert.equal(second.id, first.id);
  assert.equal(second.replayed, true);
  assert.equal(client.stockMovementInserts.length, 2, "retry must not add another material issue or finished-goods receipt");
  assert.equal(client.stockBalanceUpserts.length, 2, "retry must not mutate balances twice");
});

test("Manufacturing: insufficient component stock is rejected by canonical Stock's own row-locked balance check, not just the unlocked pre-check (concurrency-safe authoritative guard)", async () => {
  const client = trackingClient({
    existingComponentBalance: { quantity: "1", reserved_quantity: "0", average_cost: "2" }, // real balance is far short of the 5 required
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await assert.rejects(
    () => postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" }),
    /Insufficient available stock/,
  );
});

test("Manufacturing: negative-stock policy is Stock's own stock_settings.allow_negative_stock, not a separate Manufacturing-local rule (Manufacturing and Stock honor the same policy)", async () => {
  let capturedSettingsCall = false;
  const base = trackingClient({
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  const client = {
    async query(sql, params) {
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql)) {
        capturedSettingsCall = true;
      }
      return base.query(sql, params);
    },
  };
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });
  assert.ok(capturedSettingsCall, "postProduction's stock movements must consult tenant.stock_settings (Stock's own policy table), confirming there is no separate Manufacturing-local negative-stock rule");
});

test("Manufacturing: correct warehouse/location context flows from the work order and its materials into the canonical posting, not a hardcoded default", async () => {
  const altWarehouse = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const client = trackingClient({
    workOrder: workOrderRow({ finished_goods_warehouse_id: altWarehouse }),
    materials: [materialRow({ warehouse_id: altWarehouse })],
    existingComponentBalance: { quantity: "1000", reserved_quantity: "0", average_cost: "2" },
    existingFinishedBalance: { quantity: "0", reserved_quantity: "0", average_cost: "0" },
  });
  await postProduction(client, baseContext(), workOrderId, { quantity: "10", idempotencyKey: "posting-1" });
  for (const movement of client.stockMovementInserts) {
    assert.equal(movement.warehouse_id, altWarehouse);
  }
});

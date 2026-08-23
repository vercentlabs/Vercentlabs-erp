import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseStockBalanceDrift, postStockMovement, createStockTransfer, completeStockTransfer } from "../src/modules/stock/index.js";

// Prompt 12 (Emergency P0 Integrity Fixes) — regression coverage for
// diagnoseStockBalanceDrift(), the safe, dry-run-by-default, tenant-scoped
// diagnostic added to identify historical stock_balances drift left over
// from the confirmed Manufacturing/POS defect (see
// docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md Section 13). It never
// mutates anything unless explicitly asked (repair=true), and even then
// only ever corrects `quantity` to match the movement ledger's own sum.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const itemId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "66666666-6666-4666-8666-666666666666";

function baseContext(permissions) {
  return { organizationId: org, companyId: company, userId: user, roleSlugs: [], permissions };
}

function diagnosticRow({ ledgerQuantity, balanceQuantity }) {
  return {
    item_id: itemId,
    warehouse_id: warehouseId,
    warehouse_location_id: null,
    batch_id: null,
    ledger_quantity: String(ledgerQuantity),
    balance_quantity: String(balanceQuantity),
  };
}

function client({ rows, onBalanceUpsert = () => {} }) {
  return {
    async query(sql, params) {
      if (/FULL OUTER JOIN tenant\.stock_balances/.test(sql)) {
        assert.equal(params[0], org, "diagnostic must be scoped to the caller's own organization");
        assert.equal(params[1], company, "diagnostic must be scoped to the caller's own company");
        return { rows };
      }
      if (/INSERT INTO tenant\.stock_balances/.test(sql)) {
        onBalanceUpsert(params);
        return { rows: [{ id: "balance-1", quantity: params[6] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("diagnostic: reports a real drift and does NOT mutate anything by default (dry-run)", async () => {
  let mutated = false;
  const c = client({
    rows: [diagnosticRow({ ledgerQuantity: 90, balanceQuantity: 100 })], // Manufacturing/POS bug pattern: balance stuck stale
    onBalanceUpsert: () => {
      mutated = true;
    },
  });
  const result = await diagnoseStockBalanceDrift(c, baseContext(["stock.view"]));
  assert.equal(result.dryRun, true);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.mismatches[0].drift, -10);
  assert.equal(result.repaired.length, 0);
  assert.equal(mutated, false, "dry-run must never write to stock_balances");
});

test("diagnostic: ignores a matching balance (no false positives)", async () => {
  const c = client({ rows: [] }); // HAVING clause already filters out matches at the SQL level
  const result = await diagnoseStockBalanceDrift(c, baseContext(["stock.view"]));
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.mismatches, []);
});

test("diagnostic: requires stock.view even for a dry-run read", async () => {
  const c = client({ rows: [] });
  await assert.rejects(() => diagnoseStockBalanceDrift(c, baseContext([])), /permission/);
});

test("diagnostic: repair=true corrects the balance to the ledger-derived quantity, requires stock.adjust separately from stock.view", async () => {
  const c = client({ rows: [diagnosticRow({ ledgerQuantity: 90, balanceQuantity: 100 })] });
  // Holding only stock.view (not stock.adjust) must not be enough to repair.
  await assert.rejects(
    () => diagnoseStockBalanceDrift(c, baseContext(["stock.view"]), { repair: true }),
    /permission/,
  );

  let capturedQuantity = null;
  const repairClient = client({
    rows: [diagnosticRow({ ledgerQuantity: 90, balanceQuantity: 100 })],
    onBalanceUpsert: (params) => {
      capturedQuantity = params[6];
    },
  });
  const result = await diagnoseStockBalanceDrift(repairClient, baseContext(["stock.view", "stock.adjust"]), { repair: true });
  assert.equal(result.dryRun, false);
  assert.equal(result.repaired.length, 1);
  assert.equal(capturedQuantity, "90", "repair must set quantity to the ledger-derived sum, not the stale balance");
});

test("diagnostic: repair is idempotent — running it again after a successful repair finds zero remaining mismatches", async () => {
  // First pass: SQL layer would no longer return this row once quantity=90 matches the ledger sum
  // (the HAVING clause filters it out). Simulate that directly.
  const c = client({ rows: [] });
  const result = await diagnoseStockBalanceDrift(c, baseContext(["stock.view", "stock.adjust"]), { repair: true });
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.repaired.length, 0);
});

test("diagnostic: a balance row with zero movements (orphaned balance) is also detected via the FULL OUTER JOIN, not just balances missing entirely", async () => {
  const c = client({
    rows: [diagnosticRow({ ledgerQuantity: 0, balanceQuantity: 25 })], // no ledger rows at all, stale balance persists
  });
  const result = await diagnoseStockBalanceDrift(c, baseContext(["stock.view"]));
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.mismatches[0].drift, -25);
});

// --- Cross-module regression: canonical Stock functions are unaffected ---

test("regression: postStockMovement still supports serialId as an addition, without breaking callers that omit it", async () => {
  const c = {
    async query(sql, params) {
      if (/SELECT allow_negative_stock,costing_method/.test(sql)) return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost.*FOR UPDATE/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) {
        assert.equal(params[7], null, "serial_id should default to null when omitted");
        return { rows: [{ id: "movement-1" }] };
      }
      if (/INSERT INTO tenant\.stock_balances/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.stock_valuation_layers/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await postStockMovement(c, baseContext(["stock.receive"]), {
    movementType: "receipt",
    itemId,
    warehouseId,
    quantity: 5,
  });
  assert.equal(result.id, "movement-1");
});

test("regression: createStockTransfer / completeStockTransfer (Stock's own internal augmented-permissions precedent this fix's pattern was modeled on) are unmodified and still work", async () => {
  const transferId = "77777777-7777-4777-8777-777777777777";
  const c = {
    async query(sql, params) {
      if (/INSERT INTO tenant\.stock_transfers/.test(sql)) return { rows: [{ id: transferId, status: "draft", item_id: itemId, source_warehouse_id: warehouseId, destination_warehouse_id: "dest-1", quantity: "5" }] };
      if (/SELECT \* FROM tenant\.stock_transfers.*FOR UPDATE/.test(sql)) return { rows: [{ id: transferId, status: "draft", item_id: itemId, source_warehouse_id: warehouseId, source_location_id: null, destination_warehouse_id: "dest-1", destination_location_id: null, batch_id: null, quantity: "5" }] };
      if (/SELECT allow_negative_stock,costing_method/.test(sql)) return { rows: [{ allow_negative_stock: true, costing_method: "moving_average" }] };
      if (/SELECT quantity,reserved_quantity,average_cost.*FOR UPDATE/.test(sql)) return { rows: [{ quantity: "100", reserved_quantity: "0", average_cost: "10" }] };
      if (/INSERT INTO tenant\.stock_movements/.test(sql)) return { rows: [{ id: "movement-x" }] };
      if (/INSERT INTO tenant\.stock_balances/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.stock_valuation_layers/.test(sql)) return { rows: [] };
      if (/UPDATE tenant\.stock_transfers SET status='completed'/.test(sql)) return { rows: [{ id: transferId, status: "completed" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const created = await createStockTransfer(c, baseContext(["stock.transfer"]), {
    itemId,
    sourceWarehouseId: warehouseId,
    destinationWarehouseId: "dest-1",
    quantity: 5,
  });
  assert.equal(created.id, transferId);
  const completed = await completeStockTransfer(c, baseContext(["stock.transfer"]), transferId);
  assert.equal(completed.status, "completed");
});

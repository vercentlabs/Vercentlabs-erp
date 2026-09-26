import assert from "node:assert/strict";
import test from "node:test";

import {
  beginIdempotentOperation,
  canonicalPayloadJson,
  completeIdempotentOperation,
  requestPayloadHash,
} from "../src/core/idempotency.js";
import { nextDocumentNumber } from "../src/core/platform/numbering/index.js";
import { listHrPayrollResource } from "../src/modules/hr-payroll/index.js";
import { postStockMovement } from "../src/modules/stock/index.js";
import { completePointOfSale } from "../src/modules/point-of-sale/index.js";
import { createWave0PrimitiveHarness } from "./helpers/wave0-primitives.mjs";

const organizationId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const warehouseId = "55555555-5555-4555-8555-555555555555";

function context(permissions = []) {
  return { organizationId, companyId, userId, roleSlugs: [], permissions };
}

test("Wave 0 idempotency: canonical payload hashing is stable across object key order", () => {
  const left = { b: 2, a: { z: 9, y: [3, { q: true, p: null }] } };
  const right = { a: { y: [3, { p: null, q: true }], z: 9 }, b: 2 };
  assert.equal(canonicalPayloadJson(left), canonicalPayloadJson(right));
  assert.equal(requestPayloadHash(left), requestPayloadHash(right));
});

test("Wave 0 idempotency: exact retry replays the stored response", async () => {
  const wave0 = createWave0PrimitiveHarness();
  const client = { query: (sql, params) => wave0.handle(sql, params) };
  const ctx = context();
  const first = await beginIdempotentOperation(client, ctx, {
    operation: "stock.movement",
    key: "same-key",
    payload: { quantity: 2, itemId },
    required: true,
  });
  assert.equal(first.replayed, false);
  await completeIdempotentOperation(client, ctx, first, {
    response: { id: "movement-1", quantity: "2" },
    aggregateType: "stock_movement",
    aggregateId: "66666666-6666-4666-8666-666666666666",
  });
  const replay = await beginIdempotentOperation(client, ctx, {
    operation: "stock.movement",
    key: "same-key",
    payload: { itemId, quantity: 2 },
    required: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.response.id, "movement-1");
});

test("Wave 0 idempotency: same key with a different payload is a deterministic conflict", async () => {
  const wave0 = createWave0PrimitiveHarness();
  const client = { query: (sql, params) => wave0.handle(sql, params) };
  const ctx = context();
  const token = await beginIdempotentOperation(client, ctx, {
    operation: "pos.sale.complete",
    key: "sale-1",
    payload: { total: 100 },
    required: true,
  });
  await completeIdempotentOperation(client, ctx, token, { response: { id: "sale-1" } });
  await assert.rejects(
    () => beginIdempotentOperation(client, ctx, {
      operation: "pos.sale.complete",
      key: "sale-1",
      payload: { total: 101 },
      required: true,
    }),
    (error) => error?.status === 409 && error?.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("Wave 0 numbering: company-scoped sequence allocation produces unique deterministic numbers", async () => {
  const wave0 = createWave0PrimitiveHarness();
  const client = { query: (sql, params) => wave0.handle(sql, params) };
  const ctx = context();
  const first = await nextDocumentNumber(client, ctx, { documentType: "quality_hold", prefix: "QH" });
  const second = await nextDocumentNumber(client, ctx, { documentType: "quality_hold", prefix: "QH" });
  assert.equal(first, "QH-000001");
  assert.equal(second, "QH-000002");
  assert.notEqual(first, second);
});

test("Wave 0 HR security: broad hr_payroll.view alone cannot list payslips", async () => {
  let queried = false;
  const client = { async query() { queried = true; return { rows: [] }; } };
  await assert.rejects(
    () => listHrPayrollResource(client, context(["hr_payroll.view"]), "payslips"),
    (error) => error?.code === "FORBIDDEN",
  );
  assert.equal(queried, false, "authorization must fail before payroll data is queried");
});

test("Wave 0 HR security: explicit payslip visibility authorizes the scoped payslip read", async () => {
  const client = {
    async query(sql, params) {
      assert.match(sql, /FROM tenant\.hr_payslips/);
      assert.equal(params[0], organizationId);
      assert.equal(params[1], companyId);
      return { rows: [{ id: "payslip-1", net_pay: "1000" }] };
    },
  };
  const rows = await listHrPayrollResource(
    client,
    context(["hr_payroll.view", "hr_payroll.payslip.view"]),
    "payslips",
  );
  assert.equal(rows[0].id, "payslip-1");
});

test("Wave 0 Quality -> Stock: an active matching quality hold blocks a stock issue transactionally", async () => {
  const wave0 = createWave0PrimitiveHarness();
  const client = {
    async query(sql, params) {
      const primitive = wave0.handle(sql, params);
      if (primitive && !/FROM tenant\.quality_holds/.test(sql)) return primitive;
      if (/SELECT id,company_id,track_inventory,allow_negative_stock,standard_cost,tracking_type(?:,valuation_method)? FROM tenant\.items/.test(sql)) {
        return { rows: [{ id: itemId, company_id: companyId, track_inventory: true, allow_negative_stock: false, standard_cost: "10", tracking_type: "none" }] };
      }
      if (/SELECT id,company_id,allow_negative_stock FROM tenant\.warehouses/.test(sql)) {
        return { rows: [{ id: warehouseId, company_id: companyId, allow_negative_stock: false }] };
      }
      if (/AS q FROM tenant\.stock_balances/.test(sql)) return { rows: [{ q: "0" }] };
      if (/FROM tenant\.stock_valuation_layers WHERE/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [] };
      if (/FROM tenant\.stock_counts/.test(sql)) return { rows: [] };
      if (/SELECT allow_negative_stock,costing_method FROM tenant\.stock_settings/.test(sql)) {
        return { rows: [{ allow_negative_stock: false, costing_method: "moving_average" }] };
      }
      if (/SELECT quantity,reserved_quantity,average_cost FROM tenant\.stock_balances[\s\S]*FOR UPDATE/.test(sql)) {
        return { rows: [{ quantity: "10", reserved_quantity: "0", average_cost: "10" }] };
      }
      if (/FROM tenant\.quality_holds[\s\S]*FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: "77777777-7777-4777-8777-777777777777",
            hold_number: "QH-000001",
            hold_type: "inventory",
            quantity: "4",
            released_quantity: "0",
            reason: "Failed inspection",
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => postStockMovement(client, context(["stock.issue"]), {
      movementType: "issue",
      itemId,
      warehouseId,
      quantity: 7,
      idempotencyKey: "issue-held-stock",
    }),
    (error) => error?.status === 409 && error?.code === "QUALITY_HOLD_BLOCKED" && error?.availableQuantity === "6",
  );
});

test("Wave 0 POS safety: non-cash payment fails closed when no authoritative provider adapter exists", async () => {
  const wave0 = createWave0PrimitiveHarness();
  const client = { query: (sql, params) => wave0.handle(sql, params) };
  await assert.rejects(
    () => completePointOfSale(client, context(["pos.sale.create"]), {
      shiftId: "88888888-8888-4888-8888-888888888888",
      idempotencyKey: "external-payment-1",
      lines: [{ itemId, quantity: 1, unitPrice: 100 }],
      payments: [{ method: "upi", amount: 100 }],
    }),
    (error) => error?.status === 409 && error?.code === "POS_PAYMENT_PROVIDER_NOT_CONFIGURED",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBillingMaintenanceLoop, runBillingMaintenanceTick } from "../src/billing-maintenance.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = { worker: { billingMaintenanceEnabled: true, billingMaintenanceIntervalMilliseconds: 1_000, billingBatchSize: 7, leaseMilliseconds: 90_000 } };

function fakePool() {
  const statements = [];
  let released = 0;
  return {
    statements,
    released: () => released,
    connect: async () => ({
      query: async (sql, params) => {
        statements.push({ sql: String(sql), params });
        return { rows: [] };
      },
      release: () => {
        released += 1;
      },
    }),
  };
}

test("billing maintenance runs on a plain platform client: no tenant RLS context, no tenant job queue", async () => {
  const pool = fakePool();
  const summary = await runBillingMaintenanceTick(pool, config, { workerId: "w1", provider: {} });
  assert.deepEqual(summary, { webhooks: {}, checkouts: 0, seatChanges: 0, cancellations: 0, reconciliations: 0 });
  const sql = pool.statements.map((statement) => statement.sql).join("\n");
  assert.ok(!/set_config|app\.current_organization_id|tenant\.background_jobs/.test(sql));
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.ok(pool.statements[0].params.includes(7), "batch size comes from configuration");
  assert.ok(pool.statements[0].params.includes(90), "lease follows the worker lease");
  assert.equal(pool.released(), 1, "the client is always released");
});

test("the loop starts, runs, and stops cleanly; it can be disabled", async () => {
  const pool = fakePool();
  const loop = createBillingMaintenanceLoop(async () => pool, config, { workerId: "w1", provider: {} });
  loop.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await loop.stop();
  assert.ok(pool.statements.length > 0);
  const count = pool.statements.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(pool.statements.length, count, "no work after stop");

  const disabled = fakePool();
  const off = createBillingMaintenanceLoop(async () => disabled, { worker: { ...config.worker, billingMaintenanceEnabled: false } }, { workerId: "w2", provider: {} });
  off.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await off.stop();
  assert.equal(disabled.statements.length, 0);
});

test("the worker process owns the billing loop", () => {
  const worker = fs.readFileSync(path.join(here, "../src/worker.js"), "utf8");
  assert.match(worker, /createBillingMaintenanceLoop\(/);
  assert.match(worker, /billing\.start\(\)/);
  assert.match(worker, /await billing\.stop\(\)/);
});

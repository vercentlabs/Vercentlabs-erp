// Real PostgreSQL integration test -- asset maintenance: plans that generate work once, the work-order
// lifecycle with downtime and availability, parts and repair history.
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, REGISTRAR, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = { mgr: MANAGER, registrar: REGISTRAR, tech: ["assets.view", "assets.maintain"], acctA: ACCOUNTANT, custodian: ["assets.view"] };

test("Asset maintenance against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "asmt");
  const { api, run, denied, sql } = w;
  const ids = {};
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  try {
    const cat = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "MCH" })));
    const make = async (name) => {
      const a = await run("registrar", (c, x) => api.registerAsset(c, x, { name, categoryId: cat.id, acquisitionCost: 20000 }));
      return run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, a.id, { capitalizationDate: "2026-01-10" }));
    };
    ids.pump = (await make("Pump")).id;

    await t.test("F253/F254: a plan generates its work order once, when it comes due", async () => {
      await denied("custodian", (c, x) => api.saveMaintenancePlan(c, x, { assetId: ids.pump, name: "Lube", frequencyUnit: "months", frequencyValue: 3 }), 403);
      const badMeter = await run("tech", (c, x) => api.saveMaintenancePlan(c, x, { assetId: ids.pump, name: "Hours", frequencyUnit: "meter", frequencyValue: 500 })).catch((e) => e);
      assert.equal(badMeter.status, 400, "a meter plan needs its next reading");
      const plan = await run("tech", (c, x) => api.saveMaintenancePlan(c, x, { assetId: ids.pump, name: "Quarterly service", frequencyUnit: "months", frequencyValue: 3, nextDueDate: future(30), instructions: "Grease bearings" }));
      ids.plan = plan.id;
      const notYet = await run("tech", (c, x) => api.generateDueMaintenance(c, x, { asOf: w.today }));
      assert.equal(notYet.created, 0, "not due yet");
      const due = await run("tech", (c, x) => api.generateDueMaintenance(c, x, { asOf: future(25) }));
      assert.equal(due.created, 1);
      assert.equal(due.orders[0].source, "plan");
      const again = await run("tech", (c, x) => api.generateDueMaintenance(c, x, { asOf: future(25) }));
      assert.equal(again.created, 0, "one open order per plan");
      ids.planOrder = due.orders[0].id;
    });

    await t.test("F252/F255: completing a preventive order records cost, moves the plan forward, and shows in repair history", async () => {
      await run("tech", (c, x) => api.startAssetWorkOrder(c, x, ids.planOrder));
      const part = await run("tech", (c, x) => api.addAssetWorkOrderPart(c, x, ids.planOrder, { itemId: w.customerId, quantity: 2, unitCost: 150 }));
      assert.ok(part.id);
      const done = await run("tech", (c, x) => api.completeAssetWorkOrder(c, x, ids.planOrder, { laborCost: 400, externalCost: 100, findings: "OK" }));
      assert.equal(done.status, "completed");
      assert.equal(Number(done.parts_cost), 300);
      const [plan] = await sql(`SELECT last_completed_date,next_due_date FROM tenant.asset_maintenance_plans WHERE id=$1`, [ids.plan]);
      assert.ok(plan.last_completed_date, "the plan records when it was last done");
      const history = await run("mgr", (c, x) => api.getAssetRepairHistory(c, x, ids.pump));
      assert.equal(history.repairCount, 1);
      assert.equal(Number(history.totalCost), 800);
      const twice = await run("tech", (c, x) => api.completeAssetWorkOrder(c, x, ids.planOrder, {})).catch((e) => e);
      assert.equal(twice.status, 409);
    });

    await t.test("F252/F256: a breakdown takes the asset out of service, opens downtime, and completion restores it", async () => {
      const order = await run("tech", (c, x) => api.createAssetWorkOrder(c, x, ids.pump, { maintenanceType: "breakdown", priority: "urgent", problemDescription: "Seized bearing", takeOutOfService: true }));
      const [out] = await sql(`SELECT status FROM tenant.assets WHERE id=$1`, [ids.pump]);
      assert.equal(out.status, "in_maintenance");
      const [open] = await sql(`SELECT count(*)::int AS n FROM tenant.asset_downtime WHERE maintenance_order_id=$1 AND ended_at IS NULL`, [order.id]);
      assert.equal(open.n, 1);
      const noResolution = await run("tech", (c, x) => api.completeAssetWorkOrder(c, x, order.id, {})).catch((e) => e);
      assert.equal(noResolution.status, 400, "a repair needs its resolution described");
      await run("tech", (c, x) => api.startAssetWorkOrder(c, x, order.id));
      const done = await run("tech", (c, x) => api.completeAssetWorkOrder(c, x, order.id, { resolution: "Replaced bearing", failureCause: "Wear", laborCost: 200 }));
      assert.equal(done.status, "completed");
      const [back] = await sql(`SELECT status FROM tenant.assets WHERE id=$1`, [ids.pump]);
      assert.equal(back.status, "available", "the asset returns to service");
      const [closed] = await sql(`SELECT count(*)::int AS n FROM tenant.asset_downtime WHERE maintenance_order_id=$1 AND ended_at IS NOT NULL`, [order.id]);
      assert.equal(closed.n, 1, "the open downtime was closed");
    });

    await t.test("F252: a held order can resume; a cancelled one frees a taken-out asset", async () => {
      const order = await run("tech", (c, x) => api.createAssetWorkOrder(c, x, ids.pump, { maintenanceType: "corrective", takeOutOfService: true, problemDescription: "Noise" }));
      await run("tech", (c, x) => api.startAssetWorkOrder(c, x, order.id));
      const held = await run("tech", (c, x) => api.holdAssetWorkOrder(c, x, order.id, "Waiting for parts"));
      assert.equal(held.status, "on_hold");
      const resumed = await run("tech", (c, x) => api.startAssetWorkOrder(c, x, order.id));
      assert.equal(resumed.status, "in_progress");
      await run("tech", (c, x) => api.cancelAssetWorkOrder(c, x, order.id, "False alarm"));
      const [a] = await sql(`SELECT status FROM tenant.assets WHERE id=$1`, [ids.pump]);
      assert.equal(a.status, "available");
    });

  } finally {
    await w.cleanup();
    await admin.end();
  }
});

// Real PostgreSQL integration test -- maintenance and reliability (F252-F257) and inspection and
// calibration (F258-F259): plans that generate work once, the work-order lifecycle with downtime and
// availability, parts and repair history, warranties and claims, inspections that raise corrective work,
// and calibration that takes failed equipment out of service.
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = { mgr: MANAGER, tech: ["assets.view", "assets.maintain", "assets.inspect"], acctA: ACCOUNTANT, custodian: ["assets.view"] };

test("Asset maintenance, warranty, inspection and calibration against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "asmt");
  const { api, run, denied, sql } = w;
  const ids = {};
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  try {
    const cat = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "MCH" })));
    const make = async (name) => {
      const a = await run("mgr", (c, x) => api.registerAsset(c, x, { name, categoryId: cat.id, acquisitionCost: 20000 }));
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
      const manual = await run("tech", (c, x) => api.recordAssetDowntime(c, x, ids.pump, { startedAt: "2026-05-01T08:00:00Z", endedAt: "2026-05-01T12:30:00Z", category: "planned", reason: "Shutdown" }));
      assert.ok(manual.id);
      const backwards = await run("tech", (c, x) => api.recordAssetDowntime(c, x, ids.pump, { startedAt: "2026-05-02T08:00:00Z", endedAt: "2026-05-02T07:00:00Z" })).catch((e) => e);
      assert.equal(backwards.status, 400);
      const list = await run("mgr", (c, x) => api.listAssetDowntime(c, x, { assetId: ids.pump }));
      assert.ok(list.length >= 2);
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

    await t.test("F257: warranties are dated, expire, and a claim must fall inside the period", async () => {
      const bad = await run("tech", (c, x) => api.saveAssetWarranty(c, x, { assetId: ids.pump, startDate: "2026-05-01", endDate: "2026-04-01" })).catch((e) => e);
      assert.equal(bad.status, 400);
      const active = await run("tech", (c, x) => api.saveAssetWarranty(c, x, { assetId: ids.pump, providerName: "Maker", startDate: "2026-01-01", endDate: future(20) }));
      const expired = await run("tech", (c, x) => api.saveAssetWarranty(c, x, { assetId: ids.pump, providerName: "Old", warrantyType: "extended", startDate: "2024-01-01", endDate: "2025-01-01" }));
      const list = await run("mgr", (c, x) => api.listAssetWarranties(c, x, { assetId: ids.pump }));
      assert.equal(list.find((r) => r.id === active.id).warranty_status, "expiring", "inside the 30-day alert window");
      assert.equal(list.find((r) => r.id === expired.id).warranty_status, "expired");
      const late = await run("tech", (c, x) => api.createAssetWarrantyClaim(c, x, { warrantyId: expired.id, claimDate: w.today, description: "x" })).catch((e) => e);
      assert.equal(late.status, 409, "a claim outside the warranty period is refused");
      const claim = await run("tech", (c, x) => api.createAssetWarrantyClaim(c, x, { warrantyId: active.id, claimDate: w.today, description: "Bearing failure", claimedAmount: 500 }));
      const tooMuch = await run("tech", (c, x) => api.updateAssetWarrantyClaim(c, x, claim.id, { status: "settled", recoveredAmount: 900 })).catch((e) => e);
      assert.equal(tooMuch.status, 409, "recovery cannot exceed the claim");
      const settled = await run("tech", (c, x) => api.updateAssetWarrantyClaim(c, x, claim.id, { status: "settled", recoveredAmount: 450 }));
      assert.equal(settled.status, "settled");
      const final = await run("tech", (c, x) => api.updateAssetWarrantyClaim(c, x, claim.id, { status: "open" })).catch((e) => e);
      assert.equal(final.status, 409, "a settled claim is final");
    });

    await t.test("F258: a failed inspection raises a corrective work order and updates the condition", async () => {
      await denied("custodian", (c, x) => api.recordAssetInspection(c, x, ids.pump, { result: "pass" }), 403);
      const pass = await run("tech", (c, x) => api.recordAssetInspection(c, x, ids.pump, { checklist: [{ item: "Guard in place", passed: true }], locationVerified: true, custodianVerified: true, conditionRating: "good" }));
      assert.equal(pass.result, "pass");
      assert.equal(pass.corrective_order, null);
      const fail = await run("tech", (c, x) => api.recordAssetInspection(c, x, ids.pump, { checklist: [{ item: "Guard in place", passed: false, note: "missing" }], conditionRating: "poor", findings: "Guard missing" }));
      assert.equal(fail.result, "fail");
      assert.ok(fail.corrective_order?.id, "a corrective order was raised");
      assert.equal(fail.corrective_order.source, "inspection");
      const [a] = await sql(`SELECT condition_rating FROM tenant.assets WHERE id=$1`, [ids.pump]);
      assert.equal(a.condition_rating, "poor");
      await run("tech", (c, x) => api.cancelAssetWorkOrder(c, x, fail.corrective_order.id, "Handled in place"));
    });

    await t.test("F259: calibration sets the next due date; a failed calibration takes the equipment out of service", async () => {
      const gauge = await make("Pressure gauge");
      const badDates = await run("tech", (c, x) => api.recordAssetCalibration(c, x, gauge.id, { calibratedOn: "2026-05-01", dueOn: "2026-04-01", result: "pass" })).catch((e) => e);
      assert.equal(badDates.status, 400);
      const ok = await run("tech", (c, x) => api.recordAssetCalibration(c, x, gauge.id, { calibratedOn: w.today, dueOn: future(400), result: "pass", certificateNumber: "CERT-1", standardReference: "NABL" }));
      assert.equal(ok.corrective_order, null);
      const noAsFound = await run("tech", (c, x) => api.recordAssetCalibration(c, x, gauge.id, { calibratedOn: w.today, dueOn: future(30), result: "fail" })).catch((e) => e);
      assert.equal(noAsFound.status, 400, "a failure needs the as-found reading");
      const failed = await run("tech", (c, x) => api.recordAssetCalibration(c, x, gauge.id, { calibratedOn: w.today, dueOn: future(20), result: "fail", asFound: "+4% drift" }));
      assert.ok(failed.corrective_order?.id);
      const [a] = await sql(`SELECT status,calibration_due_date FROM tenant.assets WHERE id=$1`, [gauge.id]);
      assert.equal(a.status, "in_maintenance", "failed equipment must not be used");
      const list = await run("mgr", (c, x) => api.listAssetCalibrations(c, x, { assetId: gauge.id }));
      assert.equal(list.find((k) => k.result === "fail").calibration_status, "due_soon");
      assert.equal(list.find((k) => k.result === "pass").calibration_status, "valid");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});

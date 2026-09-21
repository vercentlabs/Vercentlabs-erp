// Real PostgreSQL integration test -- time tracking, hold, inspections, downtime + maintenance request,
// subcontracting. Role permission sets, no owner bypass.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";
async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

const ROLES = {
  planner: ["manufacturing.view", "manufacturing.work_order.manage", "manufacturing.work_order.release", "manufacturing.production.post", "manufacturing.scrap.post", "manufacturing.costing.view", "manufacturing.routing.manage", "manufacturing.settings.manage"],
  operator: ["manufacturing.view", "manufacturing.production.post"],
  operator2: ["manufacturing.view", "manufacturing.production.post"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing execution controls against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, stockContext, postStockMovement, createProductionOrder, releaseProductionOrder, getProductionOrder, startOperation, completeOperation, holdProductionOrder, resumeProductionOrder, issueMaterials, logTime, startTimer, stopTimer, listTimeEntries, recordInspection, listManufacturingInspections, startDowntime, endDowntime, listDowntime, getDowntimeSummary, linkWorkCenterAsset, sendToSubcontractor, receiveFromSubcontractor, listSubcontractJobs, saveWorkCenter, reportProduction, updateManufacturingSettings } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), fg: randomUUID(), c1: randomUUID(), wh: randomUUID(), wc: randomUUID(), bom: randomUUID(), routing: randomUUID(), category: randomUUID(), asset: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, manufacturingContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));
  const stockCtx = stockContext({ organizationId: orgId, userId: users.planner, activeCompanyId: companyId, roleSlugs: [], permissions: ["stock.view", "stock.receive", "stock.issue", "stock.manage", "stock.reserve"] });

  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const forbidden = (e) => e.status === 403;
  const run = (who, fn) => tx((c) => fn(c, ctx[who]));
  // Logged time comes from real timestamps, so under load a few hundred milliseconds of elapsed time add a fraction of a cent.
  const close = (actual, expected, message) => assert.ok(Math.abs(Number(actual) - expected) < 0.01, `${message}: expected ${expected}, got ${actual}`);
  const wo = async (id) => (await admin.query(`SELECT * FROM tenant.manufacturing_work_orders WHERE id=$1`, [id])).rows[0];

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `ex-${role}-${id}@test.invalid`, `Ex ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Ex Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `ex-org-${orgId}`, users.planner]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Ex Co','Ex Co Pvt Ltd','EXCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    for (const [id, code] of [[ids.fg, "FG"], [ids.c1, "C1"]]) await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'XW','XW','active')`, [ids.wh, orgId, companyId]);
    await admin.query(`INSERT INTO tenant.manufacturing_work_centers(id,organization_id,company_id,code,name,status,capacity_per_day,efficiency_percent,hourly_rate,overhead_rate,created_by) VALUES ($1,$2,$3,'WC','Line','active',480,100,60,120,$4)`, [ids.wc, orgId, companyId, users.planner]);
    await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,is_default,output_quantity,created_by) VALUES ($1,$2,$3,$4,'B',1,'active',true,1,$5)`, [ids.bom, orgId, companyId, ids.fg, users.planner]);
    await admin.query(`INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,scrap_percent,issue_method) VALUES ($1,$2,1,$3,1,0,'backflush')`, [orgId, ids.bom, ids.c1]);
    await admin.query(`INSERT INTO tenant.manufacturing_routings(id,organization_id,company_id,code,name,version,status,is_default,item_id,created_by) VALUES ($1,$2,$3,'R','Routing',1,'active',true,$4,$5)`, [ids.routing, orgId, companyId, ids.fg, users.planner]);
    // op 10 needs an inspection; op 20 is subcontracted (no work center)
    await admin.query(`INSERT INTO tenant.manufacturing_routing_operations(organization_id,routing_id,sequence,name,work_center_id,setup_minutes,run_minutes_per_unit,inspection_required,subcontracted) VALUES ($1,$2,10,'Machine',$3,0,1,true,false),($1,$2,20,'Plating',NULL,0,0,false,true)`, [orgId, ids.routing, ids.wc]);
    await tx((c) => postStockMovement(c, stockCtx, { movementType: "receipt", itemId: ids.c1, warehouseId: ids.wh, quantity: 100, unitCost: 2 }));
    await run("planner", (c, x) => updateManufacturingSettings(c, x, { defaultWipWarehouseId: ids.wh, defaultFinishedGoodsWarehouseId: ids.wh }));
    await admin.query(`INSERT INTO tenant.asset_categories(id,organization_id,company_id,code,name,created_by) VALUES ($1,$2,$3,'CAT','Machines',$4)`, [ids.category, orgId, companyId, users.planner]);
    await admin.query(`INSERT INTO tenant.assets(id,organization_id,company_id,asset_number,name,category_id,currency_code,useful_life_months,depreciation_method,created_by) VALUES ($1,$2,$3,'AST-1','Press machine',$4,'INR',60,'straight_line',$5)`, [ids.asset, orgId, companyId, ids.category, users.planner]);

    let order;
    let ops;
    await t.test("setup: a released order with a machine operation (inspection required) and a subcontracted one", async () => {
      order = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10, materialWarehouseId: ids.wh }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, order.id));
      ops = (await run("planner", (c, x) => getProductionOrder(c, x, order.id))).operations;
      assert.equal(ops.length, 2);
      assert.equal(ops[0].inspection_required, true);
    });

    await t.test("F182: a held order refuses work until resumed; a reason is required; only order managers hold", async () => {
      await assert.rejects(() => run("operator", (c, x) => holdProductionOrder(c, x, order.id, "x")), forbidden);
      await assert.rejects(() => run("planner", (c, x) => holdProductionOrder(c, x, order.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      const held = await run("planner", (c, x) => holdProductionOrder(c, x, order.id, "Waiting for a drawing change"));
      assert.equal(held.status, "on_hold");
      assert.equal(held.held_from_status, "released");
      await assert.rejects(() => run("operator", (c, x) => startOperation(c, x, ops[0].id)), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => issueMaterials(c, x, order.id, { lines: [] })), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      await assert.rejects(() => run("planner", (c, x) => holdProductionOrder(c, x, order.id, "again")), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      const resumed = await run("planner", (c, x) => resumeProductionOrder(c, x, order.id));
      assert.equal(resumed.status, "released");
      assert.equal(resumed.hold_reason, null);
    });

    await t.test("F169-F171: logged time is costed (labour/setup at the hourly rate, machine at the overhead rate) and replaces the estimated cost at completion", async () => {
      await assert.rejects(() => run("operator", (c, x) => logTime(c, x, ops[0].id, { minutes: 30 })), (e) => e.code === "MFG_OPERATION_STATE_INVALID", "not started");
      await run("operator", (c, x) => startOperation(c, x, ops[0].id));
      await assert.rejects(() => run("viewer", (c, x) => logTime(c, x, ops[0].id, { minutes: 30 })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => logTime(c, x, ops[0].id, { minutes: 0 })), (e) => e.code === "MFG_QUANTITY_INVALID");
      await assert.rejects(() => run("operator", (c, x) => logTime(c, x, ops[0].id, { minutes: 30, entryType: "coffee" })), (e) => e.code === "MFG_ENTRY_TYPE_INVALID");
      const setup = await run("operator", (c, x) => logTime(c, x, ops[0].id, { minutes: 30, entryType: "setup", operatorLabel: "Asha" }));
      assert.equal(setup.cost, null, "cost hidden without costing.view");
      await run("planner", (c, x) => logTime(c, x, ops[0].id, { minutes: 90, entryType: "labor" }));
      await run("planner", (c, x) => logTime(c, x, ops[0].id, { minutes: 60, entryType: "machine" }));
      // a running timer: one at a time per person and type; only its owner (or a planner) stops it
      const timer = await run("operator", (c, x) => startTimer(c, x, ops[0].id, { entryType: "labor" }));
      await assert.rejects(() => run("operator", (c, x) => startTimer(c, x, ops[0].id, { entryType: "labor" })), (e) => e.code === "MFG_TIMER_RUNNING");
      await assert.rejects(() => run("operator2", (c, x) => stopTimer(c, x, timer.id)), forbidden);
      await admin.query(`UPDATE tenant.manufacturing_time_entries SET started_at=now()-interval '30 minutes' WHERE id=$1`, [timer.id]);
      const stopped = await run("operator", (c, x) => stopTimer(c, x, timer.id));
      close(stopped.minutes, 30, "30 minutes on the clock");
      await assert.rejects(() => run("operator", (c, x) => stopTimer(c, x, timer.id)), (e) => e.code === "MFG_TIMER_STOPPED");
      // labour: (30 setup + 90 + 30 timer) min x 60/h = 150; machine: 60 min x 120/h = 120
      const cost = await wo(order.id);
      close(cost.labor_cost, 150, "labour + setup at 60/h");
      close(cost.overhead_cost, 120, "machine time at the 120/h overhead rate");
      const entries = await run("planner", (c, x) => listTimeEntries(c, x, { workOrderId: order.id }));
      assert.equal(entries.length, 4);
      assert.equal((await run("viewer", (c, x) => listTimeEntries(c, x, {})))[0].cost, null);
    });

    await t.test("F181: an operation that requires inspection cannot complete until a passing one exists; a failed one can scrap units or hold the order", async () => {
      await assert.rejects(() => run("operator", (c, x) => completeOperation(c, x, ops[0].id, {})), (e) => e.code === "MFG_INSPECTION_REQUIRED");
      await assert.rejects(() => run("viewer", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 5 })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 5, quantityRejected: 6, defectCode: "x" })), (e) => e.code === "MFG_QUANTITY_INVALID");
      await assert.rejects(() => run("operator", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 5, quantityRejected: 1 })), (e) => e.code === "MFG_DEFECT_REQUIRED");
      const failed = await run("planner", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 10, quantityRejected: 2, defectCode: "burr", followUp: "scrap" }));
      assert.equal(failed.result, "fail");
      close((await wo(order.id)).quantity_scrapped, 2, "the rejected units were scrapped");
      await assert.rejects(() => run("operator", (c, x) => completeOperation(c, x, ops[0].id, {})), (e) => e.code === "MFG_INSPECTION_REQUIRED", "a failed inspection does not satisfy it");
      const held = await run("planner", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 8, quantityRejected: 1, defectCode: "crack", followUp: "hold" }));
      assert.equal(held.follow_up, "hold");
      assert.equal((await wo(order.id)).status, "on_hold");
      await run("planner", (c, x) => resumeProductionOrder(c, x, order.id));
      await run("operator", (c, x) => recordInspection(c, x, order.id, { operationId: ops[0].id, quantityInspected: 8 }));
      const done = await run("operator", (c, x) => completeOperation(c, x, ops[0].id, { quantityGood: 8 }));
      assert.equal(done.status, "completed");
      close((await wo(order.id)).labor_cost, 150, "completion booked no second, estimated labour");
      close((await wo(order.id)).overhead_cost, 120, "nor overhead");
      assert.equal((await run("viewer", (c, x) => listManufacturingInspections(c, x))).length, 3);
    });

    await t.test("F180: a subcontracted operation is sent out with material and received back at a cost that joins the order's WIP", async () => {
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, order.id));
      const plating = detail.operations.find((o) => o.sequence === 20);
      const c1 = detail.materials[0];
      await assert.rejects(() => run("operator", (c, x) => sendToSubcontractor(c, x, ops[0].id, { supplierLabel: "X" })), (e) => e.code === "MFG_NOT_SUBCONTRACTED");
      await assert.rejects(() => run("operator", (c, x) => sendToSubcontractor(c, x, plating.id, { supplierLabel: "" })), (e) => e.code === "MFG_SUPPLIER_REQUIRED");
      await assert.rejects(() => run("viewer", (c, x) => sendToSubcontractor(c, x, plating.id, { supplierLabel: "Acme Plating" })), forbidden);
      const job = await run("operator", (c, x) => sendToSubcontractor(c, x, plating.id, { supplierLabel: "Acme Plating", expectedReturn: "2031-01-15", materials: [{ materialId: c1.id, quantity: 4 }] }));
      assert.equal(job.status, "sent");
      close((await wo(order.id)).material_cost, 8, "4 x C1 at cost 2 went out to the subcontractor");
      await assert.rejects(() => run("operator", (c, x) => sendToSubcontractor(c, x, plating.id, { supplierLabel: "Again" })), (e) => e.code === "MFG_OPERATION_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => receiveFromSubcontractor(c, x, job.id, { cost: -5 })), (e) => e.code === "MFG_QUANTITY_INVALID");
      const back = await run("operator", (c, x) => receiveFromSubcontractor(c, x, job.id, { quantityGood: 8, cost: 200 }));
      assert.equal(back.status, "received");
      assert.equal(back.cost, null, "cost hidden without costing.view");
      await assert.rejects(() => run("operator", (c, x) => receiveFromSubcontractor(c, x, job.id, { cost: 1 })), (e) => e.code === "MFG_JOB_STATE_INVALID");
      close((await wo(order.id)).subcontract_cost, 200, "subcontract cost accrues to the order");
      const after = await run("planner", (c, x) => getProductionOrder(c, x, order.id));
      close(after.costs.wip, 8 + 150 + 120 + 200, "material + labour + machine + subcontract");
      assert.equal((await run("planner", (c, x) => listSubcontractJobs(c, x)))[0].cost, "200.000000");
      // and output absorbs it: 8 finished at (all accrued) / planned 10
      const made = await run("operator", (c, x) => reportProduction(c, x, order.id, { quantity: 8 }));
      assert.equal(made.status, "in_progress");
    });

    await t.test("F188/F189: downtime is logged and ended; a breakdown can stop the work center and raise a real maintenance order on the linked asset", async () => {
      await assert.rejects(() => run("viewer", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "breakdown" })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "lunch" })), (e) => e.code === "MFG_REASON_CODE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "breakdown", requestMaintenance: true })), (e) => e.code === "MFG_NO_ASSET");
      await assert.rejects(() => run("operator", (c, x) => linkWorkCenterAsset(c, x, ids.wc, ids.asset)), forbidden);
      await assert.rejects(() => run("planner", (c, x) => linkWorkCenterAsset(c, x, ids.wc, randomUUID())), (e) => e.code === "MFG_ASSET_NOT_FOUND");
      await run("planner", (c, x) => linkWorkCenterAsset(c, x, ids.wc, ids.asset));
      const down = await run("operator", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "breakdown", stopWorkCenter: true, requestMaintenance: true, note: "Hydraulic leak" }));
      assert.ok(down.maintenance_order_id, "a maintenance order was raised");
      const amo = (await admin.query(`SELECT asset_id,maintenance_type,priority,status,work_order_number FROM tenant.asset_maintenance_orders WHERE id=$1`, [down.maintenance_order_id])).rows[0];
      assert.equal(amo.asset_id, ids.asset);
      assert.equal(amo.maintenance_type, "corrective");
      assert.equal(amo.priority, "high");
      assert.match(amo.work_order_number, /^AMO-/);
      assert.equal((await admin.query(`SELECT status FROM tenant.manufacturing_work_centers WHERE id=$1`, [ids.wc])).rows[0].status, "maintenance", "the work center is stopped");
      await assert.rejects(() => run("operator", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "other" })), (e) => e.code === "MFG_DOWNTIME_RUNNING");
      const listed = await run("viewer", (c, x) => listDowntime(c, x, { openOnly: true }));
      assert.equal(listed[0].maintenance_number, amo.work_order_number);
      await admin.query(`UPDATE tenant.manufacturing_downtime_events SET started_at=now()-interval '45 minutes' WHERE id=$1`, [down.id]);
      const ended = await run("operator", (c, x) => endDowntime(c, x, down.id));
      close(ended.minutes, 45, "45 minutes down");
      await assert.rejects(() => run("operator", (c, x) => endDowntime(c, x, down.id)), (e) => e.code === "MFG_DOWNTIME_ENDED");
      assert.equal((await admin.query(`SELECT status FROM tenant.manufacturing_work_centers WHERE id=$1`, [ids.wc])).rows[0].status, "active", "back in service");
      const other = await run("operator", (c, x) => startDowntime(c, x, { workCenterId: ids.wc, reasonCode: "changeover", category: "planned" }));
      await admin.query(`UPDATE tenant.manufacturing_downtime_events SET started_at=now()-interval '15 minutes' WHERE id=$1`, [other.id]);
      await run("operator", (c, x) => endDowntime(c, x, other.id));
      const summary = await run("viewer", (c, x) => getDowntimeSummary(c, x, { days: 30 }));
      close(summary.totalMinutes, 60, "45 + 15");
      assert.equal(summary.reasons[0].reason_code, "breakdown", "ranked by minutes");
      assert.equal(summary.reasons[0].share, 75);
      assert.equal(summary.reasons[1].cumulative, 100);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_subcontract_jobs", "manufacturing_inspections", "manufacturing_downtime_events", "manufacturing_time_entries", "manufacturing_scrap_records", "manufacturing_cost_snapshots", "manufacturing_production_postings", "manufacturing_work_order_operations", "manufacturing_work_order_materials", "manufacturing_work_orders", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_routing_operations", "manufacturing_routings", "manufacturing_work_centers", "manufacturing_settings", "manufacturing_events", "asset_maintenance_orders", "asset_events", "assets", "asset_categories", "stock_reservations", "stock_valuation_layers", "stock_movements", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

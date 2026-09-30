// Real PostgreSQL integration test -- production hold and production quality inspections. Role
// permission sets, no owner bypass.
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
  planner: ["manufacturing.view", "manufacturing.work_order.manage", "manufacturing.work_order.release", "manufacturing.production.post", "manufacturing.scrap.post", "manufacturing.costing.view", "manufacturing.settings.manage"],
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
  const { manufacturingContext, stockContext, postStockMovement, createProductionOrder, releaseProductionOrder, getProductionOrder, holdProductionOrder, resumeProductionOrder, issueMaterials, recordInspection, listManufacturingInspections, reportProduction, updateManufacturingSettings } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), fg: randomUUID(), c1: randomUUID(), wh: randomUUID(), bom: randomUUID() };
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
    await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,is_default,output_quantity,created_by) VALUES ($1,$2,$3,$4,'B',1,'active',true,1,$5)`, [ids.bom, orgId, companyId, ids.fg, users.planner]);
    await admin.query(`INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,scrap_percent,issue_method) VALUES ($1,$2,1,$3,1,0,'backflush')`, [orgId, ids.bom, ids.c1]);
    await tx((c) => postStockMovement(c, stockCtx, { movementType: "receipt", itemId: ids.c1, warehouseId: ids.wh, quantity: 100, unitCost: 2 }));
    await run("planner", (c, x) => updateManufacturingSettings(c, x, { defaultWipWarehouseId: ids.wh, defaultFinishedGoodsWarehouseId: ids.wh }));

    let order;
    await t.test("setup: a released production order", async () => {
      order = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10, materialWarehouseId: ids.wh }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, order.id));
      assert.equal((await wo(order.id)).status, "released");
    });

    await t.test("F182: a held order refuses work until resumed; a reason is required; only order managers hold", async () => {
      await assert.rejects(() => run("operator", (c, x) => holdProductionOrder(c, x, order.id, "x")), forbidden);
      await assert.rejects(() => run("planner", (c, x) => holdProductionOrder(c, x, order.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      const held = await run("planner", (c, x) => holdProductionOrder(c, x, order.id, "Waiting for a drawing change"));
      assert.equal(held.status, "on_hold");
      assert.equal(held.held_from_status, "released");
      await assert.rejects(() => run("operator", (c, x) => issueMaterials(c, x, order.id, { lines: [] })), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, order.id, { quantity: 1 })), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      await assert.rejects(() => run("planner", (c, x) => holdProductionOrder(c, x, order.id, "again")), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      const resumed = await run("planner", (c, x) => resumeProductionOrder(c, x, order.id));
      assert.equal(resumed.status, "released");
      assert.equal(resumed.hold_reason, null);
    });

    await t.test("F181: a pass/fail inspection of the output; a failed one can scrap the rejected units or hold the order", async () => {
      await assert.rejects(() => run("viewer", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 5 })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 5, quantityRejected: 6, defectCode: "x" })), (e) => e.code === "MFG_QUANTITY_INVALID");
      await assert.rejects(() => run("operator", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 5, quantityRejected: 1 })), (e) => e.code === "MFG_DEFECT_REQUIRED");
      const failed = await run("planner", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 10, quantityRejected: 2, defectCode: "burr", followUp: "scrap" }));
      assert.equal(failed.result, "fail");
      close((await wo(order.id)).quantity_scrapped, 2, "the rejected units were scrapped");
      const held = await run("planner", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 8, quantityRejected: 1, defectCode: "crack", followUp: "hold" }));
      assert.equal(held.follow_up, "hold");
      assert.equal((await wo(order.id)).status, "on_hold");
      await run("planner", (c, x) => resumeProductionOrder(c, x, order.id));
      const passed = await run("operator", (c, x) => recordInspection(c, x, order.id, { quantityInspected: 8 }));
      assert.equal(passed.result, "pass");
      assert.equal((await run("viewer", (c, x) => listManufacturingInspections(c, x))).length, 3);
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, order.id));
      assert.equal(detail.inspections.length, 3);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_inspections", "manufacturing_scrap_records", "manufacturing_cost_snapshots", "manufacturing_production_postings", "manufacturing_work_order_operations", "manufacturing_work_order_materials", "manufacturing_work_orders", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_settings", "manufacturing_events", "stock_reservations", "stock_valuation_layers", "stock_movements", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

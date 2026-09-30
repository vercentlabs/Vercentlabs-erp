// Real PostgreSQL integration test -- production costing (standard cost, actual cost, variance) and the
// Manufacturing dashboard. Role permission sets, no owner bypass.
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
  analyst: ["manufacturing.view", "manufacturing.costing.view", "manufacturing.reports.view", "manufacturing.routing.manage", "manufacturing.settings.manage"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing costing against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, getStandardCost, getProductionCostReport, getVarianceReport, getProductionDashboard } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), fg: randomUUID(), c1: randomUUID(), wh: randomUUID(), bom: randomUUID(), done: randomUUID(), late: randomUUID(), hold: randomUUID(), running: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, manufacturingContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));

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
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `co-${role}-${id}@test.invalid`, `Co ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Co Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `co-org-${orgId}`, users.analyst]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Co Co','Co Co Pvt Ltd','COCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,'FG','Item FG','product',$4,'active',true)`, [ids.fg, orgId, companyId, ids.uom]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,standard_cost) VALUES ($1,$2,$3,'C1','Item C1','product',$4,'active',true,5)`, [ids.c1, orgId, companyId, ids.uom]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'CW','CW','active')`, [ids.wh, orgId, companyId]);
    await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,is_default,output_quantity,created_by) VALUES ($1,$2,$3,$4,'B',1,'active',true,1,$5)`, [ids.bom, orgId, companyId, ids.fg, users.analyst]);
    await admin.query(`INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,scrap_percent,issue_method) VALUES ($1,$2,1,$3,2,0,'manual')`, [orgId, ids.bom, ids.c1]);

    // a completed order, all figures chosen for hand-checking
    const order = (id, number, status, extra = {}) => admin.query(
      `INSERT INTO tenant.manufacturing_work_orders(id,organization_id,company_id,work_order_number,item_id,bom_id,quantity_planned,quantity_completed,quantity_scrapped,status,wip_warehouse_id,finished_goods_warehouse_id,created_by,material_cost,labor_cost,overhead_cost,subcontract_cost,cost_absorbed,actual_start_at,actual_end_at,due_date,hold_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,0,$16,now(),$17,$18,$19)`,
      [id, orgId, companyId, number, ids.fg, ids.bom, extra.planned ?? 10, extra.completed ?? 0, extra.scrapped ?? 0, status, ids.wh, users.analyst, extra.material ?? 0, extra.labor ?? 0, extra.overhead ?? 0, extra.absorbed ?? 0, extra.end ?? null, extra.due ?? null, extra.hold ?? null],
    );
    await order(ids.done, "WO-DONE", "completed", { planned: 10, completed: 10, scrapped: 2, material: 144, absorbed: 144, end: new Date().toISOString(), due: today });
    await admin.query(`INSERT INTO tenant.manufacturing_work_order_materials(organization_id,work_order_id,item_id,warehouse_id,required_quantity,issued_quantity,issued_cost,issue_method) VALUES ($1,$2,$3,$4,20,24,144,'manual')`, [orgId, ids.done, ids.c1, ids.wh]);
    await admin.query(`INSERT INTO tenant.manufacturing_scrap_records(organization_id,company_id,work_order_id,item_id,category,scope,quantity,unit_cost,reason_code,posted_by) VALUES ($1,$2,$3,$4,'scrap','product',2,30,'defect',$5)`, [orgId, companyId, ids.done, ids.fg, users.analyst]);
    // open orders for the dashboard
    await order(ids.late, "WO-LATE", "released", { due: yesterday });
    await order(ids.hold, "WO-HOLD", "on_hold", { hold: "Waiting" , material: 10 });
    await order(ids.running, "WO-RUN", "in_progress", { material: 100, labor: 50, overhead: 20, absorbed: 30, due: today });

    await t.test("F184: standard cost is rolled up from the BOM (standard price x quantity); cost views need costing.view", async () => {
      await assert.rejects(() => run("viewer", (c, x) => getStandardCost(c, x, { itemId: ids.fg })), forbidden);
      await assert.rejects(() => run("analyst", (c, x) => getStandardCost(c, x, { itemId: ids.c1 })), (e) => e.code === "MFG_NO_ACTIVE_BOM");
      const std = await run("analyst", (c, x) => getStandardCost(c, x, { itemId: ids.fg, quantity: 10 }));
      close(std.material, 100, "2 x C1 at the standard 5 x 10 units");
      close(std.total, 100, "total");
      close(std.perUnit, 10, "per unit");
      assert.equal(std.materialLines[0].basis, "standard cost");
    });

    await t.test("F183: the cost report shows what each completed order actually cost, per unit", async () => {
      await assert.rejects(() => run("viewer", (c, x) => getProductionCostReport(c, x, {})), forbidden);
      const report = await run("analyst", (c, x) => getProductionCostReport(c, x, { from: yesterday, to: today }));
      assert.equal(report.lines.length, 1);
      const line = report.lines[0];
      close(line.total, 144, "material issued");
      close(line.perUnit, 14.4, "144 / 10");
      close(report.totals.total, 144, "period total");
      await assert.rejects(() => run("analyst", (c, x) => getProductionCostReport(c, x, { from: today, to: yesterday })), (e) => e.code === "MFG_DATE_INVALID");
    });

    await t.test("F185: variance = actual - standard, split into material price and usage; negative is favourable", async () => {
      const v = await run("analyst", (c, x) => getVarianceReport(c, x, { from: yesterday, to: today }));
      const line = v.lines[0];
      close(line.standard, 100, "standard material for the 10 made");
      close(line.actual, 144, "actual");
      close(line.variance, 44, "total variance");
      close(line.materialUsage, 20, "24 issued vs 20 standard, at the standard price 5");
      close(line.materialPrice, 24, "144 paid vs 24 x 5");
      close(Number(line.materialUsage) + Number(line.materialPrice), Number(line.variance), "the parts explain the whole");
      assert.equal(line.variancePercent, 44);
      await assert.rejects(() => run("viewer", (c, x) => getVarianceReport(c, x, {})), forbidden);
    });

    await t.test("F192: the dashboard counts open work by state, lateness, holds and WIP (cost only with permission)", async () => {
      const d = await run("analyst", (c, x) => getProductionDashboard(c, x));
      assert.equal(d.orders.released, 1);
      assert.equal(d.orders.inProgress, 1);
      assert.equal(d.orders.onHold, 1);
      assert.equal(d.orders.late, 1, "only the released order is past its due date");
      assert.equal(d.orders.completedLast30Days, 1);
      close(d.wipValue, 10 + (100 + 50 + 20 - 30), "held order's 10 plus the running order's 140");
      assert.deepEqual(d.attention.map((a) => a.work_order_number).sort(), ["WO-HOLD", "WO-LATE"]);
      const plain = await run("viewer", (c, x) => getProductionDashboard(c, x));
      assert.equal(plain.wipValue, null, "no WIP value without costing.view");
      assert.equal(plain.orders.onHold, 1, "counts are not cost data");
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_downtime_events", "manufacturing_scrap_records", "manufacturing_work_order_operations", "manufacturing_work_order_materials", "manufacturing_work_orders", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_routing_operations", "manufacturing_routings", "manufacturing_work_centers", "manufacturing_shifts", "manufacturing_calendars", "manufacturing_events", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

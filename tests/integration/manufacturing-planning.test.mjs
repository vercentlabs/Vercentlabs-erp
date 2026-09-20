// Real PostgreSQL integration test -- MRP (multi-level netting against stock, open orders, sales demand
// and safety stock), conversion to production orders, material availability, finite-capacity scheduling.
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
  planner: ["manufacturing.view", "manufacturing.planning.run", "manufacturing.work_order.manage", "manufacturing.work_order.release", "manufacturing.settings.manage", "manufacturing.routing.manage"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing planning against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, runMrp, listMrpRuns, getMrpRun, createOrdersFromMrp, getMaterialAvailability, scheduleProductionOrders, createProductionOrder, updateManufacturingSettings, saveCalendar, addShift, saveWorkCenter } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), top: randomUUID(), sub: randomUUID(), buy: randomUUID(), raw: randomUUID(), safe: randomUUID(), wh: randomUUID(), bomTop: randomUUID(), bomSub: randomUUID(), wc: randomUUID(), routing: randomUUID() };
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
  const num = (v) => Number(v);
  const req = (detail, code) => detail.requirements.find((r) => r.item_code === code);

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `pl-${role}-${id}@test.invalid`, `Pl ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Pl Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `pl-org-${orgId}`, users.planner]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Pl Co','Pl Co Pvt Ltd','PLCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    for (const [id, code] of [[ids.top, "TOP"], [ids.sub, "SUB"], [ids.buy, "BUY"], [ids.raw, "RAW"], [ids.safe, "SAFE"]]) await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'PW','PW','active')`, [ids.wh, orgId, companyId]);
    const bom = async (id, itemId, code, comps) => {
      await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,is_default,output_quantity,created_by) VALUES ($1,$2,$3,$4,$5,1,'active',true,1,$6)`, [id, orgId, companyId, itemId, code, users.planner]);
      for (const [n, [comp, qty]] of comps.entries()) await admin.query(`INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,scrap_percent,issue_method) VALUES ($1,$2,$3,$4,$5,0,'manual')`, [orgId, id, n + 1, comp, qty]);
    };
    await bom(ids.bomTop, ids.top, "B-TOP", [[ids.sub, 2], [ids.buy, 1]]);
    await bom(ids.bomSub, ids.sub, "B-SUB", [[ids.raw, 3]]);
    const stock = (item, qty) => admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,$5,0,1)`, [orgId, companyId, item, ids.wh, qty]);
    await stock(ids.buy, 3);
    await stock(ids.raw, 10);
    await run("planner", (c, x) => updateManufacturingSettings(c, x, { defaultWipWarehouseId: ids.wh, defaultFinishedGoodsWarehouseId: ids.wh }));

    // demand: an open production order for 10 TOP needs 20 SUB and 10 BUY; a confirmed sales order wants 5 TOP
    await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.top, quantity: 10, materialWarehouseId: ids.wh, plannedStartAt: new Date(Date.now() + 10 * 86400000).toISOString() }));
    const party = randomUUID();
    await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,code,party_type,display_name) VALUES ($1,$2,'C1','customer','Cust')`, [party, orgId]);
    const so = randomUUID();
    const version = randomUUID();
    await admin.query(`INSERT INTO tenant.sales_orders(id,organization_id,company_id,sales_order_number,party_id,owner_user_id,lifecycle_status) VALUES ($1,$2,$3,'SO-P1',$4,$5,'confirmed')`, [so, orgId, companyId, party, users.planner]);
    await admin.query(`INSERT INTO tenant.sales_order_versions(id,organization_id,sales_order_id,version_number,currency_code,base_currency_code,content_hash) VALUES ($1,$2,$3,1,'INR','INR','h')`, [version, orgId, so]);
    await admin.query(`UPDATE tenant.sales_orders SET current_version_id=$2 WHERE id=$1`, [so, version]);
    await admin.query(`INSERT INTO tenant.sales_order_lines(organization_id,sales_order_version_id,sequence,item_id,uom_id,item_code_snapshot,item_name_snapshot,uom_snapshot,quantity,base_quantity) VALUES ($1,$2,1,$3,$4,'TOP','Item TOP','EA',5,5)`, [orgId, version, ids.top, ids.uom]);
    // safety stock: keep 4 SAFE on hand, have none
    await admin.query(`INSERT INTO tenant.stock_reorder_rules(organization_id,company_id,item_id,warehouse_id,minimum_quantity,reorder_quantity,safety_quantity,active) VALUES ($1,$2,$3,$4,3,10,1,true)`, [orgId, companyId, ids.safe, ids.wh]);

    let runId;
    await t.test("F159/F160: MRP nets demand against stock level by level, explodes manufactured items into dependent demand and keeps safety stock", async () => {
      await assert.rejects(() => run("viewer", (c, x) => runMrp(c, x, { horizonDays: 60 })), forbidden);
      const result = await run("planner", (c, x) => runMrp(c, x, { horizonDays: 60, note: "test run" }));
      runId = result.id;
      assert.match(result.run_number, /^MRP-/);
      const detail = await run("viewer", (c, x) => getMrpRun(c, x, runId));
      // TOP: 10 from the order's own... the order produces 10 (receipt), the sales order wants 5 -> covered by the order's output
      const top = req(detail, "TOP");
      assert.equal(num(top.gross), 5);
      assert.equal(num(top.supply), 10, "the open order's output counts as supply");
      assert.equal(num(top.net), 0);
      assert.equal(top.recommended_action, "none");
      // BUY: order needs 10, stock 3 -> buy 7
      const buy = req(detail, "BUY");
      assert.equal(num(buy.gross), 10);
      assert.equal(num(buy.usable_stock), 3);
      assert.equal(num(buy.net), 7);
      assert.equal(buy.recommended_action, "purchase");
      // SUB: order needs 20, none in stock -> manufacture 20, which needs 60 RAW; stock 10 -> buy 50
      const sub = req(detail, "SUB");
      assert.equal(num(sub.net), 20);
      assert.equal(sub.recommended_action, "manufacture");
      assert.ok(sub.level > top.level, "a component is planned after what uses it");
      const raw = req(detail, "RAW");
      assert.equal(num(raw.gross), 60, "dependent demand from the planned SUB");
      assert.equal(num(raw.net), 50);
      assert.equal(raw.recommended_action, "purchase");
      assert.ok(raw.pegging.some((p) => p.type === "mrp_planned_order"), "pegged to the planned order that needs it");
      // SAFE: no demand at all, but the reorder minimum + safety is 4
      const safe = req(detail, "SAFE");
      assert.equal(num(safe.net), 4);
      assert.equal(num(safe.safety_shortfall), 4);
      assert.equal(result.summary.manufacture, 1);
      assert.equal((await run("viewer", (c, x) => listMrpRuns(c, x))).length, 1);
    });

    await t.test("F158: planned orders become real production orders once, for the net quantity; purchases are not converted", async () => {
      await assert.rejects(() => run("viewer", (c, x) => createOrdersFromMrp(c, x, runId)), forbidden);
      const made = await run("planner", (c, x) => createOrdersFromMrp(c, x, runId));
      assert.equal(made.created.length, 1);
      assert.equal(made.created[0].itemCode, "SUB");
      const detail = await run("viewer", (c, x) => getMrpRun(c, x, runId));
      assert.equal(req(detail, "SUB").converted_order_number, made.created[0].orderNumber);
      assert.equal(req(detail, "BUY").converted_order_id, null);
      await assert.rejects(() => run("planner", (c, x) => createOrdersFromMrp(c, x, runId)), (e) => e.code === "MFG_NOTHING_TO_CONVERT");
      const order = (await admin.query(`SELECT quantity_planned,status,source_type FROM tenant.manufacturing_work_orders WHERE id=$1`, [made.created[0].orderId])).rows[0];
      assert.equal(num(order.quantity_planned), 20);
      assert.equal(order.status, "planned");
      // re-running MRP now counts the new order's output as supply, so SUB is no longer short
      const rerun = await run("planner", (c, x) => runMrp(c, x, { horizonDays: 60 }));
      assert.equal(num(req(await run("viewer", (c, x) => getMrpRun(c, x, rerun.id)), "SUB").net), 0, "supply now covers the demand");
    });

    await t.test("F161: material availability shows what can be made now, what is short and how much stock alone could make", async () => {
      const availability = await run("viewer", (c, x) => getMaterialAvailability(c, x, { itemId: ids.top, quantity: 10 }));
      assert.equal(availability.canMakeNow, false);
      const raw = availability.lines.find((l) => l.itemCode === "RAW");
      assert.equal(num(raw.requiredQuantity), 60, "10 TOP = 20 SUB = 60 RAW");
      assert.equal(raw.status, "short");
      assert.equal(num(raw.shortageNow), 50);
      const buy = availability.lines.find((l) => l.itemCode === "BUY");
      assert.equal(num(buy.freeQuantity), 3);
      assert.equal(availability.makeableFromStock, 1, "stock alone makes one TOP: 10 RAW / 6 per TOP = 1 (BUY would allow 3)");
    });

    await t.test("F168: scheduling pours operations into capacity day by day, respects sequence and closures, flags late and unschedulable orders", async () => {
      const cal = await run("planner", (c, x) => saveCalendar(c, x, { code: "std", name: "Std", workingWeekdays: [0, 1, 2, 3, 4, 5, 6] }));
      await run("planner", (c, x) => addShift(c, x, { calendarId: cal.id, name: "Day", startTime: "08:00", endTime: "12:00" })); // 240 min/day
      const wc = await run("planner", (c, x) => saveWorkCenter(c, x, { code: "SWC", name: "Sched", calendarId: cal.id }));
      const idle = await run("planner", (c, x) => saveWorkCenter(c, x, { code: "NOCAL", name: "No calendar" }));
      const mk = async (number, priority, minutesA, minutesB, center2 = wc.id) => {
        const id = randomUUID();
        await admin.query(`INSERT INTO tenant.manufacturing_work_orders(id,organization_id,company_id,work_order_number,item_id,bom_id,quantity_planned,status,priority,planned_start_at,planned_end_at,wip_warehouse_id,finished_goods_warehouse_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,1,'planned',$7,'2040-03-01T08:00:00Z','2040-03-01T17:00:00Z',$8,$8,$9)`, [id, orgId, companyId, number, ids.top, ids.bomTop, priority, ids.wh, users.planner]);
        await admin.query(`INSERT INTO tenant.manufacturing_work_order_operations(organization_id,work_order_id,sequence,name,work_center_id,status,planned_minutes) VALUES ($1,$2,10,'A',$3,'ready',$4),($1,$2,20,'B',$5,'pending',$6)`, [orgId, id, wc.id, minutesA, center2, minutesB]);
        return id;
      };
      const urgent = await mk("WO-S1", "urgent", 300, 100); // 300 min = 2 days (240 + 60), then B fits the rest of day 2
      const normal = await mk("WO-S2", "normal", 200, 50); // queues behind: day 2 has 180 left -> spills into day 3
      const stuck = await mk("WO-S3", "low", 60, 30, idle.id);
      await assert.rejects(() => run("viewer", (c, x) => scheduleProductionOrders(c, x, { from: "2040-03-01" })), forbidden);
      const preview = await run("planner", (c, x) => scheduleProductionOrders(c, x, { from: "2040-03-01", orderIds: [urgent, normal, stuck] }));
      assert.equal(preview.applied, false);
      const s1 = preview.orders.find((o) => o.orderNumber === "WO-S1");
      const s2 = preview.orders.find((o) => o.orderNumber === "WO-S2");
      const s3 = preview.orders.find((o) => o.orderNumber === "WO-S3");
      assert.deepEqual([s1.operations[0].start, s1.operations[0].end], ["2040-03-01", "2040-03-02"], "300 minutes over two 240-minute days");
      assert.equal(s1.operations[1].start, "2040-03-02", "the next operation starts when the previous ends");
      assert.equal(preview.orders[0].orderNumber, "WO-S1", "urgent first");
      assert.ok(s2.operations[0].start >= "2040-03-02", "the normal order queues behind the urgent one's load");
      assert.ok(s2.end >= s1.end);
      assert.match(s3.blocked, /no capacity/i, "an operation on a center without a calendar cannot be scheduled");
      assert.equal(preview.blockedOrders, 1);
      assert.equal((await admin.query(`SELECT scheduled_start FROM tenant.manufacturing_work_order_operations WHERE work_order_id=$1 AND sequence=10`, [urgent])).rows[0].scheduled_start, null, "a preview writes nothing");
      const applied = await run("planner", (c, x) => scheduleProductionOrders(c, x, { from: "2040-03-01", orderIds: [urgent, normal, stuck], apply: true }));
      assert.equal(applied.applied, true);
      const row = (await admin.query(`SELECT scheduled_start::text AS s,scheduled_end::text AS e FROM tenant.manufacturing_work_order_operations WHERE work_order_id=$1 AND sequence=10`, [urgent])).rows[0];
      assert.deepEqual([row.s, row.e], ["2040-03-01", "2040-03-02"]);
      const wo = (await admin.query(`SELECT planned_start_at,due_date::text AS due FROM tenant.manufacturing_work_orders WHERE id=$1`, [urgent])).rows[0];
      assert.equal(wo.due, "2040-03-01", "the original date is kept as the due date");
      assert.equal((await admin.query(`SELECT scheduled_start FROM tenant.manufacturing_work_order_operations WHERE work_order_id=$1 AND sequence=10`, [stuck])).rows[0].scheduled_start, null, "a blocked order is left alone");
      assert.ok(applied.lateOrders >= 1, "finishing after the due date is flagged");
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_material_requirements", "manufacturing_planning_runs", "manufacturing_work_order_operations", "manufacturing_work_order_materials", "manufacturing_work_orders", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_shifts", "manufacturing_calendars", "manufacturing_work_centers", "manufacturing_settings", "manufacturing_events", "stock_reorder_rules", "sales_order_lines", "sales_orders", "sales_order_versions", "business_parties", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

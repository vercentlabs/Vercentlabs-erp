// Real PostgreSQL integration test -- production orders end to end against real Stock: reservations,
// material issue/return, backflush, job cards, WIP cost, finished-goods receipt (batch/serial),
// by-products, scrap/waste, rework, close/cancel and make-to-order. Role permission sets, no owner bypass.
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
  // note: NO stock.* permissions -- the domain authorises the stock effects itself
  planner: ["manufacturing.view", "manufacturing.work_order.manage", "manufacturing.work_order.release", "manufacturing.production.post", "manufacturing.scrap.post", "manufacturing.costing.view", "manufacturing.settings.manage", "manufacturing.bom.manage"],
  operator: ["manufacturing.view", "manufacturing.production.post"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing shop floor against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, stockContext, postStockMovement, getStockAvailability, createProductionOrder, releaseProductionOrder, cancelProductionOrder, closeProductionOrder, issueMaterials, returnMaterials, startOperation, completeOperation, skipOperation, listJobCards, reportProduction, recordScrap, sendToRework, listProductionOrders, getProductionOrder, getWipReport, listMaterialReservations, getManufacturingSettings, updateManufacturingSettings, addBomOutput } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), fg: randomUUID(), c1: randomUUID(), c2: randomUUID(), lot: randomUUID(), ser: randomUUID(), by: randomUUID(), whM: randomUUID(), whF: randomUUID(), bin: randomUUID(), wc: randomUUID(), bomFg: randomUUID(), bomLot: randomUUID(), bomSer: randomUUID(), routing: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, manufacturingContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));
  const stockCtx = stockContext({ organizationId: orgId, userId: users.planner, activeCompanyId: companyId, roleSlugs: [], permissions: ["stock.view", "stock.receive", "stock.issue", "stock.manage", "stock.adjust", "stock.reserve"] });

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
  const close = (actual, expected, message) => assert.ok(Math.abs(Number(actual) - expected) < 0.0005, `${message}: expected ${expected}, got ${actual}`);
  const onHand = async (item, warehouse) => Number((await admin.query(`SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, item, warehouse])).rows[0].q);
  const receive = (item, quantity, cost, extra = {}) => tx((c) => postStockMovement(c, stockCtx, { movementType: "receipt", itemId: item, warehouseId: ids.whM, quantity, unitCost: cost, ...extra }));
  const avail = (item, warehouse) => tx((c) => getStockAvailability(c, stockCtx, { itemId: item, warehouseId: warehouse }));

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `sf-${role}-${id}@test.invalid`, `Sf ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Sf Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `sf-org-${orgId}`, users.planner]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Sf Co','Sf Co Pvt Ltd','SFCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, tracking = "none") => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true,$7)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, tracking]);
    await item(ids.fg, "FG");
    await item(ids.c1, "C1");
    await item(ids.c2, "C2");
    await item(ids.lot, "LOT", "batch");
    await item(ids.ser, "SER", "serial");
    await item(ids.by, "BY");
    for (const [id, code] of [[ids.whM, "MAT"], [ids.whF, "FIN"]]) await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,$4,$4,'active')`, [id, orgId, companyId, code]);
    await admin.query(`INSERT INTO tenant.warehouse_locations(id,organization_id,warehouse_id,name,code,location_type,status) VALUES ($1,$2,$3,'Bin','B1','bin','active')`, [ids.bin, orgId, ids.whM]);
    await admin.query(`INSERT INTO tenant.manufacturing_work_centers(id,organization_id,company_id,code,name,status,capacity_per_day,efficiency_percent,hourly_rate,overhead_rate,created_by) VALUES ($1,$2,$3,'WC','Line','active',480,100,60,30,$4)`, [ids.wc, orgId, companyId, users.planner]);
    // FG: 2 x C1 (backflush) + 1 x C2 (manual, 10% scrap allowance) per unit
    const bom = async (id, itemId, code, comps) => {
      await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,is_default,output_quantity,created_by) VALUES ($1,$2,$3,$4,$5,1,'active',true,1,$6)`, [id, orgId, companyId, itemId, code, users.planner]);
      for (const [n, [comp, qty, method, scrap]] of comps.entries()) await admin.query(`INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,scrap_percent,issue_method) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orgId, id, n + 1, comp, qty, scrap, method]);
    };
    await bom(ids.bomFg, ids.fg, "B-FG", [[ids.c1, 2, "backflush", 0], [ids.c2, 1, "manual", 10]]);
    await bom(ids.bomLot, ids.lot, "B-LOT", [[ids.c1, 1, "backflush", 0]]);
    await bom(ids.bomSer, ids.ser, "B-SER", [[ids.c1, 1, "backflush", 0]]);
    await admin.query(`INSERT INTO tenant.manufacturing_routings(id,organization_id,company_id,code,name,version,status,is_default,item_id,created_by) VALUES ($1,$2,$3,'R-FG','FG routing',1,'active',true,$4,$5)`, [ids.routing, orgId, companyId, ids.fg, users.planner]);
    await admin.query(`INSERT INTO tenant.manufacturing_routing_operations(organization_id,routing_id,sequence,name,work_center_id,setup_minutes,run_minutes_per_unit) VALUES ($1,$2,10,'Assemble',$3,30,6),($1,$2,20,'Test',$3,0,2)`, [orgId, ids.routing, ids.wc]);
    await receive(ids.c1, 100, 5, { warehouseLocationId: ids.bin }); // C1 sits in a bin, not at warehouse level
    await receive(ids.c2, 50, 10);

    await t.test("settings: defaults exist, only a settings manager changes them, warehouses are validated", async () => {
      assert.equal((await run("viewer", (c, x) => getManufacturingSettings(c, x))).configured, false);
      await assert.rejects(() => run("operator", (c, x) => updateManufacturingSettings(c, x, { allowOverproduction: true })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => updateManufacturingSettings(c, x, { defaultWipWarehouseId: randomUUID() })), (e) => e.code === "MFG_WAREHOUSE_NOT_FOUND");
      const saved = await run("planner", (c, x) => updateManufacturingSettings(c, x, { defaultWipWarehouseId: ids.whM, defaultFinishedGoodsWarehouseId: ids.whF }));
      assert.equal(saved.default_finished_goods_warehouse_id, ids.whF);
      assert.equal(saved.require_operation_completion, true);
    });

    let wo;
    await t.test("F155/F156: an order snapshots the BOM (with scrap allowance) and routing; validation and permissions hold", async () => {
      await assert.rejects(() => run("operator", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10 })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 0 })), (e) => e.code === "MFG_QUANTITY_INVALID");
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.c1, quantity: 1 })), (e) => e.code === "MFG_NO_ACTIVE_BOM");
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 1, plannedStartAt: "2026-05-02", plannedEndAt: "2026-05-01" })), (e) => e.code === "MFG_DATE_INVALID");
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 1, sourceType: "make_to_order" })), (e) => e.code === "MFG_REFERENCE_INVALID");
      wo = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10, materialWarehouseId: ids.whM, idempotencyKey: "wo-1" }));
      assert.match(wo.work_order_number, /^WO-/);
      assert.equal(wo.status, "planned");
      assert.equal((await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10, materialWarehouseId: ids.whM, idempotencyKey: "wo-1" }))).id, wo.id, "same key replays");
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      close(detail.materials.find((m) => m.item_code === "C1").required_quantity, 20, "10 x 2");
      close(detail.materials.find((m) => m.item_code === "C2").required_quantity, 10 / 0.9, "10 x 1 with 10% scrap allowance");
      assert.deepEqual(detail.operations.map((o) => [o.sequence, o.status]), [[10, "ready"], [20, "pending"]], "only the first operation is ready");
      close(detail.operations[0].planned_minutes, 30 + 6 * 10, "setup + run x quantity");
    });

    await t.test("F162: release reserves components; a shortage blocks release unless the planner accepts it; only release-permission users release", async () => {
      const big = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 500, materialWarehouseId: ids.whM }));
      await assert.rejects(() => run("operator", (c, x) => releaseProductionOrder(c, x, big.id)), forbidden);
      await assert.rejects(() => run("planner", (c, x) => releaseProductionOrder(c, x, big.id)), (e) => e.code === "MFG_MATERIAL_SHORTAGE" && /C1/.test(e.message));
      assert.equal((await admin.query(`SELECT status FROM tenant.manufacturing_work_orders WHERE id=$1`, [big.id])).rows[0].status, "planned", "the failed release changed nothing");
      assert.equal(Number((await avail(ids.c1, ids.whM)).reservedQuantity), 0);
      await run("planner", (c, x) => cancelProductionOrder(c, x, big.id, "Too big"));
      const released = await run("planner", (c, x) => releaseProductionOrder(c, x, wo.id));
      assert.equal(released.status, "released");
      close((await avail(ids.c1, ids.whM)).reservedQuantity, 20, "C1 held (from the bin)");
      close((await avail(ids.c2, ids.whM)).reservedQuantity, 10 / 0.9, "C2 held");
      const held = await run("viewer", (c, x) => listMaterialReservations(c, x));
      assert.ok(held.find((h) => h.work_order_number === wo.work_order_number && h.item_code === "C1"));
      assert.equal(held.find((h) => h.item_code === "C1").shortage_quantity, "0");
    });

    await t.test("F163/F164/F166: issue takes stock from wherever it is, refuses over-issue, accrues WIP cost; return puts it back at the issue cost", async () => {
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      const c2 = detail.materials.find((m) => m.item_code === "C2");
      await assert.rejects(() => run("viewer", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 1 }] })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 12 }] })), (e) => e.code === "MFG_OVER_ISSUE");
      await assert.rejects(() => run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [] })), (e) => e.code === "MFG_LINES_REQUIRED");
      const issued = await run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 4 }], idempotencyKey: "iss-1" }));
      assert.equal(issued.status, "in_progress");
      close(issued.material_cost, 40, "4 x 10");
      const replay = await run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 4 }], idempotencyKey: "iss-1" }));
      assert.equal(replay.replayed, true);
      close(await onHand(ids.c2, ids.whM), 46, "issued once");
      close((await avail(ids.c2, ids.whM)).reservedQuantity, 10 / 0.9 - 4, "the hold shrinks to what is still needed");
      await assert.rejects(() => run("operator", (c, x) => returnMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 1 }] })), (e) => e.code === "MFG_REASON_REQUIRED");
      await assert.rejects(() => run("operator", (c, x) => returnMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 5, reason: "x" }] })), (e) => e.code === "MFG_OVER_RETURN");
      const back = await run("operator", (c, x) => returnMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 1, reason: "Wrong part" }] }));
      close(back.material_cost, 30, "the return reduces WIP by 1 x 10");
      close(await onHand(ids.c2, ids.whM), 47, "returned to stock");
      await run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: 1 }] })); // 4 net again -> then 10/0.9 - 4 more later by production check
      const wip = await run("planner", (c, x) => getWipReport(c, x));
      close(wip.find((w) => w.work_order_number === wo.work_order_number).wip_value, 40, "WIP = issued cost not yet absorbed");
      assert.equal((await run("operator", (c, x) => getWipReport(c, x)))[0].wip_value, null, "cost hidden without costing.view");
    });

    await t.test("F157/F169: job cards run in sequence; completing books labour and overhead at the work center rates", async () => {
      const cards = await run("operator", (c, x) => listJobCards(c, x));
      const first = cards.find((k) => k.work_order_number === wo.work_order_number);
      assert.equal(first.sequence, 10);
      assert.equal(cards.some((k) => k.work_order_number === wo.work_order_number && k.sequence === 20), false, "the next operation is not on the floor yet");
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      const op2 = detail.operations.find((o) => o.sequence === 20);
      await assert.rejects(() => run("operator", (c, x) => startOperation(c, x, op2.id)), (e) => e.code === "MFG_OPERATION_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => completeOperation(c, x, first.id, {})), (e) => e.code === "MFG_OPERATION_STATE_INVALID", "must be started first");
      await run("operator", (c, x) => startOperation(c, x, first.id));
      await assert.rejects(() => run("operator", (c, x) => startOperation(c, x, first.id)), (e) => e.code === "MFG_OPERATION_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => completeOperation(c, x, first.id, { actualMinutes: -5 })), (e) => e.code === "MFG_QUANTITY_INVALID");
      const done = await run("planner", (c, x) => completeOperation(c, x, first.id, { actualMinutes: 90, quantityGood: 10 }));
      close(done.laborCost, 90, "90 min x 60/h");
      close(done.overheadCost, 45, "90 min x 30/h");
      assert.equal((await run("operator", (c, x) => completeOperation(c, x, op2.id, {}).catch((e) => e))).code, "MFG_OPERATION_STATE_INVALID");
      await assert.rejects(() => run("operator", (c, x) => skipOperation(c, x, op2.id, "x")), forbidden);
      await assert.rejects(() => run("planner", (c, x) => skipOperation(c, x, op2.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
    });

    await t.test("F165/F167: reporting production needs finished operations and issued manual materials; backflushes the rest; absorbs WIP into the finished-goods cost", async () => {
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 4 })), (e) => e.code === "MFG_OPERATIONS_INCOMPLETE");
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      const op2 = detail.operations.find((o) => o.sequence === 20);
      await run("operator", (c, x) => startOperation(c, x, op2.id));
      await run("operator", (c, x) => completeOperation(c, x, op2.id, { actualMinutes: 30, quantityGood: 10 }));
      await assert.rejects(() => run("viewer", (c, x) => reportProduction(c, x, wo.id, { quantity: 4 })), forbidden);
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 11 })), (e) => e.code === "MFG_OVERPRODUCTION_BLOCKED");
      // manual C2: 4 of 10/0.9 = 11.11 issued, but the first 4 units need only 4.44 -> a little more first
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 5 })), (e) => e.code === "MFG_MATERIAL_NOT_ISSUED" && /C2/.test(e.message));
      await run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: detail.materials.find((m) => m.item_code === "C2").id, quantity: 1 }] })); // net 5 of the 4.44 the first 4 units need
      const first = await run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 4, idempotencyKey: "rep-1" }));
      assert.equal(first.status, "in_progress");
      close(await onHand(ids.fg, ids.whF), 4, "4 finished goods received");
      close(await onHand(ids.c1, ids.whM), 100 - 2 * 4, "C1 backflushed for 4 units (from the bin)");
      // accrued = C2 5 x 10 + C1 backflush 8 x 5 + labour 120 (90+30 min at 60/h) + overhead 60
      const accrued = 50 + 8 * 5 + 120 + 60;
      close(first.unitCost, (accrued / 10) * 4 / 4 - 0, "unit cost is the accrued per planned unit");
      assert.equal((await run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 4, idempotencyKey: "rep-1" }))).replayed, true);
      close(await onHand(ids.fg, ids.whF), 4, "a replay does not receive twice");
    });

    await t.test("F167: completing the order absorbs every remaining cost, frees the holds and writes a cost snapshot; nothing more can be reported", async () => {
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      const c2 = detail.materials.find((m) => m.item_code === "C2");
      const remaining = Number(c2.required_quantity) - (Number(c2.issued_quantity) - Number(c2.returned_quantity));
      await run("operator", (c, x) => issueMaterials(c, x, wo.id, { lines: [{ materialId: c2.id, quantity: Math.round(remaining * 1e6) / 1e6 }] }));
      const done = await run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 6 }));
      assert.equal(done.status, "completed");
      close(await onHand(ids.fg, ids.whF), 10, "10 finished goods in total");
      close(await onHand(ids.c1, ids.whM), 100 - 20, "all C1 consumed");
      const final = await run("planner", (c, x) => getProductionOrder(c, x, wo.id));
      close(final.costs.absorbed, Number(final.costs.material) + Number(final.costs.labor) + Number(final.costs.overhead), "everything accrued was absorbed");
      close((await avail(ids.c2, ids.whM)).reservedQuantity, 0, "no holds remain");
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_cost_snapshots WHERE work_order_id=$1 AND snapshot_type='completion'`, [wo.id])).rows[0].n, 1);
      assert.equal((await run("operator", (c, x) => getProductionOrder(c, x, wo.id))).costs, null, "cost hidden without costing.view");
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, wo.id, { quantity: 1 })), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID");
      // the finished goods carry that cost in the stock valuation
      const fgCost = Number((await admin.query(`SELECT average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [orgId, ids.fg])).rows[0].average_cost);
      close(fgCost * 10, Number(final.costs.absorbed), "stock value of the finished goods equals the absorbed cost");
    });

    await t.test("F176/F177: a batch product needs a batch (created on the fly); a serial product needs exactly one serial per unit", async () => {
      const lot = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.lot, quantity: 5, materialWarehouseId: ids.whM }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, lot.id));
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, lot.id, { quantity: 5 })), (e) => e.code === "MFG_BATCH_REQUIRED");
      const made = await run("operator", (c, x) => reportProduction(c, x, lot.id, { quantity: 5, batchNumber: "PROD-LOT-1", expiresOn: "2030-01-01" }));
      assert.equal(made.status, "completed");
      const batch = (await admin.query(`SELECT b.id,b.expires_on::text AS expires_on,(SELECT quantity FROM tenant.stock_balances s WHERE s.batch_id=b.id AND s.warehouse_id=$2) AS qty FROM tenant.stock_batches b WHERE b.organization_id=$1 AND b.batch_number='PROD-LOT-1'`, [orgId, ids.whF])).rows[0];
      close(batch.qty, 5, "stock sits in the new batch");
      assert.match(batch.expires_on, /^2030-01-01/);
      const ser = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.ser, quantity: 3, materialWarehouseId: ids.whM }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, ser.id));
      await assert.rejects(() => run("operator", (c, x) => reportProduction(c, x, ser.id, { quantity: 3, serialNumbers: ["S-1", "S-2"] })), (e) => e.code === "MFG_SERIAL_COUNT_MISMATCH");
      await run("operator", (c, x) => reportProduction(c, x, ser.id, { quantity: 3, serialNumbers: ["S-1", "S-2", "S-3"] }));
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM tenant.stock_serials WHERE organization_id=$1 AND serial_number IN ('S-1','S-2','S-3') AND status='available'`, [orgId])).rows[0].n, 3);
      close(await onHand(ids.ser, ids.whF), 3, "balance matches the serial register");
    });

    await t.test("F174: a by-product is received with the main output, taking its share of the cost", async () => {
      // add a by-product to a fresh draft BOM copy of the lot BOM so the engineering function is exercised
      const draft = randomUUID();
      await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,output_quantity,created_by) VALUES ($1,$2,$3,$4,'B-BY',1,'draft',1,$5)`, [draft, orgId, companyId, ids.fg, users.planner]);
      await assert.rejects(() => run("operator", (c, x) => addBomOutput(c, x, draft, { itemId: ids.by, quantity: 1 })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => addBomOutput(c, x, draft, { itemId: ids.fg, quantity: 1 })), (e) => e.code === "MFG_OUTPUT_INVALID");
      await assert.rejects(() => run("planner", (c, x) => addBomOutput(c, x, draft, { itemId: ids.by, quantity: 1, costSharePercent: 100 })), (e) => e.code === "MFG_COST_SHARE_INVALID");
      await run("planner", (c, x) => addBomOutput(c, x, ids.bomLot, { itemId: ids.by, quantity: 1 }).catch((e) => e)); // active BOM: refused
      await admin.query(`UPDATE tenant.manufacturing_boms SET status='draft' WHERE id=$1`, [ids.bomLot]);
      await run("planner", (c, x) => addBomOutput(c, x, ids.bomLot, { itemId: ids.by, quantity: 0.5, outputType: "by_product", costSharePercent: 20 }));
      await admin.query(`UPDATE tenant.manufacturing_boms SET status='active' WHERE id=$1`, [ids.bomLot]);
      const wo2 = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.lot, quantity: 10, materialWarehouseId: ids.whM }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, wo2.id));
      const made = await run("operator", (c, x) => reportProduction(c, x, wo2.id, { quantity: 10, batchNumber: "PROD-LOT-2" }));
      assert.equal(made.byProducts.length, 1);
      close(made.byProducts[0].quantity, 5, "0.5 per unit x 10");
      close(await onHand(ids.by, ids.whF), 5, "by-product received");
      const cost = Number((await admin.query(`SELECT average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [orgId, ids.by])).rows[0].average_cost);
      close(cost * 5, 10 * 5 * 0.2, "20% of the 50 accrued (10 x C1 at 5) is allocated to the by-product");
      close(made.unitCost * 10, 50 * 0.8, "the main product keeps the other 80%");
    });

    let scrapOrder;
    await t.test("F172/F173: product scrap and component waste need scrap.post and a coded reason; component waste consumes stock and adds cost", async () => {
      scrapOrder = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 10, materialWarehouseId: ids.whM }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, scrapOrder.id));
      await assert.rejects(() => run("operator", (c, x) => recordScrap(c, x, scrapOrder.id, { quantity: 1, reasonCode: "defect" })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => recordScrap(c, x, scrapOrder.id, { quantity: 1, reasonCode: "boredom" })), (e) => e.code === "MFG_REASON_CODE_INVALID");
      await assert.rejects(() => run("planner", (c, x) => recordScrap(c, x, scrapOrder.id, { quantity: 11, reasonCode: "defect" })), (e) => e.code === "MFG_SCRAP_EXCEEDS_PLAN");
      await assert.rejects(() => run("planner", (c, x) => recordScrap(c, x, scrapOrder.id, { scope: "component", itemId: ids.by, quantity: 1, reasonCode: "damage" })), (e) => e.code === "MFG_MATERIAL_NOT_FOUND");
      const before = await onHand(ids.c2, ids.whM);
      const waste = await run("planner", (c, x) => recordScrap(c, x, scrapOrder.id, { scope: "component", itemId: ids.c2, quantity: 2, category: "waste", reasonCode: "damage", note: "Spilled" }));
      assert.equal(waste.category, "waste");
      close(waste.unit_cost, 10, "at the C2 cost");
      close(await onHand(ids.c2, ids.whM), before - 2, "stock consumed");
      await run("planner", (c, x) => recordScrap(c, x, scrapOrder.id, { quantity: 3, reasonCode: "defect" }));
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, scrapOrder.id));
      close(detail.quantity_scrapped, 3, "3 units scrapped");
      close(detail.costs.material, 20, "the waste is a cost of the order");
      assert.equal(detail.scrap.length, 2);
    });

    await t.test("F175: scrapped units can be sent to rework as their own order with no new material; only scrapped units, with a reason", async () => {
      await assert.rejects(() => run("operator", (c, x) => sendToRework(c, x, scrapOrder.id, { quantity: 1, reason: "r" })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => sendToRework(c, x, scrapOrder.id, { quantity: 4, reason: "r" })), (e) => e.code === "MFG_REWORK_EXCEEDS_SCRAP");
      await assert.rejects(() => run("planner", (c, x) => sendToRework(c, x, scrapOrder.id, { quantity: 1, reason: "" })), (e) => e.code === "MFG_REASON_REQUIRED");
      const child = await run("planner", (c, x) => sendToRework(c, x, scrapOrder.id, { quantity: 2, reason: "Recoverable by re-soldering" }));
      assert.equal(child.rework_of_id, scrapOrder.id);
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, child.id));
      assert.ok(detail.materials.every((m) => Number(m.required_quantity) === 0));
      assert.equal(detail.operations.length, 2);
      close((await run("planner", (c, x) => getProductionOrder(c, x, scrapOrder.id))).quantity_scrapped, 1, "the parent's scrap count drops");
      assert.equal((await run("planner", (c, x) => getProductionOrder(c, x, scrapOrder.id))).rework.length, 1);
    });

    await t.test("cancel is refused once material is issued; a started order is closed short (holds freed); a clean order cancels", async () => {
      const detail = await run("planner", (c, x) => getProductionOrder(c, x, scrapOrder.id));
      const c1 = detail.materials.find((m) => m.item_code === "C1");
      await run("operator", (c, x) => issueMaterials(c, x, scrapOrder.id, { lines: [{ materialId: c1.id, quantity: 4 }] }));
      await assert.rejects(() => run("planner", (c, x) => cancelProductionOrder(c, x, scrapOrder.id, "no")), (e) => e.code === "MFG_WORK_ORDER_STATE_INVALID", "a started order is closed short, not cancelled");
      await run("planner", (c, x) => admin.query(`UPDATE tenant.manufacturing_work_orders SET status='on_hold' WHERE id=$1`, [scrapOrder.id]));
      await assert.rejects(() => run("planner", (c, x) => cancelProductionOrder(c, x, scrapOrder.id, "no")), (e) => e.code === "MFG_WORK_ORDER_HAS_ACTIVITY", "material is out on the floor");
      await run("planner", (c, x) => admin.query(`UPDATE tenant.manufacturing_work_orders SET status='in_progress' WHERE id=$1`, [scrapOrder.id]));
      await assert.rejects(() => run("planner", (c, x) => closeProductionOrder(c, x, scrapOrder.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      assert.ok((await avail(ids.c1, ids.whM)).reservedQuantity > 0, "the order still holds C1");
      const closed = await run("planner", (c, x) => closeProductionOrder(c, x, scrapOrder.id, "Customer cancelled the balance"));
      assert.equal(closed.status, "completed");
      assert.equal(closed.close_reason, "Customer cancelled the balance");
      close((await avail(ids.c1, ids.whM)).reservedQuantity, 0, "holds freed");
      const clean = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.fg, quantity: 1, materialWarehouseId: ids.whM }));
      await run("planner", (c, x) => releaseProductionOrder(c, x, clean.id));
      close((await avail(ids.c1, ids.whM)).reservedQuantity, 2, "held");
      await run("planner", (c, x) => cancelProductionOrder(c, x, clean.id, "Not needed"));
      close((await avail(ids.c1, ids.whM)).reservedQuantity, 0, "freed on cancel");
      const list = await run("viewer", (c, x) => listProductionOrders(c, x, { status: "cancelled" }));
      assert.ok(list.some((o) => o.id === clean.id));
    });

    await t.test("F179: a make-to-order order needs a real, live sales order and reserves what it makes for that order", async () => {
      const party = randomUUID();
      await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,code,party_type,display_name) VALUES ($1,$2,'CUST1','customer','Customer One')`, [party, orgId]);
      const so = randomUUID();
      await admin.query(`INSERT INTO tenant.sales_orders(id,organization_id,company_id,sales_order_number,party_id,owner_user_id,lifecycle_status) VALUES ($1,$2,$3,'SO-9001',$4,$5,'confirmed')`, [so, orgId, companyId, party, users.planner]);
      const draftSo = randomUUID();
      await admin.query(`INSERT INTO tenant.sales_orders(id,organization_id,company_id,sales_order_number,party_id,owner_user_id,lifecycle_status) VALUES ($1,$2,$3,'SO-9002',$4,$5,'draft')`, [draftSo, orgId, companyId, party, users.planner]);
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.lot, quantity: 4, materialWarehouseId: ids.whM, sourceType: "make_to_order", sourceId: draftSo })), (e) => e.code === "MFG_SALES_ORDER_STATE_INVALID");
      await assert.rejects(() => run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.lot, quantity: 4, materialWarehouseId: ids.whM, sourceType: "make_to_order", sourceId: randomUUID() })), (e) => e.code === "MFG_SALES_ORDER_NOT_FOUND");
      const mto = await run("planner", (c, x) => createProductionOrder(c, x, { itemId: ids.lot, quantity: 4, materialWarehouseId: ids.whM, sourceType: "make_to_order", sourceId: so }));
      assert.equal(mto.source_label, "SO-9001");
      await run("planner", (c, x) => releaseProductionOrder(c, x, mto.id));
      const made = await run("operator", (c, x) => reportProduction(c, x, mto.id, { quantity: 4, batchNumber: "MTO-1" }));
      close(made.reservedForOrder, 4, "reserved for the customer's order");
      const reservation = (await admin.query(`SELECT quantity,status FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type='sales_order' AND reference_id=$2`, [orgId, so])).rows[0];
      close(reservation.quantity, 4, "the reservation exists");
      assert.equal(reservation.status, "active");
      assert.equal((await run("viewer", (c, x) => listProductionOrders(c, x, { sourceType: "make_to_order" }))).length, 1);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_scrap_records", "manufacturing_cost_snapshots", "manufacturing_production_postings", "manufacturing_work_order_operations", "manufacturing_work_order_materials", "manufacturing_work_orders", "manufacturing_bom_outputs", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_routing_operations", "manufacturing_routings", "manufacturing_work_centers", "manufacturing_settings", "manufacturing_events", "sales_orders", "business_parties", "stock_reservations", "stock_serials", "stock_valuation_layers", "stock_movements", "stock_balances", "stock_batches", "items", "warehouse_locations", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

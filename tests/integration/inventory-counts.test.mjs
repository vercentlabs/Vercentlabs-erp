// Real PostgreSQL integration test -- cycle counts and physical inventory: snapshot, count, review,
// segregated approval, variance posting, warehouse freeze. Seeded-role permission sets, no owner bypass.
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
  manager: ["stock.view", "stock.manage", "stock.receive", "stock.issue", "stock.count", "stock.adjust", "stock.valuation.view"],
  counter: ["stock.view", "stock.count"],
  approver: ["stock.view", "stock.adjust"],
  viewer: ["stock.view"],
};

test("Inventory counts against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { stockContext, postStockMovement, createStockCount, addStockCountLine, recordStockCountLines, submitStockCount, rejectStockCount, approveStockCount, cancelStockCount, listStockCounts, getStockCount } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), a: randomUUID(), b: randomUUID(), serial: randomUUID(), wh: randomUUID(), other: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, stockContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));

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
  const balance = async (item) => Number((await admin.query(`SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, item, ids.wh])).rows[0].q);

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `cnt-${role}-${id}@test.invalid`, `Cnt ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Cnt Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `cnt-org-${orgId}`, users.manager]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Cnt Co','Cnt Co Pvt Ltd','CNTCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, tracking) => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true,$7)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, tracking]);
    await item(ids.a, "CA", "none");
    await item(ids.b, "CB", "none");
    await item(ids.serial, "CS", "serial");
    for (const [id, code] of [[ids.wh, "CW1"], [ids.other, "CW2"]]) await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,$4,$4,'active')`, [id, orgId, companyId, code]);
    await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.a, warehouseId: ids.wh, quantity: 10, unitCost: 4 }));
    await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.b, warehouseId: ids.wh, quantity: 6, unitCost: 2 }));
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,3,0,1)`, [orgId, companyId, ids.serial, ids.wh]);

    let count;
    await t.test("F126/F127: scope rules, snapshot (serial items excluded), permissions", async () => {
      await assert.rejects(() => tx((c) => createStockCount(c, ctx.viewer, { countType: "physical", warehouseId: ids.wh })), forbidden);
      await assert.rejects(() => tx((c) => createStockCount(c, ctx.counter, { countType: "cycle", warehouseId: ids.wh })), (e) => e.code === "STOCK_COUNT_SCOPE_REQUIRED");
      await assert.rejects(() => tx((c) => createStockCount(c, ctx.counter, { countType: "weekly", warehouseId: ids.wh })), (e) => e.status === 400);
      count = await tx((c) => createStockCount(c, ctx.counter, { countType: "physical", warehouseId: ids.wh, freezeStock: true, idempotencyKey: "k1" }));
      assert.match(count.count_number, /^PHY-/);
      assert.equal(count.lineCount, 2, "both non-serial balances, not the serial-tracked one");
      const again = await tx((c) => createStockCount(c, ctx.counter, { countType: "physical", warehouseId: ids.wh, idempotencyKey: "k1" }));
      assert.equal(again.id, count.id, "same key replays");
      await assert.rejects(() => tx((c) => createStockCount(c, ctx.counter, { countType: "physical", warehouseId: ids.wh, freezeStock: true, idempotencyKey: "k2" })), (e) => e.code === "STOCK_COUNT_FREEZE_CONFLICT");
    });

    await t.test("freeze: nothing moves in the frozen warehouse; other warehouses are unaffected", async () => {
      await assert.rejects(() => tx((c) => postStockMovement(c, ctx.manager, { movementType: "issue", itemId: ids.a, warehouseId: ids.wh, quantity: 1 })), (e) => e.code === "STOCK_WAREHOUSE_FROZEN");
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.a, warehouseId: ids.other, quantity: 1, unitCost: 1 }));
    });

    await t.test("F127: counting, completeness and reasons are enforced before review", async () => {
      const detail = await tx((c) => getStockCount(c, ctx.counter, count.id));
      const lineA = detail.lines.find((l) => l.item_code === "CA");
      const lineB = detail.lines.find((l) => l.item_code === "CB");
      await assert.rejects(() => tx((c) => submitStockCount(c, ctx.counter, count.id)), (e) => e.code === "STOCK_COUNT_INCOMPLETE");
      await assert.rejects(() => tx((c) => recordStockCountLines(c, ctx.counter, count.id, [{ lineId: lineA.id, countedQuantity: -1 }])), (e) => e.code === "STOCK_QUANTITY_INVALID");
      await tx((c) => recordStockCountLines(c, ctx.counter, count.id, [{ lineId: lineA.id, countedQuantity: 8 }, { lineId: lineB.id, countedQuantity: 6 }]));
      await assert.rejects(() => tx((c) => submitStockCount(c, ctx.counter, count.id)), (e) => e.code === "STOCK_COUNT_REASON_REQUIRED", "A is 2 short with no reason");
      await tx((c) => recordStockCountLines(c, ctx.counter, count.id, [{ lineId: lineA.id, countedQuantity: 8, reason: "Two damaged in aisle 3" }]));
      const found = await tx((c) => addStockCountLine(c, ctx.counter, count.id, { itemId: ids.b, warehouseLocationId: null }).catch((e) => e));
      assert.equal(found.code, "STOCK_COUNT_LINE_DUPLICATE", "an item already on the count cannot be added twice");
      const submitted = await tx((c) => submitStockCount(c, ctx.counter, count.id));
      assert.equal(submitted.status, "review");
      await assert.rejects(() => tx((c) => recordStockCountLines(c, ctx.counter, count.id, [{ lineId: lineA.id, countedQuantity: 9 }])), (e) => e.code === "STOCK_COUNT_STATE_INVALID", "no edits during review");
    });

    await t.test("F128: only a different person with stock.adjust approves; rejection returns it with a reason", async () => {
      await assert.rejects(() => tx((c) => approveStockCount(c, ctx.counter, count.id)), forbidden, "the counter lacks stock.adjust");
      await assert.rejects(() => tx((c) => rejectStockCount(c, ctx.approver, count.id, "")), (e) => e.code === "STOCK_REASON_REQUIRED");
      const sent = await tx((c) => rejectStockCount(c, ctx.approver, count.id, "Recount aisle 3"));
      assert.equal(sent.status, "counting");
      assert.equal(sent.rejection_reason, "Recount aisle 3");
      await tx((c) => submitStockCount(c, ctx.counter, count.id));
      assert.equal(await balance(ids.a), 10, "nothing posted before approval");
    });

    await t.test("approval posts only the variances as adjustments and unfreezes the warehouse", async () => {
      // the manager who also created a count cannot approve it
      const own = await tx((c) => createStockCount(c, ctx.manager, { countType: "cycle", warehouseId: ids.other, itemIds: [ids.a] }));
      const ownLine = (await tx((c) => getStockCount(c, ctx.manager, own.id))).lines[0];
      await tx((c) => recordStockCountLines(c, ctx.manager, own.id, [{ lineId: ownLine.id, countedQuantity: 1 }]));
      await tx((c) => submitStockCount(c, ctx.manager, own.id));
      await assert.rejects(() => tx((c) => approveStockCount(c, ctx.manager, own.id)), (e) => e.code === "STOCK_COUNT_SELF_APPROVAL");
      const done = await tx((c) => approveStockCount(c, ctx.approver, count.id));
      assert.equal(done.status, "posted");
      assert.equal(done.adjustmentsPosted, 1, "only item A differed");
      assert.equal(await balance(ids.a), 8);
      assert.equal(await balance(ids.b), 6);
      const movement = await admin.query(`SELECT quantity,reference_type,reason FROM tenant.stock_movements WHERE organization_id=$1 AND reference_id=$2`, [orgId, count.id]);
      assert.equal(movement.rows.length, 1);
      assert.equal(Number(movement.rows[0].quantity), -2);
      assert.match(movement.rows[0].reason, /Two damaged/);
      await assert.rejects(() => tx((c) => approveStockCount(c, ctx.approver, count.id)), (e) => e.code === "STOCK_COUNT_STATE_INVALID", "posting is once");
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "issue", itemId: ids.a, warehouseId: ids.wh, quantity: 1 }));
    });

    await t.test("blind counts hide the expected quantity until review; found stock adds a zero-system line; cancel needs a reason", async () => {
      const blind = await tx((c) => createStockCount(c, ctx.counter, { countType: "cycle", warehouseId: ids.wh, itemIds: [ids.a, ids.b], blind: true }));
      const during = await tx((c) => getStockCount(c, ctx.counter, blind.id));
      assert.ok(during.lines.every((l) => l.system_quantity === null), "expected quantity hidden while counting");
      const extra = await tx((c) => addStockCountLine(c, ctx.counter, blind.id, { itemId: ids.a, warehouseLocationId: randomUUID() }).catch((e) => e));
      assert.equal(extra.status, 404, "a location outside the counted warehouse is refused");
      await assert.rejects(() => tx((c) => cancelStockCount(c, ctx.counter, blind.id, "")), (e) => e.code === "STOCK_REASON_REQUIRED");
      const cancelled = await tx((c) => cancelStockCount(c, ctx.counter, blind.id, "Scheduled in error"));
      assert.equal(cancelled.status, "cancelled");
      const list = await tx((c) => listStockCounts(c, ctx.viewer, { countType: "physical" }));
      assert.ok(list.some((x) => x.id === count.id && x.status === "posted" && x.variance_lines === 1));
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["stock_count_lines", "stock_counts", "stock_valuation_layers", "stock_movements", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

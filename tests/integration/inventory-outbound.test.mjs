// Real PostgreSQL integration test -- pick, pack, ship. Stock is reserved by the pick list and leaves
// exactly once, on shipment.
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
  manager: ["stock.view", "stock.manage", "stock.receive", "stock.issue", "stock.reserve", "stock.adjust"],
  picker: ["stock.view", "stock.issue"],
  viewer: ["stock.view"],
};

test("Inventory pick, pack, ship against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { stockContext, postStockMovement, createPickList, recordPicks, completePicking, createPackage, completePacking, shipPickList, cancelPickList, listPickLists, getPickList, getStockAvailability } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), a: randomUUID(), b: randomUUID(), serial: randomUUID(), wh: randomUUID() };
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
  const availability = (item) => tx((c) => getStockAvailability(c, ctx.viewer, { itemId: item, warehouseId: ids.wh }));

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `out-${role}-${id}@test.invalid`, `Out ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Out Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `out-org-${orgId}`, users.manager]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Out Co','Out Co Pvt Ltd','OUTCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, tracking) => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true,$7)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, tracking]);
    await item(ids.a, "OA", "none");
    await item(ids.b, "OB", "none");
    await item(ids.serial, "OS", "serial");
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'OW','OW','active')`, [ids.wh, orgId, companyId]);
    await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.a, warehouseId: ids.wh, quantity: 10, unitCost: 3 }));
    await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.b, warehouseId: ids.wh, quantity: 5, unitCost: 3 }));

    let list;
    await t.test("F135: creating a pick list reserves the stock; permissions, serial items and over-asking are refused", async () => {
      const lines = [{ itemId: ids.a, quantity: 6 }, { itemId: ids.b, quantity: 5 }];
      await assert.rejects(() => tx((c) => createPickList(c, ctx.viewer, { warehouseId: ids.wh, lines })), forbidden);
      await assert.rejects(() => tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines: [] })), (e) => e.code === "STOCK_PICK_LINES_REQUIRED");
      await assert.rejects(() => tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines: [{ itemId: ids.serial, quantity: 1 }] })), (e) => e.code === "STOCK_PICK_SERIAL_UNSUPPORTED");
      await assert.rejects(() => tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines: [{ itemId: ids.a, quantity: 50 }] })), (e) => /insufficient/i.test(e.message) || e.status === 409);
      list = await tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, referenceLabel: "SO-1001", lines, idempotencyKey: "pl-1" }));
      assert.match(list.pick_number, /^PCK-/);
      assert.equal((await tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines, idempotencyKey: "pl-1" }))).id, list.id, "same key replays");
      const a = await availability(ids.a);
      assert.equal(Number(a.reservedQuantity), 6);
      assert.equal(Number(a.availableQuantity), 4);
    });

    await t.test("F135: picking records what was found; a short pick needs a reason and frees the difference", async () => {
      const detail = await tx((c) => getPickList(c, ctx.viewer, list.id));
      const lineA = detail.lines.find((l) => l.item_code === "OA");
      const lineB = detail.lines.find((l) => l.item_code === "OB");
      await assert.rejects(() => tx((c) => completePicking(c, ctx.picker, list.id)), (e) => e.code === "STOCK_PICK_INCOMPLETE");
      await assert.rejects(() => tx((c) => recordPicks(c, ctx.picker, list.id, [{ lineId: lineA.id, pickedQuantity: 7 }])), (e) => e.code === "STOCK_PICK_OVER");
      await assert.rejects(() => tx((c) => recordPicks(c, ctx.picker, list.id, [{ lineId: lineA.id, pickedQuantity: 4 }])), (e) => e.code === "STOCK_REASON_REQUIRED");
      await tx((c) => recordPicks(c, ctx.picker, list.id, [{ lineId: lineA.id, pickedQuantity: 4, shortReason: "Two damaged on the shelf" }, { lineId: lineB.id, pickedQuantity: 5 }]));
      const picked = await tx((c) => completePicking(c, ctx.picker, list.id));
      assert.equal(picked.status, "picked");
      const a = await availability(ids.a);
      assert.equal(Number(a.reservedQuantity), 4, "only the 4 actually picked stay reserved");
    });

    await t.test("F136: packing cannot exceed what was picked, and the list is packed only when everything is in a package", async () => {
      const detail = await tx((c) => getPickList(c, ctx.viewer, list.id));
      const lineA = detail.lines.find((l) => l.item_code === "OA");
      const lineB = detail.lines.find((l) => l.item_code === "OB");
      await assert.rejects(() => tx((c) => completePacking(c, ctx.picker, list.id)), (e) => e.code === "STOCK_PACK_INCOMPLETE");
      await assert.rejects(() => tx((c) => createPackage(c, ctx.picker, list.id, { lines: [{ lineId: lineA.id, quantity: 5 }] })), (e) => e.code === "STOCK_PACK_OVER");
      const first = await tx((c) => createPackage(c, ctx.picker, list.id, { lines: [{ lineId: lineA.id, quantity: 4 }], weightKg: 2.5 }));
      assert.equal(first.package_number, "PKG-1");
      await assert.rejects(() => tx((c) => completePacking(c, ctx.picker, list.id)), (e) => e.code === "STOCK_PACK_INCOMPLETE", "B is still unpacked");
      await tx((c) => createPackage(c, ctx.picker, list.id, { lines: [{ lineId: lineB.id, quantity: 5 }] }));
      const packed = await tx((c) => completePacking(c, ctx.picker, list.id));
      assert.equal(packed.status, "packed");
      const full = await tx((c) => getPickList(c, ctx.viewer, list.id));
      assert.equal(full.packages.length, 2);
    });

    await t.test("F137: shipping issues the picked stock once, consumes the reservation, and cannot be repeated", async () => {
      await assert.rejects(() => tx((c) => shipPickList(c, ctx.picker, list.id, {})), (e) => e.code === "STOCK_CARRIER_REQUIRED");
      const shipped = await tx((c) => shipPickList(c, ctx.picker, list.id, { carrier: "BlueDart", trackingNumber: "BD123" }));
      assert.equal(shipped.status, "shipped");
      const a = await availability(ids.a);
      assert.equal(Number(a.onHandQuantity), 6, "10 - 4 shipped");
      assert.equal(Number(a.reservedQuantity), 0);
      const b = await availability(ids.b);
      assert.equal(Number(b.onHandQuantity), 0);
      const movements = await admin.query(`SELECT count(*)::int AS n FROM tenant.stock_movements WHERE organization_id=$1 AND reference_type='stock_shipment' AND reference_id=$2`, [orgId, list.id]);
      assert.equal(movements.rows[0].n, 2);
      const again = await tx((c) => shipPickList(c, ctx.picker, list.id, { carrier: "BlueDart" }));
      assert.equal(again.replayed, true);
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM tenant.stock_movements WHERE organization_id=$1 AND reference_type='stock_shipment'`, [orgId])).rows[0].n, 2, "no second issue");
      await assert.rejects(() => tx((c) => cancelPickList(c, ctx.picker, list.id, "too late")), (e) => e.code === "STOCK_PICK_STATE_INVALID");
    });

    await t.test("cancelling before shipment releases the reservation; a reason is required", async () => {
      const second = await tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines: [{ itemId: ids.a, quantity: 3 }] }));
      assert.equal(Number((await availability(ids.a)).reservedQuantity), 3);
      await assert.rejects(() => tx((c) => cancelPickList(c, ctx.picker, second.id, "")), (e) => e.code === "STOCK_REASON_REQUIRED");
      const cancelled = await tx((c) => cancelPickList(c, ctx.picker, second.id, "Order withdrawn"));
      assert.equal(cancelled.status, "cancelled");
      assert.equal(Number((await availability(ids.a)).reservedQuantity), 0);
      const all = await tx((c) => listPickLists(c, ctx.viewer, {}));
      assert.equal(all.length, 2);
      assert.equal(all.find((l) => l.id === list.id).status, "shipped");
    });

    await t.test("a pick line with no location ships from wherever the stock was reserved (a bin)", async () => {
      const bin = randomUUID();
      await admin.query(`INSERT INTO tenant.warehouse_locations(id,organization_id,warehouse_id,name,code,location_type,status) VALUES ($1,$2,$3,'Bin','B1','bin','active')`, [bin, orgId, ids.wh]);
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.b, warehouseId: ids.wh, warehouseLocationId: bin, quantity: 5, unitCost: 3 }));
      const placed = await tx((c) => createPickList(c, ctx.picker, { warehouseId: ids.wh, lines: [{ itemId: ids.b, quantity: 5 }] }));
      const detail = await tx((c) => getPickList(c, ctx.viewer, placed.id));
      await tx((c) => recordPicks(c, ctx.picker, placed.id, [{ lineId: detail.lines[0].id, pickedQuantity: 5 }]));
      await tx((c) => completePicking(c, ctx.picker, placed.id));
      await tx((c) => createPackage(c, ctx.picker, placed.id, { lines: [{ lineId: detail.lines[0].id, quantity: 5 }] }));
      await tx((c) => completePacking(c, ctx.picker, placed.id));
      const shipped = await tx((c) => shipPickList(c, ctx.picker, placed.id, { carrier: "DTDC" }));
      assert.equal(shipped.status, "shipped");
      assert.equal(Number((await availability(ids.b)).onHandQuantity), 0);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["stock_package_lines", "stock_packages", "stock_pick_lines", "stock_pick_lists", "stock_reservations", "stock_valuation_layers", "stock_movements", "stock_balances", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

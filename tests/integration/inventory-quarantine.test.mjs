// Real PostgreSQL integration test -- quarantine / quality-held stock (F140).
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
  manager: ["stock.view", "stock.manage", "stock.receive", "stock.issue", "stock.adjust", "stock.valuation.view"],
  clerk: ["stock.view", "stock.receive", "stock.issue"],
  viewer: ["stock.view"],
};

test("Inventory quarantine against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { stockContext, postStockMovement, listStockQuarantine } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), item: randomUUID(), lot: randomUUID(), wh: randomUUID(), qloc: randomUUID(), bin: randomUUID() };
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
  const post = (who, input) => tx((c) => postStockMovement(c, ctx[who], input));
  const balance = async (item, location = null) => Number((await admin.query(`SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_location_id IS NOT DISTINCT FROM $3`, [orgId, item, location])).rows[0].q);

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `exc-${role}-${id}@test.invalid`, `Exc ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Exc Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `exc-org-${orgId}`, users.manager]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Exc Co','Exc Co Pvt Ltd','EXCCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type) VALUES ($1,$2,$3,'XI','Item XI','product',$4,'active',true,'none')`, [ids.item, orgId, companyId, ids.uom]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type) VALUES ($1,$2,$3,'XL','Item XL','product',$4,'active',true,'batch')`, [ids.lot, orgId, companyId, ids.uom]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'XW','XW','active')`, [ids.wh, orgId, companyId]);
    await admin.query(`INSERT INTO tenant.warehouse_locations(id,organization_id,warehouse_id,name,code,location_type,status) VALUES ($1,$2,$3,'Quarantine','QRN','quality','active'),($4,$2,$3,'Bin','BIN1','bin','active')`, [ids.qloc, orgId, ids.wh, ids.bin]);
    await post("manager", { movementType: "receipt", itemId: ids.item, warehouseId: ids.wh, warehouseLocationId: ids.bin, quantity: 20, unitCost: 5 });

    await t.test("F140: stock received into a quality location is listed as quarantined and is not in sellable stock", async () => {
      await post("clerk", { movementType: "receipt", itemId: ids.item, warehouseId: ids.wh, warehouseLocationId: ids.qloc, quantity: 2, unitCost: 5, reason: "Suspect lot" });
      await assert.rejects(() => tx((c) => listStockQuarantine(c, { ...ctx.viewer, permissions: [] })), forbidden);
      const quarantine = await tx((c) => listStockQuarantine(c, ctx.viewer));
      assert.equal(quarantine.located.length, 1);
      assert.equal(quarantine.located[0].location_code, "QRN");
      assert.equal(Number(quarantine.located[0].quantity), 2);
      assert.equal(await balance(ids.item, ids.bin), 20, "quarantined units are not in the bin");
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["stock_valuation_layers", "stock_movements", "stock_balances", "stock_batches", "warehouse_locations", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});

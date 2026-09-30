// Real PostgreSQL integration test -- material availability (F161) for a multi-level BOM against real stock.
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

test("Manufacturing material availability against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, getMaterialAvailability } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), top: randomUUID(), sub: randomUUID(), buy: randomUUID(), raw: randomUUID(), safe: randomUUID(), wh: randomUUID(), bomTop: randomUUID(), bomSub: randomUUID() };
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
  const run = (who, fn) => tx((c) => fn(c, ctx[who]));
  const num = (v) => Number(v);

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

// Shared setup for the Quality real-PostgreSQL tests: one organization and company, users with
// explicit permission sets (no owner bypass), a branch, a real item/warehouse/supplier/customer (so
// the F323 Stock-movement gate and supplier/customer linkage can be exercised for real), and a
// transaction runner under RLS.
import { randomUUID } from "node:crypto";

import { Client } from "pg";

export const ALL_QUALITY = [
  "quality.view", "quality.manage", "quality.plan.manage", "quality.inspect", "quality.release", "quality.hold",
  "quality.nonconformance.manage", "quality.capa.manage", "quality.sampling.manage", "quality.supplier.manage",
  "quality.audit.manage", "quality.reports.view", "quality.settings.manage", "quality.audit.view",
];

export async function connectAdmin() {
  const connectionString = process.env.MIGRATION_DATABASE_URL || "";
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

export async function buildQualityWorld(admin, roles, tag) {
  const api = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");
  const orgId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const supplierId = randomUUID();
  const customerId = randomUUID();
  const warehouseId = randomUUID();
  const uomId = randomUUID();
  const itemGroupId = randomUUID();
  const itemId = randomUUID();
  const users = Object.fromEntries(Object.keys(roles).map((r) => [r, randomUUID()]));
  const first = Object.values(users)[0];
  for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `${tag}-${role}-${id}@test.invalid`, `${tag} ${role}`]);
  await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`, [orgId, `${tag} Org`, `${tag}-org-${orgId}`, first]);
  await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,$3,$3,$4,'INR','IN',true,'active')`, [companyId, orgId, `${tag} Co`, tag.toUpperCase().slice(0, 8)]);
  await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
  for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
  await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
  await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,$4,'supplier',$5,'INR',$6,$6)`, [supplierId, orgId, companyId, `${tag}-SUP`.slice(0, 30), `${tag} Supplier`, first]);
  await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,$4,'customer',$5,'INR',$6,$6)`, [customerId, orgId, companyId, `${tag}-CUST`.slice(0, 30), `${tag} Customer`, first]);
  await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category) VALUES ($1,$2,'EA','Each','quantity')`, [uomId, orgId]);
  await admin.query(`INSERT INTO tenant.item_groups(id,organization_id,code,name) VALUES ($1,$2,'GEN','General')`, [itemGroupId, orgId]);
  await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,group_id,uom_id,track_inventory,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'product',$6,$7,true,$8,$8)`, [itemId, orgId, companyId, `${tag}-ITEM`.slice(0, 30), `${tag} Item`, itemGroupId, uomId, first]);
  await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,name,code,warehouse_type) VALUES ($1,$2,$3,$4,'Main','MAIN','stores')`, [warehouseId, orgId, companyId, branchId]);
  await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,100,0,10)`, [orgId, companyId, itemId, warehouseId]);

  const ctx = Object.fromEntries(Object.entries(roles).map(([r, permissions]) => [r, api.qualityContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));
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
  const denied = async (who, fn, status = 403, code) => {
    try {
      await run(who, fn);
    } catch (e) {
      if (e.status !== status || (code && e.code !== code)) throw new Error(`expected ${status}${code ? ` ${code}` : ""}, got ${e.status} ${e.code}: ${e.message}`);
      return e;
    }
    throw new Error(`expected a ${status} rejection but the call succeeded`);
  };
  const sql = async (text, params = []) => tx(async (c) => (await c.query(text, params)).rows);
  const cleanup = async () => {
    try {
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      await setTenantContext(admin, orgId);
      const { rows } = await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id' AND (table_name LIKE 'quality\\_%' OR table_name IN ('stock_balances','items','warehouses','item_groups','units_of_measure','business_parties'))`);
      for (const r of rows) await admin.query(`DELETE FROM tenant.${r.table_name} WHERE organization_id=$1`, [orgId]);
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK").catch(() => {});
    }
  };
  return { api, orgId, companyId, branchId, supplierId, customerId, warehouseId, itemId, users, ctx, run, tx, denied, sql, cleanup, today: new Date().toISOString().slice(0, 10) };
}

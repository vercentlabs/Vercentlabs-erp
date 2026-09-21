// Shared setup for the Projects real-PostgreSQL tests. It reuses the Accounting world (organization, company,
// users with explicit permission sets, a customer, a supplier and a fully initialized ledger) because billing
// hands invoices to Accounting, and adds a stock item and warehouse for materials consumed from Stock.
import { randomUUID } from "node:crypto";

import { buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

export { connectAdmin };

export const PM = ["projects.view", "projects.manage", "projects.create", "projects.tasks.manage", "projects.milestones.manage", "projects.resources.manage", "projects.procurement.link"];
export const PMO = ["projects.view", "projects.approve", "projects.time.approve", "projects.expense.approve", "projects.reports.view", "projects.settings.manage", "projects.audit.view"];
export const CONTROLLER = ["projects.view", "projects.budget.manage", "projects.billing.manage", "projects.profitability.view", "projects.reports.view"];
export const MEMBER = ["projects.view", "projects.time.enter", "projects.expense.enter"];

export async function buildProjectsWorld(admin, roles, tag) {
  const w = await buildAccountingWorld(admin, roles, tag);
  const uomId = randomUUID(); const groupId = randomUUID(); const itemId = randomUUID(); const warehouseId = randomUUID();
  const first = Object.values(w.users)[0];
  await w.tx(async (c) => {
    await c.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category) VALUES ($1,$2,'EA','Each','quantity')`, [uomId, w.orgId]);
    await c.query(`INSERT INTO tenant.item_groups(id,organization_id,code,name) VALUES ($1,$2,'GEN','General')`, [groupId, w.orgId]);
    await c.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,group_id,uom_id,track_inventory,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'product',$6,$7,true,$8,$8)`, [itemId, w.orgId, w.companyId, `${tag}-ITEM`.slice(0, 30), `${tag} Cable`, groupId, uomId, first]);
    await c.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,name,code,warehouse_type) VALUES ($1,$2,$3,$4,'Main','MAIN','stores')`, [warehouseId, w.orgId, w.companyId, w.branchId]);
    await c.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,100,0,10)`, [w.orgId, w.companyId, itemId, warehouseId]);
  });
  const doc = async (table) => {
    const id = randomUUID();
    await w.tx((c) => c.query(`INSERT INTO tenant.${table}(id,organization_id,company_id,status,search_text,data,content_hash,created_by,updated_by) VALUES ($1,$2,$3,'approved','x','{}'::jsonb,'h',$4,$4)`, [id, w.orgId, w.companyId, first]));
    return id;
  };
  return { ...w, itemId, warehouseId, doc };
}

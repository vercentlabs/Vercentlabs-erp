import { need } from "./common.js";

// Pickers for the Manufacturing screens, scoped to the active company.
export async function listManufacturingOptions(client, c) {
  need(c, "manufacturing.view");
  const [items, warehouses, uoms, boms, routings, workCenters, workOrders, calendars, salesOrders, assets] = await Promise.all([
    client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 1000`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY name LIMIT 200`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 300`, [c.organizationId]),
    client.query(`SELECT id,code,COALESCE(name,'') AS name,version,item_id FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY code,version DESC LIMIT 500`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY name LIMIT 300`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.manufacturing_work_centers WHERE organization_id=$1 AND company_id=$2 AND status<>'inactive' ORDER BY name LIMIT 300`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,work_order_number AS code,work_order_number AS name FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND company_id=$2 AND status IN ('planned','released','in_progress') ORDER BY created_at DESC LIMIT 300`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.manufacturing_calendars WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY name LIMIT 100`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,sales_order_number AS code,sales_order_number AS name FROM tenant.sales_orders WHERE organization_id=$1 AND company_id=$2 AND lifecycle_status IN ('approved','confirmed','on_hold') ORDER BY created_at DESC LIMIT 200`, [c.organizationId, c.companyId]),
    client.query(`SELECT id,asset_number AS code,name FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 ORDER BY name LIMIT 300`, [c.organizationId, c.companyId]),
  ]);
  return { items: items.rows, warehouses: warehouses.rows, uoms: uoms.rows, boms: boms.rows, routings: routings.rows, workCenters: workCenters.rows, workOrders: workOrders.rows, calendars: calendars.rows, salesOrders: salesOrders.rows, assets: assets.rows };
}

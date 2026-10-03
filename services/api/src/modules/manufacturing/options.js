import { need } from "./common.js";

// Pickers for the Manufacturing screens.
export async function listManufacturingOptions(client, c) {
  need(c, "manufacturing.view");
  const [items, warehouses, uoms, boms, workOrders, salesOrders] = await Promise.all([
    client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 1000`, [c.organizationId]),
    client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 300`, [c.organizationId]),
    client.query(`SELECT id,code,COALESCE(name,'') AS name,version,item_id FROM tenant.manufacturing_boms WHERE organization_id=$1 AND status='active' ORDER BY code,version DESC LIMIT 500`, [c.organizationId]),
    client.query(`SELECT id,work_order_number AS code,work_order_number AS name FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND status IN ('planned','released','in_progress') ORDER BY created_at DESC LIMIT 300`, [c.organizationId]),
    client.query(`SELECT id,sales_order_number AS code,sales_order_number AS name FROM tenant.sales_orders WHERE organization_id=$1 AND lifecycle_status IN ('approved','confirmed','on_hold') ORDER BY created_at DESC LIMIT 200`, [c.organizationId]),
  ]);
  return { items: items.rows, warehouses: warehouses.rows, uoms: uoms.rows, boms: boms.rows, workOrders: workOrders.rows, salesOrders: salesOrders.rows };
}

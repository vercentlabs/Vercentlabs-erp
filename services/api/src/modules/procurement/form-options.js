import { ProcurementError } from "./index.js";
import { itemOptions, supplierOptions } from "./options.js";

export { searchProcurementOptions } from "./options.js";

const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);

// The master data Procurement's configuration forms and list filters choose from (categories, policies, source rules). Suppliers and
// items are a first page plus the ones asked for (include.supplierIds / include.itemIds); the rest are found by typing (./options.js).
// One connection runs one query at a time, so they run in turn.
export async function listProcurementFormOptions(client, c, include = {}) {
  if (!has(c, "procurement.view")) throw new ProcurementError(403, "You do not have permission to perform this Procurement operation.");
  const values = [c.organizationId];
  const suppliers = { rows: await supplierOptions(client, c.organizationId, { ids: include.supplierIds }) };
  const items = { rows: await itemOptions(client, c.organizationId, { ids: include.itemIds }) };
  const warehouses = await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL ORDER BY name LIMIT 1000`, values);
  const uoms = await client.query(`SELECT id, code, name FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY name LIMIT 200`, values);
  const categories = await client.query(
    `SELECT id, COALESCE(data->>'name', data->>'code', id::text) AS label, status FROM tenant.procurement_categories WHERE organization_id = $1 AND status = 'active' ORDER BY 2 LIMIT 1000`, values);
  const paymentTerms = await client.query(`SELECT id, code, name FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_purchase_enabled ORDER BY default_due_days, name`, values);
  return { suppliers: suppliers.rows, items: items.rows, warehouses: warehouses.rows, uoms: uoms.rows, categories: categories.rows, paymentTerms: paymentTerms.rows };
}

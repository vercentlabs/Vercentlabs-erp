import { ProcurementError } from "./index.js";

const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);

// The master data Procurement's configuration forms choose from (categories, policies, source rules).
// One connection runs one query at a time, so they run in turn.
export async function listProcurementFormOptions(client, c) {
  if (!has(c, "procurement.view")) throw new ProcurementError(403, "You do not have permission to perform this Procurement operation.");
  const values = [c.organizationId];
  const suppliers = await client.query(
    `SELECT supplier.id, party.display_name || ' · ' || supplier.supplier_number AS label, supplier.status, (supplier.status = 'active') AS selectable
       FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 ORDER BY (supplier.status = 'active') DESC, party.display_name LIMIT 2000`, values);
  const items = await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND status = 'active' AND is_purchasable ORDER BY name LIMIT 1000`, values);
  const warehouses = await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' ORDER BY name LIMIT 1000`, values);
  const uoms = await client.query(`SELECT id, code, name FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY name LIMIT 200`, values);
  const categories = await client.query(
    `SELECT id, COALESCE(data->>'name', data->>'code', id::text) AS label, status FROM tenant.procurement_categories WHERE organization_id = $1 AND status = 'active' ORDER BY 2 LIMIT 1000`, values);
  const paymentTerms = await client.query(`SELECT id, code, name FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_purchase_enabled ORDER BY default_due_days, name`, values);
  return { suppliers: suppliers.rows, items: items.rows, warehouses: warehouses.rows, uoms: uoms.rows, categories: categories.rows, paymentTerms: paymentTerms.rows };
}

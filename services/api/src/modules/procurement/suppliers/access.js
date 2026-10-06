// Who may see and change a supplier.
//
// Viewing all suppliers needs procurement.suppliers.view_all; with only
// procurement.suppliers.view a person sees the suppliers they buy for (the
// assigned buyer) or created. A supplier outside that scope is "not found".
import { SUPPLIER_PERMISSIONS, SupplierError, requireUuid } from "./constants.js";

export function supplierCan(context, permission) {
  return Boolean(context?.roleSlugs?.includes("organization_owner") || context?.permissions?.includes(permission));
}

export function requireSupplierPermission(context, permission, message = "You do not have permission to do this.") {
  if (!supplierCan(context, permission)) throw new SupplierError(403, message, "PERMISSION_DENIED");
}

export function requireSupplierAccess(context) {
  if (!supplierCan(context, SUPPLIER_PERMISSIONS.view) && !supplierCan(context, SUPPLIER_PERMISSIONS.viewAll))
    throw new SupplierError(403, "You do not have permission to view suppliers.", "PERMISSION_DENIED");
}

// " AND (…)" limiting `alias` (a procurement_suppliers alias) to the suppliers the caller may see; "" with view-all.
export function supplierScopeSql(context, values, alias = "supplier") {
  if (supplierCan(context, SUPPLIER_PERMISSIONS.viewAll)) return "";
  values.push(context.userId ?? null);
  const me = `$${values.length}`;
  return ` AND (${alias}.assigned_buyer_id = ${me} OR ${alias}.created_by = ${me})`;
}

// The supplier row with its party, after checking the caller may see it; locked for a change when asked.
export async function loadSupplier(client, context, supplierId, { lock = false } = {}) {
  requireSupplierAccess(context);
  const values = [context.organizationId, requireUuid(supplierId, "Supplier")];
  const scope = supplierScopeSql(context, values, "supplier");
  const { rows } = await client.query(
    `SELECT supplier.*, party.display_name, party.legal_name, party.gstin, party.pan, party.website, party.country_code, party.gst_state_code, party.tax_treatment,
            party.party_type, party.customer_number, party.status AS party_status
       FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2${scope}${lock ? " FOR UPDATE OF supplier, party" : ""}`, values);
  if (!rows[0]) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  return rows[0];
}

// What the caller may do, for the screens. The server checks again on every action.
export function supplierCapabilities(context) {
  return Object.fromEntries(Object.entries(SUPPLIER_PERMISSIONS).map(([name, permission]) => [name, supplierCan(context, permission)]));
}

export async function recordSupplierEvent(client, context, supplierId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.procurement_supplier_events (organization_id, supplier_id, event_type, summary, changes, actor_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, supplierId, eventType, summary, JSON.stringify(changes), context.userId ?? null]);
}

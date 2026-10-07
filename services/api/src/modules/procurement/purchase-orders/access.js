// Who may do what with purchase orders, and which orders a caller sees.
//
// With procurement.po.view_all every order is visible; with only
// procurement.po.view, the orders the caller buys for or created. Access to
// an order never grants posting a goods receipt, a supplier bill or a payment:
// each of those keeps its own permission.
import { PO_PERMISSIONS, PurchaseOrderError, requireUuid } from "./constants.js";

export function poCan(context, permission) {
  return Boolean(context.roleSlugs?.some((slug) => slug === "organization_owner" || slug === "system_administrator")) || Boolean(context.permissions?.includes(permission));
}

export function requirePoPermission(context, permission, message = "You do not have permission to do this.") {
  if (!poCan(context, permission)) throw new PurchaseOrderError(403, message, "PERMISSION_DENIED");
}

export function requirePoAccess(context) {
  if (!poCan(context, PO_PERMISSIONS.view) && !poCan(context, PO_PERMISSIONS.viewAll))
    throw new PurchaseOrderError(403, "You do not have permission to view purchase orders.", "PERMISSION_DENIED");
}

// " AND (…)" restricting `alias` to the orders the caller sees; "" for view-all. $1 must be the organization id.
export function poScopeSql(context, values, alias = "po") {
  if (poCan(context, PO_PERMISSIONS.viewAll)) return "";
  values.push(context.userId ?? null);
  const me = `$${values.length}`;
  return ` AND (${alias}.buyer_user_id = ${me} OR ${alias}.created_by = ${me})`;
}

export function poCapabilities(context) {
  return Object.fromEntries(Object.entries(PO_PERMISSIONS).map(([name, permission]) => [name, poCan(context, permission)]));
}

// The order row, locked when asked, after checking the caller may see it.
export async function loadPurchaseOrder(client, context, orderId, { lock = false } = {}) {
  requirePoAccess(context);
  const values = [context.organizationId, requireUuid(orderId)];
  const scope = poScopeSql(context, values, "po");
  const { rows } = await client.query(`SELECT po.* FROM tenant.purchase_orders po WHERE po.organization_id = $1 AND po.id = $2${scope}${lock ? " FOR UPDATE OF po" : ""}`, values);
  if (!rows[0]) throw new PurchaseOrderError(404, "Purchase order not found.", "PURCHASE_ORDER_NOT_FOUND");
  return rows[0];
}

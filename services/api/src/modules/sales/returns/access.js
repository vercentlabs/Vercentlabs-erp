// Who may see and act on sales returns. A return is seen by whoever can see
// its sales order (own / team / all), or by anyone allowed to see every
// return (the warehouse). Seeing a return never shows prices: those belong to
// the invoice and the credit note.
import { orderCan, orderScopeSql } from "../orders/access.js";
import { requireUuid } from "../orders/constants.js";
import { RETURN_PERMISSIONS, ReturnError } from "./constants.js";

export const returnCan = orderCan;

export function requireReturnPermission(context, permission, message = "You do not have permission to do this.") {
  if (!returnCan(context, permission)) throw new ReturnError(403, message, "PERMISSION_DENIED");
}

export function requireReturnAccess(context) {
  if (!returnCan(context, RETURN_PERMISSIONS.view) && !returnCan(context, RETURN_PERMISSIONS.viewAll))
    throw new ReturnError(403, "You do not have permission to view sales returns.", "PERMISSION_DENIED");
}

export function returnScopeSql(context, values, alias = "sales_order") {
  if (returnCan(context, RETURN_PERMISSIONS.viewAll)) return "";
  return orderScopeSql(context, values, alias);
}

// The return (with its order and delivery numbers), after checking the caller may see it; locked for a change when asked.
export async function loadReturn(client, context, returnId, { lock = false } = {}) {
  requireReturnAccess(context);
  const values = [context.organizationId, requireUuid(returnId, "Return")];
  const scope = returnScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT sales_return.*, sales_order.sales_order_number, sales_order.current_version_id, delivery.request_number AS delivery_number, delivery.warehouse_id AS delivery_warehouse_id
       FROM tenant.sales_returns sales_return
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_return.organization_id AND sales_order.id = sales_return.sales_order_id
       JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = sales_return.organization_id AND delivery.id = sales_return.delivery_id
      WHERE sales_return.organization_id = $1 AND sales_return.id = $2${scope}${lock ? " FOR UPDATE OF sales_return" : ""}`, values);
  if (!rows[0]) throw new ReturnError(404, "Sales return not found.", "SALES_RETURN_NOT_FOUND");
  return rows[0];
}

export async function recordReturnEvent(client, context, returnId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_return_events (organization_id, sales_return_id, event_type, from_status, to_status, metadata, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [context.organizationId, returnId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

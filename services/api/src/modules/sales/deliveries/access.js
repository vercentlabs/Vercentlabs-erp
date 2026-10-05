// Who may see and act on deliveries. A delivery is seen by whoever can see
// its sales order (own / team / all), or by anyone allowed to see every
// delivery (the warehouse). Access to a delivery never opens its order's
// commercial details beyond what the delivery itself shows.
import { orderCan, orderScopeSql } from "../orders/access.js";
import { requireUuid } from "../orders/constants.js";
import { DELIVERY_PERMISSIONS, DeliveryError } from "./constants.js";

export const deliveryCan = orderCan;

export function requireDeliveryPermission(context, permission, message = "You do not have permission to do this.") {
  if (!deliveryCan(context, permission)) throw new DeliveryError(403, message, "PERMISSION_DENIED");
}

export function requireDeliveryAccess(context) {
  if (!deliveryCan(context, DELIVERY_PERMISSIONS.view) && !deliveryCan(context, DELIVERY_PERMISSIONS.viewAll))
    throw new DeliveryError(403, "You do not have permission to view deliveries.", "PERMISSION_DENIED");
}

// " AND (…)" limiting `alias` (a sales_orders alias) to what the caller may see; "" with view-all.
export function deliveryScopeSql(context, values, alias = "sales_order") {
  if (deliveryCan(context, DELIVERY_PERMISSIONS.viewAll)) return "";
  return orderScopeSql(context, values, alias);
}

// The delivery row (locked for a change when asked), after checking the caller may see it.
export async function loadDelivery(client, context, deliveryId, { lock = false } = {}) {
  requireDeliveryAccess(context);
  const values = [context.organizationId, requireUuid(deliveryId, "Delivery")];
  const scope = deliveryScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT delivery.*, sales_order.sales_order_number, sales_order.lifecycle_status AS order_status, sales_order.current_version_id
       FROM tenant.sales_fulfillment_requests delivery
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = delivery.organization_id AND sales_order.id = delivery.sales_order_id
      WHERE delivery.organization_id = $1 AND delivery.id = $2${scope}${lock ? " FOR UPDATE OF delivery" : ""}`, values);
  if (!rows[0]) throw new DeliveryError(404, "Delivery not found.", "SALES_DELIVERY_NOT_FOUND");
  return rows[0];
}

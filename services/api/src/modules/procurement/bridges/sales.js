// The Procurement + Sales bridge (report Phase 3, dropship): the supplier delivered a dropship order to the customer, so the sales order's
// delivery is recorded dispatched and delivered from the warehouse the goods were received into on paper. Raised as the person confirming
// the supplier's delivery, who need not be a Sales user.
import { appOn } from "../../../core/access/apps.js";
import { DELIVERY_PERMISSIONS } from "../../sales/deliveries/constants.js";
import { createDeliveryFromSalesOrder, markDeliveryDelivered } from "../../sales/deliveries/index.js";
import { PurchaseOrderError } from "../purchase-orders/constants.js";

const SALES_PERMISSIONS = [DELIVERY_PERMISSIONS.create, DELIVERY_PERMISSIONS.dispatch, DELIVERY_PERMISSIONS.deliver, DELIVERY_PERMISSIONS.view, DELIVERY_PERMISSIONS.viewAll,
  "sales.order.view", "sales.order.view_all"];
const internal = (context) => ({ ...context, apps: undefined, permissions: [...new Set([...(context.permissions ?? []), ...SALES_PERMISSIONS])] });

// { salesOrderId, lines: [{ salesOrderLineId, quantity }], warehouseId, deliveredOn, key, trackingNumber?, carrier?, note? } → { deliveryId, deliveryNumber }.
export async function deliverDropshipToCustomer(client, context, { salesOrderId, lines, warehouseId, deliveredOn, key, trackingNumber = null, carrier = null, note = null }) {
  if (!(await appOn(client, context, "sales")))
    throw new PurchaseOrderError(409, "Sales is not switched on, so the customer's delivery cannot be recorded.", "SALES_NOT_ON");
  const as = internal(context);
  const created = await createDeliveryFromSalesOrder(client, as, salesOrderId, {
    idempotencyKey: key, lines, warehouseId, dispatch: true, dispatchDate: deliveredOn, trackingNumber, carrier, internalNotes: note,
  });
  await markDeliveryDelivered(client, as, created.deliveryId, { deliveredAt: deliveredOn, note });
  return { deliveryId: created.deliveryId, deliveryNumber: created.deliveryNumber };
}

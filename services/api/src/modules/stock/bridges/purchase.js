// The Stock + Purchase bridge: reordering opens draft purchase orders only when Purchase is on. Without it the reorder list is a list, and
// the business buys however it likes.
import { appOn } from "../../../core/access/apps.js";
import { createPurchaseOrder } from "../../procurement/purchase-orders/index.js";

export const purchaseOn = (client, context) => appOn(client, context, "procurement");

// A draft purchase order from Procurement, or null when Purchase is off.
export async function draftPurchaseOrder(client, context, input) {
  if (!(await purchaseOn(client, context))) return null;
  return createPurchaseOrder(client, context, input);
}

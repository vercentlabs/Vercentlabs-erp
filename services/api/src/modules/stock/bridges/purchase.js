// The Stock + Purchase bridge: reordering opens draft purchase orders only when Purchase is on. Without it the reorder list is a list, and
// the business buys however it likes.
import { appOn } from "../../../core/access/apps.js";
import { createPurchaseOrder } from "../../procurement/purchase-orders/index.js";
import { procurementSettings } from "../../procurement/purchase-orders/document.js";
import { draftIndentFromReorder } from "../../procurement/indents/index.js";

export const purchaseOn = (client, context) => appOn(client, context, "procurement");

// What a reorder opens in Procurement (Procurement plan Phase 2): "indent" when the company uses indents and asked for it, else "purchase_order";
// null when Purchase is off.
export async function reorderTarget(client, context) {
  if (!(await purchaseOn(client, context))) return null;
  return (await procurementSettings(client, context.organizationId)).reorderCreates;
}

// A submitted purchase indent from Procurement, or null when Purchase is off.
export async function draftPurchaseIndent(client, context, input) {
  if (!(await purchaseOn(client, context))) return null;
  return draftIndentFromReorder(client, context, input);
}

// A draft purchase order from Procurement, or null when Purchase is off.
export async function draftPurchaseOrder(client, context, input) {
  if (!(await purchaseOn(client, context))) return null;
  return createPurchaseOrder(client, context, input);
}

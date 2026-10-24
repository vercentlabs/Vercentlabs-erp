// The variant grid on purchase orders (report Phase 3): the shared grid (products/variant-grid.js) with the variants that are bought.
import { variantGridOf, variantTemplates } from "../products/variant-grid.js";
import { requirePoPermission } from "./purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError } from "./purchase-orders/constants.js";

export async function searchPurchaseVariantTemplates(client, context, { search = "" } = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to make purchase orders.");
  return { templates: await variantTemplates(client, context.organizationId, { search, purpose: "buy" }) };
}

export async function getPurchaseVariantGrid(client, context, templateId) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to make purchase orders.");
  const grid = await variantGridOf(client, context.organizationId, templateId, { purpose: "buy" });
  if (!grid) throw new PurchaseOrderError(404, "This item has no variants that are bought.", "PURCHASE_VARIANTS_NOT_FOUND");
  return grid;
}

// The variant grid (Sales report Phase 3): a product sold in sizes and colours is entered as one grid — sizes down, colours across —
// and each filled cell becomes a line for that variant. The grid itself is shared with Procurement (products/variant-grid.js); Sales
// shows sellable variants to those who make quotations or orders.
import { SalesError } from "./index.js";
import { variantGridOf, variantTemplates } from "../products/variant-grid.js";

const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));

function requireSales(context) {
  if (!can(context, "sales.quotation.create") && !can(context, "sales.order.create")) throw new SalesError(403, "You do not have permission to make quotations or orders.", "PERMISSION_DENIED");
}

// Templates with at least one sellable variant, by name or code. options: { search? }
export async function searchVariantTemplates(client, context, options = {}) {
  requireSales(context);
  return { templates: await variantTemplates(client, context.organizationId, { search: options.search, purpose: "sell" }) };
}

// Returns { template, rowAttribute, columnAttribute, rows: [value], columns: [value], cells: { "row|column": { itemId, code, name } } }.
export async function getVariantGrid(client, context, templateId) {
  requireSales(context);
  const grid = await variantGridOf(client, context.organizationId, templateId, { purpose: "sell" });
  if (!grid) throw new SalesError(404, "This product has no variants.", "SALES_PRODUCT_NOT_FOUND");
  return grid;
}

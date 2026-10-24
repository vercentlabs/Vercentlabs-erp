// Sales warnings (Sales report Phase 3): "Cash only" on a customer, "Discontinued soon" on a product. A warning is shown on the quotation
// or order the moment the customer or product is chosen; a product's can block it from new documents instead. Lines already agreed
// (from a quotation) are never blocked. Customer warnings need Edit customers; product warnings need Edit products or Sales settings.
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const message = (value) => String(value ?? "").trim().slice(0, 300) || null;

export async function setCustomerSalesWarning(client, context, partyId, input = {}) {
  if (!can(context, "sales.customers.edit")) throw new SalesError(403, "You do not have permission to change customers.", "PERMISSION_DENIED");
  const updated = await client.query(
    "UPDATE tenant.business_parties SET sales_warning = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING sales_warning",
    [context.organizationId, UUID.test(String(partyId ?? "")) ? partyId : null, message(input.message), context.userId ?? null]);
  if (!updated.rows[0]) throw new SalesError(404, "Customer not found.", "SALES_CUSTOMER_NOT_FOUND");
  return { message: updated.rows[0].sales_warning };
}

// input: { level: none | warn | block, message? } — a block needs its reason.
export async function setProductSalesWarning(client, context, itemId, input = {}) {
  if (!can(context, "products.edit") && !can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to change products.", "PERMISSION_DENIED");
  const level = ["none", "warn", "block"].includes(input.level) ? input.level : null;
  if (!level) throw new SalesError(400, "Choose no warning, Warn or Block.", "SALES_WARNING_INVALID", { field: "level" });
  const text = level === "none" ? null : message(input.message);
  if (level !== "none" && !text) throw new SalesError(400, "Write the warning salespeople will see.", "SALES_WARNING_INVALID", { field: "message" });
  const updated = await client.query(
    "UPDATE tenant.items SET sales_warning_level = $3, sales_warning = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING sales_warning_level, sales_warning",
    [context.organizationId, UUID.test(String(itemId ?? "")) ? itemId : null, level, text]);
  if (!updated.rows[0]) throw new SalesError(404, "Product not found.", "SALES_PRODUCT_NOT_FOUND");
  return { level: updated.rows[0].sales_warning_level, message: updated.rows[0].sales_warning };
}

// How a product is billed (Sales report Phase 3): "ordered" (services, subscriptions: bill when the order is confirmed), "delivered"
// (goods: bill what was delivered), or null for the company's setting.
export async function setProductInvoiceBasis(client, context, itemId, basis) {
  if (!can(context, "products.edit") && !can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to change products.", "PERMISSION_DENIED");
  if (basis !== null && !["ordered", "delivered"].includes(basis)) throw new SalesError(400, "Choose as ordered, as delivered or the company's setting.", "SALES_WARNING_INVALID", { field: "basis" });
  const updated = await client.query("UPDATE tenant.items SET invoice_basis = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING invoice_basis",
    [context.organizationId, UUID.test(String(itemId ?? "")) ? itemId : null, basis]);
  if (!updated.rows[0]) throw new SalesError(404, "Product not found.", "SALES_PRODUCT_NOT_FOUND");
  return { basis: updated.rows[0].invoice_basis };
}

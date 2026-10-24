// Purchase warnings (report Phase 3): "Pay only against delivery" on a supplier, "Being phased out: check with stores" on an item. A
// warning is shown on purchase requests, price requests and orders the moment the supplier or item is chosen; an item's can block it
// from new ones instead (lines already agreed are never blocked). A supplier is stopped by blocking the supplier itself.
import { PurchaseOrderError } from "./purchase-orders/constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, ...permissions) => Boolean(context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || permissions.some((permission) => context.permissions?.includes(permission)));
const message = (value) => String(value ?? "").trim().slice(0, 300) || null;

// input: { message? } — empty clears it.
export async function setSupplierPurchaseWarning(client, context, supplierId, input = {}) {
  if (!can(context, "procurement.suppliers.edit")) throw new PurchaseOrderError(403, "You do not have permission to change suppliers.", "PERMISSION_DENIED");
  const updated = await client.query(
    "UPDATE tenant.procurement_suppliers SET purchase_warning = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING purchase_warning",
    [context.organizationId, UUID.test(String(supplierId ?? "")) ? supplierId : null, message(input.message), context.userId ?? null]);
  if (!updated.rows[0]) throw new PurchaseOrderError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  return { message: updated.rows[0].purchase_warning };
}

// input: { level: none | warn | block, message? } — a warning or block needs its message.
export async function setItemPurchaseWarning(client, context, itemId, input = {}) {
  if (!can(context, "products.edit", "procurement.settings.manage")) throw new PurchaseOrderError(403, "You do not have permission to change items.", "PERMISSION_DENIED");
  const level = ["none", "warn", "block"].includes(input.level) ? input.level : null;
  if (!level) throw new PurchaseOrderError(400, "Choose no warning, Warn or Block.", "PURCHASE_WARNING_INVALID", { issues: [{ field: "level", message: "Choose a level." }] });
  const text = level === "none" ? null : message(input.message);
  if (level !== "none" && !text) throw new PurchaseOrderError(400, "Write the warning buyers will see.", "PURCHASE_WARNING_INVALID", { issues: [{ field: "message", message: "Write the warning." }] });
  const updated = await client.query(
    "UPDATE tenant.items SET purchase_warning_level = $3, purchase_warning = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING purchase_warning_level, purchase_warning",
    [context.organizationId, UUID.test(String(itemId ?? "")) ? itemId : null, level, text]);
  if (!updated.rows[0]) throw new PurchaseOrderError(404, "Item not found.", "ITEM_NOT_FOUND");
  return { level: updated.rows[0].purchase_warning_level, message: updated.rows[0].purchase_warning };
}

// For a document being written: the supplier's warning, and each item's — refusing a blocked item on a new line.
// lines: [{ itemId, label, carried? }]. Returns [{ line, code, message }] (line null for the supplier).
export async function purchaseWarningsFor(client, organizationId, { supplierId = null, lines = [] }) {
  const warnings = [];
  if (UUID.test(String(supplierId ?? ""))) {
    const supplier = (await client.query(`SELECT purchase_warning FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [organizationId, supplierId])).rows[0];
    if (supplier?.purchase_warning) warnings.push({ line: null, code: "SUPPLIER_WARNING", message: `Supplier: ${supplier.purchase_warning}` });
  }
  const ids = [...new Set(lines.map((line) => line.itemId).filter((id) => UUID.test(String(id ?? ""))))];
  if (!ids.length) return warnings;
  const items = new Map((await client.query(`SELECT id, name, purchase_warning, purchase_warning_level FROM tenant.items WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [organizationId, ids])).rows.map((row) => [row.id, row]));
  for (const [index, line] of lines.entries()) {
    const item = items.get(line.itemId);
    if (!item?.purchase_warning || item.purchase_warning_level === "none") continue;
    if (item.purchase_warning_level === "block" && !line.carried)
      throw new PurchaseOrderError(409, `${line.label ?? `Line ${index + 1}`}: ${item.name} is not bought now: ${item.purchase_warning}`, "PURCHASE_ITEM_BLOCKED",
        { issues: [{ field: "productId", message: item.purchase_warning }] });
    if (item.purchase_warning_level === "warn") warnings.push({ line: index + 1, code: "ITEM_WARNING", message: `${item.name}: ${item.purchase_warning}` });
  }
  return warnings;
}

// input: { basis: order | receipt | null } — how this item is billed whatever the order's policy (null: the order decides).
export async function setItemPurchaseBillBasis(client, context, itemId, input = {}) {
  if (!can(context, "products.edit", "procurement.settings.manage")) throw new PurchaseOrderError(403, "You do not have permission to change items.", "PERMISSION_DENIED");
  const basis = input.basis === null || input.basis === "" || input.basis === "default" ? null : ["order", "receipt"].includes(input.basis) ? input.basis : undefined;
  if (basis === undefined) throw new PurchaseOrderError(400, "Choose ordered quantity, received quantity or the order's rule.", "PURCHASE_BILL_BASIS_INVALID", { issues: [{ field: "basis", message: "Choose one." }] });
  const updated = await client.query("UPDATE tenant.items SET purchase_bill_basis = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING purchase_bill_basis",
    [context.organizationId, UUID.test(String(itemId ?? "")) ? itemId : null, basis]);
  if (!updated.rows[0]) throw new PurchaseOrderError(404, "Item not found.", "ITEM_NOT_FOUND");
  return { basis: updated.rows[0].purchase_bill_basis };
}

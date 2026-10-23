// Purchasing settings (one row per workspace) and the Procurement home figures.
import { requirePoAccess, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, fail, has, optionalUuid } from "./constants.js";
import { procurementSettings } from "./document.js";

export async function getProcurementSettings(client, context) {
  requirePoAccess(context);
  return procurementSettings(client, context.organizationId);
}

// input: { billingBasis?: "receipt" | "order", requireExpectedDate?, defaultWarehouseId?, billHeldGoods?, postReceiptAccrual?, useIndents?, useRfqs?,
// reorderCreates?: "purchase_order" | "indent", allowReceiptWithoutOrder? }
export async function updateProcurementSettings(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.settings, "You do not have permission to change procurement settings.");
  const current = await procurementSettings(client, context.organizationId);
  const billingBasis = has(input, "billingBasis") ? input.billingBasis : current.billingBasis;
  if (!["receipt", "order"].includes(billingBasis)) fail("Choose how goods are billed: once received, or as ordered.", "billingBasis");
  const warehouseId = has(input, "defaultWarehouseId") ? optionalUuid(input.defaultWarehouseId, "Warehouse") : current.defaultWarehouseId;
  if (warehouseId) {
    const warehouse = (await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, warehouseId])).rows[0];
    if (!warehouse) fail("Choose an active warehouse.", "defaultWarehouseId", "PURCHASE_ORDER_WAREHOUSE_INVALID", 409);
  }
  const useIndents = has(input, "useIndents") ? Boolean(input.useIndents) : current.useIndents;
  const reorderCreates = has(input, "reorderCreates") ? input.reorderCreates : current.reorderCreates;
  if (!["purchase_order", "indent"].includes(reorderCreates)) fail("Choose what a reorder opens: a draft purchase order or an indent.", "reorderCreates");
  if (reorderCreates === "indent" && !useIndents) fail("Turn on purchase indents before reorders open indents.", "reorderCreates");
  await client.query(
    `INSERT INTO tenant.procurement_settings (organization_id, billing_basis, require_expected_date, default_warehouse_id, updated_by, updated_at, bill_held_goods, post_receipt_accrual,
       use_indents, use_rfqs, reorder_creates, allow_receipt_without_order) VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11)
     ON CONFLICT (organization_id) DO UPDATE SET billing_basis = EXCLUDED.billing_basis, require_expected_date = EXCLUDED.require_expected_date,
       default_warehouse_id = EXCLUDED.default_warehouse_id, bill_held_goods = EXCLUDED.bill_held_goods, post_receipt_accrual = EXCLUDED.post_receipt_accrual,
       use_indents = EXCLUDED.use_indents, use_rfqs = EXCLUDED.use_rfqs, reorder_creates = EXCLUDED.reorder_creates,
       allow_receipt_without_order = EXCLUDED.allow_receipt_without_order, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, billingBasis, has(input, "requireExpectedDate") ? Boolean(input.requireExpectedDate) : current.requireExpectedDate, warehouseId, context.userId ?? null,
      has(input, "billHeldGoods") ? Boolean(input.billHeldGoods) : current.billHeldGoods,
      has(input, "postReceiptAccrual") ? Boolean(input.postReceiptAccrual) : current.postReceiptAccrual,
      useIndents, has(input, "useRfqs") ? Boolean(input.useRfqs) : current.useRfqs, reorderCreates,
      has(input, "allowReceiptWithoutOrder") ? Boolean(input.allowReceiptWithoutOrder) : current.allowReceiptWithoutOrder]);
  return procurementSettings(client, context.organizationId);
}

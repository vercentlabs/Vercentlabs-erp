// Purchasing settings (one row per workspace) and the Procurement home figures.
import { requirePoAccess, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, fail, has, optionalUuid } from "./constants.js";
import { procurementSettings } from "./document.js";

export async function getProcurementSettings(client, context) {
  requirePoAccess(context);
  return procurementSettings(client, context.organizationId);
}

// input: { billingBasis?: "receipt" | "order", requireExpectedDate?, defaultWarehouseId?, billHeldGoods?, postReceiptAccrual? }
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
  await client.query(
    `INSERT INTO tenant.procurement_settings (organization_id, billing_basis, require_expected_date, default_warehouse_id, updated_by, updated_at, bill_held_goods, post_receipt_accrual) VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
     ON CONFLICT (organization_id) DO UPDATE SET billing_basis = EXCLUDED.billing_basis, require_expected_date = EXCLUDED.require_expected_date,
       default_warehouse_id = EXCLUDED.default_warehouse_id, bill_held_goods = EXCLUDED.bill_held_goods, post_receipt_accrual = EXCLUDED.post_receipt_accrual, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, billingBasis, has(input, "requireExpectedDate") ? Boolean(input.requireExpectedDate) : current.requireExpectedDate, warehouseId, context.userId ?? null,
      has(input, "billHeldGoods") ? Boolean(input.billHeldGoods) : current.billHeldGoods,
      has(input, "postReceiptAccrual") ? Boolean(input.postReceiptAccrual) : current.postReceiptAccrual]);
  return procurementSettings(client, context.organizationId);
}

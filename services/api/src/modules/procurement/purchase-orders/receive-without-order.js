// Receive without a purchase order (Create-Where-You-Are PR3). Goods that arrive with no order (common with small suppliers) are received
// in one step: a matching purchase order is raised and confirmed in the same transaction, marked as created from the receipt with the
// reason given, and the goods receipt is drafted (or posted) against it, so a bill still matches order, receipt and bill. The company's
// purchase order approval rules still apply: an order waiting for approval is kept as a draft and nothing is received yet. Allowed by the
// Procurement setting allow_receipt_without_order (off by default where purchase orders need approval).
import { requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, fail, text } from "./constants.js";
import { recordPoEvent } from "./persist.js";
import { createPurchaseOrder } from "./records.js";
import { confirmPurchaseOrder } from "./lifecycle.js";
import { createGoodsReceiptFromPurchaseOrder } from "./receipts.js";

// input: { supplierId, warehouseId?, receiptDate?, reason, supplierChallanNumber?, supplierChallanDate?, notes?, post?, idempotencyKey?,
//          lines: [{ productId, quantity, unitPrice, uomId? }] }
export async function createGoodsReceiptWithoutOrder(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to receive goods.");
  if (input.post) requirePoPermission(context, PO_PERMISSIONS.post, "You do not have permission to post goods receipts.");
  const setting = (await client.query(`SELECT allow_receipt_without_order FROM tenant.procurement_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (setting?.allow_receipt_without_order === false)
    throw new PurchaseOrderError(409, "Receiving without a purchase order is switched off in Procurement settings. Raise a purchase order first.", "GOODS_RECEIPT_ORDER_REQUIRED");
  const reason = text(input.reason, 500);
  if (!reason) fail("Say why the goods came without an order (for example: a walk-in supplier or an urgent local purchase).", "reason");
  if (!Array.isArray(input.lines) || !input.lines.length) fail("Add what was received.", "lines");
  // The receiver raises the order as part of this receipt (never on its own), so the receipt carries the create and confirm rights.
  const acting = { ...context, permissions: [...new Set([...(context.permissions ?? []), PO_PERMISSIONS.create, PO_PERMISSIONS.confirm])] };
  const key = text(input.idempotencyKey, 180);
  const created = await createPurchaseOrder(client, acting, {
    supplierId: input.supplierId,
    ...(input.receiptDate ? { orderDate: input.receiptDate } : {}),
    ...(input.warehouseId ? { defaultWarehouseId: input.warehouseId } : {}),
    internalNotes: `Raised to receive goods that came without an order: ${reason}`,
    lines: input.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, ...(line.uomId ? { uomId: line.uomId } : {}),
      ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}) })),
    ...(key ? { idempotencyKey: `${key}:order` } : {}),
  });
  if (!created.replayed) {
    await client.query(`UPDATE tenant.purchase_orders SET created_from_receipt = true, created_from_receipt_reason = $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, created.id, reason]);
    await recordPoEvent(client, context, created.id, "purchase_order.created_from_receipt", `Raised to receive goods that came without an order: ${reason}`, { details: { reason } });
  }
  const confirmed = await confirmPurchaseOrder(client, acting, created.id, {});
  if (confirmed.approvalRequired)
    return { orderId: created.id, purchaseOrderNumber: created.purchaseOrderNumber, approvalRequired: true, pendingApproval: confirmed.pendingApproval, receipt: null };
  const receipt = await createGoodsReceiptFromPurchaseOrder(client, context, created.id, {
    receiptDate: input.receiptDate, warehouseId: input.warehouseId, supplierChallanNumber: input.supplierChallanNumber, supplierChallanDate: input.supplierChallanDate,
    notes: input.notes, post: Boolean(input.post), ...(key ? { idempotencyKey: `${key}:receipt` } : {}),
  });
  return { orderId: created.id, purchaseOrderNumber: created.purchaseOrderNumber, approvalRequired: false, receipt };
}

// The Sales + Procurement bridge (Sales report Phase 3, make-to-order): what a confirmed order buys for itself. With purchase indents on,
// one submitted indent for the order's "buy" lines (Purchasing turns it into orders); with them off, a draft purchase order per supplier,
// to the supplier each product was last bought from at that price. Raised as the person confirming, who need not be a buyer.
import { appOn } from "../../../core/access/apps.js";
import { createPurchaseIndent, INDENT_PERMISSIONS } from "../../procurement/indents/index.js";
import { createPurchaseOrder } from "../../procurement/purchase-orders/records.js";
import { PO_PERMISSIONS } from "../../procurement/purchase-orders/constants.js";
import { procurementSettings } from "../../procurement/purchase-orders/document.js";

export const procurementOn = (client, context) => appOn(client, context, "procurement");
const internal = (context, permission) => ({ ...context, apps: undefined, permissions: [...new Set([...(context.permissions ?? []), permission])] });

// lines: [{ sequence, itemId, quantity, uomId, warehouseId, requiredBy }]. Returns [{ sequences, documentType, documentId, documentNumber } | { sequences, error }].
export async function buyForSalesOrder(client, context, order, lines) {
  if (!(await procurementOn(client, context))) return [{ sequences: lines.map((line) => line.sequence), error: "Procurement is not switched on: buy these items by hand." }];
  const purpose = `For sales order ${order.sales_order_number}`;
  if ((await procurementSettings(client, context.organizationId)).useIndents) {
    const indent = await createPurchaseIndent(client, internal(context, INDENT_PERMISSIONS.create), {
      purpose, submit: true, lines: lines.map((line) => ({ productId: line.itemId, quantity: line.quantity, uomId: line.uomId ?? undefined, warehouseId: line.warehouseId ?? undefined,
        requiredBy: line.requiredBy ?? undefined, notes: purpose })),
    }, { source: "manual" });
    return [{ sequences: lines.map((line) => line.sequence), documentType: "purchase_indent", documentId: indent.id, documentNumber: indent.number }];
  }
  // The supplier and price each product was last bought at.
  const last = new Map((await client.query(
    `SELECT DISTINCT ON (line.product_id) line.product_id AS item_id, purchase_order.supplier_id, line.unit_price
       FROM tenant.purchase_order_lines line JOIN tenant.purchase_orders purchase_order ON purchase_order.id = line.purchase_order_id
      WHERE line.organization_id = $1 AND line.product_id = ANY($2::uuid[]) AND purchase_order.status <> 'cancelled'
      ORDER BY line.product_id, purchase_order.order_date DESC, purchase_order.created_at DESC`, [context.organizationId, lines.map((line) => line.itemId)])).rows
    .map((row) => [row.item_id, row]));
  const results = [];
  const bySupplier = new Map();
  for (const line of lines) {
    const found = last.get(line.itemId);
    if (!found) { results.push({ sequences: [line.sequence], error: "Never bought before, so there is no supplier to order from. Raise the purchase order by hand." }); continue; }
    bySupplier.set(found.supplier_id, [...(bySupplier.get(found.supplier_id) ?? []), { ...line, unitPrice: found.unit_price }]);
  }
  for (const [supplierId, supplied] of bySupplier) {
    const created = await createPurchaseOrder(client, internal(context, PO_PERMISSIONS.create), {
      supplierId, internalNotes: purpose, idempotencyKey: `sales-supply:${order.id}:${order.version_number}:${supplierId}`,
      lines: supplied.map((line) => ({ productId: line.itemId, quantity: line.quantity, uomId: line.uomId ?? undefined, unitPrice: line.unitPrice, warehouseId: line.warehouseId ?? undefined,
        expectedDeliveryDate: line.requiredBy ?? undefined })),
    });
    results.push({ sequences: supplied.map((line) => line.sequence), documentType: "purchase_order", documentId: created.id, documentNumber: created.purchaseOrderNumber });
  }
  return results;
}

// The Sales + Procurement bridge (Sales report Phase 3, make-to-order): what a confirmed order buys for itself. With purchase indents on,
// one submitted indent for the order's "buy" lines (Purchasing turns it into orders); with them off, a draft purchase order per supplier,
// to the supplier each product was last bought from at that price. Raised as the person confirming, who need not be a buyer.
import { appOn } from "../../../core/access/apps.js";
import { createPurchaseIndent, INDENT_PERMISSIONS } from "../../procurement/indents/index.js";
import { createPurchaseOrder } from "../../procurement/purchase-orders/records.js";
import { markPurchaseOrderDropship } from "../../procurement/purchase-orders/dropship.js";
import { PO_PERMISSIONS } from "../../procurement/purchase-orders/constants.js";
import { procurementSettings } from "../../procurement/purchase-orders/document.js";
import { preferredSupplierRate } from "../../procurement/supplier-rates/index.js";
import { databaseToday } from "../../procurement/org-day.js";

export const procurementOn = (client, context) => appOn(client, context, "procurement");
const internal = (context, permission) => ({ ...context, apps: undefined, permissions: [...new Set([...(context.permissions ?? []), permission])] });

// lines: [{ sequence, lineId, itemId, quantity, uomId, warehouseId, requiredBy }]. Returns [{ sequences, documentType, documentId, documentNumber } | { sequences, error }].
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
  const { bySupplier, results } = await suppliersFor(client, context, lines);
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

// Ship from supplier (Procurement report Phase 3): a draft purchase order per supplier, delivered to the customer's shipping address, its
// lines tied to the sales lines. Never through a purchase indent: the order is for this customer.
export async function dropshipForSalesOrder(client, context, order, lines) {
  if (!(await procurementOn(client, context))) return [{ sequences: lines.map((line) => line.sequence), error: "Procurement is not switched on: arrange the supplier's delivery by hand." }];
  const version = (await client.query(`SELECT customer_snapshot, shipping_address_snapshot FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.current_version_id])).rows[0] ?? {};
  const customer = version.customer_snapshot ?? {};
  const address = version.shipping_address_snapshot ?? {};
  const customerName = customer.displayName ?? customer.legalName ?? null;
  if (!address.line1) return [{ sequences: lines.map((line) => line.sequence), error: "The order has no shipping address for the supplier to deliver to." }];
  const shipTo = { name: customerName, line1: address.line1, line2: address.line2 ?? null, city: address.city ?? null, stateCode: address.state_code ?? null,
    stateName: address.state ?? null, postalCode: address.postal_code ?? null, countryCode: address.country_code ?? null };
  const purpose = `Ship to ${customerName ?? "the customer"} for sales order ${order.sales_order_number}`;
  const { bySupplier, results } = await suppliersFor(client, context, lines);
  for (const [supplierId, supplied] of bySupplier) {
    const created = await createPurchaseOrder(client, internal(context, PO_PERMISSIONS.create), {
      supplierId, internalNotes: purpose, supplierNotes: `Deliver to our customer ${customerName ?? ""} at the address shown. Quote our order number on your delivery note.`.replace("  ", " "),
      shipTo, dropship: true, idempotencyKey: `sales-dropship:${order.id}:${order.version_number}:${supplierId}`,
      lines: supplied.map((line) => ({ productId: line.itemId, quantity: line.quantity, uomId: line.uomId ?? undefined, unitPrice: line.unitPrice, warehouseId: line.warehouseId ?? undefined,
        expectedDeliveryDate: line.requiredBy ?? undefined })),
    });
    await markPurchaseOrderDropship(client, context, created.id, { salesOrderId: order.id, salesOrderNumber: order.sales_order_number, customerName,
      links: supplied.map((line, index) => ({ lineNumber: index + 1, salesOrderLineId: line.lineId })) });
    results.push({ sequences: supplied.map((line) => line.sequence), documentType: "purchase_order", documentId: created.id, documentNumber: created.purchaseOrderNumber });
  }
  return results;
}

// The supplier each product is bought from: the preferred one in Supplier Rates (its price list prices the line), else the supplier and
// price it was last bought at. Returns { bySupplier: Map(supplierId → lines with unitPrice), results: [lines with no supplier, as errors] }.
async function suppliersFor(client, context, lines) {
  const today = await databaseToday(client, context.organizationId);
  const preferred = new Map();
  for (const line of lines) if (!preferred.has(line.itemId)) preferred.set(line.itemId, await preferredSupplierRate(client, context.organizationId, line.itemId, today));
  const last = new Map((await client.query(
    `SELECT DISTINCT ON (line.product_id) line.product_id AS item_id, purchase_order.supplier_id, line.unit_price
       FROM tenant.purchase_order_lines line JOIN tenant.purchase_orders purchase_order ON purchase_order.id = line.purchase_order_id
      WHERE line.organization_id = $1 AND line.product_id = ANY($2::uuid[]) AND purchase_order.status <> 'cancelled'
      ORDER BY line.product_id, purchase_order.order_date DESC, purchase_order.created_at DESC`, [context.organizationId, lines.map((line) => line.itemId)])).rows
    .map((row) => [row.item_id, row]));
  const results = [];
  const bySupplier = new Map();
  for (const line of lines) {
    const listed = preferred.get(line.itemId);
    if (listed) {
      bySupplier.set(listed.supplierId, [...(bySupplier.get(listed.supplierId) ?? []), { ...line, unitPrice: !line.uomId || line.uomId === listed.uomId ? listed.rate : undefined }]);
      continue;
    }
    const found = last.get(line.itemId);
    if (!found) { results.push({ sequences: [line.sequence], error: "No supplier rate and never bought before: add a supplier rate, or raise the order by hand." }); continue; }
    bySupplier.set(found.supplier_id, [...(bySupplier.get(found.supplier_id) ?? []), { ...line, unitPrice: found.unit_price }]);
  }
  return { bySupplier, results };
}

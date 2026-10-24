// Repeat order (Sales audit, should-have): a retailer reorders what it bought last time. A new draft order from a past order or invoice —
// the same customer, contact, addresses, terms and charges, the same products and quantities — priced at today's prices and rules (free
// goods of a scheme are not copied: the new order earns its own). The source is not changed.
import { assertOrderVisible, requireOrderPermission } from "./access.js";
import { ORDER_PERMISSIONS, OrderError, text } from "./constants.js";
import { createSalesOrder } from "./records.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// input: { orderId } or { invoiceId }, and idempotencyKey?
export async function repeatSalesOrder(client, context, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to create sales orders.");
  let orderId = input.orderId;
  let invoiceLines = null;
  if (!orderId && UUID.test(String(input.invoiceId ?? ""))) {
    const invoice = (await client.query("SELECT id, source_sales_order_id FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2 AND invoice_type = 'invoice'",
      [context.organizationId, input.invoiceId])).rows[0];
    if (!invoice?.source_sales_order_id) throw new OrderError(404, "Only an invoice made from a sales order can be repeated.", "SALES_ORDER_REPEAT_SOURCE");
    orderId = invoice.source_sales_order_id;
    invoiceLines = (await client.query(
      `SELECT line.item_id, line.quantity, line.uom_id, line.description, order_line.warehouse_id, order_line.item_name_snapshot, order_line.hsn_sac_snapshot,
              order_line.tax_category_id, order_line.unit_price, order_line.supply_route, (SELECT item.system_role FROM tenant.items item WHERE item.id = line.item_id) AS system_role
         FROM tenant.accounting_customer_invoice_lines line
         LEFT JOIN tenant.sales_invoice_lines sales_line ON sales_line.customer_invoice_line_id = line.id
         LEFT JOIN tenant.sales_order_lines order_line ON order_line.id = line.source_sales_order_line_id
        WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 AND line.item_id IS NOT NULL AND sales_line.order_charge_id IS NULL
          AND order_line.scheme_rule_id IS NULL ORDER BY line.sequence`, [context.organizationId, invoice.id])).rows;
  }
  if (!UUID.test(String(orderId ?? ""))) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  await assertOrderVisible(client, context, orderId);
  const order = (await client.query(
    `SELECT version.*, sales_order.id AS order_id, sales_order.sales_order_number, sales_order.party_id, sales_order.contact_id, version.id AS version_id
       FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [context.organizationId, orderId])).rows[0];
  if (!order) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  const lines = invoiceLines ?? (await client.query(
    `SELECT item_id, item_name_snapshot, hsn_sac_snapshot, tax_category_id, unit_price, quantity, uom_id, description_snapshot AS description, warehouse_id, supply_route,
            (SELECT item.system_role FROM tenant.items item WHERE item.id = item_id) AS system_role FROM tenant.sales_order_lines
      WHERE organization_id = $1 AND sales_order_version_id = $2 AND scheme_rule_id IS NULL ORDER BY sequence`, [context.organizationId, order.version_id])).rows;
  if (!lines.length) throw new OrderError(409, "There is nothing to repeat on this document.", "SALES_ORDER_REPEAT_EMPTY");
  const charges = (await client.query(
    `SELECT charge_type, label, calculation_type, value, taxable FROM tenant.sales_order_charges WHERE organization_id = $1 AND sales_order_version_id = $2 ORDER BY sequence`,
    [context.organizationId, order.version_id])).rows;
  const created = await createSalesOrder(client, context, {
    partyId: order.party_id, contactId: order.contact_id ?? null, billingAddressId: order.billing_address_id, shippingAddressId: order.shipping_address_id,
    currencyCode: String(order.currency_code).trim(), priceListId: order.price_list_id ?? null, paymentTermId: order.payment_term_id ?? null,
    defaultWarehouseId: order.default_warehouse_id ?? null, deliveryTerms: order.delivery_terms ?? undefined, shippingMethod: order.shipping_method ?? undefined,
    incoterm: order.incoterm ?? undefined, termsAndConditions: order.terms_and_conditions ?? undefined, customerNotes: order.customer_notes ?? undefined,
    charges: charges.map((charge) => ({ chargeType: charge.charge_type, label: charge.label, calculationType: charge.calculation_type, value: charge.value, taxable: charge.taxable })),
    // A typed line (no catalogue item) is repeated with its name, HSN/SAC, GST and price.
    lines: lines.map((line) => ({ itemId: line.item_id, quantity: line.quantity, uomId: line.uom_id ?? undefined, warehouseId: line.warehouse_id ?? undefined, description: line.description ?? undefined,
      supplyRoute: line.supply_route ?? undefined,
      ...(line.system_role === "unlisted" ? { itemName: line.item_name_snapshot, hsnSac: line.hsn_sac_snapshot ?? undefined, taxCategoryId: line.tax_category_id ?? undefined, unitPrice: line.unit_price } : {}) })),
    idempotencyKey: input.idempotencyKey ? `repeat:${orderId}:${text(input.idempotencyKey, 150)}` : undefined,
  });
  return { ...created, repeatedFrom: order.sales_order_number };
}

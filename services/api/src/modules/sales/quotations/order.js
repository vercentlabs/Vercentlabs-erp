// Accepted quotation → Sales Order. The order carries the accepted
// quotation's prices, discounts, taxes basis, addresses and terms exactly as
// quoted (nothing is re-priced). One quotation makes one order: a repeated
// request, or two people at once, get the same order. No stock is reserved
// by a quotation; the order reserves stock when it is confirmed.
import { SalesError, insertOrderFromPreview, previewSalesDocument } from "../index.js";
import { requireQuotationPermission } from "./access.js";
import { QUOTATION_PERMISSIONS, QuotationError, STATUS, text } from "./constants.js";
import { assertQuotationVisible } from "./records.js";
import { inputFromQuotation, lockQuotation, recordQuotationEvent } from "./versions.js";

// input: { orderDate?, requestedDeliveryDate?, customerPoNumber?, customerPoDate? }
export async function createSalesOrderFromQuotation(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.createOrder, "You do not have permission to create sales orders.");
  // The row lock serialises two conversions of the same quotation.
  const quote = await lockQuotation(client, context, quotationId);
  await assertQuotationVisible(client, context, quote.id);
  if (quote.converted_order_id) {
    const order = (await client.query(`SELECT sales_order_number FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, quote.converted_order_id])).rows[0];
    return { orderId: quote.converted_order_id, orderNumber: order?.sales_order_number ?? null, idempotent: true };
  }
  if (quote.lifecycle_status !== STATUS.accepted)
    throw new QuotationError(409, "Only an accepted quotation can become a sales order.", "SALES_QUOTATION_NOT_ACCEPTED");
  const source = await inputFromQuotation(client, context, quote, { carryPrices: true });
  const document = {
    ...source,
    orderDate: text(input.orderDate, 10) ?? undefined,
    requestedDeliveryDate: text(input.requestedDeliveryDate, 10) ?? null,
    customerPoNumber: text(input.customerPoNumber, 120) ?? quote.customer_reference ?? null,
    customerPoDate: text(input.customerPoDate, 10) ?? null,
  };
  let order;
  try {
    const preview = await previewSalesDocument(client, context, document, { order: true, carryQuotedPrices: true });
    // Each order line remembers the quotation line it came from.
    preview.lines.forEach((line, index) => { line.sourceQuotationLineId = source.lines[index]?.sourceQuotationLineId ?? null; });
    order = await insertOrderFromPreview(client, context, document, preview, {
      quotationId: quote.id, quotationVersionId: quote.current_version_id, opportunityId: quote.source_opportunity_id,
    });
  } catch (error) {
    if (error instanceof SalesError) throw new QuotationError(error.status, error.message, error.code);
    throw error;
  }
  await client.query(
    `UPDATE tenant.sales_quotations SET converted_order_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, order.id, context.userId ?? null]);
  await recordQuotationEvent(client, context, quote.id, "quotation.order_created", STATUS.accepted, STATUS.accepted,
    { orderId: order.id, orderNumber: order.sales_order_number });
  return { orderId: order.id, orderNumber: order.sales_order_number, idempotent: false };
}

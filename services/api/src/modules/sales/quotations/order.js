// Accepted quotation → Sales Order. The order carries the accepted
// quotation's prices, discounts, taxes basis, addresses and terms exactly as
// quoted (nothing is re-priced). One quotation makes one order: a repeated
// request, or two people at once, get the same order. No stock is reserved
// by a quotation; the order reserves stock when it is confirmed.
import { SalesError, previewSalesDocument } from "../index.js";
import { insertOrder } from "../orders/records.js";
import { requireQuotationPermission } from "./access.js";
import { QUOTATION_PERMISSIONS, QuotationError, STATUS, text } from "./constants.js";
import { assertQuotationVisible } from "./records.js";
import { inputFromQuotation, lockQuotation, recordQuotationEvent } from "./versions.js";
import { createCustomerFromAccount } from "../customers/account-link.js";

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
  const prospect = await customerOfProspect(client, context, quote);
  const { optionalLines: _optional, chosenOptionalLines: chosen, ...source } = await inputFromQuotation(client, context, quote, { carryPrices: true });
  // The optional products the customer chose (Sales report Phase 3) join the quoted lines, priced from the price list.
  source.lines = [...source.lines, ...chosen];
  const document = {
    ...source,
    orderDate: text(input.orderDate, 10) ?? undefined,
    requestedDeliveryDate: text(input.requestedDeliveryDate, 10) ?? null,
    customerPoNumber: text(input.customerPoNumber, 120) ?? null,
    customerReference: quote.customer_reference ?? null,
    customerPoDate: text(input.customerPoDate, 10) ?? null,
  };
  let order;
  try {
    const preview = await previewSalesDocument(client, context, document, { order: true, carryQuotedPrices: true });
    // Each order line remembers the quotation line it came from (source.lines carry it).
    order = await insertOrder(client, context, { ...document, orderDate: document.orderDate ?? null }, preview, {
      quotationId: quote.id, quotationNumber: quote.quotation_number, quotationVersionId: quote.current_version_id, opportunityId: quote.source_opportunity_id,
    });
  } catch (error) {
    if (error instanceof SalesError) throw new QuotationError(error.status, error.message, error.code);
    throw error;
  }
  await client.query(
    `UPDATE tenant.sales_quotations SET converted_order_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, order.id, context.userId ?? null]);
  await recordQuotationEvent(client, context, quote.id, "quotation.order_created", STATUS.accepted, STATUS.accepted,
    { orderId: order.id, orderNumber: order.sales_order_number, ...(prospect ? { customerCreated: prospect.customerNumber } : {}) });
  return { orderId: order.id, orderNumber: order.sales_order_number, idempotent: false, ...(prospect ? { customerCreated: prospect } : {}) };
}

// A quotation to a prospect: the order makes the prospect a customer (Sales audit M5), with the quotation's currency and the company's
// country when the prospect has none. Creating the order authorises it — the customer is the order's, not a separate decision.
async function customerOfProspect(client, context, quote) {
  const party = (await client.query("SELECT party_type, country_code, currency_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, quote.party_id])).rows[0];
  if (party?.party_type !== "prospect") return null;
  const version = (await client.query("SELECT currency_code FROM tenant.sales_quotation_versions WHERE organization_id = $1 AND id = $2", [context.organizationId, quote.current_version_id])).rows[0];
  const country = (await client.query("SELECT country_code FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.country_code;
  const customerContext = { ...context, permissions: [...new Set([...(context.permissions ?? []), "sales.customers.create", "sales.customers.link_account", "sales.customers.view", "sales.customers.view_all"])] };
  try {
    const customer = await createCustomerFromAccount(client, customerContext, quote.party_id, {
      ...(party.country_code ? {} : { countryCode: String(country ?? "IN").trim() }),
      ...(party.currency_code ? {} : { currencyCode: String(version?.currency_code ?? "").trim() || undefined }),
      origin: "quotation", allowDuplicate: true, duplicateReason: `Customer opened from accepted quotation ${quote.quotation_number}`,
    });
    return { customerId: customer.id, customerNumber: customer.customerNumber };
  } catch (error) {
    if (error?.name !== "CustomerError") throw error;
    throw new QuotationError(error.status ?? 409, `The prospect could not be made a customer for the order: ${error.message}`, error.code ?? "SALES_QUOTATION_PROSPECT");
  }
}

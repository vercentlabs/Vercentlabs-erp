// How a sales order's content is stored. Each save of a draft writes a new
// immutable version (its edit history) and the order points at its current
// one. Customer, contact, addresses, payment terms, the seller's tax
// registration, prices, discounts and tax are copied onto the version and its
// lines, so a later change to the customer, a product, a price list or a tax
// rate never changes an order already made.
import { createHash } from "node:crypto";

import { documentDiscountColumns, documentTaxColumns, lineTaxColumns } from "../index.js";
import { asDatabaseDecimal } from "../money.js";
import { OrderError, requireUuid, text } from "./constants.js";

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function readDate(value, label) {
  const result = text(value, 10);
  if (!result) return null;
  if (!DATE.test(result)) throw new OrderError(400, `${label} must be a date.`, "SALES_ORDER_VALIDATION", { field: label });
  return result;
}

// INSERT built from a { column: value } map; a value wrapped by json() is cast to jsonb.
const json = (value) => ({ json: JSON.stringify(value ?? {}) });
async function insert(client, table, record, returning = "*") {
  const columns = Object.keys(record);
  const values = columns.map((column) => (record[column] && typeof record[column] === "object" && "json" in record[column] ? record[column].json : record[column]));
  const places = columns.map((column, index) => `$${index + 1}${record[column] && typeof record[column] === "object" && "json" in record[column] ? "::jsonb" : ""}`);
  return (await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${places.join(", ")}) RETURNING ${returning}`, values)).rows[0];
}

const DISCOUNT_COLUMNS = ["document_discount_type", "document_discount_value", "document_discount_amount", "gross_total", "line_discount_total", "taxable_total", "discount_reason_code", "discount_reason_text"];
const TAX_COLUMNS = ["seller_registration_id", "seller_snapshot", "tax_treatment", "tax_override_reason", "place_of_supply_name", "place_of_supply_source", "place_of_supply_reason", "supply_nature"];
const LINE_TAX_COLUMNS = ["tax_rate", "tax_rate_id", "tax_category_code", "tax_treatment", "hsn_sac_kind"];
const zip = (columns, values) => Object.fromEntries(columns.map((column, index) => [column, values[index]]));

// Writes `preview` (from previewSalesDocument) as the order's next version and makes it current.
export async function insertOrderVersion(client, context, orderId, input, preview) {
  const versionNumber = Number((await client.query(`SELECT COALESCE(max(version_number), 0) + 1 AS version FROM tenant.sales_order_versions WHERE organization_id = $1 AND sales_order_id = $2`,
    [context.organizationId, orderId])).rows[0].version);
  const { master, snapshots, totals } = preview;
  const taxValues = documentTaxColumns(preview);
  const version = await insert(client, "tenant.sales_order_versions", {
    organization_id: context.organizationId, sales_order_id: orderId, version_number: versionNumber, amendment_reason: text(input.changeNote, 1000),
    currency_code: master.currencyCode, base_currency_code: master.baseCurrencyCode, exchange_rate: asDatabaseDecimal(master.exchangeRate),
    price_list_id: master.priceList?.id ?? null, payment_term_id: master.paymentTerm?.id ?? null, billing_address_id: master.billing.id, shipping_address_id: master.shipping.id,
    customer_snapshot: json(snapshots.customer), contact_snapshot: json(snapshots.contact), billing_address_snapshot: json(snapshots.billingAddress),
    shipping_address_snapshot: json(snapshots.shippingAddress), payment_term_snapshot: json(snapshots.paymentTerm),
    customer_po_number: text(input.customerPoNumber, 120), customer_po_date: readDate(input.customerPoDate, "Customer PO date"), customer_reference: text(input.customerReference, 200),
    default_warehouse_id: input.defaultWarehouseId || null, priority: input.priority || "normal",
    delivery_terms: text(input.deliveryTerms), shipping_method: text(input.shippingMethod), incoterm: text(input.incoterm, 40),
    place_of_supply: preview.tax.placeOfSupply?.code ?? null, supply_type: preview.tax.supplyType,
    internal_notes: text(input.internalNotes, 10000), customer_notes: text(input.customerNotes, 10000), terms_and_conditions: text(input.termsAndConditions, 20000),
    subtotal: totals.subtotal, discount_total: totals.discountTotal, charge_total: totals.chargeTotal, tax_total: totals.taxTotal, rounding_adjustment: totals.roundingAdjustment,
    grand_total: totals.grandTotal, base_currency_total: totals.baseCurrencyTotal, cost_total: totals.costTotal, margin_amount: totals.marginAmount, margin_percent: totals.marginPercent,
    pricing_trace: json(preview.pricingTrace), tax_trace: json(preview.taxTrace),
    content_hash: createHash("sha256").update(stable({ input, preview: { lines: preview.lines, charges: preview.charges, totals } })).digest("hex"),
    created_by: context.userId ?? null,
    ...zip(DISCOUNT_COLUMNS, documentDiscountColumns(preview)),
    ...zip(TAX_COLUMNS, taxValues.map((value, index) => (index === 1 ? { json: value } : value))),
  });
  for (const line of preview.lines) {
    const inserted = await insert(client, "tenant.sales_order_lines", {
      organization_id: context.organizationId, sales_order_version_id: version.id, source_quotation_line_id: line.sourceQuotationLineId ?? null, sequence: line.sequence,
      item_id: line.itemId, uom_id: line.uomId, warehouse_id: line.warehouseId,
      item_code_snapshot: line.itemCodeSnapshot, item_name_snapshot: line.itemNameSnapshot, description_snapshot: line.descriptionSnapshot, hsn_sac_snapshot: line.hsnSacSnapshot,
      uom_snapshot: line.uomSnapshot, quantity: line.quantity, base_quantity: line.baseQuantity, conversion_factor: line.conversionFactor,
      list_unit_price: line.listUnitPrice, unit_price: line.unitPrice, manual_price_override: Boolean(line.manualPriceOverride), manual_price_reason: line.manualPriceReason ?? null,
      discount_type: line.discountType, discount_value: line.discountValue, discount_percent: line.discountPercent,
      discount_amount: line.discountAmount, gross_amount: line.grossAmount, net_amount: line.netAmount, document_discount_amount: line.documentDiscountAmount,
      taxable_amount: line.taxableAmount, tax_amount: line.taxAmount, line_total: line.lineTotal, standard_cost: line.standardCost, cost_amount: line.costAmount,
      margin_amount: line.marginAmount, margin_percent: line.marginPercent, tax_category_id: line.taxCategoryId,
      requested_delivery_date: line.requestedDeliveryDate, promised_delivery_date: line.requestedDeliveryDate,
      pricing_trace: json(line.pricingTrace), tax_trace: json(line.taxTrace), created_by: context.userId ?? null,
      ...zip(LINE_TAX_COLUMNS, lineTaxColumns(line)),
    }, "id");
    for (const tax of line.taxLines)
      await insert(client, "tenant.sales_order_tax_lines", {
        organization_id: context.organizationId, sales_order_version_id: version.id, sales_order_line_id: inserted.id, sequence: tax.sequence, tax_type: tax.taxType, label: tax.label,
        rate: tax.rate, taxable_amount: tax.taxableAmount, tax_amount: tax.taxAmount, tax_category_id: tax.taxCategoryId, tax_rate_id: tax.taxRateId, metadata: json(tax.metadata),
      }, "id");
    await client.query(`INSERT INTO tenant.sales_order_line_progress (organization_id, sales_order_line_id, confirmed_quantity, updated_by) VALUES ($1, $2, 0, $3)`,
      [context.organizationId, inserted.id, context.userId ?? null]);
  }
  await client.query(`UPDATE tenant.sales_orders SET current_version_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, orderId, version.id]);
  return version;
}

// The order row, locked for a change, with its current version's number.
export async function lockOrder(client, context, orderId) {
  const { rows } = await client.query(
    `SELECT sales_order.*, version.version_number, version.currency_code, version.grand_total, version.customer_snapshot, version.contact_snapshot, version.customer_po_number
       FROM tenant.sales_orders sales_order
       LEFT JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2 FOR UPDATE OF sales_order`,
    [context.organizationId, requireUuid(orderId)]);
  if (!rows[0]) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  return rows[0];
}

export async function recordOrderEvent(client, context, orderId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'sales_order', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, orderId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

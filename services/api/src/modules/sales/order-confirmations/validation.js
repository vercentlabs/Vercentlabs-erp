// What must be true before a sales order is confirmed, so nobody discovers
// missing business information after the order has entered fulfillment.
//
// Checked: the customer (an active customer, not blocked), at least one line,
// each line's product or service, quantity, unit and price, the currency,
// payment terms, the billing address, a shipping address and a warehouse
// where goods are delivered, the tax context (place of supply, HSN/SAC), a
// customer PO and a requested delivery date when Sales settings require them.
//
// The order is then priced and taxed again by the server from what is
// stored, under the confirming user's authority: a manual price needs the
// price override permission and its reason, a discount must be within the
// confirming user's limit and carry a reason above the threshold. If the
// result differs from what was saved (a price list, a tax rate, the customer
// or an address changed since), the order is not confirmed with stale
// values: it is saved again first.
//
// An order made from a quotation is compared with the accepted quotation; a
// difference needs its own permission and a reason. Stock is reported (what
// is short), but a shortage never stops a confirmation.
import { orderCan, assertOrderVisible, requireOrderAccess } from "../orders/access.js";
import { OrderError, dayOf } from "../orders/constants.js";
import { databaseToday, draftDocument, priced } from "../orders/records.js";
import { computeOrderAvailability } from "../availability/service.js";
import { lockOrder } from "../orders/versions.js";
import { CONFIRMATION_PERMISSIONS } from "./constants.js";

const EPSILON = 0.005;
const differs = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) > EPSILON;

// A snapshot compared without its bookkeeping (timestamps and who changed it).
function comparable(value) {
  if (Array.isArray(value)) return `[${value.map(comparable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).filter((key) => !/(_at|At|_by|By)$/.test(key)).sort().map((key) => `${JSON.stringify(key)}:${comparable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
const sameSnapshot = (a, b) => comparable(a ?? {}) === comparable(b ?? {});

// The stored draft as the input the pricing core reads, so it can be priced again.
async function storedInput(client, context, order) {
  const version = (await client.query(
    `SELECT version.* FROM tenant.sales_order_versions version WHERE version.organization_id = $1 AND version.id = $2`, [context.organizationId, order.current_version_id])).rows[0];
  const lines = (await client.query(
    `SELECT * FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = $2 ORDER BY sequence`, [context.organizationId, order.current_version_id])).rows;
  const input = {
    partyId: order.party_id, contactId: order.contact_id ?? null, ownerUserId: order.owner_user_id ?? undefined,
    billingAddressId: version.billing_address_id, shippingAddressId: version.shipping_address_id, currencyCode: String(version.currency_code).trim(), exchangeRate: version.exchange_rate,
    priceListId: version.price_list_id, paymentTermId: version.payment_term_id, orderDate: dayOf(order.order_date), requestedDeliveryDate: dayOf(order.requested_delivery_date),
    customerPoNumber: version.customer_po_number, customerPoDate: dayOf(version.customer_po_date), customerReference: version.customer_reference,
    defaultWarehouseId: version.default_warehouse_id, priority: version.priority, deliveryTerms: version.delivery_terms, shippingMethod: version.shipping_method, incoterm: version.incoterm,
    customerNotes: version.customer_notes, internalNotes: version.internal_notes, termsAndConditions: version.terms_and_conditions,
    documentDiscountType: version.document_discount_type, documentDiscountValue: version.document_discount_value,
    discountReasonCode: version.discount_reason_code, discountReasonText: version.discount_reason_text, sellerRegistrationId: version.seller_registration_id,
    ...(version.place_of_supply_source === "override" ? { placeOfSupply: version.place_of_supply, placeOfSupplyReason: version.place_of_supply_reason } : {}),
    ...(version.tax_override_reason ? { supplyType: version.supply_type, taxOverrideReason: version.tax_override_reason } : {}),
    // An order keeps only the total of its charges.
    charges: Number(version.charge_total) ? [{ label: "Charges", calculationType: "fixed", value: version.charge_total }] : [],
    lines: lines.map((line) => ({
      salesOrderLineId: line.id, itemId: line.item_id, variantId: line.variant_id, uomId: line.uom_id, warehouseId: line.warehouse_id, quantity: line.quantity,
      description: line.description_snapshot, requestedDeliveryDate: dayOf(line.requested_delivery_date),
      ...(line.manual_price_override && !line.source_quotation_line_id ? { unitPrice: line.unit_price, manualPriceReason: line.manual_price_reason } : {}),
      discountType: line.discount_type, discountValue: line.discount_value,
    })),
  };
  return { version, lines, input };
}

// The stored version and what pricing it again gives now.
async function recalculation(client, context, order, problems) {
  const { version, lines, input } = await storedInput(client, context, order);
  let preview;
  try {
    const document = await draftDocument(client, context, order, input, await databaseToday(client));
    preview = await priced(client, context, document, { carryDocumentDiscount: Boolean(order.source_quotation_id), allowMissingPrice: true, preview: true });
  } catch (error) {
    if (error?.name !== "OrderError") throw error;
    problems.push(error.code === "PERMISSION_DENIED" || error.status === 403
      ? `${error.message} Confirming this order needs permission for its prices and discounts.`
      : error.message);
    return { version, lines, preview: null };
  }
  for (const line of preview.lines) if (line.priceMissing) problems.push(`Line ${line.sequence}: ${line.priceMessage}`);
  if (preview.discount?.limitExceeded || (preview.discount?.reasonRequired && preview.discount?.message)) problems.push(preview.discount.message);
  const changes = [];
  if (differs(version.grand_total, preview.totals.grandTotal) || differs(version.tax_total, preview.totals.taxTotal)) changes.push("totals");
  preview.lines.forEach((line, index) => {
    const stored = lines[index];
    if (!stored) return;
    if (["unit_price", "discount_amount", "taxable_amount", "tax_amount", "line_total"].some((column) => differs(stored[column], line[{
      unit_price: "unitPrice", discount_amount: "discountAmount", taxable_amount: "taxableAmount", tax_amount: "taxAmount", line_total: "lineTotal",
    }[column]]))) changes.push(`line ${line.sequence} price or tax`);
    if (stored.item_name_snapshot !== line.itemNameSnapshot || stored.item_code_snapshot !== line.itemCodeSnapshot || (stored.hsn_sac_snapshot ?? null) !== (line.hsnSacSnapshot ?? null))
      changes.push(`line ${line.sequence} product details`);
  });
  if (!sameSnapshot(version.customer_snapshot, preview.snapshots.customer)) changes.push("customer details");
  if (!sameSnapshot(version.billing_address_snapshot, preview.snapshots.billingAddress)) changes.push("billing address");
  if (!sameSnapshot(version.shipping_address_snapshot, preview.snapshots.shippingAddress)) changes.push("shipping address");
  if (!sameSnapshot(version.contact_snapshot, preview.snapshots.contact)) changes.push("contact");
  if (changes.length)
    problems.push(`The order has changed since it was saved (${changes.join(", ")}): total ${Number(version.grand_total).toFixed(2)} would now be ${Number(preview.totals.grandTotal).toFixed(2)}. Open the order and save it to bring it up to date, then confirm.`);
  return { version, lines, preview, changes };
}

// How the order differs from its accepted quotation: quantities, lines added or removed, and the total.
async function quotationComparison(client, context, order, version, lines) {
  if (!order.source_quotation_id) return null;
  const quotation = (await client.query(
    `SELECT quotation.id, quotation.quotation_number, quotation.lifecycle_status, quotation.converted_order_id, version.grand_total, version.id AS version_id
       FROM tenant.sales_quotations quotation
       JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
      WHERE quotation.organization_id = $1 AND quotation.id = $2`, [context.organizationId, order.source_quotation_id])).rows[0];
  if (!quotation) return null;
  const quoted = (await client.query(
    `SELECT id, item_name_snapshot, quantity, uom_snapshot FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`,
    [context.organizationId, quotation.version_id])).rows;
  const changes = [];
  for (const line of quoted) {
    const ordered = lines.find((candidate) => candidate.source_quotation_line_id === line.id);
    if (!ordered) changes.push({ item: line.item_name_snapshot, change: "removed", from: Number(line.quantity), to: 0, unit: line.uom_snapshot });
    else if (differs(ordered.quantity, line.quantity)) changes.push({ item: line.item_name_snapshot, change: "quantity", from: Number(line.quantity), to: Number(ordered.quantity), unit: line.uom_snapshot });
  }
  for (const line of lines.filter((candidate) => !candidate.source_quotation_line_id))
    changes.push({ item: line.item_name_snapshot, change: "added", from: 0, to: Number(line.quantity), unit: line.uom_snapshot });
  return {
    quotationId: quotation.id, quotationNumber: quotation.quotation_number, quotationTotal: quotation.grand_total, orderTotal: version.grand_total,
    stillAccepted: quotation.lifecycle_status === "accepted" && quotation.converted_order_id === order.id,
    differs: changes.length > 0 || differs(quotation.grand_total, version.grand_total), changes,
  };
}

// The checks on the stored order itself.
async function orderProblems(client, context, order, preview) {
  const facts = (await client.query(
    `SELECT version.billing_address_id, version.shipping_address_id, version.currency_code, version.payment_term_id, version.grand_total, version.tax_treatment, version.place_of_supply,
            version.customer_po_number, party.status AS party_status, party.party_type, party.display_name, party.sales_block, party.sales_block_reason,
            term.status AS term_status, currency.status AS currency_status, settings.require_customer_po, settings.require_requested_delivery_date
       FROM tenant.sales_order_versions version
       JOIN tenant.business_parties party ON party.organization_id = version.organization_id AND party.id = $3
       LEFT JOIN tenant.payment_terms term ON term.organization_id = version.organization_id AND term.id = version.payment_term_id
       LEFT JOIN tenant.currencies currency ON currency.organization_id = version.organization_id AND currency.code = version.currency_code
       LEFT JOIN tenant.sales_settings settings ON settings.organization_id = version.organization_id
      WHERE version.organization_id = $1 AND version.id = $2`,
    [context.organizationId, order.current_version_id, order.party_id])).rows[0];
  if (!facts) return ["The order has no content."];
  const lines = (await client.query(
    `SELECT line.sequence, line.item_name_snapshot, line.quantity, line.unit_price, line.manual_price_override, line.manual_price_reason, line.warehouse_id, line.tax_amount,
            line.tax_treatment, line.hsn_sac_snapshot, line.uom_id, line.source_quotation_line_id, item.uom_id AS base_uom_id,
            item.status AS item_status, item.is_sellable, item.item_type, COALESCE(item.track_inventory, false) AS track_inventory, warehouse.status AS warehouse_status,
            (line.uom_id IS NULL OR line.uom_id = item.uom_id OR EXISTS (SELECT 1 FROM tenant.item_uom_conversions conversion
               WHERE conversion.organization_id = line.organization_id AND conversion.item_id = line.item_id AND line.uom_id IN (conversion.from_uom_id, conversion.to_uom_id))) AS uom_valid
       FROM tenant.sales_order_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.warehouse_id
      WHERE line.organization_id = $1 AND line.sales_order_version_id = $2 ORDER BY line.sequence`, [context.organizationId, order.current_version_id])).rows;
  const problems = [];
  if (facts.party_status !== "active" || !["customer", "both"].includes(facts.party_type))
    problems.push(`Cannot confirm ${order.sales_order_number}. Customer ${facts.display_name} is ${facts.party_status === "active" ? "not a customer" : "inactive"}.`);
  if (["all", "orders"].includes(facts.sales_block))
    problems.push(`Cannot confirm ${order.sales_order_number}. Customer ${facts.display_name} is blocked. Reason: ${facts.sales_block_reason}`);
  if (!lines.length) problems.push("Add at least one line: an empty order cannot be confirmed.");
  if (!facts.currency_code) problems.push("Choose the currency.");
  else if (facts.currency_status && facts.currency_status !== "active") problems.push("The order currency is no longer active.");
  if (!facts.payment_term_id) problems.push("Choose the payment terms.");
  else if (facts.term_status !== "active") problems.push("The payment terms are no longer active.");
  if (!facts.billing_address_id) problems.push("Choose the billing address.");
  const goods = lines.filter((line) => line.item_type !== "service");
  if (goods.length && !facts.shipping_address_id) problems.push("Choose the shipping address: this order has goods to deliver.");
  if (facts.require_customer_po && !facts.customer_po_number) problems.push("Enter the customer's PO number: Sales settings require it before an order is confirmed.");
  if (facts.require_requested_delivery_date && !order.requested_delivery_date) problems.push("Enter the requested delivery date: Sales settings require it before an order is confirmed.");
  if (Number(facts.grand_total) < 0) problems.push("The order total cannot be negative.");
  const taxEnabled = Boolean(preview?.tax?.enabled);
  for (const line of lines) {
    const name = `Line ${line.sequence} (${line.item_name_snapshot})`;
    if (!(Number(line.quantity) > 0)) problems.push(`${name}: the quantity must be more than zero.`);
    if (!line.uom_valid) problems.push(`${name}: the unit is not one this product is sold in.`);
    if (Number(line.unit_price) === 0 && !line.manual_price_override) problems.push(`${name} has no price.`);
    if (line.manual_price_override && !line.source_quotation_line_id && !line.manual_price_reason) problems.push(`${name}: give the reason for the manual price.`);
    // A quoted line is executed as agreed even if the product has since been withdrawn.
    if (!line.source_quotation_line_id && (line.item_status !== "active" || !line.is_sellable)) problems.push(`${name} is no longer sold.`);
    if (line.track_inventory && line.item_type !== "service") {
      if (!line.warehouse_id) problems.push(`${name}: choose the warehouse it ships from.`);
      else if (line.warehouse_status !== "active") problems.push(`${name}: its warehouse is inactive.`);
    }
    if (taxEnabled && (line.tax_treatment ?? "taxable") === "taxable" && !line.hsn_sac_snapshot)
      problems.push(`${name} has no ${line.item_type === "service" ? "SAC" : "HSN"} code, so its tax cannot be confirmed.`);
  }
  // Tax context: a taxable order must know where it is supplied.
  if (facts.tax_treatment === "taxable" && lines.some((line) => Number(line.tax_amount) > 0) && !facts.place_of_supply)
    problems.push("The place of supply is missing, so tax cannot be confirmed.");
  return problems;
}

// Everything the confirm step reports, for an order already locked and visible.
export async function evaluateConfirmation(client, context, order) {
  const problems = [];
  const warnings = [];
  const { version, lines, preview } = await recalculation(client, context, order, problems);
  problems.unshift(...(await orderProblems(client, context, order, preview)));
  const quotation = await quotationComparison(client, context, order, version, lines);
  if (quotation && !quotation.stillAccepted) problems.push(`Quotation ${quotation.quotationNumber} is no longer the accepted quotation of this order.`);
  if (quotation?.differs) warnings.push(`This order differs from the accepted quotation ${quotation.quotationNumber}.`);
  const settings = (await client.query(`SELECT reserve_stock_on_confirm, check_availability_on_confirm FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  // Stock is checked when Sales settings say so; a shortage never stops a confirmation.
  let shortages = [];
  let availability = null;
  if (settings?.check_availability_on_confirm !== false) {
    availability = await computeOrderAvailability(client, context, order.id);
    shortages = availability.lines.filter((line) => Number(line.shortage) > 0 || line.problem)
      .map((line) => ({ itemName: line.itemName, unit: line.unit, required: line.remaining, available: line.available, shortage: line.shortage, problem: line.problem }));
    if (shortages.length) warnings.push(`Stock is short on ${shortages.length} line(s). The order can still be confirmed; what is available is reserved and the rest later.`);
  }
  return {
    orderId: order.id, orderNumber: order.sales_order_number, status: order.lifecycle_status, versionNumber: Number(order.version_number),
    ready: problems.length === 0, problems: [...new Set(problems)], warnings,
    totals: { saved: version?.grand_total ?? null, recalculated: preview?.totals.grandTotal ?? null, currencyCode: String(version?.currency_code ?? "").trim() },
    quotation, varianceNeedsPermission: Boolean(quotation?.differs) && !orderCan(context, CONFIRMATION_PERMISSIONS.quoteVariance),
    shortages, availabilitySummary: availability?.summaryLabel ?? null, availabilityCheckedAt: availability?.checkedAt ?? null, reservesOnConfirm: settings?.reserve_stock_on_confirm !== false, nextConfirmationVersion: Number(order.confirmation_version ?? 0) + 1,
  };
}

// The checks before confirming, for the confirm dialog. Changes nothing.
export async function validateSalesOrderForConfirmation(client, context, orderId) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== "draft") throw new OrderError(409, "Only a draft order is confirmed.", "SALES_ORDER_NOT_DRAFT");
  return evaluateConfirmation(client, context, order);
}

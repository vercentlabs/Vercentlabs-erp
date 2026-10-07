// How a quotation's content is stored. Each save of a draft writes a new
// immutable version (its edit history); the quotation points at its current
// version. Customer, contact, addresses and payment terms are copied onto the
// version as snapshots, so a later change to the customer, a product or the
// price list never changes a quotation already made.
import { createHash } from "node:crypto";

import { documentDiscountColumns, documentTaxColumns, lineTaxColumns } from "../index.js";
import { asDatabaseDecimal } from "../money.js";
import { QuotationError, dayOf, requireUuid, text } from "./constants.js";

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Writes `preview` (from previewSalesDocument) as the quotation's next version.
export async function insertQuotationVersion(client, context, quotationId, input, preview) {
  const next = await client.query(`SELECT COALESCE(max(version_number), 0) + 1 AS version FROM tenant.sales_quotation_versions WHERE organization_id = $1 AND quotation_id = $2`,
    [context.organizationId, quotationId]);
  const versionNumber = Number(next.rows[0].version);
  const contentHash = sha256(stable({ input, preview: { lines: preview.lines, charges: preview.charges, totals: preview.totals } }));
  const { master, snapshots, totals } = preview;
  const version = (await client.query(
    `INSERT INTO tenant.sales_quotation_versions (organization_id, quotation_id, version_number, revision_reason, currency_code, base_currency_code, exchange_rate, price_list_id,
        payment_term_id, billing_address_id, shipping_address_id, customer_snapshot, contact_snapshot, billing_address_snapshot, shipping_address_snapshot, payment_term_snapshot,
        delivery_terms, shipping_method, incoterm, place_of_supply, supply_type, internal_notes, customer_notes, terms_and_conditions, subtotal, discount_total, charge_total,
        tax_total, rounding_adjustment, grand_total, base_currency_total, cost_total, margin_amount, margin_percent, maximum_discount_percent, pricing_trace, tax_trace,
        content_hash, created_by, document_discount_type, document_discount_value, document_discount_amount, gross_total, line_discount_total, taxable_total,
        discount_reason_code, discount_reason_text, seller_registration_id, seller_snapshot, tax_treatment, tax_override_reason, place_of_supply_name,
        place_of_supply_source, place_of_supply_reason, supply_nature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
             $28, $29, $30, $31, $32, $33, $34, $35, $36::jsonb, $37::jsonb, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49::jsonb, $50, $51, $52, $53, $54, $55) RETURNING *`,
    [context.organizationId, quotationId, versionNumber, text(input.revisionReason, 1000), master.currencyCode, master.baseCurrencyCode, asDatabaseDecimal(master.exchangeRate),
      master.priceList?.id ?? null, master.paymentTerm?.id ?? null, master.billing.id, master.shipping.id, JSON.stringify(snapshots.customer), JSON.stringify(snapshots.contact),
      JSON.stringify(snapshots.billingAddress), JSON.stringify(snapshots.shippingAddress), JSON.stringify(snapshots.paymentTerm), text(input.deliveryTerms), text(input.shippingMethod),
      text(input.incoterm, 40), preview.tax.placeOfSupply?.code ?? null, preview.tax.supplyType, text(input.internalNotes, 10000), text(input.customerNotes, 10000),
      text(input.termsAndConditions, 20000), totals.subtotal, totals.discountTotal, totals.chargeTotal, totals.taxTotal, totals.roundingAdjustment, totals.grandTotal,
      totals.baseCurrencyTotal, totals.costTotal, totals.marginAmount, totals.marginPercent, totals.maximumDiscountPercent, JSON.stringify(preview.pricingTrace),
      JSON.stringify(preview.taxTrace), contentHash, context.userId ?? null, ...documentDiscountColumns(preview), ...documentTaxColumns(preview)],
  )).rows[0];
  for (const line of preview.lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.sales_quotation_lines (organization_id, quotation_version_id, sequence, item_id, uom_id, warehouse_id, item_code_snapshot, item_name_snapshot,
          description_snapshot, hsn_sac_snapshot, uom_snapshot, quantity, base_quantity, conversion_factor, list_unit_price, unit_price, discount_percent, discount_amount,
          net_amount, tax_amount, line_total, standard_cost, cost_amount, margin_amount, margin_percent, tax_category_id, requested_delivery_date, manual_price_override,
          manual_price_reason, pricing_trace, tax_trace, created_by, discount_type, discount_value, gross_amount, document_discount_amount,
          taxable_amount, tax_rate, tax_rate_id, tax_category_code, tax_treatment, hsn_sac_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30::jsonb, $31::jsonb,
               $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42) RETURNING id`,
      [context.organizationId, version.id, line.sequence, line.itemId, line.uomId, line.warehouseId, line.itemCodeSnapshot, line.itemNameSnapshot, line.descriptionSnapshot,
        line.hsnSacSnapshot, line.uomSnapshot, line.quantity, line.baseQuantity, line.conversionFactor, line.listUnitPrice, line.unitPrice, line.discountPercent,
        line.discountAmount, line.netAmount, line.taxAmount, line.lineTotal, line.standardCost, line.costAmount, line.marginAmount, line.marginPercent, line.taxCategoryId,
        line.requestedDeliveryDate, line.manualPriceOverride, line.manualPriceReason, JSON.stringify(line.pricingTrace), JSON.stringify(line.taxTrace),
        context.userId ?? null, line.discountType, line.discountValue, line.grossAmount, line.documentDiscountAmount, line.taxableAmount, ...lineTaxColumns(line)],
    );
    for (const tax of line.taxLines)
      await client.query(
        `INSERT INTO tenant.sales_quotation_tax_lines (organization_id, quotation_version_id, quotation_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount,
            tax_category_id, tax_rate_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [context.organizationId, version.id, inserted.rows[0].id, tax.sequence, tax.taxType, tax.label, tax.rate, tax.taxableAmount, tax.taxAmount, tax.taxCategoryId, tax.taxRateId,
          JSON.stringify(tax.metadata)]);
  }
  for (const charge of preview.charges)
    await client.query(
      `INSERT INTO tenant.sales_quotation_charges (organization_id, quotation_version_id, sequence, charge_type, label, calculation_type, value, amount, taxable, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [context.organizationId, version.id, charge.sequence, charge.chargeType, charge.label, charge.calculationType, charge.value, charge.amount, charge.taxable, context.userId ?? null]);
  return version;
}

// A saved version's discounts, to compare with the next save.
export async function discountSnapshot(client, context, versionId) {
  if (!versionId) return null;
  const version = (await client.query(`SELECT document_discount_type, document_discount_value, document_discount_amount FROM tenant.sales_quotation_versions WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, versionId])).rows[0];
  if (!version) return null;
  const lines = (await client.query(`SELECT sequence, item_id, item_name_snapshot, list_unit_price, unit_price, manual_price_override, discount_type, discount_value, discount_amount
    FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [context.organizationId, versionId])).rows;
  return {
    documentDiscount: { type: version.document_discount_type, value: version.document_discount_value, amount: version.document_discount_amount },
    lines: lines.map((line) => ({
      sequence: line.sequence, itemId: line.item_id, name: line.item_name_snapshot, listPrice: line.list_unit_price, unitPrice: line.unit_price, override: line.manual_price_override,
      type: line.discount_type, value: line.discount_value, amount: line.discount_amount,
    })),
  };
}

// The quotation row, locked for a change.
export async function lockQuotation(client, context, quotationId) {
  const { rows } = await client.query(
    `SELECT quote.*, version.version_number, version.contact_snapshot, version.customer_snapshot, version.grand_total, version.maximum_discount_percent, version.margin_percent,
            version.currency_code, version.billing_address_id, version.price_list_id
       FROM tenant.sales_quotations quote
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
      WHERE quote.organization_id = $1 AND quote.id = $2 FOR UPDATE OF quote`,
    [context.organizationId, requireUuid(quotationId)]);
  if (!rows[0]) throw new QuotationError(404, "Quotation not found.", "SALES_QUOTATION_NOT_FOUND");
  return rows[0];
}

export async function recordQuotationEvent(client, context, quotationId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'quotation', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, quotationId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

// The document input that reproduces a quotation's current version: for a
// revision (prices carried exactly), a duplicate (prices from today's list)
// or the sales order made from it.
export async function inputFromQuotation(client, context, quote, { carryPrices = true } = {}) {
  const version = (await client.query(`SELECT * FROM tenant.sales_quotation_versions WHERE organization_id = $1 AND id = $2`, [context.organizationId, quote.current_version_id])).rows[0];
  const lines = (await client.query(`SELECT * FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [context.organizationId, version.id])).rows;
  // The tax each line was quoted with, so a sales order made from the quotation keeps it.
  const taxRows = carryPrices ? (await client.query(
    `SELECT quotation_line_id, tax_type, label, rate, tax_category_id, tax_rate_id FROM tenant.sales_quotation_tax_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`,
    [context.organizationId, version.id])).rows : [];
  const carriedTax = (line) => ({
    treatment: line.tax_treatment ?? "taxable", taxType: "gst", categoryId: taxRows.find((row) => row.quotation_line_id === line.id)?.tax_category_id ?? null,
    categoryCode: line.tax_category_code, categoryName: null, rateId: line.tax_rate_id, rate: line.tax_rate, supplyNature: version.supply_nature, reverseCharge: false,
    components: taxRows.filter((row) => row.quotation_line_id === line.id).map((row) => ({ type: row.tax_type, label: row.label, rate: row.rate })),
  });
  const charges = (await client.query(`SELECT * FROM tenant.sales_quotation_charges WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [context.organizationId, version.id])).rows;
  return {
    partyId: quote.party_id,
    contactId: quote.contact_id,
    opportunityId: quote.source_opportunity_id,
    ownerUserId: quote.owner_user_id,
    currencyCode: version.currency_code?.trim(),
    exchangeRate: version.exchange_rate,
    priceListId: version.price_list_id,
    paymentTermId: version.payment_term_id,
    // The terms as agreed on the quotation travel with it (to its revision and its sales order), whatever the master says today.
    carriedPaymentTerm: version.payment_term_snapshot,
    billingAddressId: version.billing_address_id,
    shippingAddressId: version.shipping_address_id,
    deliveryTerms: version.delivery_terms,
    shippingMethod: version.shipping_method,
    incoterm: version.incoterm,
    sellerRegistrationId: version.seller_registration_id,
    placeOfSupply: version.place_of_supply,
    placeOfSupplyReason: version.place_of_supply_reason,
    supplyType: version.supply_type,
    taxOverrideReason: version.tax_override_reason,
    internalNotes: version.internal_notes,
    customerNotes: version.customer_notes,
    termsAndConditions: version.terms_and_conditions,
    customerReference: quote.customer_reference,
    documentDiscountType: version.document_discount_type,
    documentDiscountValue: version.document_discount_value,
    discountReasonCode: version.discount_reason_code,
    discountReasonText: version.discount_reason_text,
    lines: lines.map((line) => ({
      itemId: line.item_id,
      uomId: line.uom_id,
      warehouseId: line.warehouse_id,
      description: line.description_snapshot,
      quantity: line.quantity,
      discountType: line.discount_type,
      discountValue: line.discount_value,
      requestedDeliveryDate: dayOf(line.requested_delivery_date),
      ...(carryPrices
        ? { listUnitPrice: line.list_unit_price, unitPrice: line.unit_price, manualPriceOverride: line.manual_price_override, manualPriceReason: line.manual_price_reason, sourceQuotationLineId: line.id,
            carriedTax: carriedTax(line) }
        : line.manual_price_override ? { unitPrice: line.unit_price, manualPriceReason: line.manual_price_reason } : {}),
    })),
    charges: charges.map((charge) => ({ chargeType: charge.charge_type, label: charge.label, calculationType: charge.calculation_type, value: charge.value, taxable: charge.taxable })),
  };
}

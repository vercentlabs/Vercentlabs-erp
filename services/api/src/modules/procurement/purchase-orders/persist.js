// Writing an order: its header, lines and line taxes, and its history.
import { asDatabaseDecimal, decimal, div, mul, roundMoney } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";

const d = (value) => (value === null || value === undefined ? null : asDatabaseDecimal(value));
const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

export async function recordPoEvent(client, context, orderId, eventType, summary, { from = null, to = null, details = {} } = {}) {
  await client.query(
    `INSERT INTO tenant.purchase_order_events (organization_id, purchase_order_id, event_type, from_status, to_status, summary, details, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [context.organizationId, orderId, eventType, from, to, summary, JSON.stringify(details ?? {}), context.userId ?? null]);
}

const HEADER_VALUES = (header, totals) => [
  header.supplierId, header.partyId, header.buyingRegistrationId, header.contact?.relationshipId ?? null, header.orderingAddress?.addressId ?? null,
  header.billingAddress?.addressId ?? null, header.shipFrom?.addressId ?? null, header.supplierTax?.registrationId ?? null, json(header.supplierSnapshot),
  json(header.contact), json(header.orderingAddress), json(header.billingAddress), json(header.shipFrom), json(header.supplierTax), json(header.buyerRegistration),
  json(header.billTo), json(header.shipTo), json(header.paymentTerm), header.orderDate, header.expectedDeliveryDate, header.supplierQuotationReference,
  header.supplierReference, header.currencyCode, header.paymentTermId, header.buyerUserId, header.defaultWarehouseId, header.priceMode,
  totals.documentDiscountType, d(totals.documentDiscountValue), d(totals.documentDiscountAmount), d(totals.grossTotal), d(totals.lineDiscountTotal),
  d(totals.taxableTotal), d(totals.taxTotal), d(totals.grandTotal), header.supplierNotes, header.internalNotes,
  header.advancePercentage ?? null, header.advancePercentage ? d(roundMoney(mul(decimal(totals.grandTotal), div(decimal(header.advancePercentage), decimal(100))), 2)) : null,
  header.paymentTermsNote ?? null, header.paymentTermChangeReason ?? null,
];
const HEADER_COLUMNS = `supplier_id, party_id, buying_registration_id, supplier_contact_id, supplier_address_id, supplier_billing_address_id, supplier_ship_from_id,
  supplier_tax_registration_id, supplier_snapshot, contact_snapshot, ordering_address_snapshot, billing_address_snapshot, ship_from_snapshot, supplier_tax_snapshot,
  buyer_registration_snapshot, bill_to_snapshot, ship_to_snapshot, payment_term_snapshot, order_date, expected_delivery_date, supplier_quotation_reference,
  supplier_reference, currency_code, payment_term_id, buyer_user_id, default_warehouse_id, price_mode, document_discount_type, document_discount_value,
  document_discount_amount, gross_total, line_discount_total, taxable_total, tax_total, grand_total, supplier_notes, internal_notes, advance_percentage, advance_amount,
  payment_terms_note, payment_term_change_reason`;

export async function insertOrder(client, context, header, priced, { sourceQuotationId = null } = {}) {
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "purchase_order", at: new Date(`${header.orderDate}T12:00:00Z`) });
  const values = HEADER_VALUES(header, priced.totals);
  const placeholders = values.map((_, index) => `$${index + 4}`).join(", ");
  const order = (await client.query(
    `INSERT INTO tenant.purchase_orders (organization_id, purchase_order_number, source_quotation_id, ${HEADER_COLUMNS}, created_by, updated_by)
     VALUES ($1, $2, $3, ${placeholders}, $${values.length + 4}, $${values.length + 4}) RETURNING *`,
    [context.organizationId, number, sourceQuotationId, ...values, context.userId ?? null])).rows[0];
  await writeLines(client, context, order.id, priced.lines);
  return order;
}

export async function updateOrderHeader(client, context, orderId, header, priced) {
  const values = HEADER_VALUES(header, priced.totals);
  const sets = HEADER_COLUMNS.split(",").map((column, index) => `${column.trim()} = $${index + 3}`).join(", ");
  await client.query(
    `UPDATE tenant.purchase_orders SET ${sets}, revision = revision + 1, updated_by = $${values.length + 3}, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, orderId, ...values, context.userId ?? null]);
  await writeLines(client, context, orderId, priced.lines);
}

// Lines that keep their id are updated, new ones inserted, the rest removed (a draft's lines are referenced by nothing else).
async function writeLines(client, context, orderId, lines) {
  const organizationId = context.organizationId;
  const existing = new Set((await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, orderId])).rows.map((row) => row.id));
  const kept = new Set(lines.map((line) => line.lineId).filter((id) => id && existing.has(id)));
  await client.query(`DELETE FROM tenant.purchase_order_line_taxes WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, orderId]);
  await client.query(`DELETE FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 AND NOT (id = ANY($3::uuid[]))`, [organizationId, orderId, [...kept]]);
  // Line numbers are rewritten in order; move kept lines out of the way first.
  await client.query(`UPDATE tenant.purchase_order_lines SET line_number = line_number + 100000 WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, orderId]);
  for (const line of lines) {
    const values = [
      line.lineNumber, line.productType, line.productId, json(line.productSnapshot), line.description, line.hsnSacCode ?? null, d(line.quantity), line.uom.id,
      json(line.uomSnapshot), d(line.conversionFactor), line.baseUomId, d(line.baseQuantity), d(line.unitPrice ?? 0n), line.priceSource, line.zeroPriceReason
        ?? (line.unitPrice === null ? "price not entered" : null),
      line.discountType, d(line.discountValue), d(line.gross), d(line.lineDiscount), d(line.allocatedDocumentDiscount), d(line.taxableAmount), line.taxCategoryId,
      line.taxTreatment, d(line.taxRate), d(line.taxTotal), d(line.lineTotal), line.warehouseId, line.expectedDeliveryDate, line.sourceQuotationLineId,
      line.expenseAccountId,
    ];
    let lineId = line.lineId && kept.has(line.lineId) ? line.lineId : null;
    if (lineId) {
      await client.query(
        `UPDATE tenant.purchase_order_lines SET line_number = $3, product_type = $4, product_id = $5, product_snapshot = $6::jsonb, description = $7, hsn_sac_code = $8,
                ordered_quantity = $9, purchase_uom_id = $10, uom_snapshot = $11::jsonb, conversion_factor = $12, base_uom_id = $13, base_quantity = $14, unit_price = $15,
                price_source = $16, zero_price_reason = $17, discount_type = $18, discount_value = $19, gross_amount = $20, line_discount = $21,
                allocated_document_discount = $22, taxable_amount = $23, tax_category_id = $24, tax_treatment = $25, tax_rate = $26, tax_total = $27, line_total = $28,
                receiving_warehouse_id = $29, expected_delivery_date = $30, source_quotation_line_id = $31, expense_account_id = $32, updated_at = now()
          WHERE organization_id = $1 AND id = $2`, [organizationId, lineId, ...values]);
    } else {
      lineId = (await client.query(
        `INSERT INTO tenant.purchase_order_lines (organization_id, purchase_order_id, line_number, product_type, product_id, product_snapshot, description, hsn_sac_code,
           ordered_quantity, purchase_uom_id, uom_snapshot, conversion_factor, base_uom_id, base_quantity, unit_price, price_source, zero_price_reason, discount_type,
           discount_value, gross_amount, line_discount, allocated_document_discount, taxable_amount, tax_category_id, tax_treatment, tax_rate, tax_total, line_total,
           receiving_warehouse_id, expected_delivery_date, source_quotation_line_id, expense_account_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                 $31, $32) RETURNING id`, [organizationId, orderId, ...values])).rows[0].id;
    }
    for (const [sequence, component] of line.components.entries()) {
      await client.query(
        `INSERT INTO tenant.purchase_order_line_taxes (organization_id, purchase_order_id, purchase_order_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [organizationId, orderId, lineId, sequence + 1, component.type, component.label, d(component.rate), d(component.taxableAmount), d(component.taxAmount)]);
    }
  }
}

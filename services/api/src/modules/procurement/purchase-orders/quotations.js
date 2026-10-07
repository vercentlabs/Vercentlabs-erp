// Supplier quotations: what a supplier offered (products, quantities, prices,
// discounts, terms), recorded so a purchase order can be made from it without
// retyping and without repricing. A quotation converts once; converting it
// again names the order it already became (unless that order was cancelled).
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { decimal, formatDecimal } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { assertSupplierUsable } from "../suppliers/defaults.js";
import { poCan, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, STATUS, dayOf, fail, has, isUuid, optionalUuid, readDate, requireUuid, text } from "./constants.js";
import { databaseToday, resolveOrderDocument, translated } from "./document.js";
import { insertOrder, recordPoEvent } from "./persist.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;

function requireQuotationAccess(context) {
  if (!poCan(context, PO_PERMISSIONS.quotations) && !poCan(context, PO_PERMISSIONS.view) && !poCan(context, PO_PERMISSIONS.viewAll))
    throw new PurchaseOrderError(403, "You do not have permission to view supplier quotations.", "PERMISSION_DENIED");
}

async function readQuotationInput(client, context, input, current = null) {
  const supplierId = requireUuid(input.supplierId ?? current?.supplier_id, "Supplier");
  await translated(() => assertSupplierUsable(client, context.organizationId, supplierId, { purpose: "a supplier quotation" }));
  const currencyCode = String(text(input.currencyCode, 3) ?? current?.currency_code ?? "").trim().toUpperCase()
    || (await client.query(`SELECT default_currency FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0].default_currency;
  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!current && (!lines || !lines.length)) fail("Add at least one quoted line.", "lines");
  const parsed = [];
  for (const [index, line] of (lines ?? []).entries()) {
    const label = `Line ${index + 1}`;
    const itemId = requireUuid(line.productId ?? line.itemId, `${label} product`);
    const item = (await client.query(`SELECT id, uom_id, purchase_uom_id, status FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, itemId])).rows[0];
    if (!item) fail(`${label}: the product was not found.`, "productId", "PURCHASE_ORDER_PRODUCT_INVALID", 409);
    const quantity = String(line.quantity ?? "").trim();
    if (!QTY.test(quantity) || decimal(quantity) <= 0n) fail(`${label}: the quantity must be greater than zero.`, "quantity");
    const price = String(line.unitPrice ?? "").trim();
    if (!QTY.test(price)) fail(`${label}: enter the quoted price.`, "unitPrice");
    const discountType = ["percent", "amount"].includes(line.discountType) ? line.discountType : null;
    const discountValue = discountType ? String(line.discountValue ?? "0").trim() : "0";
    if (!QTY.test(discountValue) || (discountType === "percent" && decimal(discountValue) > decimal(100))) fail(`${label}: check the discount.`, "discountValue");
    parsed.push({ itemId, description: text(line.description, 2000), quantity, uomId: optionalUuid(line.uomId, "Unit") ?? item.purchase_uom_id ?? item.uom_id, unitPrice: price,
      discountType, discountValue, taxCategoryId: optionalUuid(line.taxCategoryId, "Tax category") });
  }
  const discountType = ["percent", "amount"].includes(input.documentDiscountType) ? input.documentDiscountType : has(input, "documentDiscountType") ? null : current?.document_discount_type ?? null;
  return {
    supplierId, currencyCode, lines: lines ? parsed : null,
    supplierReference: has(input, "supplierReference") ? text(input.supplierReference, 200) : current?.supplier_reference ?? null,
    rfqReference: has(input, "rfqReference") ? text(input.rfqReference, 200) : current?.rfq_reference ?? null,
    quotationDate: readDate(input.quotationDate, "Quotation date") ?? (current ? dayOf(current.quotation_date) : await databaseToday(client)),
    validUntil: has(input, "validUntil") ? readDate(input.validUntil, "Valid until") : current ? dayOf(current.valid_until) : null,
    paymentTermId: has(input, "paymentTermId") ? optionalUuid(input.paymentTermId, "Payment terms") : current?.payment_term_id ?? null,
    priceMode: (has(input, "priceMode") ? input.priceMode : current?.price_mode) === "inclusive" ? "inclusive" : "exclusive",
    documentDiscountType: discountType, documentDiscountValue: discountType ? String(input.documentDiscountValue ?? current?.document_discount_value ?? "0") : "0",
    deliveryLeadDays: has(input, "deliveryLeadDays") ? (input.deliveryLeadDays === null || input.deliveryLeadDays === "" ? null : Math.max(0, Math.floor(Number(input.deliveryLeadDays) || 0))) : current?.delivery_lead_days ?? null,
    notes: has(input, "notes") ? text(input.notes, 4000) : current?.notes ?? null,
  };
}

async function writeQuotationLines(client, context, quotationId, lines) {
  await client.query(`DELETE FROM tenant.supplier_quotation_lines WHERE organization_id = $1 AND supplier_quotation_id = $2`, [context.organizationId, quotationId]);
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO tenant.supplier_quotation_lines (organization_id, supplier_quotation_id, line_number, item_id, description, quantity, uom_id, unit_price, discount_type, discount_value, tax_category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [context.organizationId, quotationId, index + 1, line.itemId, line.description, line.quantity, line.uomId, line.unitPrice, line.discountType, line.discountValue, line.taxCategoryId]);
  }
}

export async function createSupplierQuotation(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.quotations, "You do not have permission to record supplier quotations.");
  const data = await readQuotationInput(client, context, input);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "supplier_quotation" });
  const row = (await client.query(
    `INSERT INTO tenant.supplier_quotations (organization_id, quotation_number, supplier_id, supplier_reference, rfq_reference, quotation_date, valid_until, currency_code, payment_term_id,
       price_mode, document_discount_type, document_discount_value, delivery_lead_days, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id, quotation_number`,
    [context.organizationId, number, data.supplierId, data.supplierReference, data.rfqReference, data.quotationDate, data.validUntil, data.currencyCode, data.paymentTermId, data.priceMode,
      data.documentDiscountType, data.documentDiscountValue, data.deliveryLeadDays, data.notes, context.userId ?? null])).rows[0];
  await writeQuotationLines(client, context, row.id, data.lines);
  return { id: row.id, quotationNumber: row.quotation_number };
}

async function lockQuotation(client, context, quotationId) {
  const row = (await client.query(`SELECT * FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, requireUuid(quotationId, "Quotation")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Supplier quotation not found.", "SUPPLIER_QUOTATION_NOT_FOUND");
  return row;
}

export async function updateSupplierQuotation(client, context, quotationId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.quotations, "You do not have permission to change supplier quotations.");
  const current = await lockQuotation(client, context, quotationId);
  if (current.status !== "received") throw new PurchaseOrderError(409, `A ${current.status} quotation cannot be changed.`, "SUPPLIER_QUOTATION_LOCKED");
  const data = await readQuotationInput(client, context, input, current);
  await client.query(
    `UPDATE tenant.supplier_quotations SET supplier_id = $3, supplier_reference = $4, rfq_reference = $5, quotation_date = $6, valid_until = $7, currency_code = $8, payment_term_id = $9,
            price_mode = $10, document_discount_type = $11, document_discount_value = $12, delivery_lead_days = $13, notes = $14, updated_by = $15, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, data.supplierId, data.supplierReference, data.rfqReference, data.quotationDate, data.validUntil, data.currencyCode, data.paymentTermId,
      data.priceMode, data.documentDiscountType, data.documentDiscountValue, data.deliveryLeadDays, data.notes, context.userId ?? null]);
  if (data.lines) await writeQuotationLines(client, context, current.id, data.lines);
  return { id: current.id };
}

export async function cancelSupplierQuotation(client, context, quotationId) {
  requirePoPermission(context, PO_PERMISSIONS.quotations, "You do not have permission to change supplier quotations.");
  const current = await lockQuotation(client, context, quotationId);
  if (current.status === "converted") throw new PurchaseOrderError(409, "This quotation became a purchase order. Cancel the order instead.", "SUPPLIER_QUOTATION_LOCKED");
  await client.query(`UPDATE tenant.supplier_quotations SET status = 'cancelled', updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, context.userId ?? null]);
  return { id: current.id, status: "cancelled" };
}

export async function getSupplierQuotation(client, context, quotationId) {
  requireQuotationAccess(context);
  const row = (await client.query(
    `SELECT quotation.*, party.display_name AS supplier_name, supplier.supplier_number, term.name AS payment_term_name, po.purchase_order_number AS converted_purchase_order_number
       FROM tenant.supplier_quotations quotation
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = quotation.organization_id AND supplier.id = quotation.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
       LEFT JOIN tenant.payment_terms term ON term.organization_id = quotation.organization_id AND term.id = quotation.payment_term_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = quotation.organization_id AND po.id = quotation.converted_purchase_order_id
      WHERE quotation.organization_id = $1 AND quotation.id = $2`, [context.organizationId, requireUuid(quotationId, "Quotation")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Supplier quotation not found.", "SUPPLIER_QUOTATION_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, uom.code AS uom_code FROM tenant.supplier_quotation_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.supplier_quotation_id = $2 ORDER BY line.line_number`, [context.organizationId, row.id])).rows;
  return {
    quotation: {
      id: row.id, quotationNumber: row.quotation_number, supplierId: row.supplier_id, supplierName: row.supplier_name, supplierNumber: row.supplier_number,
      supplierReference: row.supplier_reference, rfqReference: row.rfq_reference, quotationDate: dayOf(row.quotation_date), validUntil: dayOf(row.valid_until),
      currencyCode: row.currency_code?.trim(), paymentTermId: row.payment_term_id, paymentTermName: row.payment_term_name, priceMode: row.price_mode,
      documentDiscountType: row.document_discount_type, documentDiscountValue: dec(row.document_discount_value), deliveryLeadDays: row.delivery_lead_days, notes: row.notes,
      status: row.status, convertedPurchaseOrderId: row.converted_purchase_order_id, convertedPurchaseOrderNumber: row.converted_purchase_order_number,
      expired: Boolean(row.valid_until && dayOf(row.valid_until) < await databaseToday(client)),
    },
    lines: lines.map((line) => ({
      id: line.id, lineNumber: line.line_number, productId: line.item_id, productCode: line.item_code, productName: line.item_name, description: line.description,
      quantity: dec(line.quantity), uomId: line.uom_id, uomCode: line.uom_code, unitPrice: dec(line.unit_price), discountType: line.discount_type, discountValue: dec(line.discount_value),
      taxCategoryId: line.tax_category_id,
    })),
    actions: {
      edit: row.status === "received" && poCan(context, PO_PERMISSIONS.quotations),
      convert: row.status === "received" && poCan(context, PO_PERMISSIONS.create),
      cancel: row.status === "received" && poCan(context, PO_PERMISSIONS.quotations),
    },
  };
}

export async function listSupplierQuotations(client, context, filters = {}) {
  requireQuotationAccess(context);
  const values = [context.organizationId];
  let where = "";
  if (["received", "converted", "cancelled"].includes(filters.status)) { values.push(filters.status); where += ` AND quotation.status = $${values.length}`; }
  if (isUuid(filters.supplierId)) { values.push(filters.supplierId); where += ` AND quotation.supplier_id = $${values.length}`; }
  const search = text(filters.search, 120);
  if (search) { values.push(`%${search}%`); where += ` AND (quotation.quotation_number ILIKE $${values.length} OR quotation.supplier_reference ILIKE $${values.length} OR party.display_name ILIKE $${values.length})`; }
  const { rows } = await client.query(
    `SELECT quotation.id, quotation.quotation_number, quotation.status, quotation.quotation_date, quotation.valid_until, quotation.currency_code, quotation.supplier_reference,
            party.display_name AS supplier_name, po.purchase_order_number, quotation.converted_purchase_order_id,
            (SELECT COALESCE(sum(line.quantity * line.unit_price), 0) FROM tenant.supplier_quotation_lines line WHERE line.organization_id = quotation.organization_id AND line.supplier_quotation_id = quotation.id) AS gross
       FROM tenant.supplier_quotations quotation
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = quotation.organization_id AND supplier.id = quotation.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = quotation.organization_id AND po.id = quotation.converted_purchase_order_id
      WHERE quotation.organization_id = $1${where} ORDER BY quotation.quotation_date DESC, quotation.created_at DESC LIMIT 300`, values);
  return rows.map((row) => ({
    id: row.id, quotationNumber: row.quotation_number, status: row.status, quotationDate: dayOf(row.quotation_date), validUntil: dayOf(row.valid_until), currencyCode: row.currency_code?.trim(),
    supplierReference: row.supplier_reference, supplierName: row.supplier_name, grossValue: dec(row.gross), purchaseOrderId: row.converted_purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number,
  }));
}

// createPurchaseOrderFromQuotation. input: any order header field to set on the new draft (expected date, warehouse, buyer, ship-to…), idempotencyKey.
// The lines, prices, discounts, currency and terms are the quotation's.
export async function createPurchaseOrderFromQuotation(client, context, quotationId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to create purchase orders.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.purchase_order.from_quotation", key: text(input.idempotencyKey, 200), payload: { quotationId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const quotation = await lockQuotation(client, context, quotationId);
  if (quotation.status === "converted") {
    const existing = (await client.query(`SELECT purchase_order_number FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, quotation.converted_purchase_order_id])).rows[0];
    throw new PurchaseOrderError(409, `This quotation is already purchase order ${existing?.purchase_order_number ?? ""}.`.replace(" .", "."), "SUPPLIER_QUOTATION_ALREADY_CONVERTED",
      { purchaseOrderId: quotation.converted_purchase_order_id });
  }
  if (quotation.status !== "received") throw new PurchaseOrderError(409, "A cancelled quotation cannot become an order.", "SUPPLIER_QUOTATION_LOCKED");
  const lines = (await client.query(`SELECT * FROM tenant.supplier_quotation_lines WHERE organization_id = $1 AND supplier_quotation_id = $2 ORDER BY line_number`,
    [context.organizationId, quotation.id])).rows;
  const today = await databaseToday(client);
  const document = {
    ...input,
    supplierId: quotation.supplier_id, currencyCode: quotation.currency_code.trim(), paymentTermId: quotation.payment_term_id ?? input.paymentTermId ?? undefined,
    priceMode: quotation.price_mode, documentDiscountType: quotation.document_discount_type, documentDiscountValue: formatDecimal(quotation.document_discount_value),
    supplierQuotationReference: quotation.supplier_reference ?? quotation.quotation_number,
    expectedDeliveryDate: input.expectedDeliveryDate ?? (quotation.delivery_lead_days != null
      ? (await client.query(`SELECT (current_date + $1::int)::text AS day`, [quotation.delivery_lead_days])).rows[0].day : undefined),
    lines: lines.map((line) => ({
      productId: line.item_id, description: line.description ?? undefined, quantity: formatDecimal(line.quantity), uomId: line.uom_id, unitPrice: formatDecimal(line.unit_price),
      discountType: line.discount_type, discountValue: formatDecimal(line.discount_value), priceSource: "quotation", sourceQuotationLineId: line.id,
      carriedTaxCategoryId: line.tax_category_id ?? undefined, zeroPriceReason: decimal(line.unit_price) === 0n ? "Quoted at no charge" : undefined, carried: decimal(line.unit_price) === 0n,
      warehouseId: input.defaultWarehouseId ?? undefined,
    })),
  };
  const { header, priced } = await resolveOrderDocument(client, context, document, { today });
  const order = await insertOrder(client, context, header, priced, { sourceQuotationId: quotation.id });
  await client.query(`UPDATE tenant.supplier_quotations SET status = 'converted', converted_purchase_order_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quotation.id, order.id, context.userId ?? null]);
  await recordPoEvent(client, context, order.id, "purchase_order.created", `Created from supplier quotation ${quotation.quotation_number} · ${header.currencyCode} ${formatDecimal(priced.totals.grandTotal)}`,
    { to: STATUS.draft, details: { source: "supplier_quotation", quotationId: quotation.id, quotationNumber: quotation.quotation_number } });
  const response = { id: order.id, purchaseOrderNumber: order.purchase_order_number, revision: order.revision, replayed: false,
    warnings: quotation.valid_until && dayOf(quotation.valid_until) < today ? [{ code: "QUOTATION_EXPIRED", message: `The quotation expired on ${dayOf(quotation.valid_until)}. Check the prices with the supplier.` }] : [] };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "purchase_order", aggregateId: order.id });
  return response;
}

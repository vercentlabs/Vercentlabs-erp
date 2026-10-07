// Creating, editing, reading and listing purchase orders.
//
// An order is always for one Supplier Master supplier. It is created directly
// (Procurement → Purchase Orders → New, or from the supplier) or from a
// supplier quotation. A Draft can be edited freely within permissions; once
// confirmed it changes only through an amendment (reconfirmed as the next
// version), expected-date updates, warehouse changes and cancelling what is
// still outstanding.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { decimal, formatDecimal } from "../../../core/decimal.js";
import { loadPurchaseOrder, poCan, poCapabilities, poScopeSql, requirePoAccess, requirePoPermission } from "./access.js";
import {
  BILLING_LABELS, CANCEL_REASONS, COMMUNICATION_LABELS, PAYMENT_LABELS, PO_PERMISSIONS, PO_VIEWS, PRODUCT_TYPE_LABELS, PurchaseOrderError, RECEIPT_LABELS, SENT_CHANNELS,
  STATUS, STATUS_LABELS, dayOf, fail, has, isUuid, optionalUuid, requireUuid, text,
} from "./constants.js";
import { databaseToday, linesAsInput, procurementSettings, resolveOrderDocument, translated } from "./document.js";
import { insertOrder, recordPoEvent, updateOrderHeader } from "./persist.js";
import { pricedView } from "./pricing.js";
import { LIST_PROGRESS_COLUMNS, LIST_PROGRESS_SQL, loadLineProgress, trackingFor } from "./progress.js";
import { MATCHING_POLICY_LABELS } from "./lifecycle.js";
import { resolveSupplierDefaults } from "../suppliers/defaults.js";
import { getPurchaseOrderRejections, getRejectionSummary } from "./rejection-records.js";
import { getPurchaseOrderPaymentTerms } from "../payment-terms/orders.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

// A line from a supplier quotation keeps the quoted price unless whoever edits may override prices.
async function enforceQuotedPrices(client, context, lines) {
  const quoted = lines.filter((line) => line.sourceQuotationLineId);
  if (!quoted.length || poCan(context, PO_PERMISSIONS.overridePrice)) return;
  const { rows } = await client.query(`SELECT id, unit_price, discount_type, discount_value FROM tenant.supplier_quotation_lines WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [context.organizationId, quoted.map((line) => line.sourceQuotationLineId)]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const line of quoted) {
    const source = byId.get(line.sourceQuotationLineId);
    if (!source) continue;
    if (line.unitPrice !== decimal(source.unit_price) || (line.discountType ?? null) !== (source.discount_type ?? null) || line.discountValue !== decimal(source.discount_value))
      throw new PurchaseOrderError(403, `Line ${line.lineNumber}: the price and discount come from the supplier quotation. You may not change them.`, "PURCHASE_ORDER_QUOTED_PRICE_LOCKED");
  }
}

function warnZeroAndMissing(priced) {
  return priced.lines.filter((line) => line.unitPrice === 0n).map((line) => ({ line: line.lineNumber, code: "ZERO_PRICE", message: `Line ${line.lineNumber} is at no charge: ${line.zeroPriceReason}` }));
}

// Recent orders of the same supplier for the same products: a warning (a repeat purchase is legitimate), never a refusal.
export async function similarOrders(client, context, { supplierId, productIds, exceptOrderId = null }) {
  if (!productIds.length) return [];
  const { rows } = await client.query(
    `SELECT po.id, po.purchase_order_number, po.status, po.order_date, count(DISTINCT line.product_id)::int AS shared
       FROM tenant.purchase_orders po JOIN tenant.purchase_order_lines line ON line.organization_id = po.organization_id AND line.purchase_order_id = po.id
      WHERE po.organization_id = $1 AND po.supplier_id = $2 AND po.status IN ('draft', 'confirmed') AND line.product_id = ANY($3::uuid[])
        AND ($4::uuid IS NULL OR po.id <> $4) AND po.created_at > now() - interval '30 days'
      GROUP BY po.id ORDER BY po.created_at DESC LIMIT 5`,
    [context.organizationId, supplierId, productIds, exceptOrderId]);
  return rows.map((row) => ({ id: row.id, number: row.purchase_order_number, status: row.status, orderDate: dayOf(row.order_date), sharedProducts: row.shared }));
}

// createPurchaseOrder. input: supplierId, buyingRegistrationId?, supplierContactId?, supplierAddressId?, supplierBillingAddressId?, supplierShipFromId?,
// supplierTaxRegistrationId?, shipTo?, currencyCode?, paymentTermId?, buyerUserId?, defaultWarehouseId?, orderDate?, expectedDeliveryDate?, priceMode?,
// documentDiscountType?, documentDiscountValue?, supplierReference?, supplierQuotationReference?, supplierNotes?, internalNotes?,
// lines[{ productId | (description, productType, uomId, taxCategoryId | noTax, expenseAccountId), quantity, uomId?, unitPrice, zeroPriceReason?, discountType?,
// discountValue?, warehouseId?, expectedDeliveryDate? }], idempotencyKey?
export async function createPurchaseOrder(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to create purchase orders.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.purchase_order.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const { header, priced } = await resolveOrderDocument(client, context, input, { today: await databaseToday(client) });
  if (priced.lines.some((line) => line.sourceQuotationLineId)) fail("Create an order from a quotation with Create Purchase Order on the quotation.", "lines");
  const order = await insertOrder(client, context, header, priced);
  await recordPoEvent(client, context, order.id, "purchase_order.created", `Created for ${header.supplierSnapshot.supplierName} · ${header.currencyCode} ${dec(priced.totals.grandTotal)}`,
    { to: STATUS.draft, details: { source: "direct", lines: priced.lines.length, total: dec(priced.totals.grandTotal) } });
  const response = {
    id: order.id, purchaseOrderNumber: order.purchase_order_number, revision: order.revision, warnings: warnZeroAndMissing(priced),
    similarOrders: await similarOrders(client, context, { supplierId: header.supplierId, productIds: priced.lines.map((line) => line.productId).filter(Boolean), exceptOrderId: order.id }),
    replayed: false,
  };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "purchase_order", aggregateId: order.id });
  return response;
}

async function editableDraft(client, context, orderId, expectedRevision) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to edit purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.draft)
    throw new PurchaseOrderError(409, `A ${order.status} order cannot be edited.${order.status === STATUS.confirmed ? " Amend it to change it." : ""}`, "PURCHASE_ORDER_LOCKED");
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== Number(order.revision))
    throw new PurchaseOrderError(409, "Someone else changed this order. Reload it and make your change again.", "PURCHASE_ORDER_STALE");
  return order;
}

async function saveDraft(client, context, order, input, eventType, summary) {
  const { header, priced } = await resolveOrderDocument(client, context, input, { order, today: await databaseToday(client) });
  await enforceQuotedPrices(client, context, priced.lines);
  const before = { total: dec(order.grand_total), supplier: order.supplier_id };
  await updateOrderHeader(client, context, order.id, header, priced);
  await recordPoEvent(client, context, order.id, eventType, summary ?? `Draft changed · ${header.currencyCode} ${dec(priced.totals.grandTotal)}`, {
    from: STATUS.draft, to: STATUS.draft,
    details: { totalBefore: before.total, totalAfter: dec(priced.totals.grandTotal), supplierChanged: before.supplier !== header.supplierId },
  });
  return { id: order.id, revision: Number(order.revision) + 1, warnings: warnZeroAndMissing(priced) };
}

// updateDraftPurchaseOrder. input: any createPurchaseOrder field, expectedRevision.
export async function updateDraftPurchaseOrder(client, context, orderId, input = {}) {
  const order = await editableDraft(client, context, orderId, input.expectedRevision);
  return saveDraft(client, context, order, input, "purchase_order.updated");
}

export async function addPurchaseOrderLine(client, context, orderId, line = {}, { expectedRevision } = {}) {
  const order = await editableDraft(client, context, orderId, expectedRevision);
  const lines = await linesAsInput(client, context.organizationId, order.id);
  return saveDraft(client, context, order, { lines: [...lines, { ...line, lineId: undefined, sourceQuotationLineId: undefined }] }, "purchase_order.line_added", "Line added");
}

export async function updateDraftPurchaseOrderLine(client, context, orderId, lineId, changes = {}, { expectedRevision } = {}) {
  const order = await editableDraft(client, context, orderId, expectedRevision);
  const lines = await linesAsInput(client, context.organizationId, order.id);
  const index = lines.findIndex((line) => line.lineId === requireUuid(lineId, "Line"));
  if (index < 0) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
  lines[index] = { ...lines[index], ...changes, lineId: lines[index].lineId, sourceQuotationLineId: lines[index].sourceQuotationLineId };
  return saveDraft(client, context, order, { lines }, "purchase_order.line_changed", `Line ${index + 1} changed`);
}

export async function removeDraftPurchaseOrderLine(client, context, orderId, lineId, { expectedRevision } = {}) {
  const order = await editableDraft(client, context, orderId, expectedRevision);
  const lines = await linesAsInput(client, context.organizationId, order.id);
  const remaining = lines.filter((line) => line.lineId !== requireUuid(lineId, "Line"));
  if (remaining.length === lines.length) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
  if (!remaining.length) fail("An order needs at least one line.", "lines", "PURCHASE_ORDER_NO_LINES", 409);
  return saveDraft(client, context, order, { lines: remaining }, "purchase_order.line_removed", "Line removed");
}

// The totals a save would store, without saving: what the order form shows while it is edited.
// A missing price is reported, not refused. orderId: the draft being edited, if any.
export async function previewPurchaseOrder(client, context, input = {}, orderId = null) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to edit purchase orders.");
  const order = orderId ? await loadPurchaseOrder(client, context, orderId) : null;
  const { header, priced } = await resolveOrderDocument(client, context, input, { order, today: await databaseToday(client), allowMissingPrice: true });
  return {
    ...pricedView(priced),
    supplier: header.supplierSnapshot, currencyCode: header.currencyCode, paymentTerm: header.paymentTerm, contact: header.contact, orderingAddress: header.orderingAddress,
    billingAddress: header.billingAddress, shipFrom: header.shipFrom, supplierTaxRegistration: header.supplierTax, buyerRegistration: header.buyerRegistration,
    billTo: header.billTo, shipTo: header.shipTo, buyerUserId: header.buyerUserId, defaultWarehouseId: header.defaultWarehouseId,
  };
}

// resolveSupplierDefaults for a new order, with each product's suggested purchase cost (a suggestion only: the agreed price is entered).
export async function getPurchaseOrderDefaults(client, context, { supplierId, productIds = [] } = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to create purchase orders.");
  const supplier = supplierId ? await translated(() => resolveSupplierDefaults(client, context, requireUuid(supplierId, "Supplier"), "purchase_order")) : null;
  const ids = (Array.isArray(productIds) ? productIds : String(productIds || "").split(",")).filter(isUuid);
  const products = ids.length ? (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.purchase_price, item.standard_cost, item.purchase_uom_id, item.uom_id, item.tax_category_id
       FROM tenant.items item WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[])`, [context.organizationId, ids])).rows
    .map((row) => ({ id: row.id, code: row.code, name: row.name, suggestedPrice: Number(row.purchase_price) > 0 ? formatDecimal(row.purchase_price) : Number(row.standard_cost) > 0 ? formatDecimal(row.standard_cost) : null,
      uomId: row.purchase_uom_id ?? row.uom_id, productType: row.item_type === "service" ? "service" : row.track_inventory ? "stock" : "non_stock" })) : [];
  const settings = await procurementSettings(client, context.organizationId);
  return { supplier, products, settings, today: await databaseToday(client) };
}

const ORDER_COLUMNS = `po.*, supplier.supplier_number, party.display_name AS supplier_name, buyer.full_name AS buyer_name, warehouse.name AS default_warehouse_name,
  creator.full_name AS created_by_name, confirmer.full_name AS confirmed_by_name, closer.full_name AS closed_by_name, canceller.full_name AS cancelled_by_name,
  quotation.quotation_number AS source_quotation_number`;
const ORDER_JOINS = `
  JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = po.organization_id AND supplier.id = po.supplier_id
  JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
  LEFT JOIN public.users buyer ON buyer.id = po.buyer_user_id
  LEFT JOIN public.users creator ON creator.id = po.created_by
  LEFT JOIN public.users confirmer ON confirmer.id = po.confirmed_by
  LEFT JOIN public.users closer ON closer.id = po.closed_by
  LEFT JOIN public.users canceller ON canceller.id = po.cancelled_by
  LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = po.organization_id AND warehouse.id = po.default_warehouse_id
  LEFT JOIN tenant.supplier_quotations quotation ON quotation.organization_id = po.organization_id AND quotation.id = po.source_quotation_id`;

function headerView(row) {
  return {
    id: row.id, purchaseOrderNumber: row.purchase_order_number, status: row.status, statusLabel: STATUS_LABELS[row.status], communicationStatus: row.communication_status,
    communicationLabel: COMMUNICATION_LABELS[row.communication_status], supplierId: row.supplier_id, supplierNumber: row.supplier_number, supplierName: row.supplier_name,
    partyId: row.party_id, supplier: row.supplier_snapshot, contact: row.contact_snapshot, orderingAddress: row.ordering_address_snapshot, billingAddress: row.billing_address_snapshot,
    shipFrom: row.ship_from_snapshot, supplierTaxRegistration: row.supplier_tax_snapshot, buyerRegistration: row.buyer_registration_snapshot, billTo: row.bill_to_snapshot,
    shipTo: row.ship_to_snapshot, paymentTerm: row.payment_term_snapshot, supplierContactId: row.supplier_contact_id, supplierAddressId: row.supplier_address_id,
    supplierBillingAddressId: row.supplier_billing_address_id, supplierShipFromId: row.supplier_ship_from_id, supplierTaxRegistrationId: row.supplier_tax_registration_id,
    buyingRegistrationId: row.buying_registration_id, orderDate: dayOf(row.order_date), expectedDeliveryDate: dayOf(row.expected_delivery_date),
    sourceQuotationId: row.source_quotation_id, sourceQuotationNumber: row.source_quotation_number, supplierQuotationReference: row.supplier_quotation_reference,
    supplierReference: row.supplier_reference, currencyCode: row.currency_code?.trim(), paymentTermId: row.payment_term_id, buyerUserId: row.buyer_user_id,
    buyerName: row.buyer_name, defaultWarehouseId: row.default_warehouse_id, defaultWarehouseName: row.default_warehouse_name, priceMode: row.price_mode,
    documentDiscountType: row.document_discount_type, documentDiscountValue: dec(row.document_discount_value), documentDiscountAmount: dec(row.document_discount_amount),
    grossTotal: dec(row.gross_total), lineDiscountTotal: dec(row.line_discount_total), taxableTotal: dec(row.taxable_total), taxTotal: dec(row.tax_total),
    grandTotal: dec(row.grand_total), supplierNotes: row.supplier_notes, internalNotes: row.internal_notes, revision: row.revision, versionNumber: row.version_number,
    amendmentReason: row.amendment_reason, amending: row.status === STATUS.draft && row.version_number > 0,
    confirmedAt: row.confirmed_at, confirmedByName: row.confirmed_by_name, cancelledAt: row.cancelled_at, cancelledByName: row.cancelled_by_name,
    cancelReasonCode: row.cancel_reason_code, cancelReason: row.cancel_reason, closedAt: row.closed_at, closedByName: row.closed_by_name, closeReason: row.close_reason,
    lastSentAt: row.last_sent_at, lastSentTo: row.last_sent_to, acknowledgedAt: row.acknowledged_at, acknowledgementReference: row.acknowledgement_reference,
    matchingPolicy: row.matching_policy, matchingPolicyLabel: MATCHING_POLICY_LABELS[row.matching_policy] ?? null, matchingPolicyReason: row.matching_policy_reason,
    matchingPolicyChangedAt: row.matching_policy_changed_at,
    createdAt: row.created_at, createdByName: row.created_by_name, updatedAt: row.updated_at,
  };
}

async function orderLines(client, organizationId, orderId) {
  const { rows } = await client.query(
    `SELECT line.*, warehouse.name AS warehouse_name, category.name AS tax_category_name, account.code AS expense_account_code, account.name AS expense_account_name
       FROM tenant.purchase_order_lines line
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.receiving_warehouse_id
       LEFT JOIN tenant.tax_categories category ON category.organization_id = line.organization_id AND category.id = line.tax_category_id
       LEFT JOIN tenant.accounting_accounts account ON account.organization_id = line.organization_id AND account.id = line.expense_account_id
      WHERE line.organization_id = $1 AND line.purchase_order_id = $2 ORDER BY line.line_number`, [organizationId, orderId]);
  const taxes = (await client.query(
    `SELECT purchase_order_line_id, tax_type, label, rate, taxable_amount, tax_amount FROM tenant.purchase_order_line_taxes WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY sequence`,
    [organizationId, orderId])).rows;
  return rows.map((row) => ({
    id: row.id, lineNumber: row.line_number, productType: row.product_type, productTypeLabel: PRODUCT_TYPE_LABELS[row.product_type], productId: row.product_id,
    product: row.product_snapshot, description: row.description, hsnSacCode: row.hsn_sac_code, orderedQuantity: dec(row.ordered_quantity), uomId: row.purchase_uom_id,
    uom: row.uom_snapshot, conversionFactor: dec(row.conversion_factor), baseQuantity: dec(row.base_quantity), unitPrice: dec(row.unit_price), priceSource: row.price_source,
    zeroPriceReason: row.zero_price_reason, discountType: row.discount_type, discountValue: dec(row.discount_value), grossAmount: dec(row.gross_amount),
    lineDiscount: dec(row.line_discount), allocatedDocumentDiscount: dec(row.allocated_document_discount), taxableAmount: dec(row.taxable_amount),
    taxCategoryId: row.tax_category_id, taxCategoryName: row.tax_category_name, taxTreatment: row.tax_treatment, taxRate: dec(row.tax_rate), taxTotal: dec(row.tax_total),
    lineTotal: dec(row.line_total), warehouseId: row.receiving_warehouse_id, warehouseName: row.warehouse_name, expectedDeliveryDate: dayOf(row.expected_delivery_date),
    sourceQuotationLineId: row.source_quotation_line_id, expenseAccountId: row.expense_account_id,
    expenseAccount: row.expense_account_id ? `${row.expense_account_code} ${row.expense_account_name}` : null,
    taxes: taxes.filter((tax) => tax.purchase_order_line_id === row.id).map((tax) => ({ type: tax.tax_type, label: tax.label, rate: dec(tax.rate), taxableAmount: dec(tax.taxable_amount), taxAmount: dec(tax.tax_amount) })),
  }));
}

// The documents an order is connected to, each opening the real document.
async function relatedDocuments(client, context, order, canSeeAmounts) {
  const organizationId = context.organizationId;
  const receipts = (await client.query(
    `SELECT receipt.id, receipt.receipt_number, CASE WHEN receipt.reversed_at IS NOT NULL THEN 'reversed' ELSE receipt.status END AS status, receipt.receipt_date, receipt.supplier_delivery_note,
            COALESCE(sum(line.accepted_quantity), 0) AS accepted, COALESCE(sum(line.held_quantity), 0) AS held, COALESCE(sum(line.rejected_quantity), 0) AS rejected
       FROM tenant.goods_receipts receipt LEFT JOIN tenant.goods_receipt_lines line ON line.organization_id = receipt.organization_id AND line.goods_receipt_id = receipt.id
      WHERE receipt.organization_id = $1 AND receipt.purchase_order_id = $2 GROUP BY receipt.id ORDER BY receipt.created_at`, [organizationId, order.id])).rows
    .map((row) => ({ id: row.id, number: row.receipt_number, status: row.status, date: dayOf(row.receipt_date), deliveryNote: row.supplier_delivery_note,
      accepted: dec(row.accepted), held: dec(row.held), rejected: dec(row.rejected), href: `/procurement/goods-receipts/${row.id}` }));
  const bills = (await client.query(
    `SELECT id, bill_number, COALESCE(supplier_invoice_reference, supplier_invoice_number) AS supplier_invoice_number, bill_type, status, bill_date, grand_total, outstanding_amount, matching_status, currency_code
       FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_order_id = $2 ORDER BY created_at`, [organizationId, order.id])).rows
    .map((row) => ({ id: row.id, number: row.bill_number, supplierInvoiceNumber: row.supplier_invoice_number, type: row.bill_type, status: row.status, date: dayOf(row.bill_date),
      matchingStatus: row.matching_status, currencyCode: row.currency_code?.trim(),
      total: canSeeAmounts ? dec(row.grand_total) : undefined, outstanding: canSeeAmounts ? dec(row.outstanding_amount) : undefined,
      href: row.bill_type === "credit_note" ? `/procurement/debit-notes-credits/vendor-credits/${row.id}` : `/procurement/supplier-bills/${row.id}` }));
  const returns = (await client.query(
    `SELECT purchase_return.id, purchase_return.return_number, purchase_return.return_date, purchase_return.reason, replacement.purchase_order_number AS replacement_number,
            receipt.receipt_number, COALESCE(sum(line.quantity), 0) AS quantity, purchase_return.document_status
       FROM tenant.purchase_returns purchase_return
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = purchase_return.organization_id AND receipt.id = purchase_return.goods_receipt_id
       LEFT JOIN tenant.purchase_return_lines line ON line.organization_id = purchase_return.organization_id AND line.purchase_return_id = purchase_return.id
       LEFT JOIN tenant.purchase_orders replacement ON replacement.organization_id = purchase_return.organization_id AND replacement.id = purchase_return.replacement_purchase_order_id
      WHERE purchase_return.organization_id = $1 AND purchase_return.purchase_order_id = $2 AND purchase_return.document_status <> 'cancelled'
      GROUP BY purchase_return.id, receipt.receipt_number, replacement.purchase_order_number ORDER BY purchase_return.created_at`,
    [organizationId, order.id])).rows
    .map((row) => ({ id: row.id, number: row.return_number, date: dayOf(row.return_date), reason: row.reason, replacementNumber: row.replacement_number,
      receiptNumber: row.receipt_number, quantity: dec(row.quantity), href: `/procurement/purchase-returns/${row.id}` }));
  const payments = canSeeAmounts ? (await client.query(
    `SELECT payment.id, payment.payment_number, payment.payment_date, allocation.allocated_amount AS amount, payment.currency_code
       FROM tenant.accounting_vendor_payment_allocations allocation
       JOIN tenant.accounting_vendor_payments payment ON payment.organization_id = allocation.organization_id AND payment.id = allocation.payment_id
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
      WHERE allocation.organization_id = $1 AND bill.source_purchase_order_id = $2 ORDER BY payment.payment_date`, [organizationId, order.id])).rows
    .map((row) => ({ id: row.id, number: row.payment_number, date: dayOf(row.payment_date), amount: dec(row.amount), currencyCode: row.currency_code?.trim(), href: "/accounting/payments" })) : [];
  const quotation = order.source_quotation_id ? { id: order.source_quotation_id, number: order.source_quotation_number, href: `/procurement/purchase-orders/quotations/${order.source_quotation_id}` } : null;
  return {
    quotation, receipts, returns, payments,
    bills: bills.filter((bill) => bill.type === "bill"),
    vendorCredits: bills.filter((bill) => bill.type === "credit_note"),
  };
}

// Which receipts and bills touched each line (product-level progress).
async function lineDocuments(client, organizationId, orderId) {
  const receipts = (await client.query(
    `SELECT line.purchase_order_line_id, receipt.id, receipt.receipt_number, CASE WHEN receipt.reversed_at IS NOT NULL THEN 'reversed' ELSE receipt.status END AS status, receipt.receipt_date, line.accepted_quantity, line.held_quantity, line.rejected_quantity
       FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
      WHERE line.organization_id = $1 AND line.purchase_order_id = $2 ORDER BY receipt.created_at`, [organizationId, orderId])).rows;
  const bills = (await client.query(
    `SELECT line.purchase_order_line_id, bill.id, bill.bill_number, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice_number, bill.bill_type, bill.status, line.quantity, line.unit_price, line.ordered_unit_price
       FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
      WHERE line.organization_id = $1 AND bill.source_purchase_order_id = $2 AND line.purchase_order_line_id IS NOT NULL ORDER BY bill.created_at`, [organizationId, orderId])).rows;
  const cancellations = (await client.query(
    `SELECT cancellation.purchase_order_line_id, cancellation.quantity, cancellation.reason_code, cancellation.reason, cancellation.cancelled_at, users.full_name
       FROM tenant.purchase_order_line_cancellations cancellation LEFT JOIN public.users users ON users.id = cancellation.cancelled_by
      WHERE cancellation.organization_id = $1 AND cancellation.purchase_order_id = $2 ORDER BY cancellation.cancelled_at`, [organizationId, orderId])).rows;
  return { receipts, bills, cancellations };
}

// getPurchaseOrder: the order, its lines with their progress, the four status dimensions, its versions, communication, related documents and history.
export async function getPurchaseOrder(client, context, orderId) {
  requirePoAccess(context);
  const values = [context.organizationId, requireUuid(orderId)];
  const scope = poScopeSql(context, values, "po");
  const row = (await client.query(`SELECT ${ORDER_COLUMNS} FROM tenant.purchase_orders po ${ORDER_JOINS} WHERE po.organization_id = $1 AND po.id = $2${scope}`, values)).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Purchase order not found.", "PURCHASE_ORDER_NOT_FOUND");
  const organizationId = context.organizationId;
  const progress = await loadLineProgress(client, organizationId, row.id);
  const tracking = await trackingFor(client, organizationId, row, progress);
  const canSeeAmounts = poCan(context, PO_PERMISSIONS.viewPayables) || poCan(context, PO_PERMISSIONS.bill);
  if (!canSeeAmounts) tracking.payable = { status: tracking.payable.status };
  const perLine = await lineDocuments(client, organizationId, row.id);
  const lines = (await orderLines(client, organizationId, row.id)).map((line) => ({
    ...line,
    progress: tracking.lines.find((entry) => entry.lineId === line.id) ?? null,
    receipts: perLine.receipts.filter((entry) => entry.purchase_order_line_id === line.id).map((entry) => ({
      id: entry.id, number: entry.receipt_number, status: entry.status, date: dayOf(entry.receipt_date), accepted: dec(entry.accepted_quantity), held: dec(entry.held_quantity),
      rejected: dec(entry.rejected_quantity) })),
    bills: perLine.bills.filter((entry) => entry.purchase_order_line_id === line.id).map((entry) => ({
      id: entry.id, number: entry.bill_number, supplierInvoiceNumber: entry.supplier_invoice_number, type: entry.bill_type, status: entry.status, quantity: dec(entry.quantity),
      unitPrice: canSeeAmounts ? dec(entry.unit_price) : undefined })),
    cancellations: perLine.cancellations.filter((entry) => entry.purchase_order_line_id === line.id).map((entry) => ({
      quantity: dec(entry.quantity), reasonCode: entry.reason_code, reason: entry.reason, at: entry.cancelled_at, by: entry.full_name })),
  }));
  const confirmations = (await client.query(
    `SELECT confirmation.id, confirmation.version_number, confirmation.amendment_reason, confirmation.grand_total, confirmation.confirmed_at, confirmation.superseded_at, users.full_name
       FROM tenant.purchase_order_confirmations confirmation LEFT JOIN public.users users ON users.id = confirmation.confirmed_by
      WHERE confirmation.organization_id = $1 AND confirmation.purchase_order_id = $2 ORDER BY confirmation.version_number DESC`, [organizationId, row.id])).rows
    .map((entry) => ({ id: entry.id, version: entry.version_number, amendmentReason: entry.amendment_reason, grandTotal: dec(entry.grand_total), confirmedAt: entry.confirmed_at,
      confirmedBy: entry.full_name, supersededAt: entry.superseded_at, current: !entry.superseded_at }));
  const communications = (await client.query(
    `SELECT communication.*, users.full_name FROM tenant.purchase_order_communications communication LEFT JOIN public.users users ON users.id = communication.recorded_by
      WHERE communication.organization_id = $1 AND communication.purchase_order_id = $2 ORDER BY communication.occurred_at DESC`, [organizationId, row.id])).rows
    .map((entry) => ({ id: entry.id, kind: entry.kind, version: entry.version_number, channel: entry.channel, recipients: entry.recipients, subject: entry.subject, note: entry.note,
      at: entry.occurred_at, by: entry.full_name, pdfFileId: entry.pdf_file_id }));
  const related = await relatedDocuments(client, context, row, canSeeAmounts);
  const history = await listPurchaseOrderHistory(client, context, row.id, { checked: true });
  const executed = progress.some((line) => line.received > 0n || line.billed !== 0n || line.cancelled > 0n) || related.receipts.some((receipt) => receipt.status === "draft")
    || related.bills.length > 0;
  const confirmed = row.status === STATUS.confirmed;
  const actions = {
    edit: row.status === STATUS.draft && poCan(context, PO_PERMISSIONS.create),
    confirm: row.status === STATUS.draft && poCan(context, PO_PERMISSIONS.confirm),
    amend: confirmed && !executed && poCan(context, PO_PERMISSIONS.amend),
    cancel: (row.status === STATUS.draft || (confirmed && !executed)) && poCan(context, PO_PERMISSIONS.cancel),
    cancelRemaining: confirmed && progress.some((line) => line.remainingToReceive > 0n || (!line.receiptRequired && line.billed < line.billTarget)) && poCan(context, PO_PERMISSIONS.cancel),
    close: tracking.readyToClose && poCan(context, PO_PERMISSIONS.close),
    send: confirmed && poCan(context, PO_PERMISSIONS.send),
    acknowledge: confirmed && row.communication_status === "sent" && poCan(context, PO_PERMISSIONS.send),
    receive: tracking.readyToReceive && poCan(context, PO_PERMISSIONS.receive),
    bill: tracking.readyToBill && poCan(context, PO_PERMISSIONS.bill),
    returnGoods: related.receipts.some((receipt) => receipt.status === "posted") && poCan(context, PO_PERMISSIONS.returns),
    updateDates: confirmed && poCan(context, PO_PERMISSIONS.updateDates),
    changeWarehouse: confirmed && poCan(context, PO_PERMISSIONS.changeWarehouse),
    print: true,
    attach: poCan(context, PO_PERMISSIONS.create) || poCan(context, PO_PERMISSIONS.confirm),
  };
  // Rejections & discrepancies: the cases on this order and, per line, what was refused at the dock and rejected after receipt.
  const seesRejections = poCan(context, PO_PERMISSIONS.rejectionsView) || poCan(context, PO_PERMISSIONS.rejectionsViewAll);
  const rejections = seesRejections ? { cases: await getPurchaseOrderRejections(client, context, row.id), summary: await getRejectionSummary(client, context, row.id) } : null;
  actions.recordRejection = row.status === STATUS.confirmed && poCan(context, PO_PERMISSIONS.rejectionsRecord);
  actions.changeMatchingPolicy = [STATUS.confirmed, STATUS.draft].includes(row.status) && poCan(context, "procurement.matching.override");
  // Payment terms: the agreed term, the advance it expects and where that stands, and the statutory warning for a micro or small supplier.
  const paymentTerms = await getPurchaseOrderPaymentTerms(client, context, row.id);
  return { order: headerView(row), lines, tracking, confirmations, communications, related, rejections, history, actions, paymentTerms, capabilities: poCapabilities(context), canSeeAmounts };
}

export async function getPurchaseOrderTracking(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId);
  return trackingFor(client, context.organizationId, order);
}

export async function listPurchaseOrderHistory(client, context, orderId, { checked = false } = {}) {
  if (!checked) await loadPurchaseOrder(client, context, orderId);
  const { rows } = await client.query(
    `SELECT event.id, event.event_type, event.summary, event.details, event.from_status, event.to_status, event.occurred_at, users.full_name
       FROM tenant.purchase_order_events event LEFT JOIN public.users users ON users.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.purchase_order_id = $2 ORDER BY event.occurred_at DESC, event.id DESC`, [context.organizationId, requireUuid(orderId)]);
  return rows.map((row) => ({ id: row.id, type: row.event_type, summary: row.summary, details: row.details, from: row.from_status, to: row.to_status, at: row.occurred_at, actor: row.full_name }));
}

const VIEW_CONDITIONS = {
  all: "",
  draft: " AND po.status = 'draft'",
  confirmed: " AND po.status = 'confirmed'",
  awaiting_receipt: " AND po.status = 'confirmed' AND progress.goods_lines > 0 AND progress.received_lines = 0 AND progress.open_receipt_lines > 0",
  partially_received: " AND po.status = 'confirmed' AND progress.received_lines > 0 AND progress.open_receipt_lines > 0",
  fully_received: " AND po.status IN ('confirmed', 'closed') AND progress.goods_lines > 0 AND progress.received_lines > 0 AND progress.open_receipt_lines = 0",
  overdue_receipt: " AND po.status = 'confirmed' AND progress.overdue_lines > 0",
  awaiting_billing: " AND po.status = 'confirmed' AND progress.billable_lines > 0",
  partially_billed: " AND progress.billed_lines > 0 AND progress.unbilled_lines > 0 AND po.status <> 'cancelled'",
  // Bills that do not match their order: overbilled lines, or a live bill whose price differs or whose receipts are not there yet.
  billing_mismatch: ` AND (progress.overbilled_lines > 0 OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_bills mismatch WHERE mismatch.organization_id = po.organization_id
                      AND mismatch.source_purchase_order_id = po.id AND mismatch.bill_type = 'bill' AND mismatch.status NOT IN ('cancelled', 'reversed')
                      AND mismatch.matching_status IN ('exception', 'pending')))`,
  ready_to_close: ` AND po.status = 'confirmed' AND progress.open_receipt_lines = 0 AND progress.unbilled_lines = 0 AND progress.overbilled_lines = 0
                    AND progress.unposted_bill_lines = 0 AND progress.held_lines = 0 AND progress.open_rejections = 0 AND drafts.draft_receipts = 0`,
  receivable: " AND po.status = 'confirmed' AND progress.open_receipt_lines > 0",
  closed: " AND po.status = 'closed'",
  cancelled: " AND po.status = 'cancelled'",
  needs_attention: ` AND (progress.overbilled_lines > 0 OR (po.status = 'confirmed' AND progress.overdue_lines > 0) OR (po.status = 'confirmed' AND po.communication_status = 'not_sent')
                     OR progress.open_rejections > 0)`,
  with_rejections: " AND progress.open_rejections > 0",
};

// filters: view, search (PO number, supplier, supplier reference, quotation, product, receipt, bill), supplierId, buyerId, status, warehouseId,
// receiptStatus, billingStatus, overdue, dateFrom, dateTo, limit, offset.
export async function listPurchaseOrders(client, context, filters = {}) {
  requirePoAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = poScopeSql(context, values, "po");
  // "receivable" is not a list tab: it is the order picker of a new goods receipt (confirmed, something still to receive).
  const view = PO_VIEWS.some((entry) => entry.key === filters.view) || filters.view === "receivable" ? filters.view : "all";
  if (view === "mine") where += ` AND po.buyer_user_id = ${bind(context.userId ?? null)}`;
  else where += VIEW_CONDITIONS[view] ?? "";
  if (isUuid(filters.supplierId)) where += ` AND po.supplier_id = ${bind(filters.supplierId)}`;
  if (isUuid(filters.buyerId)) where += ` AND po.buyer_user_id = ${bind(filters.buyerId)}`;
  if (Object.values(STATUS).includes(filters.status)) where += ` AND po.status = ${bind(filters.status)}`;
  if (isUuid(filters.warehouseId))
    where += ` AND (po.default_warehouse_id = ${bind(filters.warehouseId)} OR EXISTS (SELECT 1 FROM tenant.purchase_order_lines line WHERE line.organization_id = po.organization_id AND line.purchase_order_id = po.id AND line.receiving_warehouse_id = $${values.length}))`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND po.order_date >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND po.order_date <= ${bind(filters.dateTo)}::date`;
  if (filters.overdue === true || filters.overdue === "true") where += " AND po.status = 'confirmed' AND progress.overdue_lines > 0";
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (po.purchase_order_number ILIKE ${term} OR party.display_name ILIKE ${term} OR supplier.supplier_number ILIKE ${term} OR po.supplier_reference ILIKE ${term}
      OR po.supplier_quotation_reference ILIKE ${term} OR quotation.quotation_number ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.purchase_order_lines line WHERE line.organization_id = po.organization_id AND line.purchase_order_id = po.id
                   AND (line.description ILIKE ${term} OR line.product_snapshot->>'code' ILIKE ${term} OR line.product_snapshot->>'name' ILIKE ${term}))
      OR EXISTS (SELECT 1 FROM tenant.goods_receipts receipt WHERE receipt.organization_id = po.organization_id AND receipt.purchase_order_id = po.id
                   AND (receipt.receipt_number ILIKE ${term} OR receipt.supplier_delivery_note ILIKE ${term}))
      OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = po.organization_id AND bill.source_purchase_order_id = po.id
                   AND (bill.bill_number ILIKE ${term} OR COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) ILIKE ${term})))`;
  }
  const base = `FROM tenant.purchase_orders po ${ORDER_JOINS} ${LIST_PROGRESS_SQL} WHERE po.organization_id = $1${where}`;
  const total = Number((await client.query(`SELECT count(*) ${base}`, values)).rows[0].count);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const listValues = [...values, limit, offset];
  const { rows } = await client.query(
    `SELECT po.id, po.purchase_order_number, po.status, po.communication_status, po.supplier_id, supplier.supplier_number, party.display_name AS supplier_name,
            po.order_date, po.expected_delivery_date, po.grand_total, po.currency_code, po.buyer_user_id, buyer.full_name AS buyer_name, po.version_number,
            po.supplier_reference, ${LIST_PROGRESS_COLUMNS}
       ${base} ORDER BY po.order_date DESC, po.created_at DESC LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues);
  let receiptFilter = rows;
  if (filters.receiptStatus) receiptFilter = receiptFilter.filter((row) => row.receipt_status === filters.receiptStatus);
  if (filters.billingStatus) receiptFilter = receiptFilter.filter((row) => row.billing_status === filters.billingStatus);
  return {
    total,
    rows: receiptFilter.map((row) => ({
      id: row.id, purchaseOrderNumber: row.purchase_order_number, status: row.status, statusLabel: STATUS_LABELS[row.status], communicationStatus: row.communication_status,
      supplierId: row.supplier_id, supplierNumber: row.supplier_number, supplierName: row.supplier_name, orderDate: dayOf(row.order_date),
      expectedDeliveryDate: dayOf(row.expected_delivery_date), grandTotal: dec(row.grand_total), currencyCode: row.currency_code?.trim(), buyerUserId: row.buyer_user_id,
      buyerName: row.buyer_name, versionNumber: row.version_number, supplierReference: row.supplier_reference, receiptStatus: row.receipt_status,
      receiptLabel: RECEIPT_LABELS[row.receipt_status], billingStatus: row.billing_status, billingLabel: BILLING_LABELS[row.billing_status],
      receivingComplete: row.receiving_complete, readyToReceive: row.ready_to_receive, readyToBill: row.ready_to_bill, readyToClose: row.ready_to_close, overdueReceipt: row.overdue_receipt, needsAttention: row.needs_attention, openRejections: row.open_rejections ?? 0,
    })),
    views: PO_VIEWS,
  };
}

// Everything the order screens offer: views, labels, reasons and the master data to choose from.
export async function getPurchaseOrderOptions(client, context) {
  requirePoAccess(context);
  const organizationId = context.organizationId;
  const q = async (sql) => (await client.query(sql, [organizationId])).rows;
  return {
    views: PO_VIEWS, cancelReasons: CANCEL_REASONS, sentChannels: SENT_CHANNELS, statusLabels: STATUS_LABELS, receiptLabels: RECEIPT_LABELS, billingLabels: BILLING_LABELS,
    paymentLabels: PAYMENT_LABELS, communicationLabels: COMMUNICATION_LABELS, productTypeLabels: PRODUCT_TYPE_LABELS,
    settings: await procurementSettings(client, organizationId),
    suppliers: await q(`SELECT supplier.id, supplier.supplier_number, party.display_name AS name, supplier.status, supplier.default_currency AS currency_code
                          FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
                         WHERE supplier.organization_id = $1 ORDER BY party.display_name LIMIT 2000`),
    products: await q(`SELECT id, code, name, item_type, track_inventory, purchase_uom_id, uom_id, purchase_price, tax_category_id FROM tenant.items
                        WHERE organization_id = $1 AND status = 'active' AND is_purchasable IS NOT FALSE ORDER BY name LIMIT 5000`),
    uoms: await q(`SELECT id, code, name, decimal_places FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY code`),
    warehouses: await q(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    currencies: await q(`SELECT code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`),
    paymentTerms: await q(`SELECT term.id, term.code, term.name, term.term_type, term.advance_percentage, (settings.default_payment_term_id = term.id) AS is_default FROM tenant.payment_terms term
                           LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = term.organization_id
                          WHERE term.organization_id = $1 AND term.status = 'active' AND term.is_purchase_enabled ORDER BY term.name`),
    registrations: await q(`SELECT id, code, name, registration_number AS gstin, state_code, is_default FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`),
    taxCategories: await q(`SELECT id, code, name FROM tenant.tax_categories WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    expenseAccounts: poCan(context, PO_PERMISSIONS.descriptiveLines) ? await q(`SELECT account.id, account.code, account.name FROM tenant.accounting_accounts account
                        WHERE account.organization_id = $1 AND account.status = 'active' AND NOT account.is_group AND account.account_class IN ('expense', 'asset') ORDER BY account.code LIMIT 1000`) : [],
    buyers: await q(`SELECT users.id, users.full_name AS name FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
                      WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY users.full_name`),
    capabilities: poCapabilities(context),
  };
}

export { has, optionalUuid };

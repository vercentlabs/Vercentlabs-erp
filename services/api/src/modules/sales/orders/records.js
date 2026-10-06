// Creating, editing, reading and listing sales orders.
//
// An order is always for a Customer Master. It is created directly (Sales →
// Sales Orders → New) or from an accepted quotation. A Draft can be edited
// (each save is kept as a version); once confirmed it is changed only by
// reopening it, which is possible until something is delivered or invoiced.
//
// An order made from a quotation executes what was agreed: its quoted lines
// keep the quoted price, discount and tax whatever today's price list says.
// On such a draft the quantity, warehouse and dates of a quoted line can
// change, lines can be removed and new lines added (priced from today's
// list), but the agreed price of a quoted line cannot be edited here.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { SalesError, previewSalesDocument, redactMargin } from "../index.js";
import { CONFIRMATION_STATUS_LABELS, confirmationStatus } from "../order-confirmations/constants.js";
import { DELIVERY_STATUS_LABELS } from "../deliveries/constants.js";
import { draftQuantities, invoicingOfLine } from "../invoices/build.js";
import { basisOfSetting } from "../invoices/constants.js";
import { listOrderConfirmations } from "../order-confirmations/snapshot.js";
import { assertOrderVisible, orderCan, orderCapabilities, orderScopeSql, requireOrderAccess, requireOrderPermission, teamOwnersSql } from "./access.js";
import {
  CANCEL_REASONS, FULFILLMENT, INVOICING, ORDER_PERMISSIONS, ORDER_VIEWS, OrderError, STATUS, STATUS_LABELS, dayOf, isUuid, requireUuid, text,
} from "./constants.js";
import { loadOrderLineProgress } from "./progress.js";
import { deriveFulfillmentStatus, deriveInvoiceStatus, deriveReservationStatus } from "../order-tracking/derive.js";
import {
  TRACKING_COLUMNS, financeJoin, invoicingBasisSetting, needsAttentionSql, quantitiesJoin, summaryFromRow, trackingConditions,
} from "../order-tracking/summary.js";
import { insertOrderVersion, lockOrder, readDate, recordOrderEvent } from "./versions.js";

// One connection runs one query at a time.
const inOrder = async (queries) => { const results = []; for (const query of queries) results.push(await query()); return results; };

export async function databaseToday(client) {
  return (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
}

// Errors from the pricing core keep their status and code.
export async function priced(client, context, input, options) {
  try {
    return await previewSalesDocument(client, context, input, { order: true, ...options });
  } catch (error) {
    if (error instanceof SalesError) throw new OrderError(error.status, error.message, error.code);
    throw error;
  }
}

// What a new order starts with when the form leaves it out: today's date, the
// customer's currency, salesperson, default contact and addresses, and the
// warehouse from Sales Settings. A line without a warehouse takes the order's
// default warehouse.
async function withDefaults(client, context, input, today) {
  const partyId = requireUuid(input.partyId, "Customer");
  const { rows } = await client.query(
    `SELECT party.currency_code, party.owner_user_id, organization.base_currency,
            (SELECT settings.default_warehouse_id FROM tenant.sales_settings settings
               JOIN tenant.warehouses warehouse ON warehouse.organization_id = settings.organization_id AND warehouse.id = settings.default_warehouse_id AND warehouse.status = 'active'
              WHERE settings.organization_id = $1) AS default_warehouse_id,
            (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_billing LIMIT 1) AS billing_id,
            (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_shipping LIMIT 1) AS shipping_id,
            (SELECT link.contact_id FROM tenant.crm_contact_account_relationships link
               JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id AND contact.status = 'active'
                    AND contact.archived_at IS NULL AND COALESCE(contact.privacy_status, 'active') = 'active'
              WHERE link.organization_id = $1 AND link.party_id = $2 AND link.status = 'active'
              ORDER BY link.is_primary_contact DESC, link.is_billing_contact DESC, link.created_at LIMIT 1) AS contact_id
       FROM public.organizations organization
       LEFT JOIN tenant.business_parties party ON party.organization_id = organization.id AND party.id = $2
      WHERE organization.id = $1`,
    [context.organizationId, partyId]);
  const defaults = rows[0] ?? {};
  const defaultWarehouseId = input.defaultWarehouseId === undefined ? defaults.default_warehouse_id ?? null
    : input.defaultWarehouseId ? requireUuid(input.defaultWarehouseId, "Warehouse") : null;
  return {
    ...input,
    partyId,
    defaultWarehouseId,
    orderDate: readDate(input.orderDate, "Order date") ?? today,
    requestedDeliveryDate: readDate(input.requestedDeliveryDate, "Requested delivery date"),
    currencyCode: text(input.currencyCode, 3) ?? defaults.currency_code?.trim() ?? defaults.base_currency?.trim(),
    ownerUserId: input.ownerUserId || defaults.owner_user_id || context.userId,
    contactId: input.contactId !== undefined ? input.contactId || null : defaults.contact_id ?? null,
    billingAddressId: input.billingAddressId || defaults.billing_id || null,
    shippingAddressId: input.shippingAddressId || defaults.shipping_id || input.billingAddressId || defaults.billing_id || null,
    lines: Array.isArray(input.lines) ? input.lines.map((line) => ({ ...line, warehouseId: line.warehouseId || defaultWarehouseId || null })) : input.lines,
  };
}

function checkDates(document) {
  if (document.requestedDeliveryDate && document.requestedDeliveryDate < document.orderDate)
    throw new OrderError(422, "The requested delivery date cannot be before the order date.", "SALES_ORDER_DATE_INVALID", { field: "requestedDeliveryDate" });
}

// Other orders of the same customer carrying the same customer PO number: a
// warning, not a refusal, because a replacement order can legitimately repeat it.
export async function duplicatePurchaseOrders(client, context, { partyId, customerPoNumber, exceptOrderId = null }) {
  const number = text(customerPoNumber, 120);
  if (!number) return [];
  const { rows } = await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.lifecycle_status, sales_order.order_date
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.party_id = $2 AND lower(version.customer_po_number) = lower($3)
        AND sales_order.lifecycle_status <> 'cancelled' AND ($4::uuid IS NULL OR sales_order.id <> $4)
      ORDER BY sales_order.order_date DESC LIMIT 5`,
    [context.organizationId, partyId, number, exceptOrderId]);
  return rows.map((row) => ({ id: row.id, number: row.sales_order_number, status: row.lifecycle_status, orderDate: dayOf(row.order_date) }));
}

// The order row and its first version, from a priced document. source: the quotation it executes.
export async function insertOrder(client, context, document, preview, source = {}) {
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_order", at: document.orderDate ?? new Date() });
  const order = (await client.query(
    `INSERT INTO tenant.sales_orders (organization_id, sales_order_number, source_quotation_id, source_quotation_version_id, source_opportunity_id, party_id, contact_id, owner_user_id,
        order_date, requested_delivery_date, billing_status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, current_date), $10, 'not_billable', $11, $11) RETURNING *`,
    [context.organizationId, number, source.quotationId ?? null, source.quotationVersionId ?? null, document.opportunityId || source.opportunityId || null, preview.master.partyId,
      preview.master.contact?.id ?? null, preview.master.ownerUserId, document.orderDate ?? null, document.requestedDeliveryDate ?? null, context.userId ?? null])).rows[0];
  const version = await insertOrderVersion(client, context, order.id, document, preview);
  await recordOrderEvent(client, context, order.id, "sales_order.created", null, STATUS.draft, {
    versionId: version.id, versionNumber: 1, source: source.quotationId ? "quotation" : "direct", quotationId: source.quotationId ?? null, quotationNumber: source.quotationNumber ?? null,
    total: preview.totals.grandTotal, lineDiscountTotal: preview.totals.lineDiscountTotal, documentDiscountAmount: preview.totals.documentDiscountAmount,
    priceOverrides: preview.lines.filter((line) => line.manualPriceOverride && !line.quoted).map((line) => ({ line: line.sequence, listPrice: line.listUnitPrice, unitPrice: line.unitPrice })),
  });
  return { ...order, current_version_id: version.id };
}

// input: partyId, contactId?, ownerUserId?, orderDate?, requestedDeliveryDate?, customerPoNumber?, customerPoDate?, customerReference?,
//        billingAddressId?, shippingAddressId?, currencyCode?, priceListId?, paymentTermId?, defaultWarehouseId?, sellerRegistrationId?,
//        documentDiscountType?, documentDiscountValue?, discountReasonCode?, discountReasonText?, customerNotes?, termsAndConditions?,
//        internalNotes?, lines[{ itemId, quantity, uomId?, warehouseId?, description?, unitPrice? + manualPriceReason, discountType?, discountValue? }], idempotencyKey?
export async function createSalesOrder(client, context, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to create sales orders.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "sales.order.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const policy = (await client.query(`SELECT allow_direct_orders FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (policy && policy.allow_direct_orders === false)
    throw new OrderError(409, "Orders without a quotation are switched off in Sales settings. Create a quotation and make the order from it.", "SALES_DIRECT_ORDERS_DISABLED");
  // A direct order takes its terms from what is chosen, the customer or the company default.
  const document = { ...(await withDefaults(client, context, input, await databaseToday(client))), carriedPaymentTerm: undefined };
  checkDates(document);
  const preview = await priced(client, context, document);
  if (preview.master.paymentTerm?.id && preview.master.paymentTerm.id !== preview.master.paymentTermDefaultId)
    requireOrderPermission(context, ORDER_PERMISSIONS.changePaymentTerms, "You do not have permission to choose other payment terms than the customer's.");
  const order = await insertOrder(client, context, document, preview);
  const response = {
    id: order.id, salesOrderNumber: order.sales_order_number, sales_order_number: order.sales_order_number, currentVersionId: order.current_version_id, versionNumber: 1,
    duplicatePurchaseOrders: await duplicatePurchaseOrders(client, context, { partyId: order.party_id, customerPoNumber: document.customerPoNumber, exceptOrderId: order.id }),
    replayed: false,
  };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "sales_order", aggregateId: order.id });
  return response;
}

// The quoted lines of a draft made from a quotation, keyed by order line id,
// with the tax they were quoted with.
async function quotedLines(client, context, order) {
  if (!order.source_quotation_id) return new Map();
  const lines = (await client.query(
    `SELECT * FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = $2 AND source_quotation_line_id IS NOT NULL`,
    [context.organizationId, order.current_version_id])).rows;
  if (!lines.length) return new Map();
  const taxes = (await client.query(
    `SELECT sales_order_line_id, tax_type, label, rate, tax_category_id, tax_rate_id FROM tenant.sales_order_tax_lines WHERE organization_id = $1 AND sales_order_version_id = $2 ORDER BY sequence`,
    [context.organizationId, order.current_version_id])).rows;
  return new Map(lines.map((line) => [line.id, {
    line,
    carriedTax: {
      treatment: line.tax_treatment ?? "taxable", taxType: "gst", categoryId: line.tax_category_id, categoryCode: line.tax_category_code, categoryName: null, rateId: line.tax_rate_id,
      rate: line.tax_rate, supplyNature: null, reverseCharge: false,
      components: taxes.filter((tax) => tax.sales_order_line_id === line.id).map((tax) => ({ type: tax.tax_type, label: tax.label, rate: tax.rate })),
    },
  }]));
}

// The document a save of this draft would price. An order made from a
// quotation executes the agreed terms: its customer, currency, price list and
// document discount stay, and each quoted line keeps its price, discount and tax.
export async function draftDocument(client, context, order, input, today) {
  const quoted = await quotedLines(client, context, order);
  // The order's own terms (the accepted quotation's, when it came from one) stay unless other terms are chosen.
  const terms = (await client.query(`SELECT payment_term_snapshot FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.current_version_id])).rows[0];
  let document = await withDefaults(client, context, { ...input, opportunityId: order.source_opportunity_id, carriedPaymentTerm: terms?.payment_term_snapshot }, today);
  checkDates(document);
  if (!order.source_quotation_id) return document;
  if (document.partyId !== order.party_id)
    throw new OrderError(409, "An order made from a quotation keeps the quotation's customer. Create a new order for another customer.", "SALES_ORDER_CUSTOMER_LOCKED");
  const current = (await client.query(
    `SELECT currency_code, exchange_rate, price_list_id, document_discount_type, document_discount_value, discount_reason_code, discount_reason_text
       FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.current_version_id])).rows[0];
  document = {
    ...document,
    currencyCode: current.currency_code.trim(), exchangeRate: current.exchange_rate, priceListId: current.price_list_id,
    documentDiscountType: current.document_discount_type, documentDiscountValue: current.document_discount_value, discountReasonCode: current.discount_reason_code,
    discountReasonText: current.discount_reason_text,
    lines: document.lines.map((line) => {
      const source = quoted.get(line.salesOrderLineId);
      if (!source || source.line.item_id !== line.itemId) return line;
      return {
        ...line, quoted: true, uomId: source.line.uom_id, variantId: source.line.variant_id, listUnitPrice: source.line.list_unit_price, unitPrice: source.line.unit_price,
        manualPriceOverride: source.line.manual_price_override, manualPriceReason: source.line.manual_price_reason, discountType: source.line.discount_type,
        discountValue: source.line.discount_value, sourceQuotationLineId: source.line.source_quotation_line_id, carriedTax: source.carriedTax,
      };
    }),
  };
  return document;
}

// The totals a save of the draft would store, without saving: what the order
// form shows while it is edited. A line without a price is reported, not refused.
export async function previewSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to edit sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const document = await draftDocument(client, context, order, input, await databaseToday(client));
  return priced(client, context, document, { carryDocumentDiscount: Boolean(order.source_quotation_id), allowMissingPrice: true, preview: true });
}

// Saves changes to a Draft as its next version. expectedVersionNumber is the
// version the editor opened; a save over someone else's change is refused.
// A line carries salesOrderLineId when it is an existing line of the order.
export async function updateSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to edit sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.draft)
    throw new OrderError(409, "Only a draft order can be edited. Reopen a confirmed order to change it.", "SALES_ORDER_LOCKED");
  if (input.expectedVersionNumber == null || Number(input.expectedVersionNumber) !== Number(order.version_number))
    throw new OrderError(409, "Someone else changed this order. Reload it and make your change again.", "SALES_ORDER_VERSION_CONFLICT");
  const document = await draftDocument(client, context, order, input, await databaseToday(client));
  const before = await commercialSnapshot(client, context, order.current_version_id);
  const preview = await priced(client, context, document, { carryDocumentDiscount: Boolean(order.source_quotation_id) });
  if (before.version.payment_term_id && (preview.master.paymentTerm?.id ?? null) !== before.version.payment_term_id)
    requireOrderPermission(context, ORDER_PERMISSIONS.changePaymentTerms, "You do not have permission to change the payment terms.");
  const version = await insertOrderVersion(client, context, order.id, document, preview);
  await client.query(
    `UPDATE tenant.sales_orders
        SET party_id = $3, contact_id = $4, owner_user_id = $5, order_date = $6, requested_delivery_date = $7, updated_by = $8, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, preview.master.partyId, preview.master.contact?.id ?? null, preview.master.ownerUserId, document.orderDate, document.requestedDeliveryDate,
      context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.updated", STATUS.draft, STATUS.draft,
    { versionId: version.id, versionNumber: version.version_number, changes: commercialChanges(before, preview, document) });
  return {
    id: order.id, currentVersionId: version.id, versionNumber: Number(version.version_number),
    duplicatePurchaseOrders: await duplicatePurchaseOrders(client, context, { partyId: preview.master.partyId, customerPoNumber: document.customerPoNumber, exceptOrderId: order.id }),
  };
}

// What a saved version says commercially, to describe the next save in the audit trail.
async function commercialSnapshot(client, context, versionId) {
  const version = (await client.query(
    `SELECT version.grand_total, version.customer_snapshot->>'displayName' AS customer, version.billing_address_id, version.shipping_address_id, version.default_warehouse_id,
            version.document_discount_type, version.document_discount_value, version.tax_total, version.payment_term_id, version.payment_term_snapshot->>'name' AS payment_term
       FROM tenant.sales_order_versions version WHERE version.organization_id = $1 AND version.id = $2`, [context.organizationId, versionId])).rows[0];
  const lines = (await client.query(
    `SELECT item_id, item_name_snapshot, quantity, unit_price, manual_price_override, discount_type, discount_value, warehouse_id FROM tenant.sales_order_lines
      WHERE organization_id = $1 AND sales_order_version_id = $2 ORDER BY sequence`, [context.organizationId, versionId])).rows;
  return { version, lines };
}

// Customer, address, warehouse, product, quantity, price, discount and tax changes between two saves.
function commercialChanges(before, preview, document) {
  const changes = [];
  const say = (what, from, to) => { if (String(from ?? "") !== String(to ?? "")) changes.push({ what, from: from ?? null, to: to ?? null }); };
  say("Customer", before.version.customer, preview.snapshots.customer.displayName);
  say("Billing address", before.version.billing_address_id, preview.master.billing.id);
  say("Shipping address", before.version.shipping_address_id, preview.master.shipping.id);
  say("Default warehouse", before.version.default_warehouse_id, document.defaultWarehouseId);
  say("Payment terms", before.version.payment_term, preview.master.paymentTerm?.name);
  say("Document discount", Number(before.version.document_discount_value) ? `${Number(before.version.document_discount_value)}${before.version.document_discount_type === "percent" ? "%" : ""}` : null,
    Number(preview.totals.documentDiscountValue) ? `${Number(preview.totals.documentDiscountValue)}${preview.totals.documentDiscountType === "percent" ? "%" : ""}` : null);
  const discount = (type, value) => (Number(value) ? `${Number(value)}${type === "percent" ? "%" : ""}` : null);
  const earlier = new Map(before.lines.map((line) => [line.item_id, line]));
  for (const line of preview.lines) {
    const was = earlier.get(line.itemId);
    earlier.delete(line.itemId);
    if (!was) { changes.push({ what: `Added ${line.itemNameSnapshot}`, from: null, to: `${Number(line.quantity)} × ${Number(line.unitPrice)}` }); continue; }
    say(`${line.itemNameSnapshot}: quantity`, Number(was.quantity), Number(line.quantity));
    say(`${line.itemNameSnapshot}: price${line.manualPriceOverride ? " (overridden)" : ""}`, Number(was.unit_price), Number(line.unitPrice));
    say(`${line.itemNameSnapshot}: discount`, discount(was.discount_type, was.discount_value), discount(line.discountType, line.discountValue));
    say(`${line.itemNameSnapshot}: warehouse`, was.warehouse_id, line.warehouseId);
  }
  for (const removed of earlier.values()) changes.push({ what: `Removed ${removed.item_name_snapshot}`, from: `${Number(removed.quantity)} × ${Number(removed.unit_price)}`, to: null });
  say("Tax", Number(before.version.tax_total), Number(preview.totals.taxTotal));
  say("Total", Number(before.version.grand_total), Number(preview.totals.grandTotal));
  return changes;
}

// What the caller can do with the order now; the server checks again on each action.
function availableActions(context, order, lines, downstream, confirmation) {
  const can = (permission) => orderCan(context, permission);
  const status = order.lifecycle_status;
  const confirmed = status === STATUS.confirmed;
  const untouched = downstream.deliveries === 0 && downstream.invoices === 0;
  return {
    edit: status === STATUS.draft && can(ORDER_PERMISSIONS.create),
    confirm: status === STATUS.draft && can(ORDER_PERMISSIONS.confirm),
    reopen: confirmed && untouched && can(ORDER_PERMISSIONS.reopen),
    reserve: confirmed && can(ORDER_PERMISSIONS.reserve) && lines.some((line) => line.stockTracked && line.remainingToDeliver - line.reserved > 1e-6),
    release: can(ORDER_PERMISSIONS.releaseReservation) && lines.some((line) => line.reserved > 1e-6),
    deliver: confirmed && can(ORDER_PERMISSIONS.deliver) && lines.some((line) => line.remainingToDeliver > 1e-6),
    invoice: confirmed && can(ORDER_PERMISSIONS.invoice) && Boolean(downstream.invoiceableNow),
    cancel: ((status === STATUS.draft) || (confirmed && untouched)) && can(ORDER_PERMISSIONS.cancel),
    cancelRemaining: confirmed && !untouched && can(ORDER_PERMISSIONS.cancelRemaining) && lines.some((line) => line.remainingToDeliver > 1e-6 || (!line.deliverable && line.remainingToInvoice > 1e-6)),
    // A draft prints as a draft; a confirmed order prints its current confirmation.
    print: can(ORDER_PERMISSIONS.export),
    viewConfirmation: Boolean(confirmation) && can(ORDER_PERMISSIONS.export),
    sendConfirmation: [STATUS.confirmed, STATUS.closed].includes(status) && Boolean(confirmation) && can(ORDER_PERMISSIONS.sendConfirmation),
    markConfirmationSent: [STATUS.confirmed, STATUS.closed].includes(status) && Boolean(confirmation) && can(ORDER_PERMISSIONS.markConfirmationSent),
    acknowledgeConfirmation: [STATUS.confirmed, STATUS.closed].includes(status) && Boolean(confirmation) && !confirmation?.acknowledged_at && can(ORDER_PERMISSIONS.acknowledgeConfirmation),
  };
}

// Everything the order page shows. `order` is the order joined with its
// current version (the shape the PDF renderer reads).
export async function getSalesOrder(client, context, orderId) {
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  const { rows } = await client.query(
    `SELECT sales_order.*, version.*, sales_order.id AS sales_order_id, sales_order.created_at AS order_created_at, sales_order.updated_at AS order_updated_at,
            sales_order.created_by AS order_created_by, version.id AS version_id,
            quotation.quotation_number AS source_quotation_number, opportunity.code AS source_opportunity_code, opportunity.name AS source_opportunity_name,
            price_list.name AS price_list_name, price_list.tax_inclusive AS price_list_tax_inclusive, warehouse.name AS default_warehouse_name,
            owner.full_name AS owner_name, creator.full_name AS created_by_name, confirmer.full_name AS confirmed_by_name, canceller.full_name AS cancelled_by_name,
            party.customer_number, party.status AS customer_status, party.sales_block, party.sales_block_reason,
            (sales_order.requested_delivery_date < current_date) AS requested_delivery_overdue
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
       LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = sales_order.organization_id AND opportunity.id = sales_order.source_opportunity_id
       LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = sales_order.organization_id AND price_list.id = version.price_list_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = sales_order.organization_id AND warehouse.id = version.default_warehouse_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
       LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
       LEFT JOIN public.users creator ON creator.id = sales_order.created_by
       LEFT JOIN public.users confirmer ON confirmer.id = sales_order.confirmed_by
       LEFT JOIN public.users canceller ON canceller.id = sales_order.cancelled_by
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`,
    [context.organizationId, id]);
  const order = rows[0];
  if (!order) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  order.id = order.sales_order_id;
  order.created_at = order.order_created_at;
  order.updated_at = order.order_updated_at;
  order.created_by = order.order_created_by;
  order.currency_code = order.currency_code?.trim();
  const progress = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const byLine = new Map(progress.map((line) => [line.lineId, line]));
  // Invoicing per line on the company's basis: invoiceable now, pending delivery, and what drafts bill (not yet invoiced).
  const basis = basisOfSetting((await client.query(`SELECT invoice_quantity_basis FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0]?.invoice_quantity_basis);
  const drafts = await draftQuantities(client, context.organizationId, id);
  const invoicingByLine = new Map(progress.map((line) => [line.lineId, invoicingOfLine(line, basis)]));
  const [lines, taxLines, deliveries, deliveryLines, invoices, versions, events] = await inOrder([
    () => client.query(
      // The warehouse shown is where the line ships from now (changed after confirmation, else as ordered).
      `SELECT line.*, COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id) AS warehouse_id, warehouse.name AS warehouse_name FROM tenant.sales_order_lines line
         LEFT JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
         LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id)
        WHERE line.organization_id = $1 AND line.sales_order_version_id = $2 ORDER BY line.sequence`, [context.organizationId, order.current_version_id]),
    () => client.query(
      `SELECT tax_type, label, rate, sum(taxable_amount) AS taxable_amount, sum(tax_amount) AS tax_amount FROM tenant.sales_order_tax_lines
        WHERE organization_id = $1 AND sales_order_version_id = $2 GROUP BY tax_type, label, rate ORDER BY tax_type, rate`, [context.organizationId, order.current_version_id]),
    () => client.query(
      // Every delivery of the order, whatever its state; only dispatched and delivered ones count as delivered.
      `SELECT delivery.id, delivery.request_number AS delivery_number, delivery.delivery_status, delivery.dispatch_date, delivery.expected_delivery_date, delivery.carrier,
              delivery.tracking_number, delivery.tracking_url, delivery.delivered_at, delivery.received_by, warehouse.name AS warehouse_name, author.full_name AS created_by_name
         FROM tenant.sales_fulfillment_requests delivery
         LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = delivery.organization_id AND warehouse.id = delivery.warehouse_id
         LEFT JOIN public.users author ON author.id = delivery.requested_by
        WHERE delivery.organization_id = $1 AND delivery.sales_order_id = $2 ORDER BY delivery.requested_at, delivery.request_number`,
      [context.organizationId, id]),
    () => client.query(
      `SELECT delivered.delivery_id, delivered.sales_order_line_id, delivered.quantity, delivered.uom_snapshot, line.item_name_snapshot
         FROM tenant.sales_delivery_lines delivered JOIN tenant.sales_order_lines line ON line.id = delivered.sales_order_line_id
        WHERE delivered.organization_id = $1 AND delivered.sales_order_id = $2 ORDER BY line.sequence`, [context.organizationId, id]),
    () => client.query(
      `SELECT invoice.id, invoice.invoice_number, invoice.invoice_type, invoice.status, invoice.invoice_date, invoice.grand_total, invoice.tax_total, invoice.outstanding_amount,
              invoice.currency_code
         FROM tenant.accounting_customer_invoices invoice
        WHERE invoice.organization_id = $1 AND invoice.source_sales_order_id = $2 ORDER BY invoice.created_at`, [context.organizationId, id]),
    () => client.query(
      `SELECT version.id, version.version_number, version.amendment_reason AS change_note, version.grand_total, version.currency_code, version.created_at, author.full_name AS created_by_name
         FROM tenant.sales_order_versions version LEFT JOIN public.users author ON author.id = version.created_by
        WHERE version.organization_id = $1 AND version.sales_order_id = $2 ORDER BY version.version_number DESC`, [context.organizationId, id]),
    () => client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, event.actor_user_id, actor.full_name AS actor_name
         FROM tenant.sales_document_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.entity_type = 'sales_order' AND event.entity_id = $2 ORDER BY event.occurred_at DESC, event.id DESC LIMIT 300`,
      [context.organizationId, id]),
  ]);
  const validInvoices = invoices.rows.filter((invoice) => invoice.invoice_type === "invoice" && ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(invoice.status));
  const confirmations = await listOrderConfirmations(client, context.organizationId, id);
  const current = confirmations.find((confirmation) => confirmation.current) ?? null;
  // The order's dimensions, each derived by the tracking service's own functions (../order-tracking): the page, the list and the reports agree.
  const fulfillment = deriveFulfillmentStatus(order, progress);
  const reservation = deriveReservationStatus(order, progress);
  const invoiceProgress = deriveInvoiceStatus(order, progress, invoicingByLine, basis);
  const statuses = {
    status: order.lifecycle_status, statusLabel: STATUS_LABELS[order.lifecycle_status] ?? order.lifecycle_status, ...confirmationDisplay(current),
    fulfillment: fulfillment.status, fulfillmentLabel: fulfillment.label, invoicing: invoiceProgress.status, invoicingLabel: invoiceProgress.label,
    reservation: reservation.status, reservationLabel: reservation.label,
  };
  const invoicedValue = validInvoices.reduce((total, invoice) => total + Number(invoice.grand_total), 0);
  // Credit notes against the order's invoices: posted ones reduce what the customer was billed.
  const creditNotes = invoices.rows.filter((invoice) => invoice.invoice_type === "credit_note" && invoice.status !== "cancelled");
  const creditedValue = creditNotes.filter((credit) => ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(credit.status)).reduce((total, credit) => total + Number(credit.grand_total), 0);
  // Delivery progress of the physical lines (services never count): ordered = delivered + cancelled + remaining; a return changes none of them.
  const deliveryProgress = {
    deliverable: fulfillment.applies, ordered: fulfillment.ordered, delivered: fulfillment.delivered, cancelled: fulfillment.cancelled, returned: fulfillment.returned,
    remaining: fulfillment.remaining, netWithCustomer: fulfillment.netWithCustomer, overdue: fulfillment.overdue,
    // Of what was ordered, how much was dispatched: 6 of 10 with 4 cancelled is complete, and still 6 of 10.
    percent: fulfillment.percent,
  };
  const detail = {
    order: { ...order, ...statuses },
    lines: lines.rows.map((line) => {
      const state = byLine.get(line.id);
      return {
        ...line,
        is_service: !state?.deliverable, is_stock_tracked: Boolean(state?.stockTracked), is_quoted: Boolean(line.source_quotation_line_id),
        ordered_quantity: state?.ordered ?? Number(line.quantity), cancelled_quantity: state?.cancelled ?? 0, reserved_quantity: state?.reserved ?? 0,
        delivered_quantity: state?.delivered ?? 0, invoiced_quantity: state?.invoiced ?? 0, returned_quantity: state?.returned ?? 0,
        remaining_to_deliver: state?.remainingToDeliver ?? 0, remaining_to_invoice: state?.remainingToInvoice ?? 0,
        invoiceable_now: invoicingByLine.get(line.id)?.invoiceableNow ?? 0, pending_delivery_to_invoice: invoicingByLine.get(line.id)?.pendingDelivery ?? 0,
        on_draft_invoices: drafts.get(line.id)?.quantity ?? 0,
      };
    }),
    taxLines: taxLines.rows,
    returns: (await client.query(
      `SELECT sales_return.id, sales_return.return_number, sales_return.status, sales_return.return_date, sales_return.reason_code, delivery.request_number AS delivery_number,
              (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS quantity
         FROM tenant.sales_returns sales_return JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = sales_return.delivery_id
        WHERE sales_return.organization_id = $1 AND sales_return.sales_order_id = $2 AND sales_return.status <> 'cancelled' ORDER BY sales_return.created_at`, [context.organizationId, id])).rows,
    deliveries: deliveries.rows.map((delivery) => ({
      ...delivery, statusLabel: DELIVERY_STATUS_LABELS[delivery.delivery_status], lines: deliveryLines.rows.filter((line) => line.delivery_id === delivery.id),
    })),
    invoices: invoices.rows.filter((invoice) => invoice.invoice_type !== "credit_note").map((invoice) => ({ ...invoice, currency_code: invoice.currency_code?.trim() })),
    creditNotes: creditNotes.map((credit) => ({ ...credit, currency_code: credit.currency_code?.trim() })),
    delivery: deliveryProgress,
    // Values: what posted invoices billed, and the order's value of what is left (and of what can be invoiced now), at its agreed line totals.
    invoicing: {
      basis, orderedValue: Number(order.grand_total), invoicedValue: Math.round(invoicedValue * 100) / 100,
      creditedValue: Math.round(creditedValue * 100) / 100, netBilledValue: Math.round((invoicedValue - creditedValue) * 100) / 100,
      remainingValue: invoiceProgress.remainingValue, invoiceableNowValue: invoiceProgress.invoiceableNowValue,
    },
    versions: versions.rows,
    confirmations,
    events: events.rows,
    duplicatePurchaseOrders: await duplicatePurchaseOrders(client, context, { partyId: order.party_id, customerPoNumber: order.customer_po_number, exceptOrderId: id }),
    cancelReasons: CANCEL_REASONS,
    capabilities: orderCapabilities(context),
    actions: availableActions(context, order, progress, { deliveries: deliveries.rows.filter((delivery) => ["dispatched", "delivered"].includes(delivery.delivery_status)).length, invoices: validInvoices.length,
      invoiceableNow: [...invoicingByLine.values()].some((position) => position.invoiceableNow > 1e-6) }, current),
  };
  return redactMargin(detail, context);
}

// The order's confirmation state as shown: Not confirmed, Not sent, Sent or Acknowledged.
function confirmationDisplay(current) {
  const key = confirmationStatus(current);
  return { confirmation: key, confirmationLabel: CONFIRMATION_STATUS_LABELS[key] };
}

// The raw quantities a list row is derived from; they are not part of the row.
const TRACKING_KEYS = new Set(["goods_lines", "stock_lines", "open_lines", "full_lines", "reserved_lines", "reserve_required", "reserve_held", "goods_ordered", "goods_delivered",
  "goods_cancelled", "goods_remaining", "goods_returned", "quantity_ordered", "quantity_cancelled", "quantity_invoiced", "uninvoiced_lines", "invoiceable_now", "finance_invoiced", "finance_credits",
  "finance_balance_due", "finance_overdue_balance", "finance_paid", "finance_customer_credit", "requested_delivery_overdue", "fulfillment_status", "billing_status"]);
const SORTS = Object.freeze({
  date: "sales_order.order_date", number: "sales_order.sales_order_number", customer: "customer_name", total: "version.grand_total", status: "sales_order.lifecycle_status",
  requestedDelivery: "sales_order.requested_delivery_date", updated: "sales_order.updated_at",
});

// " AND (…)" for one saved view of the order list. The list and the Sales
// home use it, so a count on the home is the list it opens. Needs the
// quantities and confirmation joins of ORDER_LIST_FROM.
function orderViewSql(view, context, bind) {
  const is = trackingConditions("sales_order");
  const lifecycle = (status) => ` AND sales_order.lifecycle_status = '${status}'`;
  const fulfillment = (...statuses) => ` AND sales_order.fulfillment_status IN ('${statuses.join("','")}')`;
  const invoicing = (...statuses) => ` AND sales_order.billing_status IN ('${statuses.join("','")}')`;
  const seesTeam = orderCan(context, ORDER_PERMISSIONS.viewTeam) || orderCan(context, ORDER_PERMISSIONS.viewAll);
  let where = "";
  switch (view) {
    case "mine": where += ` AND sales_order.owner_user_id = ${bind(context.userId ?? null)}`; break;
    case "team": where += seesTeam ? ` AND sales_order.owner_user_id IN ${teamOwnersSql(bind(context.userId ?? null))}` : " AND false"; break;
    case "draft": where += lifecycle(STATUS.draft); break;
    case "confirmed": where += lifecycle(STATUS.confirmed); break;
    case "confirmation_not_sent": where += lifecycle(STATUS.confirmed) + " AND confirmation.id IS NOT NULL AND confirmation.sent_at IS NULL"; break;
    case "confirmation_sent": where += " AND sales_order.lifecycle_status IN ('confirmed','closed') AND confirmation.sent_at IS NOT NULL"; break;
    case "needs_attention": where += ` AND ${needsAttentionSql("sales_order")}`; break;
    case "awaiting_reservation": where += ` AND ${is.awaitingReservation}`; break;
    case "partially_reserved": where += ` AND ${is.partiallyReserved}`; break;
    case "awaiting_delivery": where += lifecycle(STATUS.confirmed) + fulfillment(FULFILLMENT.notStarted) + " AND quantities.goods_lines > 0"; break;
    case "partially_delivered": where += lifecycle(STATUS.confirmed) + fulfillment(FULFILLMENT.partiallyDelivered); break;
    case "delivered": where += ` AND sales_order.lifecycle_status IN ('confirmed','closed')` + fulfillment(FULFILLMENT.delivered); break;
    case "overdue_delivery": where += ` AND ${is.deliveryOverdue}`; break;
    case "ready_to_invoice": where += ` AND ${is.readyToInvoice}`; break;
    case "not_invoiced": where += lifecycle(STATUS.confirmed) + invoicing(INVOICING.notInvoiced); break;
    case "partially_invoiced": where += lifecycle(STATUS.confirmed) + invoicing(INVOICING.partiallyInvoiced); break;
    case "fully_invoiced": where += ` AND sales_order.lifecycle_status IN ('confirmed','closed')` + invoicing(INVOICING.fullyInvoiced); break;
    case "cancelled": where += lifecycle(STATUS.cancelled); break;
    case "closed": where += lifecycle(STATUS.closed); break;
    default: break;
  }
  return where;
}

// How many orders the caller can see in each of the given views, in one query.
export async function countSalesOrderViews(client, context, views) {
  requireOrderAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const basis = bind(await invoicingBasisSetting(client, context.organizationId));
  const scope = orderScopeSql(context, values, "sales_order");
  const known = views.filter((view) => ORDER_VIEWS.some((entry) => entry.key === view));
  if (!known.length) return {};
  const columns = known.map((view, index) => `count(*) FILTER (WHERE true${orderViewSql(view, context, bind)})::int AS v${index}`).join(", ");
  const row = (await client.query(
    `SELECT ${columns}
       FROM tenant.sales_orders sales_order
       LEFT JOIN tenant.sales_order_confirmations confirmation
              ON confirmation.organization_id = sales_order.organization_id AND confirmation.sales_order_id = sales_order.id AND confirmation.superseded_at IS NULL
       ${quantitiesJoin("sales_order", basis)}
       ${financeJoin("sales_order")}
      WHERE sales_order.organization_id = $1${scope}`, values)).rows[0];
  return Object.fromEntries(known.map((view, index) => [view, row[`v${index}`]]));
}

// filters: view, search, status, reservation, fulfillment, invoicing, deliveryOverdue ('true'), readyToInvoice ('true'), deliverable ('true': goods left to deliver), balance ('due' | 'overdue'), partyId, ownerUserId, warehouseId, currencyCode,
//          quotationId, productId,
//          dateFrom, dateTo, deliveryFrom, deliveryTo, sort, direction, limit, offset
export async function listSalesOrders(client, context, filters = {}) {
  requireOrderAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  // Each order's progress is read once, from the same quantities the order page uses, and the same derivations decide every status shown.
  const basis = bind(await invoicingBasisSetting(client, context.organizationId));
  const is = trackingConditions("sales_order");
  const canSeeMoney = orderCan(context, "sales.invoice.payments.view");
  let where = orderScopeSql(context, values, "sales_order");
  const lifecycle = (status) => ` AND sales_order.lifecycle_status = '${status}'`;
  const fulfillment = (...statuses) => ` AND sales_order.fulfillment_status IN ('${statuses.join("','")}')`;
  const invoicing = (...statuses) => ` AND sales_order.billing_status IN ('${statuses.join("','")}')`;
  const seesTeam = orderCan(context, ORDER_PERMISSIONS.viewTeam) || orderCan(context, ORDER_PERMISSIONS.viewAll);
  where += orderViewSql(filters.view, context, bind);
  if (Object.values(STATUS).includes(filters.status)) where += lifecycle(filters.status);
  const FULFILLMENT_FILTER = { not_delivered: FULFILLMENT.notStarted, partially_delivered: FULFILLMENT.partiallyDelivered, delivered: FULFILLMENT.delivered };
  if (FULFILLMENT_FILTER[filters.fulfillment]) where += fulfillment(FULFILLMENT_FILTER[filters.fulfillment]) + ` AND sales_order.lifecycle_status IN ('confirmed','closed')`;
  const INVOICING_FILTER = { not_invoiced: INVOICING.notInvoiced, partially_invoiced: INVOICING.partiallyInvoiced, fully_invoiced: INVOICING.fullyInvoiced };
  if (INVOICING_FILTER[filters.invoicing]) where += invoicing(INVOICING_FILTER[filters.invoicing]) + ` AND sales_order.lifecycle_status IN ('confirmed','closed')`;
  const RESERVATION_FILTER = { not_required: is.reservationNotRequired, not_reserved: is.awaitingReservation, partially_reserved: is.partiallyReserved, fully_reserved: is.fullyReserved };
  if (RESERVATION_FILTER[filters.reservation]) where += ` AND ${RESERVATION_FILTER[filters.reservation]}`;
  if (filters.deliveryOverdue === "true") where += ` AND ${is.deliveryOverdue}`;
  if (filters.readyToInvoice === "true") where += ` AND ${is.readyToInvoice}`;
  if (filters.deliverable === "true") where += lifecycle(STATUS.confirmed) + " AND quantities.goods_remaining > 0.000001";
  if (filters.balance === "due") where += ` AND ${is.hasBalance}`;
  if (filters.balance === "overdue") where += ` AND ${is.hasOverdueBalance}`;
  const CONFIRMATION_FILTER = {
    not_sent: " AND confirmation.id IS NOT NULL AND confirmation.sent_at IS NULL AND confirmation.acknowledged_at IS NULL",
    sent: " AND confirmation.sent_at IS NOT NULL AND confirmation.acknowledged_at IS NULL",
    acknowledged: " AND confirmation.acknowledged_at IS NOT NULL",
  };
  if (CONFIRMATION_FILTER[filters.confirmation]) where += CONFIRMATION_FILTER[filters.confirmation] + " AND sales_order.lifecycle_status IN ('confirmed','closed')";
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (sales_order.sales_order_number ILIKE ${term} OR version.customer_po_number ILIKE ${term} OR version.customer_reference ILIKE ${term}
      OR version.customer_snapshot->>'displayName' ILIKE ${term} OR party.customer_number ILIKE ${term} OR quotation.quotation_number ILIKE ${term}
      OR concat_ws(' ', version.contact_snapshot->>'first_name', version.contact_snapshot->>'last_name') ILIKE ${term} OR owner.full_name ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.sales_fulfillment_requests delivery WHERE delivery.organization_id = sales_order.organization_id AND delivery.sales_order_id = sales_order.id
                  AND delivery.request_number ILIKE ${term})
      OR EXISTS (SELECT 1 FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id = sales_order.organization_id AND invoice.source_sales_order_id = sales_order.id
                  AND invoice.invoice_number ILIKE ${term})
      OR EXISTS (SELECT 1 FROM tenant.sales_order_lines line WHERE line.organization_id = sales_order.organization_id AND line.sales_order_version_id = version.id
                  AND (line.item_name_snapshot ILIKE ${term} OR line.item_code_snapshot ILIKE ${term})))`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(requireUuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND sales_order.party_id = ${p}`, "Customer");
  uuidFilter("ownerUserId", (p) => ` AND sales_order.owner_user_id = ${p}`, "Salesperson");
  uuidFilter("quotationId", (p) => ` AND sales_order.source_quotation_id = ${p}`, "Quotation");
  uuidFilter("opportunityId", (p) => ` AND sales_order.source_opportunity_id = ${p}`, "Opportunity");
  uuidFilter("warehouseId", (p) => ` AND (version.default_warehouse_id = ${p} OR EXISTS (SELECT 1 FROM tenant.sales_order_lines line WHERE line.sales_order_version_id = version.id AND line.warehouse_id = ${p}))`, "Warehouse");
  uuidFilter("productId", (p) => ` AND EXISTS (SELECT 1 FROM tenant.sales_order_lines line WHERE line.sales_order_version_id = version.id AND line.item_id = ${p})`, "Product");
  if (filters.source === "quotation") where += " AND sales_order.source_quotation_id IS NOT NULL";
  if (filters.source === "direct") where += " AND sales_order.source_quotation_id IS NULL";
  if (filters.currencyCode) where += ` AND version.currency_code = ${bind(String(filters.currencyCode).trim().toUpperCase().slice(0, 3))}`;
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dateFrom", (p) => ` AND sales_order.order_date >= ${p}::date`, "From date");
  dateFilter("dateTo", (p) => ` AND sales_order.order_date <= ${p}::date`, "To date");
  dateFilter("deliveryFrom", (p) => ` AND sales_order.requested_delivery_date >= ${p}::date`, "Delivery from");
  dateFilter("deliveryTo", (p) => ` AND sales_order.requested_delivery_date <= ${p}::date`, "Delivery to");
  const sort = SORTS[filters.sort] ?? SORTS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
       LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
       LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
       LEFT JOIN tenant.sales_order_confirmations confirmation
              ON confirmation.organization_id = sales_order.organization_id AND confirmation.sales_order_id = sales_order.id AND confirmation.superseded_at IS NULL
       ${quantitiesJoin("sales_order", basis)}
       ${financeJoin("sales_order")}
      WHERE sales_order.organization_id = $1`;
  const countValues = [...values];
  const [result, count] = await inOrder([
    () => client.query(
      `SELECT sales_order.id, sales_order.sales_order_number, sales_order.order_date, sales_order.requested_delivery_date, sales_order.lifecycle_status, sales_order.fulfillment_status,
              sales_order.billing_status, sales_order.party_id, sales_order.owner_user_id, sales_order.source_quotation_id, sales_order.updated_at,
              version.version_number, version.currency_code, version.grand_total, version.customer_po_number, version.margin_percent,
              version.customer_snapshot->>'displayName' AS customer_name, party.customer_number, quotation.quotation_number AS source_quotation_number, owner.full_name AS owner_name,
              confirmation.id AS confirmation_id, confirmation.version AS confirmation_revision, confirmation.sent_at AS confirmation_last_sent_at,
              confirmation.acknowledged_at AS confirmation_acknowledged_at, (sales_order.requested_delivery_date < current_date) AS requested_delivery_overdue,
              sales_order.closed_manually, ${TRACKING_COLUMNS}
         ${from}${where}
        ORDER BY ${sort} ${direction} NULLS LAST, sales_order.sales_order_number DESC
        LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values),
    () => client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues),
  ]);
  return redactMargin({
    rows: result.rows.map((row) => {
      const tracking = summaryFromRow(row, { canSeeMoney });
      const shown = Object.fromEntries(Object.entries(row).filter(([key]) => !TRACKING_KEYS.has(key)));
      return {
        ...shown, currency_code: row.currency_code?.trim(), status: row.lifecycle_status, statusLabel: STATUS_LABELS[row.lifecycle_status] ?? row.lifecycle_status,
        fulfillment: tracking.fulfillment.status, fulfillmentLabel: tracking.fulfillment.label, invoicing: tracking.invoicing.status, invoicingLabel: tracking.invoicing.label,
        reservation: tracking.reservation.status, reservationLabel: tracking.reservation.label, delivery_overdue: tracking.flags.deliveryOverdue,
        balance_due: canSeeMoney ? tracking.payment.balanceDue : null, overdue_balance: canSeeMoney ? tracking.payment.overdueBalance : null,
        // The order's progress in each dimension, as the order page shows it.
        tracking,
        ...confirmationDisplay(row.confirmation_id ? { id: row.confirmation_id, sent_at: row.confirmation_last_sent_at, acknowledged_at: row.confirmation_acknowledged_at } : null),
      };
    }),
    total: count.rows[0].total,
    limit,
    offset,
    views: ORDER_VIEWS.filter((view) => view.key !== "team" || seesTeam),
    capabilities: orderCapabilities(context),
  }, context);
}

// What the New Sales Order form starts with, for the chosen customer.
export async function getSalesOrderDefaults(client, context, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to create sales orders.");
  const today = await databaseToday(client);
  const settings = (await client.query(
    `SELECT settings.allow_direct_orders, settings.reserve_stock_on_confirm, settings.default_payment_term_id, warehouse.id AS default_warehouse_id
       FROM tenant.sales_settings settings
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = settings.organization_id AND warehouse.id = settings.default_warehouse_id AND warehouse.status = 'active'
      WHERE settings.organization_id = $1`, [context.organizationId])).rows[0] ?? {};
  const base = {
    orderDate: today, directOrdersAllowed: settings.allow_direct_orders !== false, reservesOnConfirm: settings.reserve_stock_on_confirm !== false,
    defaultWarehouseId: settings.default_warehouse_id ?? null,
  };
  if (!isUuid(input.partyId)) return base;
  const document = await withDefaults(client, context, { partyId: input.partyId, lines: [] }, today);
  const party = (await client.query(`SELECT payment_term_id, default_price_list_id, status, sales_block, sales_block_reason FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, document.partyId])).rows[0] ?? {};
  return {
    ...base, currencyCode: document.currencyCode ?? null, contactId: document.contactId, billingAddressId: document.billingAddressId, shippingAddressId: document.shippingAddressId,
    ownerUserId: document.ownerUserId, paymentTermId: party.payment_term_id ?? settings.default_payment_term_id ?? null, priceListId: party.default_price_list_id ?? null,
    // Why an order cannot be placed for this customer, when it cannot.
    blocked: party.status !== "active" ? "This customer is inactive." : ["all", "orders"].includes(party.sales_block) ? `Customer is blocked: ${party.sales_block_reason}` : null,
  };
}

const csvCell = (value) => {
  const result = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(result) ? `'${result}` : result;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// The list as filtered on screen, as CSV (up to 5,000 rows).
export async function exportSalesOrders(client, context, filters = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.export, "You do not have permission to export sales orders.");
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await listSalesOrders(client, context, { ...filters, limit: 200, offset });
    rows.push(...page.rows);
    if (page.rows.length < 200) break;
  }
  const header = ["Sales order", "Order date", "Customer", "Customer number", "Customer PO", "Quotation", "Salesperson", "Requested delivery", "Currency", "Total", "Order status", "Confirmation",
    "Reservation", "Fulfilment", "Delivered", "Cancelled", "Invoicing", "Balance due"];
  const body = rows.map((row) => [row.sales_order_number, dayOf(row.order_date), row.customer_name, row.customer_number, row.customer_po_number, row.source_quotation_number, row.owner_name,
    dayOf(row.requested_delivery_date), row.currency_code, row.grand_total, row.statusLabel, row.confirmationLabel, row.reservationLabel, row.fulfillmentLabel,
    row.tracking.fulfillment.applies ? `${row.tracking.fulfillment.delivered} / ${row.tracking.fulfillment.ordered}` : "", row.tracking.fulfillment.cancelled || "", row.invoicingLabel,
    row.balance_due ?? ""].map(csvCell).join(","));
  return { csv: [header.join(","), ...body].join("\r\n") + "\r\n", fileName: `sales-orders-${await databaseToday(client)}.csv`, rows: rows.length };
}

// A comment on the order's timeline (never printed). input: { note }
export async function addSalesOrderNote(client, context, orderId, input = {}) {
  requireOrderAccess(context);
  const note = text(input.note, 4000);
  if (!note) throw new OrderError(400, "Write the note.", "SALES_ORDER_VALIDATION", { field: "note" });
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  await recordOrderEvent(client, context, order.id, "sales_order.note_added", order.lifecycle_status, order.lifecycle_status, { note });
  return { added: true };
}

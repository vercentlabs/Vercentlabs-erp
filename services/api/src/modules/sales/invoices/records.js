// Sales invoices: what an order can be invoiced for, a new draft from an
// order or a delivery, changing a draft, reading one and listing them.
//
// The invoice is Finance's customer invoice (number, dates, lines, amounts,
// receivable); Sales keeps beside it the customer, contact, addresses and
// seller as invoiced, the salesperson, the notes, each line's product details
// and tax components. A draft is not owed, not in the books and not invoiced:
// another draft may bill the same quantity for a while (each is warned of the
// others), and posting decides, against what is really left then.
import { changeCustomerInvoiceDueDate, createCustomerInvoice, replaceCustomerInvoiceDraft } from "../../accounting/receivables.js";
import { PaymentTermError, calculateDueDate, readTermSnapshot, salesTermSnapshot } from "../../../core/payment-terms/index.js";
import { asDatabaseDecimal, decimal } from "../../../core/decimal.js";
import { assertOrderVisible, requireOrderAccess } from "../orders/access.js";
import { STATUS, dayOf, requireUuid, text } from "../orders/constants.js";
import { lockOrder, readDate } from "../orders/versions.js";
import { invoiceCan, invoiceScopeSql, loadInvoice, requireInvoiceAccess, requireInvoicePermission } from "./access.js";
import { EPSILON, buildInvoiceLines, invoiceableLines, orderSource, taxDifferences, taxEngineFor } from "./build.js";
import {
  CREDIT_STATUS_LABELS, FINANCE_POSTED, INVOICE_PERMISSIONS, INVOICE_STATUS, INVOICE_VIEWS, InvoiceError, PAYMENT_STATUS_LABELS, QUANTITY_BASIS, SENT_CHANNELS, basisOfSetting,
  creditStatusOf, invoiceStatusLabel, invoiceStatusOf, paymentStatusOf,
} from "./constants.js";

// Sales events of an invoice; the event table keeps sales invoices as 'invoice_request'.
export async function recordInvoiceEvent(client, context, invoiceId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'invoice_request', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, invoiceId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}
async function recordOrderEvent(client, context, orderId, eventType, status, metadata) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'sales_order', $2, $3, $4, $4, $5::jsonb, $6, clock_timestamp())`,
    [context.organizationId, orderId, eventType, status, JSON.stringify(metadata), context.userId ?? null]);
}

// Finance acts on Sales' behalf: the Sales permission checked here authorises it.
export const financeContext = (context) => ({
  organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["accounting.view", "accounting.receivables.manage"], roleSlugs: [],
});
function financeError(error, fallback) {
  if (error?.name !== "AccountingError") return error;
  return new InvoiceError(error.status ?? 409, `${fallback}: ${error.message}`, error.code ?? "SALES_INVOICE_FINANCE_REFUSED");
}

async function companyBasis(client, context) {
  const setting = (await client.query(`SELECT invoice_quantity_basis FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0]?.invoice_quantity_basis;
  return basisOfSetting(setting);
}

// What a new invoice of the order would bill, on the company's invoicing basis.
export async function getInvoiceProposal(client, context, orderId) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const basis = await companyBasis(client, context);
  const lines = await invoiceableLines(client, context.organizationId, order, basis);
  return {
    orderId: order.id, basis, canInvoice: order.lifecycle_status === STATUS.confirmed,
    lines: lines.filter((line) => line.remainingToInvoice > EPSILON).map((line) => ({
      salesOrderLineId: line.lineId, itemName: line.itemName, unit: line.unit, ordered: line.ordered, delivered: line.delivered, invoiced: line.invoiced, cancelled: line.cancelled,
      remainingToInvoice: line.remainingToInvoice, eligible: line.invoiceableNow, pendingDelivery: line.pendingDelivery,
      onDrafts: line.onDrafts, draftInvoices: line.draftInvoices, isService: !line.deliverable,
    })),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

// Checks the requested quantities against what each line can take.
function settle(lines, requested, { basis, delivery }) {
  const byId = new Map(lines.map((line) => [line.lineId, line]));
  const limit = (line) => (delivery ? Math.min(line.eligible, delivery.lines.get(line.lineId)?.available ?? 0) : line.eligible);
  const chosen = (requested?.length
    ? requested.map((entry) => ({ line: byId.get(requireUuid(entry.salesOrderLineId, "Order line")), quantity: Number(entry.quantity) })).filter((entry) => entry.quantity !== 0)
    : lines.filter((line) => (!delivery || delivery.lines.has(line.lineId)) && limit(line) > EPSILON).map((line) => ({ line, quantity: limit(line) })));
  if (!chosen.length)
    throw new InvoiceError(409, delivery ? "Everything on this delivery has been invoiced." : basis === QUANTITY_BASIS.delivered ? "Nothing delivered is left to invoice. Deliver the goods first."
      : "Nothing is left to invoice on this order.", "SALES_ORDER_NOTHING_TO_INVOICE");
  const seen = new Set();
  for (const { line, quantity } of chosen) {
    if (!line) throw new InvoiceError(404, "An order line was not found on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    if (seen.has(line.lineId)) throw new InvoiceError(400, `${line.itemName} is on the invoice twice.`, "SALES_ORDER_VALIDATION");
    seen.add(line.lineId);
    if (delivery && !delivery.lines.has(line.lineId)) throw new InvoiceError(409, `${line.itemName} is not on delivery ${delivery.number}.`, "SALES_ORDER_VALIDATION");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new InvoiceError(400, `${line.itemName}: enter the quantity to invoice.`, "SALES_ORDER_VALIDATION");
    const available = limit(line);
    if (quantity > available + EPSILON)
      throw new InvoiceError(409, `${line.itemName}: only ${available} ${line.unit ?? ""} can be invoiced now.`.replace("  ", " "),
        "SALES_ORDER_INVOICE_EXCEEDS_REMAINING");
  }
  return chosen;
}

async function writeSalesLines(client, context, invoiceId, lineIds, built) {
  for (let index = 0; index < built.length; index += 1) {
    const { sales, taxes } = built[index];
    const lineId = lineIds[index];
    await client.query(
      `INSERT INTO tenant.sales_invoice_lines (customer_invoice_line_id, organization_id, customer_invoice_id, item_code_snapshot, item_name_snapshot, description_snapshot, hsn_sac_kind,
          uom_snapshot, list_unit_price, gross_amount, line_discount_amount, document_discount_amount, tax_category_id, tax_rate, tax_treatment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [lineId, context.organizationId, invoiceId, sales.item_code_snapshot, sales.item_name_snapshot, sales.description_snapshot, sales.hsn_sac_kind, sales.uom_snapshot,
        sales.list_unit_price, sales.gross_amount, sales.line_discount_amount, sales.document_discount_amount, sales.tax_category_id, sales.tax_rate, sales.tax_treatment]);
    for (const component of taxes)
      await client.query(
        `INSERT INTO tenant.sales_invoice_line_taxes (organization_id, customer_invoice_id, customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [context.organizationId, invoiceId, lineId, component.sequence, component.taxType, component.label, asDatabaseDecimal(component.rate),
          asDatabaseDecimal(component.taxableAmount), asDatabaseDecimal(component.taxAmount)]);
  }
}

// A new Draft invoice of a confirmed order. input: { idempotencyKey, lines?: [{ salesOrderLineId, quantity }], invoiceDate?, postingDate?, customerNotes?, internalNotes? }
// options.delivery (from createInvoiceFromDelivery): { id, number, lines: Map(orderLineId → { deliveryLineId, available }) }.
// Without `lines`, everything that can be invoiced now is billed.
export async function createInvoiceFromSalesOrder(client, context, orderId, input = {}, options = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.create, "You do not have permission to create invoices.");
  const delivery = options.delivery ?? null;
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new InvoiceError(400, "A request key is required to create an invoice.", "SALES_ORDER_VALIDATION");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const existing = (await client.query(
    `SELECT sales_invoice.customer_invoice_id, sales_invoice.sales_order_id, invoice.invoice_number FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = sales_invoice.customer_invoice_id
      WHERE sales_invoice.organization_id = $1 AND sales_invoice.idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.sales_order_id !== order.id) throw new InvoiceError(409, "That request key was used for another order.", "SALES_ORDER_VALIDATION");
    return { invoiceId: existing.customer_invoice_id, invoiceNumber: existing.invoice_number, status: INVOICE_STATUS.draft, replayed: true };
  }
  if (order.lifecycle_status !== STATUS.confirmed) throw new InvoiceError(409, "Only a confirmed order can be invoiced.", "SALES_ORDER_NOT_CONFIRMED");
  const basis = delivery ? QUANTITY_BASIS.delivered : await companyBasis(client, context);
  const lines = await invoiceableLines(client, context.organizationId, order, basis);
  const chosen = settle(lines, input.lines, { basis, delivery }).map((entry) => ({ ...entry, deliveryLineId: delivery?.lines.get(entry.line.lineId)?.deliveryLineId }));
  const source = await orderSource(client, context.organizationId, order.current_version_id);
  const version = source.version;
  const invoiceDate = readDate(input.invoiceDate, "Invoice date") ?? today();
  const taxOf = await taxEngineFor(client, context, { ...version, invoice_date: invoiceDate });
  const built = await buildInvoiceLines(client, context, source, chosen, taxOf);
  const postingDate = readDate(input.postingDate, "Posting date");
  if (postingDate && postingDate !== invoiceDate) requireInvoicePermission(context, INVOICE_PERMISSIONS.changePostingDate, "You do not have permission to change the posting date.");
  // The invoice inherits the order's agreed payment terms as they were agreed, never today's customer terms or master. Its due date
  // is worked out from its own date; terms that set no date (custom) leave it to be entered before posting.
  const calculatedDueDate = calculateDueDate(invoiceDate, version.payment_term_snapshot);
  let created;
  try {
    created = await createCustomerInvoice(client, financeContext(context), {
      partyId: order.party_id, billingAddressId: version.billing_address_id, invoiceDate, accountingDate: postingDate ?? invoiceDate, dueDate: calculatedDueDate ?? invoiceDate,
      currencyCode: String(version.currency_code).trim(), exchangeRate: version.exchange_rate, customerSnapshot: version.customer_snapshot,
      billingAddressSnapshot: version.billing_address_snapshot, paymentTermSnapshot: version.payment_term_snapshot,
      placeOfSupply: version.place_of_supply, supplyType: version.supply_type, termsAndConditions: version.terms_and_conditions,
      lines: built.map((line) => line.finance),
    }, { internal: true, sourceSalesOrderId: order.id, returnLineIds: true });
  } catch (error) {
    throw financeError(error, "The invoice could not be created");
  }
  await client.query(
    `INSERT INTO tenant.sales_invoices (customer_invoice_id, organization_id, sales_order_id, sales_order_version_id, idempotency_key, quantity_basis, customer_snapshot, contact_id,
        contact_snapshot, shipping_address_snapshot, seller_registration_id, seller_snapshot, place_of_supply_name, supply_nature, customer_po_number, owner_user_id,
        customer_notes, internal_notes, created_by, calculated_due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [created.id, context.organizationId, order.id, version.id, key, basis, JSON.stringify(version.customer_snapshot ?? {}), order.contact_id ?? null,
      JSON.stringify(version.contact_snapshot ?? {}), JSON.stringify(version.shipping_address_snapshot ?? {}), version.seller_registration_id ?? null,
      JSON.stringify(version.seller_snapshot ?? {}), version.place_of_supply_name ?? null, version.supply_nature ?? null, version.customer_po_number ?? null,
      order.owner_user_id ?? null, text(input.customerNotes, 4000) ?? version.customer_notes ?? null, text(input.internalNotes, 4000), context.userId ?? null, calculatedDueDate]);
  await writeSalesLines(client, context, created.id, created.lineIds, built);
  const summary = chosen.map(({ line, quantity }) => ({ item: line.itemName, quantity, unit: line.unit }));
  await recordInvoiceEvent(client, context, created.id, "sales_invoice.created", null, INVOICE_STATUS.draft,
    { invoiceNumber: created.invoiceNumber, orderNumber: order.sales_order_number, deliveryNumber: delivery?.number, basis, lines: summary });
  await recordOrderEvent(client, context, order.id, "sales_order.invoice_created", order.lifecycle_status,
    { invoiceId: created.id, invoiceNumber: created.invoiceNumber, deliveryId: delivery?.id, deliveryNumber: delivery?.number, status: INVOICE_STATUS.draft, lines: summary });
  return { invoiceId: created.id, invoiceNumber: created.invoiceNumber, status: INVOICE_STATUS.draft, replayed: false, warnings: draftWarnings(chosen) };
}

// Other drafts billing the same order lines: only what is left when each is posted can be posted.
function draftWarnings(chosen) {
  return chosen.filter(({ line }) => line.onDrafts > EPSILON).map(({ line, quantity }) => ({
    item: line.itemName, quantity, invoiceableNow: line.invoiceableNow, otherDrafts: line.draftInvoices,
    message: `${line.itemName}: ${line.draftInvoices.map((draft) => `${draft.invoiceNumber} (${draft.quantity})`).join(", ")} also bill this line; only ${line.invoiceableNow} can be invoiced in all.`,
  }));
}

// A Draft invoice for what a dispatched delivery delivered and is not yet invoiced. input: { idempotencyKey, lines?: [{ deliveryLineId, quantity }], invoiceDate?, customerNotes?, internalNotes? }
export async function createInvoiceFromDelivery(client, context, deliveryId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.create, "You do not have permission to create invoices.");
  const { loadDelivery } = await import("../deliveries/access.js");
  const seen = await loadDelivery(client, context, deliveryId);
  await lockOrder(client, context, seen.sales_order_id);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  const key = text(input.idempotencyKey, 200);
  const replay = key && (await client.query(`SELECT 1 FROM tenant.sales_invoices WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (!replay && !["dispatched", "delivered"].includes(delivery.delivery_status))
    throw new InvoiceError(409, "Only a dispatched or delivered delivery can be invoiced.", "SALES_DELIVERY_NOT_DISPATCHED");
  const lines = await deliveryInvoiceableLines(client, context.organizationId, delivery.id);
  const byDeliveryLine = new Map(lines.map((line) => [line.id, line]));
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => {
      const line = byDeliveryLine.get(requireUuid(entry.deliveryLineId, "Delivery line"));
      if (!line) throw new InvoiceError(404, "That line is not on this delivery.", "SALES_DELIVERY_LINE_NOT_FOUND");
      return { salesOrderLineId: line.sales_order_line_id, quantity: entry.quantity };
    })
    : undefined;
  const result = await createInvoiceFromSalesOrder(client, context, delivery.sales_order_id, { ...input, lines: requested }, {
    delivery: { id: delivery.id, number: delivery.request_number, lines: new Map(lines.map((line) => [line.sales_order_line_id, { deliveryLineId: line.id, available: line.available }])) },
  });
  if (!result.replayed) {
    const { recordDeliveryEvent } = await import("../deliveries/records.js");
    await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.invoiced", delivery.delivery_status, delivery.delivery_status,
      { invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber });
  }
  return { ...result, deliveryId: delivery.id };
}

// Each delivery line with what posted invoices have not billed yet, and what drafts bill of it.
export async function deliveryInvoiceableLines(client, organizationId, deliveryId, exceptInvoiceId = null) {
  const billed = (statuses) => `COALESCE((SELECT sum(invoiced.quantity) FROM tenant.accounting_customer_invoice_lines invoiced
         JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
              AND invoice.status IN (${statuses}) AND ($3::uuid IS NULL OR invoice.id <> $3)
        WHERE invoiced.organization_id = line.organization_id AND invoiced.source_sales_delivery_line_id = line.id), 0)`;
  return (await client.query(
    `SELECT line.id, line.sales_order_line_id, line.item_name_snapshot, line.uom_snapshot, line.quantity,
            line.quantity - ${billed(`'${FINANCE_POSTED.join("','")}'`)}
              - COALESCE((SELECT sum(returned.quantity) FROM tenant.sales_return_lines returned JOIN tenant.sales_returns sales_return ON sales_return.id = returned.sales_return_id AND sales_return.status = 'received'
                           WHERE returned.organization_id = line.organization_id AND returned.delivery_line_id = line.id), 0) AS available, ${billed("'draft','pending_approval','approved'")} AS on_drafts
       FROM tenant.sales_delivery_lines line WHERE line.organization_id = $1 AND line.delivery_id = $2 ORDER BY line.sequence NULLS LAST, line.created_at`,
    [organizationId, deliveryId, exceptInvoiceId])).rows.map((row) => ({ ...row, quantity: Number(row.quantity), available: Math.max(0, Number(row.available)), onDrafts: Number(row.on_drafts) }));
}

// The invoice's lines as Sales shows them: Finance's values with the product snapshot and the tax components.
export async function invoiceLines(client, organizationId, invoiceId) {
  const lines = (await client.query(
    `SELECT line.id, line.sequence, line.source_sales_order_line_id, line.source_sales_delivery_line_id, line.item_id, line.description, line.hsn_sac_code, line.quantity, line.uom_id,
            line.unit_price, line.discount_amount, line.net_amount, line.tax_amount, line.line_total, snapshot.item_code_snapshot, snapshot.item_name_snapshot,
            snapshot.description_snapshot, snapshot.hsn_sac_kind, snapshot.uom_snapshot, snapshot.list_unit_price, snapshot.gross_amount, snapshot.line_discount_amount,
            snapshot.document_discount_amount, snapshot.tax_category_id, snapshot.tax_rate, snapshot.tax_treatment, delivery.request_number AS delivery_number, delivery.id AS delivery_id
       FROM tenant.accounting_customer_invoice_lines line
       LEFT JOIN tenant.sales_invoice_lines snapshot ON snapshot.customer_invoice_line_id = line.id
       LEFT JOIN tenant.sales_delivery_lines delivery_line ON delivery_line.id = line.source_sales_delivery_line_id
       LEFT JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivery_line.delivery_id
      WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 ORDER BY line.sequence`, [organizationId, invoiceId])).rows;
  const taxes = (await client.query(
    `SELECT customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount FROM tenant.sales_invoice_line_taxes
      WHERE organization_id = $1 AND customer_invoice_id = $2 ORDER BY customer_invoice_line_id, sequence`, [organizationId, invoiceId])).rows;
  return lines.map((line) => ({ ...line, item_name_snapshot: line.item_name_snapshot ?? line.description, taxes: taxes.filter((tax) => tax.customer_invoice_line_id === line.id) }));
}

// A draft's lines worked out again from the order: the quantities asked for (or the ones it has),
// values in proportion to the quantity over what is posted now, tax at the rates the draft carries
// (or, recalculating, those in force on the invoice date). Used when a draft changes and when it is
// posted, so posted invoices always add up to the order. Returns { changes, chosen }.
export async function rewriteDraft(client, context, invoice, order, { requested = null, invoiceDate, postingDate, dueDate, paymentTermSnapshot = undefined, recalculateTax = false }) {
  const changes = [];
  const current = await invoiceLines(client, context.organizationId, invoice.id);
  const source = await orderSource(client, context.organizationId, invoice.sales_order_version_id ?? order.current_version_id);
  const deliveryByLine = new Map(current.filter((line) => line.source_sales_delivery_line_id).map((line) => [line.source_sales_order_line_id, line.source_sales_delivery_line_id]));
  const asked = requested ?? current.map((line) => ({ salesOrderLineId: line.source_sales_order_line_id, quantity: Number(line.quantity) }));
  const lines = await invoiceableLines(client, context.organizationId, { ...order, current_version_id: invoice.sales_order_version_id ?? order.current_version_id },
    invoice.quantity_basis, { exceptInvoiceId: invoice.id });
  // From a delivery, a line never bills more than posted invoices have left of that delivery line.
  let delivery = null;
  if (deliveryByLine.size) {
    const deliveryIds = (await client.query(`SELECT DISTINCT delivery_id FROM tenant.sales_delivery_lines WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [context.organizationId, [...deliveryByLine.values()]])).rows.map((row) => row.delivery_id);
    const available = new Map();
    for (const id of deliveryIds) for (const line of await deliveryInvoiceableLines(client, context.organizationId, id, invoice.id)) available.set(line.id, line.available);
    delivery = { id: deliveryIds[0], number: "", lines: new Map([...deliveryByLine].map(([orderLine, deliveryLine]) => [orderLine, { deliveryLineId: deliveryLine, available: available.get(deliveryLine) ?? 0 }])) };
  }
  const chosen = settle(lines, asked.filter((entry) => Number(entry.quantity) !== 0), { basis: invoice.quantity_basis, delivery })
    .map((entry) => ({ ...entry, deliveryLineId: deliveryByLine.get(entry.line.lineId) }));
  const dated = { ...invoice, invoice_date: invoiceDate };
  const engine = await taxEngineFor(client, context, dated);
  const stored = new Map(current.map((line) => [line.source_sales_order_line_id,
    line.taxes.map((tax) => ({ type: tax.tax_type, label: tax.label, rate: decimal(tax.rate) }))]));
  if (recalculateTax)
    for (const difference of await taxDifferences(client, context, dated, current, source.lines))
      changes.push({ what: `${difference.item}: tax`, from: difference.invoiced, to: difference.expected });
  const taxOf = async (row) => (!recalculateTax && stored.has(row.id) ? stored.get(row.id) : engine(row));
  const built = await buildInvoiceLines(client, context, source, chosen, taxOf);
  if (requested)
    for (const { line, quantity } of chosen) {
      const was = current.find((row) => row.source_sales_order_line_id === line.lineId);
      if (!was || Math.abs(Number(was.quantity) - quantity) > EPSILON) changes.push({ what: `${line.itemName}: quantity`, from: was ? Number(was.quantity) : 0, to: quantity });
    }
  let replaced;
  try {
    replaced = await replaceCustomerInvoiceDraft(client, financeContext(context), invoice.id, {
      invoiceDate, accountingDate: postingDate, dueDate, paymentTermSnapshot: paymentTermSnapshot ?? invoice.payment_term_snapshot, lines: built.map((line) => line.finance),
    }, { internal: true });
  } catch (error) {
    throw financeError(error, "The invoice could not be changed");
  }
  await writeSalesLines(client, context, invoice.id, replaced.lineIds, built);
  return { changes, chosen };
}

// Changes a draft: quantities, dates, contact, notes, and the tax worked out again on the invoice date.
// input: { expectedVersion?, lines?: [{ salesOrderLineId, quantity }] (the full set; 0 removes), invoiceDate?, postingDate?, dueDate?, contactId?, customerNotes?, internalNotes?,
//          recalculateTax? }
export async function updateDraftInvoice(client, context, invoiceId, input = {}) {
  // The payment terms and the due date can be settled by whoever may change them (a sales manager before posting), without the right to edit the rest.
  const termsOnly = Object.keys(input).every((key) => ["expectedVersion", "paymentTermId", "paymentTermsNote", "dueDate", "dueDateReason"].includes(key) || input[key] === undefined);
  if (!(termsOnly && (invoiceCan(context, INVOICE_PERMISSIONS.changePaymentTerms) || invoiceCan(context, INVOICE_PERMISSIONS.overrideDueDate))))
    requireInvoicePermission(context, INVOICE_PERMISSIONS.edit, "You do not have permission to edit invoices.");
  const seen = await loadInvoice(client, context, invoiceId);
  const order = await lockOrder(client, context, seen.sales_order_id);
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (invoice.status !== "draft")
    throw new InvoiceError(409, invoice.status === "pending_approval" || invoice.status === "approved" ? "The invoice is with Finance for approval and cannot be changed."
      : "A posted invoice cannot be changed. Use a credit note.", "SALES_INVOICE_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(invoice.version))
    throw new InvoiceError(409, "Someone else changed this invoice. Reload it and try again.", "SALES_INVOICE_VERSION_CONFLICT");
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const changes = [];
  const invoiceDate = has("invoiceDate") ? readDate(input.invoiceDate, "Invoice date") ?? dayOf(invoice.invoice_date) : dayOf(invoice.invoice_date);
  const postingDate = has("postingDate") ? readDate(input.postingDate, "Posting date") ?? invoiceDate : (dayOf(invoice.accounting_date) === dayOf(invoice.invoice_date) ? invoiceDate : dayOf(invoice.accounting_date));
  if (postingDate !== invoiceDate && (has("postingDate") || has("invoiceDate")))
    requireInvoicePermission(context, INVOICE_PERMISSIONS.changePostingDate, "You do not have permission to change the posting date.");
  if (invoiceDate !== dayOf(invoice.invoice_date)) changes.push({ what: "Invoice date", from: dayOf(invoice.invoice_date), to: invoiceDate });
  if (postingDate !== dayOf(invoice.accounting_date)) changes.push({ what: "Posting date", from: dayOf(invoice.accounting_date), to: postingDate });
  const sets = [];
  const values = [context.organizationId, invoice.id];
  const set = (column, value, cast = "") => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };

  // Payment terms: other terms (an active one), or other additional text for this invoice. The invoice keeps its own snapshot.
  const currentTerm = readTermSnapshot(invoice.payment_term_snapshot);
  let termSnapshot;
  if (has("paymentTermId") || has("paymentTermsNote")) {
    const wanted = has("paymentTermId") && input.paymentTermId ? requireUuid(input.paymentTermId, "Payment terms") : currentTerm?.id ?? null;
    const note = has("paymentTermsNote") ? text(input.paymentTermsNote, 1000) : currentTerm?.note ?? null;
    if (wanted && wanted !== (currentTerm?.id ?? null)) {
      requireInvoicePermission(context, INVOICE_PERMISSIONS.changePaymentTerms, "You do not have permission to change the payment terms.");
      try {
        termSnapshot = await salesTermSnapshot(client, context.organizationId, wanted, note);
      } catch (error) {
        if (!(error instanceof PaymentTermError)) throw error;
        throw new InvoiceError(error.status === 404 ? 409 : error.status, error.message, "SALES_INVOICE_PAYMENT_TERMS_INVALID", { field: "paymentTermId" });
      }
      changes.push({ what: "Payment terms", from: currentTerm?.name ?? null, to: termSnapshot.name });
    } else if (currentTerm && (note ?? "") !== (currentTerm.note ?? "")) {
      requireInvoicePermission(context, INVOICE_PERMISSIONS.changePaymentTerms, "You do not have permission to change the payment terms.");
      termSnapshot = { ...invoice.payment_term_snapshot, note: note ?? undefined };
      changes.push({ what: "Additional payment terms", from: currentTerm.note ?? null, to: note });
    }
  }
  // The due date: what the terms work out from the invoice date, unless an authorised user sets another date with a reason.
  // Other terms or another invoice date work it out again and drop an earlier override; terms that set no date keep the one entered.
  const terms = termSnapshot ?? invoice.payment_term_snapshot;
  const calculated = calculateDueDate(invoiceDate, terms);
  const before = dayOf(invoice.due_date);
  let overridden = Boolean(invoice.due_date_overridden);
  let reason = invoice.due_date_override_reason ?? null;
  let dueDate = overridden ? before : calculated ?? before;
  if (has("dueDate") && !input.dueDate) {
    overridden = false; reason = null; dueDate = calculated ?? invoiceDate;
  } else if (has("dueDate") && (readDate(input.dueDate, "Due date") !== (overridden ? before : calculated) || (calculated === null && !overridden))) {
    requireInvoicePermission(context, INVOICE_PERMISSIONS.overrideDueDate, "You do not have permission to set the due date by hand.");
    dueDate = readDate(input.dueDate, "Due date");
    reason = text(input.dueDateReason, 500);
    // Terms that work out a date need a reason to depart from it; terms that set none are simply completed.
    if (calculated !== null && dueDate !== calculated && !reason)
      throw new InvoiceError(400, "Give the reason for setting another due date.", "SALES_INVOICE_DUE_DATE_REASON_REQUIRED", { field: "dueDateReason" });
    overridden = calculated === null || dueDate !== calculated;
    if (!overridden) reason = null;
  } else if (overridden && calculated !== null && (termSnapshot?.id !== undefined && termSnapshot.id !== currentTerm?.id || invoiceDate !== dayOf(invoice.invoice_date))) {
    overridden = false; reason = null; dueDate = calculated;
    changes.push({ what: "Due date override", from: before, to: "worked out again from the payment terms" });
  }
  if (dueDate < invoiceDate) throw new InvoiceError(400, "The due date cannot be before the invoice date.", "SALES_INVOICE_DUE_DATE_INVALID", { field: "dueDate" });
  if (dueDate !== before) changes.push({ what: overridden ? "Due date (set by hand)" : "Due date", from: before, to: dueDate, reason: overridden ? reason ?? undefined : undefined });
  if ((dayOf(invoice.calculated_due_date) ?? "") !== (calculated ?? "")) set("calculated_due_date", calculated);
  if (overridden !== Boolean(invoice.due_date_overridden)) set("due_date_overridden", overridden);
  if ((reason ?? "") !== (invoice.due_date_override_reason ?? "")) {
    set("due_date_override_reason", reason);
    if (dueDate === before && overridden) changes.push({ what: "Due date reason", from: invoice.due_date_override_reason ?? null, to: reason });
  }

  if (Array.isArray(input.lines) || changes.length || input.recalculateTax) {
    const rewritten = await rewriteDraft(client, context, invoice, order, {
      requested: Array.isArray(input.lines) ? input.lines : null, invoiceDate, postingDate, dueDate, paymentTermSnapshot: termSnapshot, recalculateTax: Boolean(input.recalculateTax),
    });
    changes.push(...rewritten.changes);
  }
  for (const [key, column, label] of [["customerNotes", "customer_notes", "Customer notes"], ["internalNotes", "internal_notes", "Internal notes"]]) {
    if (!has(key)) continue;
    const value = text(input[key], 4000);
    if ((value ?? "") !== (invoice[column] ?? "")) { set(column, value); changes.push({ what: label, from: invoice[column] ?? null, to: value }); }
  }
  if (has("contactId")) {
    let contact = {};
    if (input.contactId) {
      contact = (await client.query(
        `SELECT contact.id, contact.first_name, contact.last_name, COALESCE(link.job_title, contact.designation) AS designation, contact.email, contact.phone, contact.mobile, link.role
           FROM tenant.contacts contact
           JOIN tenant.crm_contact_account_relationships link ON link.organization_id = contact.organization_id AND link.contact_id = contact.id AND link.party_id = $2 AND link.status = 'active'
          WHERE contact.organization_id = $1 AND contact.id = $3 AND contact.status = 'active' AND contact.archived_at IS NULL`,
        [context.organizationId, invoice.party_id, requireUuid(input.contactId, "Contact")])).rows[0];
      if (!contact) throw new InvoiceError(409, "The contact does not belong to this customer.", "SALES_INVOICE_CONTACT_INVALID");
    }
    if ((contact.id ?? null) !== (invoice.contact_id ?? null)) {
      set("contact_id", contact.id ?? null);
      set("contact_snapshot", JSON.stringify(contact), "::jsonb");
      changes.push({ what: "Contact", from: [invoice.contact_snapshot?.first_name, invoice.contact_snapshot?.last_name].filter(Boolean).join(" ") || null,
        to: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null });
    }
  }
  if (!changes.length && !sets.length) return { invoiceId: invoice.id, version: Number(invoice.version), changed: false };
  const version = (await client.query(
    `UPDATE tenant.sales_invoices SET ${[...sets, "version = version + 1", "updated_at = now()"].join(", ")} WHERE organization_id = $1 AND customer_invoice_id = $2 RETURNING version`, values)).rows[0].version;
  if (!changes.length) return { invoiceId: invoice.id, version: Number(version), changed: false };
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.updated", INVOICE_STATUS.draft, INVOICE_STATUS.draft, { changes });
  return { invoiceId: invoice.id, version: Number(version), changed: true, changes };
}

// What the caller can do with the invoice now; the server checks again on each action.
function availableActions(context, invoice, { paid, credits, balance }, creditedTotal) {
  const can = (permission) => invoiceCan(context, permission);
  const status = invoiceStatusOf(invoice.status);
  const posted = status === INVOICE_STATUS.posted;
  return {
    edit: invoice.status === "draft" && can(INVOICE_PERMISSIONS.edit),
    post: ["draft", "approved"].includes(invoice.status) && can(INVOICE_PERMISSIONS.post),
    cancel: ["draft", "approved"].includes(invoice.status) && can(INVOICE_PERMISSIONS.edit),
    print: status !== INVOICE_STATUS.cancelled && can(INVOICE_PERMISSIONS.print),
    send: posted && can(INVOICE_PERMISSIONS.send),
    markSent: posted && can(INVOICE_PERMISSIONS.send),
    recordPayment: posted && balance > 0.005 && can(INVOICE_PERMISSIONS.recordPayment),
    creditNote: posted && creditedTotal + 0.005 < Number(invoice.grand_total) && can(INVOICE_PERMISSIONS.creditNote),
    reverse: ["posted", "overdue"].includes(invoice.status) && paid <= 0.005 && credits <= 0.005 && can(INVOICE_PERMISSIONS.reverse),
    changePaymentTerms: invoice.status === "draft" && can(INVOICE_PERMISSIONS.changePaymentTerms),
    overrideDueDate: invoice.status === "draft" && can(INVOICE_PERMISSIONS.overrideDueDate),
    // A posted invoice that still owes something: Finance can correct when it falls due.
    changeDueDate: posted && balance > 0.005 && can(INVOICE_PERMISSIONS.changePostedDueDate),
    viewPayments: can(INVOICE_PERMISSIONS.paymentsView),
    viewAccounting: Boolean(invoice.journal_entry_id) && can(INVOICE_PERMISSIONS.accountingView),
  };
}

// Paid and credited from what Finance applied; the balance from them.
async function settlement(client, organizationId, invoiceId, total) {
  const row = (await client.query(
    `SELECT COALESCE((SELECT sum(allocated_amount) FROM tenant.accounting_customer_receipt_allocations WHERE organization_id = $1 AND customer_invoice_id = $2), 0) AS paid,
            COALESCE((SELECT sum(allocated_amount) FROM tenant.accounting_customer_credit_allocations WHERE organization_id = $1 AND customer_invoice_id = $2), 0) AS credits`,
    [organizationId, invoiceId])).rows[0];
  const paid = Number(row.paid);
  const credits = Number(row.credits);
  return { paid, credits, balance: Math.max(0, Math.round((total - paid - credits) * 100) / 100) };
}

// Everything the invoice page shows.
export async function getSalesInvoice(client, context, invoiceId) {
  const invoice = await loadInvoice(client, context, invoiceId);
  const head = (await client.query(
    `SELECT creator.full_name AS created_by_name, poster.full_name AS posted_by_name, reverser.full_name AS reversed_by_name, sender.full_name AS sent_by_name, owner.full_name AS owner_name,
            party.customer_number, sales_order.source_quotation_id, quotation.quotation_number AS source_quotation_number, sales_order.source_opportunity_id,
            opportunity.name AS source_opportunity_name, journal.entry_number AS journal_entry_number, now()::date > invoice.due_date AS past_due
       FROM tenant.accounting_customer_invoices invoice
       JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = invoice.id
       JOIN tenant.sales_orders sales_order ON sales_order.id = sales_invoice.sales_order_id
       LEFT JOIN tenant.business_parties party ON party.id = invoice.party_id
       LEFT JOIN tenant.sales_quotations quotation ON quotation.id = sales_order.source_quotation_id
       LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.id = sales_order.source_opportunity_id
       LEFT JOIN tenant.accounting_journal_entries journal ON journal.id = invoice.journal_entry_id
       LEFT JOIN public.users creator ON creator.id = sales_invoice.created_by
       LEFT JOIN public.users poster ON poster.id = invoice.posted_by
       LEFT JOIN public.users reverser ON reverser.id = sales_invoice.reversed_by
       LEFT JOIN public.users sender ON sender.id = sales_invoice.sent_by
       LEFT JOIN public.users owner ON owner.id = sales_invoice.owner_user_id
      WHERE invoice.organization_id = $1 AND invoice.id = $2`, [context.organizationId, invoice.id])).rows[0];
  const lines = await invoiceLines(client, context.organizationId, invoice.id);
  const total = Number(invoice.grand_total);
  const money = await settlement(client, context.organizationId, invoice.id, total);
  const status = invoiceStatusOf(invoice.status);
  const paymentStatus = paymentStatusOf({ status: invoice.status, total, paid: money.paid + money.credits });
  const overdue = status === INVOICE_STATUS.posted && money.balance > 0.005 && Boolean(head.past_due);
  const canSeePayments = invoiceCan(context, INVOICE_PERMISSIONS.paymentsView);
  const [receipts, credits, creditNotes, deliveries, sends, events, financeEvents] = [
    canSeePayments ? (await client.query(
      `SELECT allocation.id, allocation.allocated_amount, allocation.allocated_at, receipt.receipt_number, receipt.receipt_date, receipt.payment_method
         FROM tenant.accounting_customer_receipt_allocations allocation JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id
        WHERE allocation.organization_id = $1 AND allocation.customer_invoice_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, invoice.id])).rows : [],
    canSeePayments ? (await client.query(
      `SELECT allocation.id, allocation.allocated_amount, allocation.allocated_at, credit.invoice_number AS credit_note_number
         FROM tenant.accounting_customer_credit_allocations allocation JOIN tenant.accounting_customer_invoices credit ON credit.id = allocation.credit_note_id
        WHERE allocation.organization_id = $1 AND allocation.customer_invoice_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, invoice.id])).rows : [],
    (await client.query(
      `SELECT credit.id, credit.invoice_number, credit.status, credit.invoice_date, credit.grand_total, credit.outstanding_amount, btrim(credit.currency_code) AS currency_code,
              note.reason_code, note.sales_return_id, COALESCE((SELECT sum(allocation.amount) FROM tenant.accounting_customer_refund_allocations allocation
              JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'posted' WHERE allocation.credit_note_id = credit.id), 0) AS refunded
         FROM tenant.accounting_customer_invoices credit LEFT JOIN tenant.sales_credit_notes note ON note.customer_invoice_id = credit.id
        WHERE credit.organization_id = $1 AND credit.source_invoice_id = $2 AND credit.invoice_type = 'credit_note' ORDER BY credit.created_at`, [context.organizationId, invoice.id])).rows,
    (await client.query(
      `SELECT DISTINCT delivery.id, delivery.request_number AS delivery_number, delivery.delivery_status, delivery.dispatch_date
         FROM tenant.accounting_customer_invoice_lines line
         JOIN tenant.sales_delivery_lines delivery_line ON delivery_line.id = line.source_sales_delivery_line_id
         JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivery_line.delivery_id
        WHERE line.organization_id = $1 AND line.customer_invoice_id = $2`, [context.organizationId, invoice.id])).rows,
    (await client.query(
      `SELECT send.id, send.channel, send.recipients, send.subject, send.note, send.sent_at, sender.full_name AS sent_by_name FROM tenant.sales_invoice_sends send
         LEFT JOIN public.users sender ON sender.id = send.sent_by WHERE send.organization_id = $1 AND send.customer_invoice_id = $2 ORDER BY send.sent_at DESC`,
      [context.organizationId, invoice.id])).rows,
    (await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.sales_document_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.entity_type = 'invoice_request' AND event.entity_id = $2`, [context.organizationId, invoice.id])).rows,
    // Receipts and credits are applied by Finance: their events are part of the invoice's history.
    (await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.entity_type = 'customer_invoice' AND event.entity_id = $2
          AND event.event_type NOT IN ('accounting.customer_invoice.created', 'accounting.customer_invoice.updated', 'accounting.customer_invoice.auto_approved')`,
      [context.organizationId, invoice.id])).rows,
  ];
  // Posted credit notes credit the invoice; its own total never changes.
  const creditedTotal = Math.round(creditNotes.filter((credit) => FINANCE_POSTED.includes(credit.status)).reduce((total, credit) => total + Number(credit.grand_total), 0) * 100) / 100;
  const creditStatus = creditStatusOf({ total, credited: creditedTotal });
  const taxSummary = new Map();
  for (const line of lines)
    for (const tax of line.taxes) {
      const keyOf = `${tax.tax_type}:${Number(tax.rate)}`;
      const group = taxSummary.get(keyOf) ?? { taxType: tax.tax_type, label: tax.label, rate: Number(tax.rate), taxableAmount: 0, taxAmount: 0 };
      group.taxableAmount = Math.round((group.taxableAmount + Number(tax.taxable_amount)) * 100) / 100;
      group.taxAmount = Math.round((group.taxAmount + Number(tax.tax_amount)) * 100) / 100;
      taxSummary.set(keyOf, group);
    }
  return {
    invoice: {
      ...invoice, ...head, status, financeStatus: invoice.status, statusLabel: invoiceStatusLabel(invoice.status), paymentStatus, paymentStatusLabel: PAYMENT_STATUS_LABELS[paymentStatus],
      overdue, amountPaid: canSeePayments ? money.paid : null, credited: canSeePayments ? money.credits : null, balanceDue: money.balance,
      creditedTotal, netAfterCredits: Math.round((total - creditedTotal) * 100) / 100, creditStatus, creditStatusLabel: CREDIT_STATUS_LABELS[creditStatus],
      sent: Boolean(invoice.sent_at), sentLabel: invoice.sent_at ? "Sent" : "Not sent",
      // The terms as agreed on this invoice (its snapshot) and the due date in force; whether a date was set by hand, and what the terms worked out.
      paymentTerm: readTermSnapshot(invoice.payment_term_snapshot),
      dueDateRequired: readTermSnapshot(invoice.payment_term_snapshot)?.calculationType === "custom" && !invoice.due_date_overridden,
      journal_entry_number: invoiceCan(context, INVOICE_PERMISSIONS.accountingView) ? head.journal_entry_number : null,
      journal_entry_id: invoiceCan(context, INVOICE_PERMISSIONS.accountingView) ? invoice.journal_entry_id : null,
    },
    lines,
    taxSummary: [...taxSummary.values()],
    receipts, credits, deliveries, sends,
    creditNotes: creditNotes.map((credit) => ({ ...credit, statusLabel: credit.status === "pending_approval" ? "Awaiting Finance approval" : invoiceStatusLabel(credit.status) })),
    returns: (await client.query(
      `SELECT DISTINCT sales_return.id, sales_return.return_number, sales_return.status, sales_return.return_date
         FROM tenant.sales_return_lines line JOIN tenant.sales_returns sales_return ON sales_return.id = line.sales_return_id AND sales_return.status <> 'cancelled'
        WHERE line.organization_id = $1 AND line.sales_order_line_id = ANY($2::uuid[])`, [context.organizationId, lines.map((line) => line.source_sales_order_line_id)])).rows,
    events: [...events, ...financeEvents].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
    sentChannels: SENT_CHANNELS,
    draftWarnings: invoice.status === "draft" ? await otherDrafts(client, context, invoice, lines) : [],
    actions: availableActions(context, invoice, money, creditedTotal),
  };
}

// Other drafts billing the same order lines as this draft, where together they bill more than is left.
async function otherDrafts(client, context, invoice, lines) {
  const order = (await client.query(`SELECT * FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, invoice.sales_order_id])).rows[0];
  const position = new Map((await invoiceableLines(client, context.organizationId, { ...order, current_version_id: invoice.sales_order_version_id ?? order.current_version_id },
    invoice.quantity_basis, { exceptInvoiceId: invoice.id })).map((line) => [line.lineId, line]));
  return lines.flatMap((line) => {
    const state = position.get(line.source_sales_order_line_id);
    if (!state || state.onDrafts <= EPSILON || Number(line.quantity) + state.onDrafts <= state.invoiceableNow + EPSILON) return [];
    return [{ item: line.item_name_snapshot, invoiceableNow: state.invoiceableNow, otherDrafts: state.draftInvoices,
      message: `${line.item_name_snapshot}: ${state.draftInvoices.map((draft) => `${draft.invoiceNumber} (${draft.quantity})`).join(", ")} also bill this line and only ${state.invoiceableNow} is left: whichever is posted first goes through.` }];
  });
}

const SORTS = Object.freeze({
  number: "invoice.invoice_number", date: "invoice.invoice_date", due: "invoice.due_date", customer: "customer_name", total: "invoice.grand_total", created: "invoice.created_at",
});
const POSTED_SQL = `invoice.status IN ('${FINANCE_POSTED.join("','")}')`;
const PAID_SQL = `(COALESCE((SELECT sum(allocated_amount) FROM tenant.accounting_customer_receipt_allocations WHERE customer_invoice_id = invoice.id), 0)
  + COALESCE((SELECT sum(allocated_amount) FROM tenant.accounting_customer_credit_allocations WHERE customer_invoice_id = invoice.id), 0))`;

// filters: view, search, status, paymentStatus, partyId, salesOrderId, ownerUserId, paymentTermId, currencyCode, dateFrom, dateTo, dueFrom, dueTo, overdue, sort, direction, limit, offset
export async function listSalesInvoices(client, context, filters = {}) {
  requireInvoiceAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = invoiceScopeSql(context, values, "sales_order");
  const overdueSql = `(${POSTED_SQL} AND invoice.due_date < current_date AND invoice.grand_total - ${PAID_SQL} > 0.005)`;
  const view = (key) => {
    switch (key) {
      case "draft": return ` AND invoice.status IN ('draft','pending_approval','approved')`;
      case "posted": return ` AND ${POSTED_SQL}`;
      case "unpaid": return ` AND ${POSTED_SQL} AND ${PAID_SQL} <= 0.005`;
      case "partially_paid": return ` AND ${POSTED_SQL} AND ${PAID_SQL} > 0.005 AND ${PAID_SQL} < invoice.grand_total - 0.005`;
      case "balance_due": return ` AND ${POSTED_SQL} AND invoice.grand_total - ${PAID_SQL} > 0.005`;
      case "paid": return ` AND ${POSTED_SQL} AND ${PAID_SQL} >= invoice.grand_total - 0.005`;
      case "overdue": return ` AND ${overdueSql}`;
      // Derived from each invoice's due date: still owing, and falling due today / within the next seven days.
      case "due_today": return ` AND ${POSTED_SQL} AND invoice.due_date = current_date AND invoice.grand_total - ${PAID_SQL} > 0.005`;
      case "due_this_week": return ` AND ${POSTED_SQL} AND invoice.due_date BETWEEN current_date AND current_date + 6 AND invoice.grand_total - ${PAID_SQL} > 0.005`;
      case "reversed": return ` AND invoice.status IN ('reversed','cancelled')`;
      case "mine": return ` AND (sales_invoice.owner_user_id = ${bind(context.userId ?? null)} OR sales_invoice.created_by = ${bind(context.userId ?? null)})`;
      default: return "";
    }
  };
  where += view(filters.view);
  if (["draft", "posted", "reversed"].includes(filters.status)) where += view(filters.status);
  if (["unpaid", "partially_paid", "paid"].includes(filters.paymentStatus)) where += view(filters.paymentStatus);
  if (filters.overdue === "true") where += ` AND ${overdueSql}`;
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (invoice.invoice_number ILIKE ${term} OR sales_order.sales_order_number ILIKE ${term} OR sales_invoice.customer_snapshot->>'displayName' ILIKE ${term}
      OR party.customer_number ILIKE ${term} OR sales_invoice.customer_po_number ILIKE ${term} OR sales_invoice.customer_snapshot->>'gstin' ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.accounting_customer_invoice_lines line LEFT JOIN tenant.sales_invoice_lines snapshot ON snapshot.customer_invoice_line_id = line.id
                  LEFT JOIN tenant.sales_delivery_lines delivery_line ON delivery_line.id = line.source_sales_delivery_line_id
                  LEFT JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivery_line.delivery_id
                  WHERE line.customer_invoice_id = invoice.id AND (snapshot.item_name_snapshot ILIKE ${term} OR snapshot.item_code_snapshot ILIKE ${term} OR delivery.request_number ILIKE ${term})))`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(requireUuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND invoice.party_id = ${p}`, "Customer");
  uuidFilter("salesOrderId", (p) => ` AND sales_invoice.sales_order_id = ${p}`, "Sales order");
  uuidFilter("ownerUserId", (p) => ` AND sales_invoice.owner_user_id = ${p}`, "Salesperson");
  uuidFilter("paymentTermId", (p) => ` AND invoice.payment_term_snapshot->>'id' = ${p}::text`, "Payment terms");
  if (text(filters.currencyCode, 3)) where += ` AND btrim(invoice.currency_code) = ${bind(text(filters.currencyCode, 3).toUpperCase())}`;
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dateFrom", (p) => ` AND invoice.invoice_date >= ${p}::date`, "Invoice date from");
  dateFilter("dateTo", (p) => ` AND invoice.invoice_date <= ${p}::date`, "Invoice date to");
  dateFilter("dueFrom", (p) => ` AND invoice.due_date >= ${p}::date`, "Due from");
  dateFilter("dueTo", (p) => ` AND invoice.due_date <= ${p}::date`, "Due to");
  const sort = SORTS[filters.sort] ?? SORTS.created;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_invoice.organization_id AND sales_order.id = sales_invoice.sales_order_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = invoice.organization_id AND party.id = invoice.party_id
       LEFT JOIN public.users owner ON owner.id = sales_invoice.owner_user_id
      WHERE sales_invoice.organization_id = $1`;
  const countValues = [...values];
  const rows = (await client.query(
    `SELECT invoice.id, invoice.invoice_number, invoice.status AS finance_status, invoice.invoice_date, invoice.due_date, invoice.grand_total, btrim(invoice.currency_code) AS currency_code,
            invoice.party_id, sales_invoice.customer_snapshot->>'displayName' AS customer_name, party.customer_number, sales_invoice.sales_order_id, sales_order.sales_order_number,
            owner.full_name AS owner_name, sales_invoice.sent_at, invoice.payment_term_snapshot->>'name' AS payment_term_name, ${PAID_SQL} AS paid, (invoice.due_date < current_date) AS past_due,
            (SELECT COALESCE(sum(credit.grand_total), 0) FROM tenant.accounting_customer_invoices credit
              WHERE credit.source_invoice_id = invoice.id AND credit.invoice_type = 'credit_note' AND credit.status IN ('${FINANCE_POSTED.join("','")}')) AS credited_total
       ${from}${where}
      ORDER BY ${sort} ${direction} NULLS LAST, invoice.invoice_number DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const count = (await client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues)).rows[0].total;
  return {
    rows: rows.map((row) => {
      const total = Number(row.grand_total);
      const paid = Number(row.paid);
      const status = invoiceStatusOf(row.finance_status);
      const paymentStatus = paymentStatusOf({ status: row.finance_status, total, paid });
      const balance = status === INVOICE_STATUS.posted ? Math.max(0, Math.round((total - paid) * 100) / 100) : 0;
      return {
        ...row, status, statusLabel: invoiceStatusLabel(row.finance_status), paymentStatus, paymentStatusLabel: PAYMENT_STATUS_LABELS[paymentStatus], balance_due: balance,
        overdue: status === INVOICE_STATUS.posted && balance > 0.005 && Boolean(row.past_due), paid: undefined, past_due: undefined,
        credited_total: Number(row.credited_total), creditStatus: creditStatusOf({ total, credited: Number(row.credited_total) }),
        creditStatusLabel: CREDIT_STATUS_LABELS[creditStatusOf({ total, credited: Number(row.credited_total) })],
      };
    }),
    total: count, limit, offset, views: INVOICE_VIEWS,
    capabilities: Object.fromEntries(Object.entries(INVOICE_PERMISSIONS).map(([name, permission]) => [name, invoiceCan(context, permission)])),
  };
}

// Corrects the due date of a posted invoice that still owes something: by permission, with a reason, kept in its history.
// Nothing else on the invoice changes; overdue and ageing follow the new date. input: { dueDate, reason }
export async function changePostedInvoiceDueDate(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.changePostedDueDate, "You do not have permission to change a posted invoice's due date.");
  const reason = text(input.reason, 500);
  if (!reason) throw new InvoiceError(400, "Give the reason for changing the due date.", "SALES_INVOICE_DUE_DATE_REASON_REQUIRED", { field: "reason" });
  const dueDate = readDate(input.dueDate, "Due date");
  if (!dueDate) throw new InvoiceError(400, "Enter the new due date.", "SALES_INVOICE_DUE_DATE_INVALID", { field: "dueDate" });
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (!FINANCE_POSTED.includes(invoice.status))
    throw new InvoiceError(409, invoice.status === "draft" ? "Edit the draft to change its due date." : `A ${invoice.status} invoice has no due date to change.`, "SALES_INVOICE_NOT_POSTED");
  if (dueDate < dayOf(invoice.invoice_date)) throw new InvoiceError(400, "The due date cannot be before the invoice date.", "SALES_INVOICE_DUE_DATE_INVALID", { field: "dueDate" });
  const before = dayOf(invoice.due_date);
  if (dueDate === before) return { invoiceId: invoice.id, dueDate, changed: false };
  try {
    await changeCustomerInvoiceDueDate(client, financeContext(context), invoice.id, { dueDate, reason }, { internal: true });
  } catch (error) {
    throw financeError(error, "The due date could not be changed");
  }
  const calculated = calculateDueDate(dayOf(invoice.invoice_date), invoice.payment_term_snapshot);
  await client.query(
    `UPDATE tenant.sales_invoices SET due_date_overridden = $3, due_date_override_reason = $4, calculated_due_date = COALESCE(calculated_due_date, $5::date), updated_at = now()
      WHERE organization_id = $1 AND customer_invoice_id = $2`, [context.organizationId, invoice.id, dueDate !== calculated, dueDate !== calculated ? reason : null, calculated]);
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.due_date_changed", INVOICE_STATUS.posted, INVOICE_STATUS.posted, { from: before, to: dueDate, reason });
  return { invoiceId: invoice.id, dueDate, changed: true };
}

// What customers still owe on the posted invoices the caller can see, in the
// base currency: the figure the Sales home links to the Unpaid view with.
export async function salesInvoiceBalance(client, context) {
  requireInvoiceAccess(context);
  const values = [context.organizationId];
  const scope = invoiceScopeSql(context, values, "sales_order");
  const row = (await client.query(
    `SELECT count(*) FILTER (WHERE due.balance > 0.005)::int AS invoices,
            COALESCE(sum(due.balance * invoice.exchange_rate) FILTER (WHERE due.balance > 0.005), 0) AS outstanding,
            COALESCE(sum(due.balance * invoice.exchange_rate) FILTER (WHERE due.balance > 0.005 AND invoice.due_date < current_date), 0) AS overdue
       FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_invoice.organization_id AND sales_order.id = sales_invoice.sales_order_id
       CROSS JOIN LATERAL (SELECT invoice.grand_total - ${PAID_SQL} AS balance) due
      WHERE sales_invoice.organization_id = $1 AND ${POSTED_SQL}${scope}`, values)).rows[0];
  return { invoices: row.invoices, outstanding: Number(row.outstanding), overdue: Number(row.overdue) };
}

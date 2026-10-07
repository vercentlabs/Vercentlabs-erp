// What happens after the goods left: the supplier's acknowledgement, the financial correction (a vendor credit for what was billed — never
// twice — or a refund Finance received) and the replacement (an explicit replacement purchase order, received on its own goods receipt).
// A promise is not a resolution: each is recorded when it actually happened, and the statuses are derived from what is recorded.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { loadPurchaseOrder } from "../purchase-orders/access.js";
import { databaseToday, resolveOrderDocument } from "../purchase-orders/document.js";
import { insertOrder, recordPoEvent } from "../purchase-orders/persist.js";
import { PurchaseReturnError, RESOLUTION_TYPES, RETURN_PERMISSIONS, fail, optionalUuid, readDate, requireUuid, text } from "./constants.js";
import { loadReturn, orderReader, recordReturnEvent, requirePermission } from "./returns.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;
const POSTED_NOTE = "note.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')";

async function postedReturn(client, context, returnId, { lock = true } = {}) {
  const row = await loadReturn(client, context, returnId, { lock });
  if (row.document_status !== "posted") throw new PurchaseReturnError(409, "This is recorded on a posted return (the goods have left).", "PURCHASE_RETURN_NOT_POSTED");
  return row;
}
const readAmount = (value, label, field) => {
  const raw = String(value ?? "").trim();
  if (!QTY.test(raw) || decimal(raw) <= 0n) fail(`${label} must be more than zero.`, field);
  return decimal(raw);
};

// ---------------------------------------------------------------- statuses

// getPurchaseReturnFinancialStatus and the supplier resolution and replacement statuses — each its own dimension, derived from what is recorded.
export async function returnStatuses(client, context, row) {
  const organizationId = context.organizationId;
  const totals = (await client.query(
    `SELECT (SELECT COALESCE(sum(quantity), 0) FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2) AS returned,
            (SELECT COALESCE(sum(expected_credit_amount), 0) FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2) AS expected_credit,
            (SELECT COALESCE(sum(allocated_quantity), 0) FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND purchase_return_id = $2 AND allocation_type = 'billed') AS billed_quantity,
            (SELECT COALESCE(sum(allocated_value), 0) FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND purchase_return_id = $2 AND allocation_type = 'billed') AS billed_value,
            (SELECT COALESCE(sum(allocated_quantity), 0) FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND purchase_return_id = $2 AND allocation_type = 'unbilled') AS unbilled_quantity,
            (SELECT COALESCE(sum(allocation.allocated_quantity), 0) FROM tenant.purchase_return_financial_allocations allocation
               JOIN tenant.accounting_vendor_bills note ON note.organization_id = allocation.organization_id AND note.id = allocation.debit_note_id
              WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 AND allocation.allocation_type = 'debit_note' AND ${POSTED_NOTE}) AS credited_quantity,
            (SELECT COALESCE(sum(allocation.allocated_value), 0) FROM tenant.purchase_return_financial_allocations allocation
               JOIN tenant.accounting_vendor_bills note ON note.organization_id = allocation.organization_id AND note.id = allocation.debit_note_id
              WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 AND allocation.allocation_type = 'debit_note' AND ${POSTED_NOTE}) AS credited_value,
            (SELECT COALESCE(sum(amount), 0) FROM tenant.purchase_return_resolutions WHERE organization_id = $1 AND purchase_return_id = $2 AND resolution_type = 'supplier_refund') AS refunded,
            (SELECT COALESCE(sum(resolved_quantity), 0) FROM tenant.purchase_return_resolutions WHERE organization_id = $1 AND purchase_return_id = $2
                AND resolution_type IN ('supplier_refund', 'other_authorized_resolution', 'replacement_received')) AS resolved_quantity`,
    [organizationId, row.id])).rows[0];
  const returned = decimal(totals.returned);
  let replacement = null;
  if (row.replacement_purchase_order_id) {
    const progress = (await client.query(`SELECT COALESCE(sum(ordered_quantity - cancelled_quantity), 0) AS ordered, COALESCE(sum(received_quantity), 0) AS received
       FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, row.replacement_purchase_order_id])).rows[0];
    const order = (await client.query(`SELECT purchase_order_number, status FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [organizationId, row.replacement_purchase_order_id])).rows[0];
    replacement = { purchaseOrderId: row.replacement_purchase_order_id, purchaseOrderNumber: order?.purchase_order_number, orderStatus: order?.status, ordered: decimal(progress.ordered),
      received: decimal(progress.received) };
  }
  const posted = row.document_status === "posted";
  const replacementReceived = replacement ? (replacement.received < returned ? replacement.received : returned) : 0n;
  const resolvedQuantity = add(add(decimal(totals.resolved_quantity), decimal(totals.credited_quantity)), replacementReceived);
  const billedValue = decimal(totals.billed_value);
  const settledValue = add(decimal(totals.credited_value), decimal(totals.refunded));
  const financial = !posted ? "not_applicable" : billedValue <= 0n && decimal(totals.refunded) <= 0n ? "not_required"
    : settledValue <= 0n ? "pending" : settledValue >= billedValue ? "reconciled" : "partially_reconciled";
  const resolution = !posted ? "not_applicable" : row.expected_resolution === "no_resolution" ? "resolved"
    : resolvedQuantity >= returned ? "resolved" : resolvedQuantity > 0n ? "partially_resolved" : "pending";
  const replacementStatus = !replacement ? (row.expected_resolution === "replacement" && posted ? "awaiting" : "not_required")
    : replacement.received <= 0n ? "awaiting" : replacement.received < replacement.ordered ? "partially_received" : "completed";
  return {
    financial, resolution, replacement: replacementStatus,
    figures: {
      returned: dec(returned), expectedCredit: dec(totals.expected_credit), billedQuantity: dec(totals.billed_quantity), billedValue: dec(billedValue),
      unbilledQuantity: dec(totals.unbilled_quantity), creditedQuantity: dec(totals.credited_quantity), creditedValue: dec(totals.credited_value), refunded: dec(totals.refunded),
      uncreditedQuantity: dec(sub(totals.billed_quantity, totals.credited_quantity) > 0n ? sub(totals.billed_quantity, totals.credited_quantity) : 0n),
      outstandingValue: dec(sub(billedValue, settledValue) > 0n ? sub(billedValue, settledValue) : 0n), resolvedQuantity: dec(resolvedQuantity),
    },
    replacementOrder: replacement && { ...replacement, ordered: dec(replacement.ordered), received: dec(replacement.received) },
  };
}
export const getPurchaseReturnFinancialStatus = async (client, context, returnId) => {
  const row = await loadReturn(client, context, returnId);
  const statuses = await returnStatuses(client, context, row);
  return { status: statuses.financial, ...statuses.figures };
};

// getReturnBillingAllocations: each returned quantity against what was billed or not, and the vendor credits that corrected it.
export async function getReturnBillingAllocations(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  const { rows } = await client.query(
    `SELECT allocation.*, return_line.line_number, bill.bill_number, note.bill_number AS note_number, note.status AS note_status
       FROM tenant.purchase_return_financial_allocations allocation
       JOIN tenant.purchase_return_lines return_line ON return_line.organization_id = allocation.organization_id AND return_line.id = allocation.purchase_return_line_id
       LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.supplier_bill_id
       LEFT JOIN tenant.accounting_vendor_bills note ON note.organization_id = allocation.organization_id AND note.id = allocation.debit_note_id
      WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 ORDER BY return_line.line_number, allocation.created_at`, [context.organizationId, row.id]);
  return rows.map((entry) => ({ id: entry.id, lineNumber: entry.line_number, type: entry.allocation_type, quantity: dec(entry.allocated_quantity), value: dec(entry.allocated_value),
    billId: entry.supplier_bill_id, billNumber: entry.bill_number, billLineId: entry.supplier_bill_line_id, creditId: entry.debit_note_id, creditNumber: entry.note_number,
    creditStatus: entry.note_status, createdAt: entry.created_at }));
}

// ---------------------------------------------------------------- acknowledgement and resolutions

// recordSupplierAcknowledgment: the supplier confirmed the return (their RMA, a reference, the date). It says nothing about whether the goods
// left — only posting does. input: { reference?, rmaReference?, acknowledgedAt?, notes? }
export async function recordSupplierAcknowledgment(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.resolve, "You do not have permission to record supplier acknowledgements.");
  const row = await loadReturn(client, context, returnId, { lock: true });
  if (["cancelled", "reversed"].includes(row.document_status)) throw new PurchaseReturnError(409, `The return is ${row.document_status}.`, "PURCHASE_RETURN_LOCKED");
  const at = readDate(input.acknowledgedAt, "Acknowledged on") ?? await databaseToday(client);
  const reference = text(input.reference, 200);
  await client.query(`UPDATE tenant.purchase_returns SET supplier_acknowledged_at = $3::date, supplier_acknowledgement_reference = $4, supplier_acknowledged_by = $5,
       supplier_rma_reference = COALESCE($6, supplier_rma_reference), updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, at, reference, context.userId ?? null, text(input.rmaReference, 200)]);
  await recordReturnEvent(client, context, row.id, "purchase_return.acknowledged", `Supplier acknowledged${reference ? ` (${reference})` : ""}${input.notes ? `: ${text(input.notes, 500)}` : ""}`);
  return { id: row.id, acknowledgedAt: at };
}

async function unresolvedQuantity(client, context, row) {
  const { figures } = await returnStatuses(client, context, row);
  return sub(figures.returned, figures.resolvedQuantity);
}

// recordPurchaseReturnResolution: what the supplier did (other than a vendor credit or refund, which have their own operations) — a replacement
// received outside a replacement order, another authorised resolution. Never more than the return still owes. input: { type, quantity, lineId?, reference?, notes }
export async function recordPurchaseReturnResolution(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.resolve, "You do not have permission to record purchase return resolutions.");
  const row = await postedReturn(client, context, returnId);
  const type = String(input.type ?? "");
  if (!["replacement_received", "other_authorized_resolution"].includes(type)) fail("Record a replacement received or another authorised resolution here; credits are vendor credits and refunds have their own step.", "type");
  const quantity = readAmount(input.quantity, "Quantity", "quantity");
  const open = await unresolvedQuantity(client, context, row);
  if (quantity > open) throw new PurchaseReturnError(409, `Only ${dec(open > 0n ? open : 0n)} of the return is still unresolved.`, "PURCHASE_RETURN_OVER_RESOLVED");
  const notes = text(input.notes, 1000);
  if (!notes) fail("Describe the resolution.", "notes");
  const id = (await client.query(
    `INSERT INTO tenant.purchase_return_resolutions (organization_id, purchase_return_id, purchase_return_line_id, resolution_type, resolved_quantity, reference, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [context.organizationId, row.id, optionalUuid(input.lineId, "Return line"), type, dec(quantity), text(input.reference, 200), notes, context.userId ?? null])).rows[0].id;
  await recordReturnEvent(client, context, row.id, "purchase_return.resolution", `${RESOLUTION_TYPES[type]}: ${dec(quantity)} — ${notes}`);
  return { id, type, quantity: dec(quantity) };
}

// linkSupplierRefund: money the supplier paid back, as Finance received it (its receipt reference). Never more than the return's credit value
// less what vendor credits and earlier refunds already settled. input: { amount, reference, receivedOn?, quantity?, notes? }
export async function linkSupplierRefund(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.resolve, "You do not have permission to record supplier refunds.");
  const row = await postedReturn(client, context, returnId);
  const amount = readAmount(input.amount, "Refund amount", "amount");
  const reference = text(input.reference, 200);
  if (!reference) fail("Enter Finance's receipt reference for the refund.", "reference");
  const statuses = await returnStatuses(client, context, row);
  const ceiling = sub(decimal(statuses.figures.expectedCredit), add(decimal(statuses.figures.creditedValue), decimal(statuses.figures.refunded)));
  if (amount > ceiling) throw new PurchaseReturnError(409, `Only ${dec(ceiling > 0n ? ceiling : 0n)} of the return's value is still unsettled.`, "PURCHASE_RETURN_OVER_RESOLVED");
  const quantity = input.quantity ? readAmount(input.quantity, "Quantity", "quantity") : null;
  const id = (await client.query(
    `INSERT INTO tenant.purchase_return_resolutions (organization_id, purchase_return_id, resolution_type, resolved_quantity, amount, reference, notes, related_document_type, recorded_by, recorded_at)
     VALUES ($1, $2, 'supplier_refund', $3, $4, $5, $6, 'finance_receipt', $7, COALESCE($8::date::timestamptz, now())) RETURNING id`,
    [context.organizationId, row.id, dec(quantity), dec(amount), reference, text(input.notes, 1000), context.userId ?? null, readDate(input.receivedOn, "Received on")])).rows[0].id;
  await recordReturnEvent(client, context, row.id, "purchase_return.refund", `Supplier refund ${dec(amount)} (${reference})`);
  return { id, amount: dec(amount) };
}

// ---------------------------------------------------------------- vendor credits

// A vendor credit's quantity lines, matched to the return's billed allocations they correct (never more than each allocation left). They count
// for the return once the credit is posted.
async function linkNoteLines(client, context, row, noteId, allocations) {
  const noteLines = (await client.query(`SELECT id, source_bill_line_id, quantity, net_amount FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2
     AND adjustment_kind = 'quantity'`, [context.organizationId, noteId])).rows;
  let total = 0n;
  for (const line of noteLines) {
    const allocation = allocations.find((entry) => entry.supplier_bill_line_id === line.source_bill_line_id);
    if (!allocation) continue;
    const quantity = decimal(line.quantity) < decimal(allocation.open) ? decimal(line.quantity) : decimal(allocation.open);
    if (quantity <= 0n) continue;
    await client.query(
      `INSERT INTO tenant.purchase_return_financial_allocations (organization_id, purchase_return_id, purchase_return_line_id, allocation_type, supplier_bill_id, supplier_bill_line_id,
         debit_note_id, debit_note_line_id, allocated_quantity, allocated_value, created_by) VALUES ($1, $2, $3, 'debit_note', $4, $5, $6, $7, $8, $9, $10)`,
      [context.organizationId, row.id, allocation.purchase_return_line_id, allocation.supplier_bill_id, line.source_bill_line_id, noteId, line.id, dec(quantity), dec(line.net_amount),
        context.userId ?? null]);
    total = add(total, quantity);
  }
  return total;
}

// linkSupplierCreditToPurchaseReturn: a vendor credit raised on the bill (not from the return) linked to the return's billed goods.
// input: { creditId }
export async function linkSupplierCreditToPurchaseReturn(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.resolve, "You do not have permission to link supplier credits.");
  const row = await postedReturn(client, context, returnId);
  const note = (await client.query(`SELECT id, bill_number, bill_type, party_id, status, source_purchase_order_id, source_purchase_return_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(input.creditId, "Vendor credit")])).rows[0];
  if (!note || note.bill_type !== "credit_note") throw new PurchaseReturnError(404, "Vendor credit not found.", "PURCHASE_RETURN_NOTE_INVALID");
  if (note.source_purchase_order_id !== row.purchase_order_id || (note.source_purchase_return_id && note.source_purchase_return_id !== row.id))
    throw new PurchaseReturnError(409, "The vendor credit does not correct this return's order.", "PURCHASE_RETURN_NOTE_INVALID");
  if (["cancelled", "reversed"].includes(note.status)) throw new PurchaseReturnError(409, `${note.bill_number} is ${note.status}.`, "PURCHASE_RETURN_NOTE_INVALID");
  if ((await client.query(`SELECT 1 FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND debit_note_id = $2 LIMIT 1`, [context.organizationId, note.id])).rows[0])
    throw new PurchaseReturnError(409, `${note.bill_number} is already linked to a return.`, "PURCHASE_RETURN_NOTE_LINKED");
  const open = (await client.query(
    `SELECT allocation.supplier_bill_id, allocation.supplier_bill_line_id, allocation.purchase_return_line_id,
            allocation.allocated_quantity - COALESCE((SELECT sum(credited.allocated_quantity) FROM tenant.purchase_return_financial_allocations credited
               JOIN tenant.accounting_vendor_bills note ON note.organization_id = credited.organization_id AND note.id = credited.debit_note_id
              WHERE credited.organization_id = allocation.organization_id AND credited.purchase_return_id = allocation.purchase_return_id AND credited.allocation_type = 'debit_note'
                AND credited.supplier_bill_line_id = allocation.supplier_bill_line_id AND note.status NOT IN ('cancelled', 'reversed')), 0) AS open
       FROM tenant.purchase_return_financial_allocations allocation WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 AND allocation.allocation_type = 'billed'`,
    [context.organizationId, row.id])).rows;
  const linked = await linkNoteLines(client, context, row, note.id, open);
  if (linked <= 0n) throw new PurchaseReturnError(409, `${note.bill_number} does not correct any billed goods of this return still uncorrected.`, "PURCHASE_RETURN_NOTE_INVALID");
  await recordReturnEvent(client, context, row.id, "purchase_return.credit_linked", `Vendor credit ${note.bill_number} linked (${dec(linked)})`);
  return { id: row.id, creditId: note.id, quantity: dec(linked) };
}

// ---------------------------------------------------------------- replacement

// A draft purchase order for what was returned — the explicit commitment a replacement is received against — at the original prices, or at no
// charge when the supplier replaces free (so no second payable arises).
async function draftReplacementOrder(client, context, order, row, noCharge) {
  requirePermission(context, RETURN_PERMISSIONS.poCreate, "You do not have permission to create the replacement purchase order.");
  const quantities = (await client.query(`SELECT purchase_order_line_id, sum(quantity) AS quantity FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2
     GROUP BY purchase_order_line_id`, [context.organizationId, row.id])).rows;
  const byLine = new Map(quantities.map((entry) => [entry.purchase_order_line_id, decimal(entry.quantity)]));
  const orderLines = (await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY line_number`,
    [context.organizationId, [...byLine.keys()]])).rows;
  const { header, priced } = await resolveOrderDocument(client, context, {
    supplierId: order.supplier_id, currencyCode: order.currency_code.trim(), paymentTermId: order.payment_term_id, defaultWarehouseId: order.default_warehouse_id,
    priceMode: order.price_mode, supplierReference: `Replacement for ${row.return_number}`,
    internalNotes: `Replacement for goods returned on ${row.return_number} (order ${order.purchase_order_number})${noCharge ? " — no charge" : ""}.`,
    lines: orderLines.map((line) => ({
      productId: line.product_id ?? undefined, description: line.product_id ? undefined : line.description, productType: line.product_type, uomId: line.purchase_uom_id,
      quantity: formatDecimal(byLine.get(line.id)), unitPrice: noCharge ? "0" : formatDecimal(line.unit_price),
      zeroPriceReason: noCharge ? `No-charge replacement for ${row.return_number}` : line.zero_price_reason ?? (decimal(line.unit_price) === 0n ? "Replacement" : undefined),
      discountType: !noCharge && line.discount_type === "percent" ? "percent" : null, discountValue: !noCharge && line.discount_type === "percent" ? formatDecimal(line.discount_value) : "0",
      warehouseId: line.receiving_warehouse_id, taxCategoryId: line.product_id ? undefined : line.tax_category_id, noTax: !line.product_id && !line.tax_category_id,
      expenseAccountId: line.expense_account_id, carried: true,
    })),
  }, { today: await databaseToday(client) });
  const replacement = await insertOrder(client, context, header, priced);
  await recordPoEvent(client, context, replacement.id, "purchase_order.created", `Drafted as the replacement for return ${row.return_number} (order ${order.purchase_order_number})${noCharge ? " at no charge" : ""}`,
    { to: "draft", details: { source: "purchase_return", returnId: row.id, originalOrderId: order.id, noCharge } });
  return replacement;
}

// linkReplacementPurchaseOrder: the replacement commitment — a new draft order for the returned goods (create, noCharge?) or an existing order
// of the same supplier (purchaseOrderId). Returning goods never reopens the original order; the replacement is received on its own receipt.
export async function linkReplacementPurchaseOrder(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.resolve, "You do not have permission to arrange replacements.");
  const row = await postedReturn(client, context, returnId);
  if (row.replacement_purchase_order_id) throw new PurchaseReturnError(409, "A replacement order is already linked to this return.", "PURCHASE_RETURN_REPLACEMENT_LINKED");
  const order = await loadPurchaseOrder(client, orderReader(context), row.purchase_order_id);
  let replacement;
  if (input.create) replacement = await draftReplacementOrder(client, context, order, row, Boolean(input.noCharge));
  else {
    const id = requireUuid(input.purchaseOrderId, "Replacement purchase order");
    replacement = await loadPurchaseOrder(client, orderReader(context), id);
    if (replacement.id === order.id) fail("The replacement is a different order from the original.", "purchaseOrderId", "PURCHASE_RETURN_REPLACEMENT_INVALID", 409);
    if (replacement.supplier_id !== order.supplier_id) fail("The replacement order must be with the same supplier.", "purchaseOrderId", "PURCHASE_RETURN_REPLACEMENT_INVALID", 409);
    if (["cancelled"].includes(replacement.status)) fail("The replacement order is cancelled.", "purchaseOrderId", "PURCHASE_RETURN_REPLACEMENT_INVALID", 409);
  }
  await client.query(`UPDATE tenant.purchase_returns SET replacement_purchase_order_id = $3, replacement_expected = true, replacement_no_charge = $4, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, replacement.id, Boolean(input.noCharge)]);
  await recordReturnEvent(client, context, row.id, "purchase_return.replacement", `Replacement order ${replacement.purchase_order_number} ${input.create ? "drafted" : "linked"}${input.noCharge ? " (no charge)" : ""}`);
  await recordPoEvent(client, context, order.id, "purchase_order.replacement_linked", `Replacement order ${replacement.purchase_order_number} for return ${row.return_number}`,
    { details: { returnId: row.id, replacementPurchaseOrderId: replacement.id } });
  return { id: row.id, replacementPurchaseOrderId: replacement.id, replacementNumber: replacement.purchase_order_number };
}

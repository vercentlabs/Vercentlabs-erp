// Sales returns: what a delivery can take back, a new draft, changing a
// draft, reading one and listing them.
//
// Quantities are worked out from received returns, never typed:
//   returnable = delivered on the delivery line − received returns of it
// A draft returns nothing yet: several drafts may name the same units for a
// while (each is warned of the others) and Receive checks again, under the
// order's lock, so the goods received back never exceed what was delivered.
// Only goods are returned (a delivery never carries services).
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { loadDelivery } from "../deliveries/access.js";
import { dayOf, requireUuid, text } from "../orders/constants.js";
import { lockOrder, readDate } from "../orders/versions.js";
import { loadReturn, recordReturnEvent, requireReturnAccess, requireReturnPermission, returnCan, returnScopeSql } from "./access.js";
import { creditPosition } from "./credit.js";
import {
  DISPOSITIONS, RETURN_PERMISSIONS, RETURN_REASONS, RETURN_STATUS, RETURN_STATUS_LABELS, RETURN_VIEWS, ReturnError, dispositionOf, reasonLabel,
} from "./constants.js";

const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
const today = () => new Date().toISOString().slice(0, 10);

// Each line of a delivery with what can still come back: delivered less received returns, and what drafts name.
export async function returnableLines(client, organizationId, deliveryId, exceptReturnId = null) {
  const { rows } = await client.query(
    `SELECT line.id, line.sales_order_line_id, line.item_id, line.item_code_snapshot, line.item_name_snapshot, line.description_snapshot, line.uom_id, line.uom_snapshot,
            line.quantity, line.base_quantity, COALESCE(item.track_inventory, false) AS stock_tracked,
            COALESCE((SELECT sum(returned.quantity) FROM tenant.sales_return_lines returned JOIN tenant.sales_returns sales_return ON sales_return.id = returned.sales_return_id
                       WHERE returned.organization_id = line.organization_id AND returned.delivery_line_id = line.id AND sales_return.status = 'received'), 0) AS returned,
            COALESCE((SELECT json_agg(json_build_object('returnNumber', sales_return.return_number, 'quantity', returned.quantity))
                        FROM tenant.sales_return_lines returned JOIN tenant.sales_returns sales_return ON sales_return.id = returned.sales_return_id
                       WHERE returned.organization_id = line.organization_id AND returned.delivery_line_id = line.id AND sales_return.status = 'draft'
                         AND ($3::uuid IS NULL OR sales_return.id <> $3)), '[]'::json) AS drafts
       FROM tenant.sales_delivery_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.delivery_id = $2 ORDER BY line.sequence NULLS LAST, line.created_at`, [organizationId, deliveryId, exceptReturnId]);
  return rows.map((row) => {
    const delivered = Number(row.quantity);
    const returned = Number(row.returned);
    const onDrafts = row.drafts.reduce((total, draft) => total + Number(draft.quantity), 0);
    return {
      ...row, delivered, returned, onDrafts: round(onDrafts), drafts: row.drafts, returnable: round(Math.max(0, delivered - returned)),
      // Base units per delivered unit: a return is received in the delivery's own conversion.
      factor: delivered ? Number(row.base_quantity) / delivered : 1,
    };
  });
}

// What a new return of the delivery would carry, and the choices for it.
export async function getReturnProposal(client, context, deliveryId) {
  requireReturnAccess(context);
  const delivery = await loadDelivery(client, context, deliveryId);
  const lines = await returnableLines(client, context.organizationId, delivery.id);
  return {
    deliveryId: delivery.id, deliveryNumber: delivery.request_number, canReturn: ["dispatched", "delivered"].includes(delivery.delivery_status),
    warehouseId: delivery.warehouse_id,
    lines: lines.map((line) => ({
      deliveryLineId: line.id, itemName: line.item_name_snapshot, itemCode: line.item_code_snapshot, unit: line.uom_snapshot, delivered: line.delivered, returned: line.returned,
      returnable: line.returnable, onDrafts: line.onDrafts, drafts: line.drafts, stockTracked: line.stock_tracked,
    })),
    reasons: RETURN_REASONS, dispositions: DISPOSITIONS.map(({ code, label, sellable }) => ({ code, label, sellable })),
  };
}

function readReason(input, required) {
  const code = text(input.reasonCode, 40);
  const note = text(input.reasonNote, 1000);
  if (!code) {
    if (required) throw new ReturnError(400, "Choose the return reason.", "SALES_RETURN_REASON_REQUIRED", { field: "reasonCode" });
    return null;
  }
  if (!RETURN_REASONS.some((entry) => entry.code === code)) throw new ReturnError(400, "Choose a return reason from the list.", "SALES_RETURN_REASON_INVALID", { field: "reasonCode" });
  if (code === "other" && !note) throw new ReturnError(400, "Describe the reason for the return.", "SALES_RETURN_REASON_REQUIRED", { field: "reasonNote" });
  return { code, note };
}

async function readWarehouse(client, context, value, defaultId) {
  const id = value ? requireUuid(value, "Return warehouse") : defaultId;
  if (!id) throw new ReturnError(400, "Choose the warehouse the goods come back to.", "SALES_RETURN_WAREHOUSE_REQUIRED", { field: "warehouseId" });
  if (id !== defaultId) requireReturnPermission(context, RETURN_PERMISSIONS.selectWarehouse, "You do not have permission to receive returns into another warehouse.");
  const warehouse = (await client.query(`SELECT id, name, status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, id])).rows[0];
  if (!warehouse) throw new ReturnError(404, "Warehouse not found.", "SALES_WAREHOUSE_NOT_FOUND");
  if (warehouse.status !== "active") throw new ReturnError(409, `${warehouse.name} is inactive.`, "SALES_WAREHOUSE_NOT_ELIGIBLE");
  return warehouse;
}

// The lines asked for, checked against what each delivery line can take back now.
function settle(lines, requested, defaultDisposition) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const chosen = (Array.isArray(requested) ? requested : [])
    .map((entry) => ({ line: byId.get(requireUuid(entry.deliveryLineId, "Delivery line")), quantity: Number(entry.quantity), disposition: text(entry.disposition, 20) ?? defaultDisposition,
      reasonCode: text(entry.reasonCode, 40) }))
    .filter((entry) => entry.quantity !== 0);
  if (!chosen.length) throw new ReturnError(400, "Enter what comes back.", "SALES_RETURN_EMPTY");
  const seen = new Set();
  for (const entry of chosen) {
    const { line, quantity, disposition } = entry;
    if (!line) throw new ReturnError(404, "That line is not on this delivery.", "SALES_DELIVERY_LINE_NOT_FOUND");
    if (seen.has(line.id)) throw new ReturnError(400, `${line.item_name_snapshot} is on the return twice.`, "SALES_RETURN_VALIDATION");
    seen.add(line.id);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ReturnError(400, `${line.item_name_snapshot}: enter the quantity that comes back.`, "SALES_RETURN_VALIDATION");
    if (quantity > line.returnable + EPSILON)
      throw new ReturnError(409, `${line.item_name_snapshot}: only ${line.returnable} ${line.uom_snapshot ?? ""} can come back (delivered ${line.delivered}, already returned ${line.returned}).`.replace("  ", " "),
        "SALES_RETURN_EXCEEDS_DELIVERED");
    if (!dispositionOf(disposition)) throw new ReturnError(400, `${line.item_name_snapshot}: choose the condition of the goods.`, "SALES_RETURN_DISPOSITION_INVALID");
    if (entry.reasonCode && !RETURN_REASONS.some((reason) => reason.code === entry.reasonCode))
      throw new ReturnError(400, "Choose a return reason from the list.", "SALES_RETURN_REASON_INVALID");
  }
  return chosen;
}

async function insertLines(client, context, returnId, chosen) {
  let sequence = 0;
  for (const { line, quantity, disposition, reasonCode } of chosen) {
    sequence += 1;
    await client.query(
      `INSERT INTO tenant.sales_return_lines (organization_id, sales_return_id, sequence, delivery_line_id, sales_order_line_id, item_id, item_code_snapshot, item_name_snapshot,
          description_snapshot, uom_id, uom_snapshot, quantity, base_quantity, disposition, reason_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [context.organizationId, returnId, sequence, line.id, line.sales_order_line_id, line.item_id, line.item_code_snapshot, line.item_name_snapshot, line.description_snapshot,
        line.uom_id, line.uom_snapshot, quantity, round(quantity * line.factor), disposition, reasonCode ?? null]);
  }
}

// Other drafts naming the same delivery lines, where together they name more than can come back.
function draftWarnings(chosen) {
  return chosen.filter(({ line, quantity }) => line.onDrafts > EPSILON && quantity + line.onDrafts > line.returnable + EPSILON).map(({ line }) => ({
    item: line.item_name_snapshot,
    message: `${line.item_name_snapshot}: ${line.drafts.map((draft) => `${draft.returnNumber} (${Number(draft.quantity)})`).join(", ")} also return this line and only ${line.returnable} can come back: whichever is received first goes through.`,
  }));
}

// A new Draft return of a dispatched delivery; no stock moves until it is received.
// input: { idempotencyKey, lines: [{ deliveryLineId, quantity, disposition?, reasonCode? }], reasonCode, reasonNote?, disposition (default for the lines),
//          warehouseId? (default: the delivery's), returnDate?, customerNotes?, internalNotes? }
export async function createReturnFromDelivery(client, context, deliveryId, input = {}) {
  requireReturnPermission(context, RETURN_PERMISSIONS.create, "You do not have permission to create sales returns.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new ReturnError(400, "A request key is required to create a return.", "SALES_RETURN_VALIDATION");
  const seen = await loadDelivery(client, context, deliveryId);
  const order = await lockOrder(client, context, seen.sales_order_id);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  const existing = (await client.query(`SELECT id, return_number, delivery_id FROM tenant.sales_returns WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.delivery_id !== delivery.id) throw new ReturnError(409, "That request key was used for another delivery.", "SALES_RETURN_VALIDATION");
    return { returnId: existing.id, returnNumber: existing.return_number, status: RETURN_STATUS.draft, replayed: true, warnings: [] };
  }
  if (!["dispatched", "delivered"].includes(delivery.delivery_status))
    throw new ReturnError(409, "Only goods that were dispatched can come back: this delivery has not left the warehouse.", "SALES_RETURN_DELIVERY_NOT_DISPATCHED");
  const reason = readReason(input, true);
  const defaultDisposition = text(input.disposition, 20) ?? "inspection";
  const lines = await returnableLines(client, context.organizationId, delivery.id);
  const chosen = settle(lines, input.lines, defaultDisposition);
  const warehouse = await readWarehouse(client, context, input.warehouseId, delivery.warehouse_id);
  const returnDate = readDate(input.returnDate, "Return date") ?? today();
  if (returnDate > today()) throw new ReturnError(400, "The return date cannot be in the future.", "SALES_RETURN_VALIDATION", { field: "returnDate" });
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_return" });
  const created = (await client.query(
    `INSERT INTO tenant.sales_returns (organization_id, return_number, sales_order_id, delivery_id, party_id, customer_snapshot, customer_po_number, return_date, warehouse_id,
        reason_code, reason_note, customer_notes, internal_notes, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [context.organizationId, number, order.id, delivery.id, delivery.party_id ?? order.party_id, JSON.stringify(delivery.customer_snapshot ?? {}), delivery.customer_po_number ?? null,
      returnDate, warehouse.id, reason.code, reason.note, text(input.customerNotes, 4000), text(input.internalNotes, 4000), key, context.userId ?? null])).rows[0];
  await insertLines(client, context, created.id, chosen);
  const summary = chosen.map(({ line, quantity, disposition }) => ({ item: line.item_name_snapshot, quantity, unit: line.uom_snapshot, condition: dispositionOf(disposition).label }));
  await recordReturnEvent(client, context, created.id, "sales_return.created", null, RETURN_STATUS.draft,
    { deliveryNumber: delivery.request_number, orderNumber: order.sales_order_number, reason: reasonLabel(reason.code), warehouse: warehouse.name, lines: summary });
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'sales_order', $2, 'sales_order.return_created', $3, $3, $4::jsonb, $5, clock_timestamp())`,
    [context.organizationId, order.id, order.lifecycle_status, JSON.stringify({ returnId: created.id, returnNumber: number, deliveryNumber: delivery.request_number, lines: summary }),
      context.userId ?? null]);
  return { returnId: created.id, returnNumber: number, status: RETURN_STATUS.draft, replayed: false, warnings: draftWarnings(chosen) };
}

// Changes a draft. input: { expectedVersion?, lines? (the full set; 0 removes), reasonCode?, reasonNote?, warehouseId?, returnDate?, customerNotes?, internalNotes? }
export async function updateDraftReturn(client, context, returnId, input = {}) {
  requireReturnPermission(context, RETURN_PERMISSIONS.edit, "You do not have permission to edit sales returns.");
  const seen = await loadReturn(client, context, returnId);
  await lockOrder(client, context, seen.sales_order_id);
  const salesReturn = await loadReturn(client, context, returnId, { lock: true });
  if (salesReturn.status !== RETURN_STATUS.draft) throw new ReturnError(409, "Only a draft return can be changed.", "SALES_RETURN_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(salesReturn.version))
    throw new ReturnError(409, "Someone else changed this return. Reload it and try again.", "SALES_RETURN_VERSION_CONFLICT");
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const changes = [];
  const sets = [];
  const values = [context.organizationId, salesReturn.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  let warnings = [];
  if (Array.isArray(input.lines)) {
    const lines = await returnableLines(client, context.organizationId, salesReturn.delivery_id, salesReturn.id);
    const chosen = settle(lines, input.lines, "inspection");
    const before = (await client.query(`SELECT delivery_line_id, quantity, disposition, item_name_snapshot FROM tenant.sales_return_lines WHERE organization_id = $1 AND sales_return_id = $2`,
      [context.organizationId, salesReturn.id])).rows;
    await client.query(`DELETE FROM tenant.sales_return_lines WHERE organization_id = $1 AND sales_return_id = $2`, [context.organizationId, salesReturn.id]);
    await insertLines(client, context, salesReturn.id, chosen);
    for (const { line, quantity, disposition } of chosen) {
      const was = before.find((row) => row.delivery_line_id === line.id);
      if (!was || Math.abs(Number(was.quantity) - quantity) > EPSILON) changes.push({ what: `${line.item_name_snapshot}: quantity`, from: was ? Number(was.quantity) : 0, to: quantity });
      if (was && was.disposition !== disposition) changes.push({ what: `${line.item_name_snapshot}: condition`, from: dispositionOf(was.disposition)?.label, to: dispositionOf(disposition).label });
    }
    for (const was of before.filter((row) => !chosen.some(({ line }) => line.id === row.delivery_line_id)))
      changes.push({ what: `${was.item_name_snapshot}: quantity`, from: Number(was.quantity), to: 0 });
    warnings = draftWarnings(chosen);
  }
  if (has("reasonCode") || has("reasonNote")) {
    const reason = readReason({ reasonCode: input.reasonCode ?? salesReturn.reason_code, reasonNote: has("reasonNote") ? input.reasonNote : salesReturn.reason_note }, true);
    if (reason.code !== salesReturn.reason_code) { set("reason_code", reason.code); changes.push({ what: "Reason", from: reasonLabel(salesReturn.reason_code), to: reasonLabel(reason.code) }); }
    if ((reason.note ?? "") !== (salesReturn.reason_note ?? "")) { set("reason_note", reason.note); changes.push({ what: "Reason details", from: salesReturn.reason_note, to: reason.note }); }
  }
  if (has("warehouseId")) {
    const warehouse = await readWarehouse(client, context, input.warehouseId, salesReturn.delivery_warehouse_id);
    if (warehouse.id !== salesReturn.warehouse_id) { set("warehouse_id", warehouse.id); changes.push({ what: "Warehouse", to: warehouse.name }); }
  }
  if (has("returnDate")) {
    const day = readDate(input.returnDate, "Return date") ?? today();
    if (day > today()) throw new ReturnError(400, "The return date cannot be in the future.", "SALES_RETURN_VALIDATION", { field: "returnDate" });
    if (day !== dayOf(salesReturn.return_date)) { set("return_date", day); changes.push({ what: "Return date", from: dayOf(salesReturn.return_date), to: day }); }
  }
  for (const [key, column, label] of [["customerNotes", "customer_notes", "Customer notes"], ["internalNotes", "internal_notes", "Internal notes"]]) {
    if (!has(key)) continue;
    const value = text(input[key], 4000);
    if ((value ?? "") !== (salesReturn[column] ?? "")) { set(column, value); changes.push({ what: label, from: salesReturn[column] ?? null, to: value }); }
  }
  if (!changes.length) return { returnId: salesReturn.id, version: Number(salesReturn.version), changed: false, warnings };
  const version = (await client.query(
    `UPDATE tenant.sales_returns SET ${[...sets, "version = version + 1", "updated_at = now()"].join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING version`, values)).rows[0].version;
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.updated", RETURN_STATUS.draft, RETURN_STATUS.draft, { changes });
  return { returnId: salesReturn.id, version: Number(version), changed: true, changes, warnings };
}

function availableActions(context, salesReturn, credit) {
  const can = (permission) => returnCan(context, permission);
  const draft = salesReturn.status === RETURN_STATUS.draft;
  return {
    edit: draft && can(RETURN_PERMISSIONS.edit),
    receive: draft && can(RETURN_PERMISSIONS.receive),
    cancel: draft && can(RETURN_PERMISSIONS.edit),
    print: salesReturn.status !== RETURN_STATUS.cancelled && can(RETURN_PERMISSIONS.print),
    creditNote: salesReturn.status === RETURN_STATUS.received && credit.creditable > EPSILON && can(RETURN_PERMISSIONS.creditNote),
    selectWarehouse: draft && can(RETURN_PERMISSIONS.selectWarehouse),
  };
}

// Everything the return page shows. Prices are never shown here: they belong to the invoice and the credit note.
export async function getSalesReturn(client, context, returnId) {
  const salesReturn = await loadReturn(client, context, returnId);
  const head = (await client.query(
    `SELECT warehouse.name AS warehouse_name, creator.full_name AS created_by_name, receiver.full_name AS received_by_name, canceller.full_name AS cancelled_by_name,
            party.customer_number, delivery.dispatch_date AS delivery_dispatch_date, delivery_warehouse.name AS delivery_warehouse_name
       FROM tenant.sales_returns sales_return
       JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = sales_return.delivery_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.id = sales_return.warehouse_id
       LEFT JOIN tenant.warehouses delivery_warehouse ON delivery_warehouse.id = delivery.warehouse_id
       LEFT JOIN tenant.business_parties party ON party.id = sales_return.party_id
       LEFT JOIN public.users creator ON creator.id = sales_return.created_by
       LEFT JOIN public.users receiver ON receiver.id = sales_return.received_by
       LEFT JOIN public.users canceller ON canceller.id = sales_return.cancelled_by
      WHERE sales_return.organization_id = $1 AND sales_return.id = $2`, [context.organizationId, salesReturn.id])).rows[0];
  const position = new Map((await returnableLines(client, context.organizationId, salesReturn.delivery_id, salesReturn.id)).map((line) => [line.id, line]));
  const lines = (await client.query(
    `SELECT line.*, location.code AS location_code, location.name AS location_name, movement.movement_number
       FROM tenant.sales_return_lines line
       LEFT JOIN tenant.warehouse_locations location ON location.id = line.warehouse_location_id
       LEFT JOIN tenant.stock_movements movement ON movement.id = line.stock_movement_id
      WHERE line.organization_id = $1 AND line.sales_return_id = $2 ORDER BY line.sequence`, [context.organizationId, salesReturn.id])).rows.map((line) => {
    const state = position.get(line.delivery_line_id);
    return {
      ...line, quantity: Number(line.quantity), base_quantity: Number(line.base_quantity), dispositionLabel: dispositionOf(line.disposition)?.label,
      sellable: Boolean(dispositionOf(line.disposition)?.sellable), reasonLabel: line.reason_code ? reasonLabel(line.reason_code) : null,
      delivered: state?.delivered ?? null, returned_elsewhere: state ? round(state.returned - (salesReturn.status === RETURN_STATUS.received ? Number(line.quantity) : 0)) : null,
      returnable_now: state?.returnable ?? null, on_other_drafts: state?.onDrafts ?? 0, other_drafts: state?.drafts ?? [],
    };
  });
  const credit = await creditPosition(client, context.organizationId, salesReturn, lines);
  const [movements, credits, invoices, events] = [
    (await client.query(
      `SELECT movement.id, movement.movement_number, movement.quantity, movement.created_at, item.name AS item_name, warehouse.name AS warehouse_name, location.code AS location_code,
              location.location_type
         FROM tenant.stock_movements movement
         JOIN tenant.items item ON item.id = movement.item_id
         JOIN tenant.warehouses warehouse ON warehouse.id = movement.warehouse_id
         LEFT JOIN tenant.warehouse_locations location ON location.id = movement.warehouse_location_id
        WHERE movement.organization_id = $1 AND movement.reference_type = 'sales_return' AND movement.reference_id = $2 ORDER BY movement.created_at`, [context.organizationId, salesReturn.id])).rows,
    (await client.query(
      `SELECT DISTINCT credit_note.id, credit_note.invoice_number, credit_note.status, credit_note.invoice_date, source.id AS source_invoice_id, source.invoice_number AS source_invoice_number,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', refund.id, 'refundNumber', refund.refund_number, 'status', refund.status, 'amount', allocation.amount,
                        'currencyCode', btrim(refund.currency_code)) ORDER BY refund.created_at), '[]'::jsonb)
                 FROM tenant.accounting_customer_refund_allocations allocation JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id
                WHERE allocation.credit_note_id = credit_note.id AND refund.status IN ('posted', 'reversed')) AS refunds
         FROM tenant.sales_return_credits credit
         JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id
         JOIN tenant.accounting_customer_invoices source ON source.id = credit.source_invoice_id
        WHERE credit.organization_id = $1 AND credit.sales_return_id = $2`, [context.organizationId, salesReturn.id])).rows,
    // The posted invoices that billed what came back.
    (await client.query(
      `SELECT DISTINCT invoice.id, invoice.invoice_number, invoice.status, invoice.invoice_date
         FROM tenant.sales_return_lines line
         JOIN tenant.accounting_customer_invoice_lines invoiced ON invoiced.organization_id = line.organization_id AND invoiced.source_sales_order_line_id = line.sales_order_line_id
         JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
              AND invoice.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
         JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = invoice.id
        WHERE line.organization_id = $1 AND line.sales_return_id = $2`, [context.organizationId, salesReturn.id])).rows,
    (await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.sales_return_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.sales_return_id = $2 ORDER BY event.occurred_at DESC`, [context.organizationId, salesReturn.id])).rows,
  ];
  return {
    salesReturn: {
      ...salesReturn, ...head, statusLabel: RETURN_STATUS_LABELS[salesReturn.status], reasonLabel: reasonLabel(salesReturn.reason_code),
      total_quantity: round(lines.reduce((total, line) => total + line.quantity, 0)), creditStatus: credit.status, creditStatusLabel: credit.label,
    },
    lines, credit, movements, credits, invoices, events,
    draftWarnings: salesReturn.status === RETURN_STATUS.draft
      ? lines.filter((line) => line.on_other_drafts > EPSILON && line.quantity + line.on_other_drafts > (line.returnable_now ?? 0) + EPSILON).map((line) => ({
        item: line.item_name_snapshot,
        message: `${line.item_name_snapshot}: ${line.other_drafts.map((draft) => `${draft.returnNumber} (${Number(draft.quantity)})`).join(", ")} also return this line and only ${line.returnable_now} can come back: whichever is received first goes through.`,
      }))
      : [],
    reasons: RETURN_REASONS, dispositions: DISPOSITIONS.map(({ code, label, sellable }) => ({ code, label, sellable })),
    actions: availableActions(context, salesReturn, credit),
  };
}

const SORTS = Object.freeze({ number: "sales_return.return_number", date: "sales_return.return_date", customer: "customer_name", created: "sales_return.created_at" });
// A received return still owing a credit note: its lines' share of what was invoiced but returned (the latest
// received returns of the order line first, as creditPosition allocates it) is more than what was credited for them.
export const CREDIT_DUE_SQL = `EXISTS (SELECT 1 FROM (
     SELECT line.id, line.sales_return_id,
            GREATEST(0, LEAST(line.quantity, due.quantity - (sum(line.quantity) OVER (PARTITION BY line.sales_order_line_id ORDER BY received.received_at DESC, line.id) - line.quantity))) AS invoiced
       FROM tenant.sales_return_lines line
       JOIN tenant.sales_returns received ON received.id = line.sales_return_id AND received.status = 'received'
       JOIN (SELECT progress.sales_order_line_id,
                    LEAST(progress.returned_quantity, GREATEST(0, progress.invoiced_quantity - (progress.fulfilled_quantity - progress.returned_quantity))) AS quantity
               FROM tenant.sales_order_line_progress progress) due ON due.sales_order_line_id = line.sales_order_line_id
      WHERE received.sales_order_id = sales_return.sales_order_id) allocation
    WHERE allocation.sales_return_id = sales_return.id
      AND allocation.invoiced > COALESCE((SELECT sum(credit.quantity) FROM tenant.sales_return_credits credit
                                           JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id AND credit_note.status NOT IN ('cancelled', 'reversed')
                                          WHERE credit.sales_return_line_id = allocation.id), 0) + 0.000001)`;

// filters: view, search, status, partyId, warehouseId, reasonCode, productId, salesOrderId, deliveryId, invoiceId, credited ('yes'|'no'), dateFrom, dateTo, sort, direction, limit, offset
export async function listSalesReturns(client, context, filters = {}) {
  requireReturnAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = returnScopeSql(context, values, "sales_order");
  switch (filters.view) {
    case "draft": where += ` AND sales_return.status = 'draft'`; break;
    case "received": where += ` AND sales_return.status = 'received'`; break;
    case "cancelled": where += ` AND sales_return.status = 'cancelled'`; break;
    case "awaiting_credit": where += ` AND sales_return.status = 'received' AND ${CREDIT_DUE_SQL}`; break;
    case "mine": where += ` AND sales_return.created_by = ${bind(context.userId ?? null)}`; break;
    default: break;
  }
  if (Object.values(RETURN_STATUS).includes(filters.status)) where += ` AND sales_return.status = ${bind(filters.status)}`;
  if (filters.credited === "yes") where += ` AND EXISTS (SELECT 1 FROM tenant.sales_return_credits credit WHERE credit.sales_return_id = sales_return.id)`;
  if (filters.credited === "no") where += ` AND NOT EXISTS (SELECT 1 FROM tenant.sales_return_credits credit WHERE credit.sales_return_id = sales_return.id)`;
  if (RETURN_REASONS.some((reason) => reason.code === filters.reasonCode)) where += ` AND sales_return.reason_code = ${bind(filters.reasonCode)}`;
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (sales_return.return_number ILIKE ${term} OR sales_order.sales_order_number ILIKE ${term} OR delivery.request_number ILIKE ${term}
      OR sales_return.customer_snapshot->>'displayName' ILIKE ${term} OR sales_return.customer_po_number ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id AND (line.item_name_snapshot ILIKE ${term} OR line.item_code_snapshot ILIKE ${term}))
      OR EXISTS (SELECT 1 FROM tenant.sales_return_lines line JOIN tenant.accounting_customer_invoice_lines invoiced ON invoiced.source_sales_order_line_id = line.sales_order_line_id
                  JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id
                  WHERE line.sales_return_id = sales_return.id AND invoice.invoice_number ILIKE ${term}))`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(requireUuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND sales_return.party_id = ${p}`, "Customer");
  uuidFilter("warehouseId", (p) => ` AND sales_return.warehouse_id = ${p}`, "Warehouse");
  uuidFilter("salesOrderId", (p) => ` AND sales_return.sales_order_id = ${p}`, "Sales order");
  uuidFilter("deliveryId", (p) => ` AND sales_return.delivery_id = ${p}`, "Delivery");
  uuidFilter("productId", (p) => ` AND EXISTS (SELECT 1 FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id AND line.item_id = ${p})`, "Product");
  uuidFilter("invoiceId", (p) => ` AND EXISTS (SELECT 1 FROM tenant.sales_return_lines line JOIN tenant.accounting_customer_invoice_lines invoiced ON invoiced.source_sales_order_line_id = line.sales_order_line_id
      WHERE line.sales_return_id = sales_return.id AND invoiced.customer_invoice_id = ${p})`, "Invoice");
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dateFrom", (p) => ` AND sales_return.return_date >= ${p}::date`, "Returned from");
  dateFilter("dateTo", (p) => ` AND sales_return.return_date <= ${p}::date`, "Returned to");
  const sort = SORTS[filters.sort] ?? SORTS.created;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_returns sales_return
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_return.organization_id AND sales_order.id = sales_return.sales_order_id
       JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = sales_return.organization_id AND delivery.id = sales_return.delivery_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = sales_return.organization_id AND warehouse.id = sales_return.warehouse_id
      WHERE sales_return.organization_id = $1`;
  const countValues = [...values];
  const rows = (await client.query(
    `SELECT sales_return.id, sales_return.return_number, sales_return.status, sales_return.return_date, sales_return.reason_code, sales_return.sales_order_id,
            sales_order.sales_order_number, sales_return.delivery_id, delivery.request_number AS delivery_number, sales_return.customer_snapshot->>'displayName' AS customer_name,
            warehouse.name AS warehouse_name,
            (SELECT count(*)::int FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS line_count,
            (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS total_quantity,
            (SELECT string_agg(DISTINCT invoice.invoice_number, ', ') FROM tenant.sales_return_lines line
               JOIN tenant.accounting_customer_invoice_lines invoiced ON invoiced.source_sales_order_line_id = line.sales_order_line_id
               JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
                    AND invoice.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
              WHERE line.sales_return_id = sales_return.id) AS invoice_numbers,
            (SELECT string_agg(DISTINCT credit_note.invoice_number, ', ') FROM tenant.sales_return_credits credit
               JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id WHERE credit.sales_return_id = sales_return.id) AS credit_note_numbers,
            sales_return.status = 'received' AND ${CREDIT_DUE_SQL} AS awaiting_credit
       ${from}${where}
      ORDER BY ${sort} ${direction} NULLS LAST, sales_return.return_number DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const count = (await client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues)).rows[0].total;
  return {
    rows: rows.map((row) => ({
      ...row, statusLabel: RETURN_STATUS_LABELS[row.status], reasonLabel: reasonLabel(row.reason_code),
      creditStatus: row.credit_note_numbers ? "credited" : row.awaiting_credit ? "awaiting" : "not_required",
      creditStatusLabel: row.credit_note_numbers ? "Credit note created" : row.awaiting_credit ? "Awaiting credit note" : "—",
    })),
    total: count, limit, offset, views: RETURN_VIEWS, reasons: RETURN_REASONS,
    capabilities: Object.fromEntries(Object.entries(RETURN_PERMISSIONS).map(([name, permission]) => [name, returnCan(context, permission)])),
  };
}

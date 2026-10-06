// Deliveries of confirmed sales orders: what is proposed, creating one as a
// draft, changing it before dispatch, reading one and listing them.
//
// Quantities are always worked out, never typed into the order:
//   remaining to deliver = ordered − dispatched − cancelled
//   open elsewhere       = what other deliveries not yet dispatched carry
//   assignable           = remaining − open elsewhere
// A delivery takes at most what is assignable for each line; Dispatch checks
// again against what is still to deliver, under a lock. One delivery ships
// from one warehouse: the lines' own fulfillment warehouse, where their
// reservations are. Services are never delivered.
//
// A delivery keeps its own snapshots (customer, contact, ship-to address,
// customer PO, instructions, product details), so later changes to the
// customer or the product never rewrite it.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { assertOrderVisible, requireOrderAccess } from "../orders/access.js";
import { STATUS, dayOf, requireUuid, text } from "../orders/constants.js";
import { loadOrderLineProgress } from "../orders/progress.js";
import { lockOrder, readDate, recordOrderEvent } from "../orders/versions.js";
import { deliveryCan, deliveryScopeSql, loadDelivery, requireDeliveryAccess, requireDeliveryPermission } from "./access.js";
import {
  DELIVERY_CANCEL_REASONS, DELIVERY_PERMISSIONS, DELIVERY_STATUS, DELIVERY_STATUS_LABELS, DELIVERY_VIEWS, DeliveryError, OPEN, SHIPMENT_LABELS, SHIPPED,
} from "./constants.js";
import { readPackageCount, shipmentColumns } from "./shipment.js";

const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

export async function recordDeliveryEvent(client, context, deliveryId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'fulfillment_request', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, deliveryId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

// What other deliveries of the order still to be dispatched carry, per order line.
export async function openQuantities(client, organizationId, orderId, exceptDeliveryId = null) {
  const { rows } = await client.query(
    `SELECT line.sales_order_line_id, sum(line.quantity) AS quantity FROM tenant.sales_delivery_lines line
       JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = line.organization_id AND delivery.id = line.delivery_id
      WHERE line.organization_id = $1 AND delivery.sales_order_id = $2 AND delivery.delivery_status IN ('draft', 'ready') AND ($3::uuid IS NULL OR delivery.id <> $3)
      GROUP BY line.sales_order_line_id`, [organizationId, orderId, exceptDeliveryId]);
  return new Map(rows.map((row) => [row.sales_order_line_id, Number(row.quantity)]));
}

// Each order line with what a delivery can take now.
async function deliverableLines(client, organizationId, order, exceptDeliveryId = null) {
  const progress = await loadOrderLineProgress(client, organizationId, order.current_version_id);
  const open = await openQuantities(client, organizationId, order.id, exceptDeliveryId);
  const snapshots = new Map((await client.query(
    `SELECT line.id, line.item_code_snapshot, line.item_name_snapshot, line.description_snapshot, line.uom_id, warehouse.name AS warehouse_name, warehouse.status AS warehouse_status,
            warehouse.sales_fulfillment
       FROM tenant.sales_order_lines line
       LEFT JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id)
      WHERE line.organization_id = $1 AND line.sales_order_version_id = $2`, [organizationId, order.current_version_id])).rows.map((row) => [row.id, row]));
  return progress.map((line) => {
    const snapshot = snapshots.get(line.lineId) ?? {};
    const openElsewhere = round(open.get(line.lineId) ?? 0);
    return {
      ...line, ...snapshot, warehouseName: snapshot.warehouse_name ?? null, openElsewhere,
      assignable: line.deliverable ? round(Math.max(0, line.remainingToDeliver - openElsewhere)) : 0,
    };
  });
}

async function reservationWarehouses(client, organizationId, lineIds) {
  if (!lineIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT reservation.sales_order_line_id, warehouse.id, warehouse.name FROM tenant.stock_reservations reservation
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
      WHERE reservation.organization_id = $1 AND reservation.sales_order_line_id = ANY($2::uuid[]) AND reservation.status = 'active'`, [organizationId, lineIds]);
  const map = new Map();
  for (const row of rows) map.set(row.sales_order_line_id, [...(map.get(row.sales_order_line_id) ?? []), row]);
  return map;
}

// What a new delivery of the order would carry: the goods lines with what
// each can take now, grouped by the warehouse they ship from; services are
// listed as needing no physical delivery.
export async function getDeliveryProposal(client, context, orderId) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const lines = await deliverableLines(client, context.organizationId, order);
  const goods = lines.filter((line) => line.deliverable);
  return {
    orderId: order.id, canDeliver: order.lifecycle_status === STATUS.confirmed,
    lines: goods.filter((line) => line.remainingToDeliver > EPSILON).map((line) => ({
      salesOrderLineId: line.lineId, itemName: line.itemName, unit: line.unit, ordered: line.ordered, delivered: line.delivered, cancelled: line.cancelled,
      reserved: round(line.reserved), remaining: line.remainingToDeliver, openElsewhere: line.openElsewhere, assignable: line.assignable,
      // The default: what is reserved for the line when stock is reserved, else all that is left.
      suggested: line.stockTracked && line.reserved > EPSILON ? round(Math.min(line.assignable, line.reserved)) : line.assignable,
      stockTracked: line.stockTracked, warehouseId: line.warehouseId, warehouseName: line.warehouseName,
    })),
    services: lines.filter((line) => !line.deliverable).map((line) => ({ salesOrderLineId: line.lineId, itemName: line.itemName, note: "No physical delivery required" })),
  };
}

// Checks the lines a delivery would carry and settles its warehouse.
async function settleLines(client, context, order, lines, requested, warehouseHint) {
  const byId = new Map(lines.map((line) => [line.lineId, line]));
  const chosen = requested
    .map((entry) => ({ line: byId.get(requireUuid(entry.salesOrderLineId, "Order line")), quantity: Number(entry.quantity) }))
    .filter((entry) => entry.quantity !== 0);
  if (!chosen.length) throw new DeliveryError(409, "Nothing is left to deliver on this order.", "SALES_ORDER_NOTHING_TO_DELIVER");
  const seen = new Set();
  for (const { line, quantity } of chosen) {
    if (!line) throw new DeliveryError(404, "An order line was not found on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    if (seen.has(line.lineId)) throw new DeliveryError(400, `${line.itemName} is on the delivery twice.`, "SALES_ORDER_VALIDATION");
    seen.add(line.lineId);
    if (!line.deliverable) throw new DeliveryError(409, `${line.itemName} is a service: no physical delivery is required.`, "SALES_ORDER_LINE_NOT_DELIVERABLE");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new DeliveryError(400, `${line.itemName}: enter the quantity to deliver.`, "SALES_ORDER_VALIDATION");
    if (quantity > line.assignable + EPSILON)
      throw new DeliveryError(409, `${line.itemName}: only ${line.assignable} ${line.unit ?? ""} can be delivered${line.openElsewhere > EPSILON ? ` (${line.openElsewhere} is already on another delivery not yet dispatched)` : ""}.`.replace("  ", " "),
        "SALES_ORDER_DELIVERY_EXCEEDS_REMAINING");
    if (line.stockTracked && !line.warehouseId)
      throw new DeliveryError(409, `${line.itemName}: the order line has no warehouse to ship from.`, "SALES_ORDER_WAREHOUSE_REQUIRED");
  }
  const warehouses = [...new Set(chosen.filter(({ line }) => line.stockTracked).map(({ line }) => line.warehouseId))];
  if (warehouses.length > 1)
    throw new DeliveryError(409, "These lines ship from different warehouses: create one delivery per warehouse.", "SALES_DELIVERY_MIXED_WAREHOUSES");
  const warehouseId = warehouses[0] ?? warehouseHint ?? null;
  if (warehouseHint && warehouses[0] && warehouseHint !== warehouses[0])
    throw new DeliveryError(409, "The lines chosen do not ship from that warehouse.", "SALES_DELIVERY_MIXED_WAREHOUSES");
  // Stock reserved in another warehouse is never shipped from here.
  const reserved = await reservationWarehouses(client, context.organizationId, chosen.map(({ line }) => line.lineId));
  for (const { line } of chosen) {
    const elsewhere = (reserved.get(line.lineId) ?? []).find((row) => row.id !== warehouseId);
    if (elsewhere)
      throw new DeliveryError(409, `${line.itemName} is reserved in ${elsewhere.name}. Change the line's warehouse (which releases that reservation) or deliver from ${elsewhere.name}.`,
        "SALES_DELIVERY_WAREHOUSE_MISMATCH");
  }
  return { chosen, warehouseId };
}

async function insertLines(client, context, order, deliveryId, chosen, warehouseId) {
  for (const { line, quantity } of chosen)
    await client.query(
      `INSERT INTO tenant.sales_delivery_lines (organization_id, delivery_id, sales_order_id, sales_order_line_id, item_id, warehouse_id, quantity, base_quantity, uom_snapshot, uom_id,
          stock_issued, sequence, item_code_snapshot, item_name_snapshot, description_snapshot, ordered_quantity, previously_delivered_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $13, $14, $15, $16)`,
      [context.organizationId, deliveryId, order.id, line.lineId, line.itemId, line.stockTracked ? warehouseId : null, quantity, round(quantity * line.conversionFactor), line.unit,
        line.uom_id ?? null, line.sequence, line.item_code_snapshot ?? null, line.itemName, line.description_snapshot ?? null, line.ordered, line.delivered]);
}

// A new delivery for a confirmed order, as a Draft: no stock moves until it is dispatched.
// input: { idempotencyKey, lines?: [{ salesOrderLineId, quantity }], warehouseId?, expectedDeliveryDate?, deliveryInstructions?, internalNotes?,
//          carrier?, trackingNumber?, trackingUrl?, vehicleReference?, packageCount?, packageNotes?,
//          dispatch?: true (create and dispatch in one step), dispatchDate? }
// Without `lines`, everything that can be delivered now from the warehouse is taken (the default quantities).
export async function createDeliveryFromSalesOrder(client, context, orderId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.create, "You do not have permission to create deliveries.");
  if (input.dispatch) requireDeliveryPermission(context, DELIVERY_PERMISSIONS.dispatch, "You do not have permission to dispatch deliveries.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new DeliveryError(400, "A request key is required to create a delivery.", "SALES_ORDER_VALIDATION");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const existing = (await client.query(`SELECT id, request_number, sales_order_id, delivery_status FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.sales_order_id !== order.id) throw new DeliveryError(409, "That request key was used for another order.", "SALES_ORDER_VALIDATION");
    return { deliveryId: existing.id, deliveryNumber: existing.request_number, status: existing.delivery_status, replayed: true };
  }
  if (order.lifecycle_status !== STATUS.confirmed)
    throw new DeliveryError(409, order.lifecycle_status === STATUS.draft ? "Confirm the order before delivering it." : "Only a confirmed order can be delivered.", "SALES_ORDER_NOT_CONFIRMED");
  const lines = await deliverableLines(client, context.organizationId, order);
  const warehouseHint = input.warehouseId ? requireUuid(input.warehouseId, "Warehouse") : null;
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines
    : (() => {
      const candidates = lines.filter((line) => line.deliverable && line.assignable > EPSILON);
      const from = warehouseHint ?? candidates.find((line) => line.stockTracked)?.warehouseId ?? null;
      return candidates.filter((line) => !line.stockTracked || line.warehouseId === from)
        .map((line) => ({ salesOrderLineId: line.lineId, quantity: line.stockTracked && line.reserved > EPSILON ? round(Math.min(line.assignable, line.reserved)) : line.assignable }));
    })();
  const { chosen, warehouseId } = await settleLines(client, context, order, lines, requested, warehouseHint);
  const version = (await client.query(
    `SELECT customer_snapshot, contact_snapshot, shipping_address_id, shipping_address_snapshot, customer_po_number, delivery_terms, customer_notes
       FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.current_version_id])).rows[0];
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_fulfillment_request" });
  const shipment = shipmentColumns(input);
  const delivery = (await client.query(
    `INSERT INTO tenant.sales_fulfillment_requests (organization_id, request_number, sales_order_id, sales_order_version_id, idempotency_key, delivery_status, payload, requested_by,
        party_id, customer_snapshot, contact_id, contact_snapshot, shipping_address_id, shipping_address_snapshot, customer_po_number, warehouse_id,
        expected_delivery_date, delivery_instructions, internal_notes, carrier, tracking_number, tracking_url, vehicle_reference, package_count, package_notes)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
     RETURNING id, request_number`,
    [context.organizationId, number, order.id, order.current_version_id, key, JSON.stringify({ salesOrderNumber: order.sales_order_number }), context.userId ?? null,
      order.party_id, JSON.stringify(version.customer_snapshot ?? {}), order.contact_id ?? null, JSON.stringify(version.contact_snapshot ?? {}), version.shipping_address_id,
      JSON.stringify(version.shipping_address_snapshot ?? {}), version.customer_po_number, warehouseId,
      shipment.expected_delivery_date ?? dayOf(order.requested_delivery_date), text(input.deliveryInstructions, 2000) ?? version.delivery_terms ?? version.customer_notes ?? null,
      text(input.internalNotes, 2000), shipment.carrier, shipment.tracking_number, shipment.tracking_url, shipment.vehicle_reference, shipment.package_count, shipment.package_notes])).rows[0];
  await insertLines(client, context, order, delivery.id, chosen, warehouseId);
  const summary = chosen.map(({ line, quantity }) => ({ item: line.itemName, quantity, unit: line.unit }));
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.created", null, DELIVERY_STATUS.draft, { orderNumber: order.sales_order_number, lines: summary });
  await recordOrderEvent(client, context, order.id, "sales_order.delivery_created", order.lifecycle_status, order.lifecycle_status,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, status: DELIVERY_STATUS.draft, lines: summary });
  if (input.dispatch) {
    const { dispatchDelivery } = await import("./lifecycle.js");
    const dispatched = await dispatchDelivery(client, context, delivery.id, { dispatchDate: input.dispatchDate });
    return { deliveryId: delivery.id, deliveryNumber: delivery.request_number, status: DELIVERY_STATUS.dispatched, replayed: false, fulfillmentStatus: dispatched.fulfillmentStatus };
  }
  return { deliveryId: delivery.id, deliveryNumber: delivery.request_number, status: DELIVERY_STATUS.draft, replayed: false };
}

// Changes a delivery before it is dispatched. Lines change only while it is a Draft; the
// address, contact, dates, instructions, notes and packages until it is dispatched.
// input: { expectedVersion?, lines?: [{ salesOrderLineId, quantity }] (the full set; 0 removes),
//          shippingAddressId?, addressChangeReason?, contactId?, expectedDeliveryDate?, deliveryInstructions?, internalNotes?, packageCount?, packageNotes? }
export async function updateDraftDelivery(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.edit, "You do not have permission to prepare deliveries.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (!OPEN.includes(delivery.delivery_status))
    throw new DeliveryError(409, "A dispatched or cancelled delivery cannot be changed.", "SALES_DELIVERY_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(delivery.version))
    throw new DeliveryError(409, "Someone else changed this delivery. Reload it and try again.", "SALES_DELIVERY_VERSION_CONFLICT");
  const changes = [];
  const sets = [];
  const values = [context.organizationId, delivery.id];
  const set = (column, value, cast = "") => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (Array.isArray(input.lines)) {
    if (delivery.delivery_status !== DELIVERY_STATUS.draft) throw new DeliveryError(409, "Return the delivery to Draft to change its lines.", "SALES_DELIVERY_LOCKED");
    const order = await lockOrder(client, context, delivery.sales_order_id);
    const lines = await deliverableLines(client, context.organizationId, order, delivery.id);
    const { chosen, warehouseId } = await settleLines(client, context, order, lines, input.lines, delivery.warehouse_id);
    const before = (await client.query(`SELECT sales_order_line_id, quantity, item_name_snapshot FROM tenant.sales_delivery_lines WHERE organization_id = $1 AND delivery_id = $2`,
      [context.organizationId, delivery.id])).rows;
    await client.query(`DELETE FROM tenant.sales_delivery_lines WHERE organization_id = $1 AND delivery_id = $2`, [context.organizationId, delivery.id]);
    await insertLines(client, context, order, delivery.id, chosen, warehouseId);
    for (const { line, quantity } of chosen) {
      const was = before.find((row) => row.sales_order_line_id === line.lineId);
      if (!was || Math.abs(Number(was.quantity) - quantity) > EPSILON) changes.push({ what: `${line.itemName}: quantity`, from: was ? Number(was.quantity) : 0, to: quantity });
    }
    for (const was of before.filter((row) => !chosen.some(({ line }) => line.lineId === row.sales_order_line_id)))
      changes.push({ what: `${was.item_name_snapshot}: quantity`, from: Number(was.quantity), to: 0 });
  }
  if (has("shippingAddressId")) {
    const address = (await client.query(
      `SELECT id, address_type, label, line1, line2, city, district, state, state_code, postal_code, country_code, gstin, is_default_shipping FROM tenant.addresses
        WHERE organization_id = $1 AND party_id = $2 AND id = $3 AND status = 'active'`,
      [context.organizationId, delivery.party_id, requireUuid(input.shippingAddressId, "Shipping address")])).rows[0];
    if (!address) throw new DeliveryError(409, "The address does not belong to this customer.", "SALES_DELIVERY_ADDRESS_INVALID");
    if (!address.is_default_shipping && !["shipping", "plant", "office", "registered"].includes(address.address_type))
      throw new DeliveryError(409, `A ${address.address_type} address cannot be a delivery address.`, "SALES_ADDRESS_PURPOSE_MISMATCH");
    delete address.is_default_shipping;
    if (address.id !== delivery.shipping_address_id) {
      const describe = (snapshot) => [snapshot?.label, snapshot?.line1, snapshot?.city].filter(Boolean).join(", ") || null;
      changes.push({ what: "Ship-to address", from: describe(delivery.shipping_address_snapshot), to: describe(address), reason: text(input.addressChangeReason, 500) });
      set("shipping_address_id", address.id);
      set("shipping_address_snapshot", JSON.stringify(address), "::jsonb");
    }
  }
  if (has("contactId")) {
    let contact = {};
    if (input.contactId) {
      contact = (await client.query(
        `SELECT contact.id, contact.first_name, contact.last_name, COALESCE(link.job_title, contact.designation) AS designation, contact.email, contact.phone, contact.mobile, link.role
           FROM tenant.contacts contact
           JOIN tenant.crm_contact_account_relationships link ON link.organization_id = contact.organization_id AND link.contact_id = contact.id AND link.party_id = $2 AND link.status = 'active'
          WHERE contact.organization_id = $1 AND contact.id = $3 AND contact.status = 'active' AND contact.archived_at IS NULL AND COALESCE(contact.privacy_status, 'active') = 'active'`,
        [context.organizationId, delivery.party_id, requireUuid(input.contactId, "Contact")])).rows[0];
      if (!contact) throw new DeliveryError(409, "The contact does not belong to this customer.", "SALES_DELIVERY_CONTACT_INVALID");
    }
    if ((contact.id ?? null) !== (delivery.contact_id ?? null)) {
      const name = (snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
      changes.push({ what: "Contact", from: name(delivery.contact_snapshot), to: name(contact) });
      set("contact_id", contact.id ?? null);
      set("contact_snapshot", JSON.stringify(contact), "::jsonb");
    }
  }
  const simple = { expectedDeliveryDate: ["expected_delivery_date", (v) => readDate(v, "Expected delivery date")], deliveryInstructions: ["delivery_instructions", (v) => text(v, 2000)],
    internalNotes: ["internal_notes", (v) => text(v, 2000)], packageCount: ["package_count", readPackageCount], packageNotes: ["package_notes", (v) => text(v, 1000)] };
  for (const [key, [column, read]] of Object.entries(simple)) {
    if (!has(key)) continue;
    const value = read(input[key]);
    const current = column === "expected_delivery_date" ? dayOf(delivery[column]) : delivery[column];
    if (String(current ?? "") !== String(value ?? "")) { set(column, value); changes.push({ what: key, from: current ?? null, to: value ?? null }); }
  }
  if (!changes.length) return { deliveryId: delivery.id, version: Number(delivery.version), changed: false };
  const version = (await client.query(
    `UPDATE tenant.sales_fulfillment_requests SET ${[...sets, "version = version + 1"].join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING version`, values)).rows[0].version;
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.updated", delivery.delivery_status, delivery.delivery_status, { changes });
  return { deliveryId: delivery.id, version: Number(version), changed: true, changes };
}

// What the caller can do with the delivery now; the server checks again on each action.
function availableActions(context, delivery, invoiceable, returnable = false) {
  const can = (permission) => deliveryCan(context, permission);
  const status = delivery.delivery_status;
  return {
    edit: status === DELIVERY_STATUS.draft && can(DELIVERY_PERMISSIONS.edit),
    editShipment: [...OPEN, DELIVERY_STATUS.dispatched].includes(status) && can(DELIVERY_PERMISSIONS.edit),
    changeAddress: OPEN.includes(status) && can(DELIVERY_PERMISSIONS.edit),
    changeWarehouse: status === DELIVERY_STATUS.draft && can(DELIVERY_PERMISSIONS.edit) && can(DELIVERY_PERMISSIONS.changeWarehouse),
    markReady: status === DELIVERY_STATUS.draft && can(DELIVERY_PERMISSIONS.edit),
    backToDraft: status === DELIVERY_STATUS.ready && can(DELIVERY_PERMISSIONS.edit),
    dispatch: OPEN.includes(status) && delivery.order_status === STATUS.confirmed && can(DELIVERY_PERMISSIONS.dispatch),
    markDelivered: status === DELIVERY_STATUS.dispatched && can(DELIVERY_PERMISSIONS.deliver),
    cancel: OPEN.includes(status) && can(DELIVERY_PERMISSIONS.cancel),
    print: status !== DELIVERY_STATUS.cancelled && can(DELIVERY_PERMISSIONS.print),
    createInvoice: SHIPPED.includes(status) && invoiceable && can(DELIVERY_PERMISSIONS.invoice),
    uploadProof: SHIPPED.includes(status) && (can(DELIVERY_PERMISSIONS.deliver) || can(DELIVERY_PERMISSIONS.edit)),
    // Goods that left can come back, up to what was delivered less what already came back.
    createReturn: SHIPPED.includes(status) && returnable && can("sales.return.create"),
  };
}

// Everything the delivery page shows.
export async function getDelivery(client, context, deliveryId) {
  const delivery = await loadDelivery(client, context, deliveryId);
  const head = (await client.query(
    `SELECT warehouse.name AS warehouse_name, warehouse.code AS warehouse_code, creator.full_name AS created_by_name, readier.full_name AS ready_by_name,
            dispatcher.full_name AS dispatched_by_name, deliverer.full_name AS delivered_by_name, canceller.full_name AS cancelled_by_name,
            sales_order.requested_delivery_date, owner.full_name AS owner_name,
            sales_order.source_quotation_id, quotation.quotation_number AS source_quotation_number, party.customer_number
       FROM tenant.sales_fulfillment_requests delivery
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = delivery.organization_id AND sales_order.id = delivery.sales_order_id
       LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = delivery.organization_id AND party.id = delivery.party_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = delivery.organization_id AND warehouse.id = delivery.warehouse_id
       LEFT JOIN public.users creator ON creator.id = delivery.requested_by
       LEFT JOIN public.users readier ON readier.id = delivery.ready_by
       LEFT JOIN public.users dispatcher ON dispatcher.id = delivery.dispatched_by
       LEFT JOIN public.users deliverer ON deliverer.id = delivery.delivered_by
       LEFT JOIN public.users canceller ON canceller.id = delivery.cancelled_by
       LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
      WHERE delivery.organization_id = $1 AND delivery.id = $2`, [context.organizationId, delivery.id])).rows[0];
  const lines = (await client.query(
    `SELECT line.id, line.sales_order_line_id, line.sequence, line.item_id, line.item_code_snapshot, line.item_name_snapshot, line.description_snapshot, line.quantity, line.base_quantity,
            line.uom_snapshot, line.warehouse_id, line.stock_issued, line.ordered_quantity, line.previously_delivered_quantity, warehouse.name AS warehouse_name,
            COALESCE((SELECT sum(invoiced.quantity) FROM tenant.accounting_customer_invoice_lines invoiced
                       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
                            AND invoice.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
                      WHERE invoiced.organization_id = line.organization_id AND invoiced.source_sales_delivery_line_id = line.id), 0) AS invoiced_quantity,
            COALESCE((SELECT json_agg(json_build_object('reservation', reservation.reservation_number, 'quantity', consumption.quantity) ORDER BY consumption.consumed_at)
                       FROM tenant.stock_reservation_consumptions consumption
                       JOIN tenant.stock_reservations reservation ON reservation.id = consumption.reservation_id
                      WHERE consumption.organization_id = line.organization_id AND consumption.delivery_line_id = line.id), '[]'::json) AS consumed_reservations
       FROM tenant.sales_delivery_lines line
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.warehouse_id
      WHERE line.organization_id = $1 AND line.delivery_id = $2 ORDER BY line.sequence NULLS LAST, line.created_at`, [context.organizationId, delivery.id])).rows;
  // The order lines' quantities now, for what is left after this delivery.
  const progress = new Map((await loadOrderLineProgress(client, context.organizationId, delivery.current_version_id)).map((line) => [line.lineId, line]));
  const open = await openQuantities(client, context.organizationId, delivery.sales_order_id, delivery.id);
  const [invoices, movements, events] = [
    await client.query(
      `SELECT DISTINCT invoice.id, invoice.invoice_number, invoice.status, invoice.invoice_date, invoice.grand_total, btrim(invoice.currency_code) AS currency_code
         FROM tenant.accounting_customer_invoice_lines invoiced
         JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = invoiced.organization_id AND invoice.id = invoiced.customer_invoice_id
         JOIN tenant.sales_delivery_lines line ON line.id = invoiced.source_sales_delivery_line_id
        WHERE invoiced.organization_id = $1 AND line.delivery_id = $2 AND invoice.invoice_type = 'invoice' AND invoice.status <> 'cancelled'`, [context.organizationId, delivery.id]),
    await client.query(
      `SELECT movement.id, movement.movement_number, movement.quantity, movement.created_at, item.name AS item_name, warehouse.name AS warehouse_name, location.code AS location_code
         FROM tenant.stock_movements movement
         JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
        WHERE movement.organization_id = $1 AND movement.reference_type = 'sales_delivery' AND movement.reference_id = $2 ORDER BY movement.created_at`, [context.organizationId, delivery.id]),
    await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.sales_document_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.entity_type = 'fulfillment_request' AND event.entity_id = $2 ORDER BY event.occurred_at DESC, event.id DESC`, [context.organizationId, delivery.id]),
  ];
  const returned = new Map((await client.query(
    `SELECT returned.delivery_line_id, sum(returned.quantity) AS quantity FROM tenant.sales_return_lines returned
       JOIN tenant.sales_returns sales_return ON sales_return.id = returned.sales_return_id AND sales_return.status = 'received'
      WHERE returned.organization_id = $1 AND sales_return.delivery_id = $2 GROUP BY returned.delivery_line_id`, [context.organizationId, delivery.id])).rows
    .map((row) => [row.delivery_line_id, Number(row.quantity)]));
  const returns = (await client.query(
    `SELECT sales_return.id, sales_return.return_number, sales_return.status, sales_return.return_date, sales_return.reason_code,
            (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_return_lines line WHERE line.sales_return_id = sales_return.id) AS quantity
       FROM tenant.sales_returns sales_return WHERE sales_return.organization_id = $1 AND sales_return.delivery_id = $2 AND sales_return.status <> 'cancelled'
      ORDER BY sales_return.created_at`, [context.organizationId, delivery.id])).rows;
  const detailLines = lines.map((line) => {
    const state = progress.get(line.sales_order_line_id);
    return {
      ...line, quantity: Number(line.quantity), invoiced_quantity: Number(line.invoiced_quantity),
      returned_quantity: returned.get(line.id) ?? 0, kept_quantity: round(Number(line.quantity) - (returned.get(line.id) ?? 0)),
      ordered_now: state?.ordered ?? Number(line.ordered_quantity ?? 0), cancelled_now: state?.cancelled ?? 0, delivered_now: state?.delivered ?? 0,
      reserved_now: round(state?.reserved ?? 0), remaining_now: state?.remainingToDeliver ?? 0, open_elsewhere: round(open.get(line.sales_order_line_id) ?? 0),
    };
  });
  const shipped = SHIPPED.includes(delivery.delivery_status);
  const totalQuantity = detailLines.reduce((total, line) => total + line.quantity, 0);
  // Invoicing is complete when what the customer kept is invoiced.
  const keptQuantity = detailLines.reduce((total, line) => total + line.kept_quantity, 0);
  const invoicedQuantity = detailLines.reduce((total, line) => total + Math.min(line.kept_quantity, line.invoiced_quantity), 0);
  const invoicing = !shipped || totalQuantity <= EPSILON ? "not_invoiced" : invoicedQuantity <= EPSILON ? "not_invoiced" : invoicedQuantity + EPSILON >= keptQuantity ? "fully_invoiced" : "partially_invoiced";
  return {
    delivery: {
      ...delivery, ...head, status: delivery.delivery_status, statusLabel: DELIVERY_STATUS_LABELS[delivery.delivery_status], shipment: SHIPMENT_LABELS[delivery.delivery_status],
      invoicing, invoicingLabel: { not_invoiced: "Not invoiced", partially_invoiced: "Partially invoiced", fully_invoiced: "Fully invoiced" }[invoicing],
      line_count: detailLines.length, total_quantity: round(totalQuantity), returned_quantity: round(totalQuantity - keptQuantity),
    },
    returns: returns.map((row) => ({ ...row, quantity: Number(row.quantity) })),
    lines: detailLines,
    invoices: invoices.rows,
    stockMovements: movements.rows,
    events: events.rows,
    cancelReasons: DELIVERY_CANCEL_REASONS,
    actions: availableActions(context, delivery, shipped && invoicedQuantity + EPSILON < keptQuantity, keptQuantity > EPSILON),
  };
}

const SORTS = Object.freeze({
  number: "delivery.request_number", created: "delivery.requested_at", dispatch: "delivery.dispatch_date", expected: "delivery.expected_delivery_date", customer: "customer_name",
  status: "delivery.delivery_status",
});

// filters: view, search, status, partyId, warehouseId, salesOrderId, carrier, ownerUserId, dispatchFrom, dispatchTo, expectedFrom, expectedTo, sort, direction, limit, offset
export async function listDeliveries(client, context, filters = {}) {
  requireDeliveryAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = deliveryScopeSql(context, values, "sales_order");
  const status = (...statuses) => ` AND delivery.delivery_status IN ('${statuses.join("','")}')`;
  switch (filters.view) {
    case "draft": where += status("draft"); break;
    case "ready": where += status("ready"); break;
    case "in_transit": where += status("dispatched"); break;
    case "delivered": where += status("delivered"); break;
    case "cancelled": where += status("cancelled"); break;
    case "mine": where += ` AND delivery.requested_by = ${bind(context.userId ?? null)}`; break;
    case "due_today": where += status("draft", "ready", "dispatched") + " AND delivery.expected_delivery_date = current_date"; break;
    case "overdue": where += status("draft", "ready", "dispatched") + " AND delivery.expected_delivery_date < current_date"; break;
    default: break;
  }
  if (Object.values(DELIVERY_STATUS).includes(filters.status)) where += ` AND delivery.delivery_status = ${bind(filters.status)}`;
  // Deliveries goods have left on: what a return can be made from.
  if (filters.shipped === "true") where += status("dispatched", "delivered");
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (delivery.request_number ILIKE ${term} OR sales_order.sales_order_number ILIKE ${term} OR delivery.customer_snapshot->>'displayName' ILIKE ${term}
      OR delivery.customer_po_number ILIKE ${term} OR delivery.tracking_number ILIKE ${term} OR delivery.carrier ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.sales_delivery_lines line WHERE line.organization_id = delivery.organization_id AND line.delivery_id = delivery.id
                  AND (line.item_name_snapshot ILIKE ${term} OR line.item_code_snapshot ILIKE ${term})))`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(requireUuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND delivery.party_id = ${p}`, "Customer");
  uuidFilter("warehouseId", (p) => ` AND delivery.warehouse_id = ${p}`, "Warehouse");
  uuidFilter("salesOrderId", (p) => ` AND delivery.sales_order_id = ${p}`, "Sales order");
  uuidFilter("ownerUserId", (p) => ` AND sales_order.owner_user_id = ${p}`, "Salesperson");
  if (text(filters.carrier, 120)) where += ` AND delivery.carrier ILIKE ${bind(`%${text(filters.carrier, 120)}%`)}`;
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dispatchFrom", (p) => ` AND delivery.dispatch_date >= ${p}::date`, "Dispatched from");
  dateFilter("dispatchTo", (p) => ` AND delivery.dispatch_date <= ${p}::date`, "Dispatched to");
  dateFilter("expectedFrom", (p) => ` AND delivery.expected_delivery_date >= ${p}::date`, "Expected from");
  dateFilter("expectedTo", (p) => ` AND delivery.expected_delivery_date <= ${p}::date`, "Expected to");
  const sort = SORTS[filters.sort] ?? SORTS.created;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_fulfillment_requests delivery
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = delivery.organization_id AND sales_order.id = delivery.sales_order_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = delivery.organization_id AND warehouse.id = delivery.warehouse_id
      WHERE delivery.organization_id = $1`;
  const countValues = [...values];
  const rows = (await client.query(
    `SELECT delivery.id, delivery.request_number AS delivery_number, delivery.delivery_status, delivery.sales_order_id, sales_order.sales_order_number, delivery.party_id,
            delivery.customer_snapshot->>'displayName' AS customer_name, warehouse.name AS warehouse_name, delivery.shipping_address_snapshot->>'city' AS ship_to_city,
            delivery.shipping_address_snapshot->>'label' AS ship_to_label, delivery.dispatch_date, delivery.expected_delivery_date, delivery.delivered_at, delivery.carrier,
            delivery.tracking_number, delivery.tracking_url, delivery.customer_po_number, delivery.requested_at,
            (SELECT count(*)::int FROM tenant.sales_delivery_lines line WHERE line.organization_id = delivery.organization_id AND line.delivery_id = delivery.id) AS line_count,
            (SELECT COALESCE(sum(line.quantity), 0) FROM tenant.sales_delivery_lines line WHERE line.organization_id = delivery.organization_id AND line.delivery_id = delivery.id) AS total_quantity,
            -- What the order lines on this delivery ordered: a partial delivery reads "6 of 10".
            (SELECT COALESCE(sum(line.ordered_quantity), 0) FROM tenant.sales_delivery_lines line WHERE line.organization_id = delivery.organization_id AND line.delivery_id = delivery.id) AS ordered_quantity
       ${from}${where}
      ORDER BY ${sort} ${direction} NULLS LAST, delivery.request_number DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const count = (await client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues)).rows[0].total;
  return {
    rows: rows.map((row) => ({ ...row, status: row.delivery_status, statusLabel: DELIVERY_STATUS_LABELS[row.delivery_status], shipment: SHIPMENT_LABELS[row.delivery_status] })),
    total: count, limit, offset, views: DELIVERY_VIEWS,
    capabilities: Object.fromEntries(Object.entries(DELIVERY_PERMISSIONS).map(([name, permission]) => [name, deliveryCan(context, permission)])),
  };
}

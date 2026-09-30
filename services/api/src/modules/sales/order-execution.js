import { getSalesOrder, previewSalesDocument, SalesError } from "./index.js";

// F041/F044/F048/F049: approval delegation, amendment impact, backorder
// promise dates and shipment/delivery evidence. Stock stays authoritative
// for stock itself; this only reads its reservations to explain impact.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SalesError(400, `${label} is invalid.`, "SALES_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const can = (c, permission) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission);
const need = (c, permission) => {
  if (!can(c, permission)) throw new SalesError(403, "You do not have permission to perform this Sales operation.");
};
async function event(client, c, entityType, entityId, eventType, status, metadata) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id) VALUES ($1,$2,$3,$4,$5,$5,$6::jsonb,$7)`,
    [c.organizationId, entityType, entityId, eventType, status, JSON.stringify(metadata), c.userId || null],
  );
}

// ---- F044 amendment impact --------------------------------------------------
// What an amendment would change before it is requested: line quantities and
// prices, the total, and what is already in flight downstream (stock
// reservations, open fulfilment/invoice requests) that blocks it.
export async function previewSalesOrderAmendmentImpact(client, c, orderId, input = {}) {
  need(c, "sales.order.create");
  const detail = await getSalesOrder(client, c, uuid(orderId, "Sales order"));
  const current = detail.order;
  const preview = await previewSalesDocument(client, c, input, { order: true });
  const keyOf = (line) => `${line.item_id ?? line.itemId}|${line.variant_id ?? line.variantId ?? ""}|${line.uom_id ?? line.uomId ?? ""}`;
  const before = new Map(detail.lines.map((line) => [keyOf(line), line]));
  const after = new Map(preview.lines.map((line) => [keyOf(line), line]));
  const lines = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key);
    const now = after.get(key);
    const change = !was ? "added" : !now ? "removed" : Number(was.quantity) !== Number(now.quantity) || Number(was.unit_price) !== Number(now.unitPrice) ? "changed" : "unchanged";
    lines.push({
      item: now?.itemNameSnapshot ?? was?.item_name_snapshot,
      unit: now?.uomSnapshot ?? was?.uom_snapshot,
      change,
      quantityBefore: was ? Number(was.quantity) : 0,
      quantityAfter: now ? Number(now.quantity) : 0,
      unitPriceBefore: was ? Number(was.unit_price) : null,
      unitPriceAfter: now ? Number(now.unitPrice) : null,
    });
  }
  const downstream = (
    await client.query(
      `SELECT
         (SELECT count(*) FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type='sales_order' AND reference_id=$2 AND status='active')::int AS active_reservations,
         (SELECT count(*) FROM tenant.sales_fulfillment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('pending','processing'))::int AS open_fulfilment_requests,
         (SELECT count(*) FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('pending','processing'))::int AS open_invoice_requests`,
      [c.organizationId, current.id],
    )
  ).rows[0];
  const blockers = [];
  if (downstream.active_reservations) blockers.push("Release the stock reserved for this order first; the amended lines are reserved again after approval.");
  if (downstream.open_fulfilment_requests) blockers.push("A fulfilment request is still open for this order.");
  if (downstream.open_invoice_requests) blockers.push("An invoice request is still open for this order.");
  const totalBefore = Number(current.grand_total);
  const totalAfter = Number(preview.totals.grandTotal);
  return {
    orderId: current.id,
    totalBefore,
    totalAfter,
    totalChange: Number((totalAfter - totalBefore).toFixed(2)),
    creditRecheck: totalAfter > totalBefore,
    approvalRequired: true,
    lines,
    downstream,
    blockers,
  };
}

// ---- F049 shipment and delivery evidence ----------------------------------------
export async function recordFulfillmentShipment(client, c, requestId, input = {}) {
  need(c, "sales.fulfillment.request");
  const id = uuid(requestId, "Fulfilment request");
  const carrier = text(input.carrier, 120);
  const trackingNumber = text(input.trackingNumber, 120);
  if (!carrier) throw new SalesError(400, "Carrier is required.", "SALES_SHIPMENT_CARRIER_REQUIRED");
  const shippedAt = input.shippedAt ? new Date(input.shippedAt) : new Date();
  if (Number.isNaN(shippedAt.getTime()) || shippedAt.getTime() > Date.now() + 60_000) throw new SalesError(400, "Shipped date is invalid.", "SALES_SHIPMENT_DATE_INVALID");
  const request = (await client.query(`SELECT id,sales_order_id,status,delivered_at FROM tenant.sales_fulfillment_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!request) throw new SalesError(404, "Fulfilment request not found.");
  if (request.status !== "completed") throw new SalesError(409, "Record the shipment after the warehouse has completed the fulfilment.", "SALES_SHIPMENT_NOT_PICKED");
  if (request.delivered_at) throw new SalesError(409, "This shipment is already delivered.");
  await client.query(
    `UPDATE tenant.sales_fulfillment_requests SET carrier=$3,tracking_number=NULLIF($4,''),shipped_at=$5 WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, carrier, trackingNumber, shippedAt],
  );
  await event(client, c, "sales_order", request.sales_order_id, "sales_order.shipped", "confirmed", { requestId: id, carrier, trackingNumber: trackingNumber || null, shippedAt });
  return { id, carrier, trackingNumber: trackingNumber || null, shippedAt };
}

export async function recordFulfillmentDelivery(client, c, requestId, input = {}) {
  need(c, "sales.fulfillment.request");
  const id = uuid(requestId, "Fulfilment request");
  const receivedBy = text(input.receivedBy, 160);
  if (!receivedBy) throw new SalesError(400, "Say who received the goods.", "SALES_DELIVERY_RECEIVER_REQUIRED");
  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : new Date();
  const request = (await client.query(`SELECT id,sales_order_id,shipped_at,delivered_at FROM tenant.sales_fulfillment_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!request) throw new SalesError(404, "Fulfilment request not found.");
  if (!request.shipped_at) throw new SalesError(409, "Record the shipment before the delivery.", "SALES_DELIVERY_NOT_SHIPPED");
  if (request.delivered_at) return { id, deliveredAt: request.delivered_at, replayed: true };
  if (Number.isNaN(deliveredAt.getTime()) || deliveredAt < new Date(request.shipped_at) || deliveredAt.getTime() > Date.now() + 60_000)
    throw new SalesError(400, "The delivery date must be after the shipment and not in the future.", "SALES_DELIVERY_DATE_INVALID");
  const note = text(input.note, 1000);
  await client.query(
    `UPDATE tenant.sales_fulfillment_requests SET delivered_at=$3,received_by=$4,delivery_note=NULLIF($5,'') WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, deliveredAt, receivedBy, note],
  );
  await event(client, c, "sales_order", request.sales_order_id, "sales_order.delivered", "confirmed", { requestId: id, receivedBy, deliveredAt, note: note || null });
  return { id, deliveredAt, receivedBy };
}

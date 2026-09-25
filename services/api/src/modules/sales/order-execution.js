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
const isoDate = (value, label) => {
  const day = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new SalesError(400, `${label} is invalid.`, "SALES_DATE_INVALID");
  return day;
};
const today = () => new Date().toISOString().slice(0, 10);
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

// ---- F041 approval delegation ------------------------------------------------
export async function listSalesApprovalDelegations(client, c) {
  need(c, "sales.view");
  const { rows } = await client.query(
    `SELECT delegation.id,delegation.delegator_user_id,delegator.full_name AS delegator_name,delegation.delegate_user_id,delegate.full_name AS delegate_name,
            delegation.starts_on::text AS starts_on,delegation.ends_on::text AS ends_on,delegation.reason,delegation.status,delegation.created_at,
            (delegation.status='active' AND delegation.starts_on<=current_date AND delegation.ends_on>=current_date) AS in_effect
       FROM tenant.sales_approval_delegations delegation
       JOIN public.users delegator ON delegator.id=delegation.delegator_user_id
       JOIN public.users delegate ON delegate.id=delegation.delegate_user_id
      WHERE delegation.organization_id=$1
      ORDER BY delegation.status, delegation.starts_on DESC`,
    [c.organizationId],
  );
  return rows;
}

// An approver delegates their own approvals; managing someone else's needs
// Sales settings rights. Overlapping active windows for one approver are refused
// so routing is never ambiguous.
export async function createSalesApprovalDelegation(client, c, input = {}) {
  const delegatorId = uuid(input.delegatorUserId || c.userId, "Approver");
  const delegateId = uuid(input.delegateUserId, "Delegate");
  if (delegatorId !== c.userId) need(c, "sales.settings.manage");
  else if (!can(c, "sales.quotation.approve") && !can(c, "sales.order.approve")) need(c, "sales.settings.manage");
  if (delegatorId === delegateId) throw new SalesError(400, "Choose someone other than the approver.", "SALES_DELEGATION_SELF");
  const startsOn = isoDate(input.startsOn, "Start date");
  const endsOn = isoDate(input.endsOn, "End date");
  if (startsOn > endsOn) throw new SalesError(400, "The end date must be on or after the start date.", "SALES_DELEGATION_DATES");
  if (endsOn < today()) throw new SalesError(400, "The delegation has already ended.", "SALES_DELEGATION_DATES");
  const reason = text(input.reason, 500);
  if (reason.length < 5) throw new SalesError(400, "Say why approvals are delegated (at least 5 characters).", "SALES_DELEGATION_REASON");
  const members = await client.query(
    `SELECT user_id FROM public.organization_memberships WHERE organization_id=$1 AND status='active' AND user_id = ANY($2::uuid[])`,
    [c.organizationId, [delegatorId, delegateId]],
  );
  if (members.rows.length !== 2) throw new SalesError(409, "Both people must be active members of this organisation.", "SALES_DELEGATION_MEMBER");
  const overlap = await client.query(
    `SELECT 1 FROM tenant.sales_approval_delegations WHERE organization_id=$1 AND delegator_user_id=$2 AND status='active' AND starts_on<=$4 AND ends_on>=$3 LIMIT 1`,
    [c.organizationId, delegatorId, startsOn, endsOn],
  );
  if (overlap.rows[0]) throw new SalesError(409, "This approver already has a delegation in that period.", "SALES_DELEGATION_OVERLAP");
  const { rows } = await client.query(
    `INSERT INTO tenant.sales_approval_delegations (organization_id,delegator_user_id,delegate_user_id,starts_on,ends_on,reason,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,starts_on::text AS starts_on,ends_on::text AS ends_on,status`,
    [c.organizationId, delegatorId, delegateId, startsOn, endsOn, reason, c.userId],
  );
  return rows[0];
}

export async function revokeSalesApprovalDelegation(client, c, delegationId) {
  const id = uuid(delegationId, "Delegation");
  const found = (await client.query(`SELECT delegator_user_id,status FROM tenant.sales_approval_delegations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!found) throw new SalesError(404, "Delegation not found.");
  if (found.delegator_user_id !== c.userId) need(c, "sales.settings.manage");
  if (found.status !== "active") return { id, status: found.status };
  await client.query(
    `UPDATE tenant.sales_approval_delegations SET status='revoked',revoked_by=$3,revoked_at=now() WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, c.userId],
  );
  return { id, status: "revoked" };
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

// ---- F048 backorder promise dates --------------------------------------------
export async function setSalesOrderLinePromise(client, c, input = {}) {
  need(c, "sales.fulfillment.request");
  const lineId = uuid(input.salesOrderLineId, "Sales order line");
  const promisedDate = isoDate(input.promisedDate, "Promised date");
  if (promisedDate < today()) throw new SalesError(400, "A promise date cannot be in the past.", "SALES_PROMISE_DATE_PAST");
  const note = text(input.note, 500);
  if (note.length < 5) throw new SalesError(400, "Say what the promise is based on (at least 5 characters).", "SALES_PROMISE_NOTE_REQUIRED");
  const line = (
    await client.query(
      `SELECT line.id,orders.id AS order_id,orders.lifecycle_status,
              line.quantity-progress.fulfilled_quantity-progress.cancelled_quantity AS open_quantity
         FROM tenant.sales_order_lines line
         JOIN tenant.sales_orders orders ON orders.organization_id=line.organization_id AND orders.current_version_id=line.sales_order_version_id
         JOIN tenant.sales_order_line_progress progress ON progress.organization_id=line.organization_id AND progress.sales_order_line_id=line.id
        WHERE line.organization_id=$1 AND line.id=$2 FOR UPDATE OF orders`,
      [c.organizationId, lineId],
    )
  ).rows[0];
  if (!line) throw new SalesError(404, "Sales order line not found in the current order version.");
  if (!["confirmed", "on_hold"].includes(line.lifecycle_status)) throw new SalesError(409, "Only open lines of a confirmed order can be promised.");
  if (Number(line.open_quantity) <= 0) throw new SalesError(409, "Nothing remains to deliver on this line.");
  const updated = await client.query(
    `UPDATE tenant.sales_order_schedules SET promised_date=$3,promise_note=$4,updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND sales_order_line_id=$2 AND sequence=1 RETURNING id`,
    [c.organizationId, lineId, promisedDate, note, c.userId],
  );
  if (!updated.rows[0])
    await client.query(
      `INSERT INTO tenant.sales_order_schedules (organization_id,sales_order_line_id,sequence,requested_date,promised_date,quantity,promise_note,updated_by) VALUES ($1,$2,1,$3,$3,$4,$5,$6)`,
      [c.organizationId, lineId, promisedDate, line.open_quantity, note, c.userId],
    );
  await event(client, c, "sales_order", line.order_id, "sales_order.line_promised", line.lifecycle_status, { salesOrderLineId: lineId, promisedDate, note, openQuantity: String(line.open_quantity) });
  return { salesOrderLineId: lineId, promisedDate, note };
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

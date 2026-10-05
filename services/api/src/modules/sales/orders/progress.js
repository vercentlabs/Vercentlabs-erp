// What has happened to a sales order downstream, worked out from the records
// that own it:
//   reserved   the active stock reservations made for each order line
//   delivered  the lines of the order's completed deliveries
//   invoiced   the lines of its valid customer invoices (draft or posted)
// Cancelled quantity is the order's own. Nobody types a delivered or an
// invoiced quantity on an order line; they are recalculated here each time
// something downstream changes, so the order can always be reconciled.
//
// From those quantities come the order's fulfilment status and invoice
// status, and the order closes itself when nothing is left to deliver or
// invoice (and reopens if an invoice or delivery is later undone).
import { FULFILLMENT, INVOICING, STATUS } from "./constants.js";

// A service is never delivered or reserved; a product that is not stock
// tracked is delivered but never reserved.
const LINES_SQL = `
  SELECT line.id, line.sequence, line.item_id, line.warehouse_id, line.quantity, line.conversion_factor, line.line_total, line.item_name_snapshot, line.uom_snapshot,
         item.item_type <> 'service' AS deliverable, COALESCE(item.track_inventory, false) AND item.item_type <> 'service' AS stock_tracked,
         progress.cancelled_quantity, progress.returned_quantity,
         COALESCE((SELECT sum(reservation.quantity) FROM tenant.stock_reservations reservation
                    WHERE reservation.organization_id = line.organization_id AND reservation.reference_type = 'sales_order_line' AND reservation.reference_id = line.id
                      AND reservation.status = 'active'), 0) / COALESCE(NULLIF(line.conversion_factor, 0), 1) AS reserved,
         COALESCE((SELECT sum(delivered.quantity) FROM tenant.sales_delivery_lines delivered
                     JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivered.delivery_id AND delivery.status = 'completed'
                    WHERE delivered.organization_id = line.organization_id AND delivered.sales_order_line_id = line.id), 0) AS delivered,
         COALESCE((SELECT sum(invoiced.quantity) FROM tenant.accounting_customer_invoice_lines invoiced
                     JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
                          AND invoice.status NOT IN ('cancelled', 'reversed')
                    WHERE invoiced.organization_id = line.organization_id AND invoiced.source_sales_order_line_id = line.id), 0) AS invoiced
    FROM tenant.sales_order_lines line
    JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
    JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
   WHERE line.organization_id = $1 AND line.sales_order_version_id = $2
   ORDER BY line.sequence`;

const number = (value) => Number(value ?? 0);
const EPSILON = 1e-6;

// The line quantities of an order version, as they stand now.
export async function loadOrderLineProgress(client, organizationId, versionId) {
  const { rows } = await client.query(LINES_SQL, [organizationId, versionId]);
  return rows.map((row) => {
    const ordered = number(row.quantity);
    const cancelled = number(row.cancelled_quantity);
    const delivered = number(row.delivered);
    const invoiced = number(row.invoiced);
    const open = Math.max(0, ordered - cancelled);
    return {
      lineId: row.id, sequence: row.sequence, itemId: row.item_id, itemName: row.item_name_snapshot, unit: row.uom_snapshot, warehouseId: row.warehouse_id,
      conversionFactor: number(row.conversion_factor) || 1, deliverable: Boolean(row.deliverable), stockTracked: Boolean(row.stock_tracked),
      ordered, cancelled, reserved: number(row.reserved), delivered, invoiced, returned: number(row.returned_quantity),
      // What can still be delivered and invoiced; never negative.
      remainingToDeliver: row.deliverable ? Math.max(0, open - delivered) : 0,
      remainingToInvoice: Math.max(0, open - invoiced),
      lineTotal: number(row.line_total),
    };
  });
}

export function fulfillmentOf(lines) {
  const deliverable = lines.filter((line) => line.deliverable);
  if (!deliverable.length) return { status: FULFILLMENT.delivered, deliverable: false, complete: true };
  const complete = deliverable.every((line) => line.remainingToDeliver <= EPSILON);
  if (complete) return { status: FULFILLMENT.delivered, deliverable: true, complete: true };
  if (deliverable.some((line) => line.delivered > EPSILON)) return { status: FULFILLMENT.partiallyDelivered, deliverable: true, complete: false };
  const tracked = deliverable.filter((line) => line.stockTracked && line.remainingToDeliver > EPSILON);
  if (tracked.length && tracked.every((line) => line.reserved + EPSILON >= line.remainingToDeliver)) return { status: FULFILLMENT.reserved, deliverable: true, complete: false };
  if (tracked.some((line) => line.reserved > EPSILON)) return { status: FULFILLMENT.partiallyReserved, deliverable: true, complete: false };
  return { status: FULFILLMENT.notStarted, deliverable: true, complete: false };
}

export function invoicingOf(lines) {
  const complete = lines.every((line) => line.remainingToInvoice <= EPSILON);
  const any = lines.some((line) => line.invoiced > EPSILON);
  return { status: complete && any ? INVOICING.fullyInvoiced : any ? INVOICING.partiallyInvoiced : INVOICING.notInvoiced, complete: complete && any };
}

// Recalculates an order's line quantities and statuses. Called after a
// confirmation, reservation, release, delivery, invoice or cancellation.
// Returns { lines, fulfillmentStatus, billingStatus, lifecycleStatus }.
export async function refreshSalesOrderProgress(client, organizationId, orderId, actorUserId = null) {
  const order = (await client.query(
    `SELECT id, current_version_id, lifecycle_status, fulfillment_status, billing_status FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [organizationId, orderId])).rows[0];
  if (!order) return null;
  const lines = await loadOrderLineProgress(client, organizationId, order.current_version_id);
  for (const line of lines)
    await client.query(
      `UPDATE tenant.sales_order_line_progress SET reserved_quantity = $3, fulfilled_quantity = $4, invoiced_quantity = $5, updated_by = COALESCE($6, updated_by), updated_at = now()
        WHERE organization_id = $1 AND sales_order_line_id = $2 AND (reserved_quantity, fulfilled_quantity, invoiced_quantity) IS DISTINCT FROM ($3::numeric, $4::numeric, $5::numeric)`,
      [organizationId, line.lineId, line.reserved, line.delivered, line.invoiced, actorUserId]);
  if (![STATUS.confirmed, STATUS.closed].includes(order.lifecycle_status))
    return { lines, fulfillmentStatus: order.fulfillment_status, billingStatus: order.billing_status, lifecycleStatus: order.lifecycle_status };

  const fulfillment = fulfillmentOf(lines);
  const invoicing = invoicingOf(lines);
  // Nothing left to deliver or invoice: the order is done. Something was
  // delivered or invoiced, so an order whose every line was cancelled is not "closed" here.
  const done = fulfillment.complete && invoicing.complete;
  const lifecycleStatus = done ? STATUS.closed : STATUS.confirmed;
  if (fulfillment.status !== order.fulfillment_status || invoicing.status !== order.billing_status || lifecycleStatus !== order.lifecycle_status) {
    await client.query(
      `UPDATE tenant.sales_orders
          SET fulfillment_status = $3, billing_status = $4, lifecycle_status = $5,
              closed_at = CASE WHEN $5 = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
              closed_by = CASE WHEN $5 = 'closed' THEN COALESCE(closed_by, $6) ELSE NULL END,
              updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, order.id, fulfillment.status, invoicing.status, lifecycleStatus, actorUserId]);
    if (lifecycleStatus !== order.lifecycle_status)
      await client.query(
        `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
         VALUES ($1, 'sales_order', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
        [organizationId, order.id, done ? "sales_order.closed" : "sales_order.reopened_for_work", order.lifecycle_status, lifecycleStatus,
          JSON.stringify(done ? { reason: "Nothing left to deliver or invoice." } : { reason: "A delivery or invoice was undone." }), actorUserId]);
  }
  return { lines, fulfillmentStatus: fulfillment.status, billingStatus: invoicing.status, lifecycleStatus, deliverable: fulfillment.deliverable };
}

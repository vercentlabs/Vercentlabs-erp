// Deliveries not yet dispatched follow their order: when the order is
// reopened to Draft or cancelled, they are cancelled with it (nothing has
// left the warehouse, so nothing needs returning).
import { DELIVERY_CANCEL_REASONS } from "./constants.js";

// Cancels every Draft and Ready delivery of the order. Returns their numbers.
export async function cancelOpenDeliveriesForOrder(client, context, orderId, reasonCode, reason) {
  const label = [DELIVERY_CANCEL_REASONS.find((entry) => entry.code === reasonCode)?.label, reason].filter(Boolean).join(": ");
  const { rows } = await client.query(
    `WITH open AS (
       SELECT id, delivery_status FROM tenant.sales_fulfillment_requests
        WHERE organization_id = $1 AND sales_order_id = $2 AND delivery_status IN ('draft', 'ready') FOR UPDATE)
     UPDATE tenant.sales_fulfillment_requests delivery
        SET delivery_status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason_code = $4, cancel_reason = $5, version = delivery.version + 1
       FROM open WHERE delivery.organization_id = $1 AND delivery.id = open.id
     RETURNING delivery.id, delivery.request_number, open.delivery_status AS from_status`,
    [context.organizationId, orderId, context.userId ?? null, reasonCode, label]);
  for (const row of rows)
    await client.query(
      `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
       VALUES ($1, 'fulfillment_request', $2, 'sales_delivery.cancelled', $3, 'cancelled', $4::jsonb, $5, clock_timestamp())`,
      [context.organizationId, row.id, row.from_status, JSON.stringify({ reasonCode, reason: label, automatic: true }), context.userId ?? null]);
  return rows.map((row) => row.request_number);
}

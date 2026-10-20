// Quality — Inspection Linked to Delivery: the command of its own (the rest is the shared engine in ../incoming).
//   request   an authorized manual inspection of an exact delivery line before dispatch (a customer complaint, a sensitive shipment): bound to
//             the pre-dispatch specification in force for the item, once per request; it records evidence and restricts nothing by itself.
import { recordEvent } from "../common.js";
import { createInspection } from "../inspections.js";
import { ensureMirrorPlan, specificationForSource } from "../specifications/qs-resolver.js";
import { DP, inError, need, text, uuid } from "../incoming/in-rules.js";
import { insertDispatchContext } from "./pd-engine.js";

// input: { deliveryLineId, quantity?, reason, priority?, idempotencyKey? }
export async function requestDispatchInspection(client, c, input = {}) {
  need(c, DP.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_inspections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, `pdmanual:${key}`])).rows[0];
    if (prior) return { id: prior.id, replayed: true };
  }
  const line = (await client.query(`SELECT line.*, d.request_number, d.sales_order_id, d.party_id, d.delivery_status, o.sales_order_number, p.display_name AS customer_name
      FROM tenant.sales_delivery_lines line JOIN tenant.sales_fulfillment_requests d ON d.id = line.delivery_id JOIN tenant.sales_orders o ON o.id = d.sales_order_id
      LEFT JOIN tenant.business_parties p ON p.id = d.party_id WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, uuid(input.deliveryLineId, "Delivery line")])).rows[0];
  if (!line) throw inError(400, "QUALITY_DISPATCH_DELIVERY_INVALID");
  if (!["draft", "ready"].includes(line.delivery_status)) throw inError(409, "QUALITY_DISPATCH_DELIVERY_INVALID", `${line.request_number} was already dispatched or cancelled.`);
  const reason = text(input.reason, 1000);
  if (!reason) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say why the delivery is inspected.");
  const total = Number(line.base_quantity ?? line.quantity);
  const quantity = input.quantity === undefined || input.quantity === null || input.quantity === "" ? total : Number(input.quantity);
  if (!(quantity > 0) || quantity > total + 1e-9) throw inError(400, "QUALITY_DISPATCH_QUANTITY_MISMATCH", `Inspect between 1 and the ${total} units on the delivery line.`);
  const found = await specificationForSource(client, c, { stage: "PRE_DISPATCH", itemId: line.item_id, supplierId: null, warehouseId: line.warehouse_id, date: new Date().toISOString().slice(0, 10),
    quantity: String(quantity), sourceType: "sales_delivery_line", sourceId: line.delivery_id, sourceLineId: line.sales_order_line_id, sourceLabel: `${line.request_number} · ${line.item_name_snapshot}` });
  if (found.status !== "RESOLVED") throw inError(409, "QUALITY_DISPATCH_SPEC_MISSING");
  const planId = found.planId ?? await ensureMirrorPlan(client, c, found.versionId);
  const created = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: "pre_dispatch", sourceType: "sales_delivery", sourceId: line.delivery_id, itemId: line.item_id, warehouseId: line.warehouse_id,
    lotQuantity: String(quantity), priority: input.priority, specResolution: { ...found.resolution, manual: true, reason },
    population: { controlled: String(quantity), manual: true, delivery: line.request_number, order: line.sales_order_number },
  }, { boundVersionId: found.versionId, allowPendingSample: true });
  const delivery = { id: line.delivery_id, request_number: line.request_number, sales_order_id: line.sales_order_id, sales_order_number: line.sales_order_number, party_id: line.party_id,
    customer_name: line.customer_name };
  await insertDispatchContext(client, c, created.id, { delivery, line, quantity, checkpoint: "MANUAL", key: `pdmanual:${key ?? created.id}` });
  if (key) await client.query(`UPDATE tenant.quality_inspections SET idempotency_key = $2 WHERE id = $1`, [created.id, `pdmanual:${key}`]);
  await recordEvent(client, c, "inspection", created.id, "quality.dispatch.created_manually", { reason, delivery: line.request_number });
  return { id: created.id };
}

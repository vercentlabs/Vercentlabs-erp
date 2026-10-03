import { MfgError, need, nonNegative, positive, recordEvent, text, uuid } from "./common.js";
import { recordScrap } from "./shopfloor.js";

async function loadOrder(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Work order")]);
  if (!rows[0]) throw new MfgError(404, "Work order was not found.", "MFG_WORK_ORDER_NOT_FOUND");
  return rows[0];
}
// ---------------------------------------------------------------- production hold (F182)
export async function holdProductionOrder(client, c, id, reason) {
  need(c, "manufacturing.work_order.manage");
  const wo = await loadOrder(client, c, id, { lock: true });
  if (!["released", "in_progress"].includes(wo.status)) throw new MfgError(409, `A ${wo.status} work order cannot be put on hold.`, "MFG_WORK_ORDER_STATE_INVALID");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to hold a work order.", "MFG_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET status='on_hold',held_from_status=$3,hold_reason=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, wo.status, text(reason, 1000)]);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.held", { reason: text(reason, 1000) });
  return rows[0];
}

export async function resumeProductionOrder(client, c, id, note) {
  need(c, "manufacturing.work_order.manage");
  const wo = await loadOrder(client, c, id, { lock: true });
  if (wo.status !== "on_hold") throw new MfgError(409, "Only a work order on hold can be resumed.", "MFG_WORK_ORDER_STATE_INVALID");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET status=COALESCE(held_from_status,'released'),hold_reason=NULL,held_from_status=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id]);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.resumed", { note: text(note, 500) });
  return rows[0];
}

// ---------------------------------------------------------------- inspections (F181)
// An inspection of the production order's output. A failed inspection can scrap the rejected units or
// put the order on hold.
export async function recordInspection(client, c, workOrderId, input = {}) {
  need(c, "manufacturing.production.post");
  const wo = await loadOrder(client, c, workOrderId, { lock: true });
  if (!["released", "in_progress", "on_hold"].includes(wo.status)) throw new MfgError(409, `A ${wo.status} work order cannot be inspected.`, "MFG_WORK_ORDER_STATE_INVALID");
  const inspected = positive(input.quantityInspected, "Quantity inspected");
  const rejected = nonNegative(input.quantityRejected, "Quantity rejected");
  if (rejected > inspected) throw new MfgError(400, "Rejected quantity cannot exceed the quantity inspected.", "MFG_QUANTITY_INVALID");
  let operationId = null;
  if (input.operationId) {
    const op = (await client.query(`SELECT id FROM tenant.manufacturing_work_order_operations WHERE organization_id=$1 AND work_order_id=$2 AND id=$3`, [c.organizationId, wo.id, uuid(input.operationId, "Operation")])).rows[0];
    if (!op) throw new MfgError(404, "Operation was not found on this work order.", "MFG_OPERATION_NOT_FOUND");
    operationId = op.id;
  }
  const result = rejected > 0 ? "fail" : "pass";
  const followUp = result === "fail" && ["scrap", "hold"].includes(input.followUp) ? input.followUp : "none";
  if (result === "fail" && !text(input.defectCode, 80)) throw new MfgError(400, "Name the defect for a failed inspection.", "MFG_DEFECT_REQUIRED");
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_inspections(organization_id,work_order_id,operation_id,quantity_inspected,quantity_rejected,result,defect_code,notes,follow_up,inspected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, wo.id, operationId, inspected, rejected, result, text(input.defectCode, 80) || null, text(input.notes, 1000) || null, followUp, c.userId],
  );
  if (followUp === "scrap") await recordScrap(client, c, wo.id, { scope: "product", quantity: rejected, category: "scrap", reasonCode: "defect", note: `Inspection: ${text(input.defectCode, 80)}`, operationId });
  if (followUp === "hold" && wo.status !== "on_hold") await holdProductionOrder(client, c, wo.id, `Failed inspection: ${text(input.defectCode, 80)}`);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.inspection.recorded", { result, rejected });
  return rows[0];
}

export async function listManufacturingInspections(client, c, { limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT i.id,i.result,i.quantity_inspected::text AS quantity_inspected,i.quantity_rejected::text AS quantity_rejected,i.defect_code,i.notes,i.follow_up,i.created_at,wo.id AS work_order_id,wo.work_order_number,item.code AS item_code,op.sequence,op.name AS operation_name
       FROM tenant.manufacturing_inspections i JOIN tenant.manufacturing_work_orders wo ON wo.id=i.work_order_id JOIN tenant.items item ON item.id=wo.item_id LEFT JOIN tenant.manufacturing_work_order_operations op ON op.id=i.operation_id
      WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT $2`,
    [c.organizationId, Math.min(Math.max(Number(limit) || 250, 1), 500)],
  );
  return rows;
}


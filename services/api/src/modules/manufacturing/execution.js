import { createMaintenanceOrder } from "../assets/index.js";
import { MfgError, has, need, nonNegative, positive, recordEvent, text, uuid } from "./common.js";
import { completeOperation, issueMaterials, recordScrap } from "./shopfloor.js";

// Execution controls around the shop floor: time (F169-F171), production hold (F182), quality
// inspections (F181), downtime with maintenance requests (F188, F189) and subcontracting (F180).
const round = (n) => Math.round(n * 1e6) / 1e6;
const seeCost = (c) => has(c, "manufacturing.costing.view");

async function loadOrder(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Work order")]);
  if (!rows[0]) throw new MfgError(404, "Work order was not found.", "MFG_WORK_ORDER_NOT_FOUND");
  return rows[0];
}
async function loadOperation(client, c, id) {
  const op = (await client.query(`SELECT op.*,wo.status AS wo_status,wo.company_id FROM tenant.manufacturing_work_order_operations op JOIN tenant.manufacturing_work_orders wo ON wo.id=op.work_order_id WHERE op.organization_id=$1 AND wo.company_id=$2 AND op.id=$3 FOR UPDATE OF op`, [c.organizationId, c.companyId, uuid(id, "Operation")])).rows[0];
  if (!op) throw new MfgError(404, "Operation was not found.", "MFG_OPERATION_NOT_FOUND");
  return op;
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

// ---------------------------------------------------------------- time (F169, F170, F171)
// Labour and setup are costed at the work center's hourly rate, machine time at its overhead
// (machine-hour) rate. Once an operation has time entries, THEY are its cost -- completing it does
// not book a second, estimated cost.
const ENTRY_TYPES = ["labor", "machine", "setup"];

async function priceEntry(client, c, op, entryType, minutes) {
  const center = op.work_center_id ? (await client.query(`SELECT hourly_rate,overhead_rate FROM tenant.manufacturing_work_centers WHERE id=$1`, [op.work_center_id])).rows[0] : null;
  const rate = Number(entryType === "machine" ? center?.overhead_rate ?? 0 : center?.hourly_rate ?? 0);
  return { rate, cost: round((minutes / 60) * rate) };
}
async function bookCost(client, c, workOrderId, entryType, cost) {
  const column = entryType === "machine" ? "overhead_cost" : "labor_cost";
  await client.query(`UPDATE tenant.manufacturing_work_orders SET ${column}=${column}+$2,updated_at=now() WHERE id=$1`, [workOrderId, cost]);
}

export async function logTime(client, c, operationId, input = {}) {
  need(c, "manufacturing.production.post");
  const op = await loadOperation(client, c, operationId);
  if (!["released", "in_progress"].includes(op.wo_status)) throw new MfgError(409, `The work order is ${op.wo_status}.`, "MFG_WORK_ORDER_STATE_INVALID");
  if (!["in_progress"].includes(op.status)) throw new MfgError(409, "Time can only be logged against an operation that has been started.", "MFG_OPERATION_STATE_INVALID");
  const entryType = String(input.entryType || "labor");
  if (!ENTRY_TYPES.includes(entryType)) throw new MfgError(400, "Entry type must be labor, machine or setup.", "MFG_ENTRY_TYPE_INVALID");
  const minutes = positive(input.minutes, "Minutes");
  if (minutes > 24 * 60) throw new MfgError(400, "A single entry cannot exceed 24 hours.", "MFG_QUANTITY_INVALID");
  const { rate, cost } = await priceEntry(client, c, op, entryType, minutes);
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_time_entries(organization_id,company_id,work_order_id,operation_id,work_center_id,entry_type,operator_label,user_id,started_at,ended_at,minutes,rate,cost,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()-($9::numeric*interval '1 minute'),now(),$9::numeric,$10,$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, op.work_order_id, op.id, op.work_center_id, entryType, text(input.operatorLabel, 120) || null, c.userId, minutes, rate, cost, text(input.note, 500) || null],
  );
  await bookCost(client, c, op.work_order_id, entryType, cost);
  return { ...rows[0], cost: seeCost(c) ? rows[0].cost : null, rate: seeCost(c) ? rows[0].rate : null };
}

export async function startTimer(client, c, operationId, input = {}) {
  need(c, "manufacturing.production.post");
  const op = await loadOperation(client, c, operationId);
  if (op.status !== "in_progress" || op.wo_status !== "in_progress") throw new MfgError(409, "A timer runs against a started operation of an in-progress work order.", "MFG_OPERATION_STATE_INVALID");
  const entryType = String(input.entryType || "labor");
  if (!ENTRY_TYPES.includes(entryType)) throw new MfgError(400, "Entry type must be labor, machine or setup.", "MFG_ENTRY_TYPE_INVALID");
  const open = (await client.query(`SELECT 1 FROM tenant.manufacturing_time_entries WHERE organization_id=$1 AND operation_id=$2 AND entry_type=$3 AND ended_at IS NULL AND user_id=$4`, [c.organizationId, op.id, entryType, c.userId])).rows[0];
  if (open) throw new MfgError(409, "You already have a running timer of that type on this operation.", "MFG_TIMER_RUNNING");
  const { rows } = await client.query(`INSERT INTO tenant.manufacturing_time_entries(organization_id,company_id,work_order_id,operation_id,work_center_id,entry_type,operator_label,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [c.organizationId, c.companyId, op.work_order_id, op.id, op.work_center_id, entryType, text(input.operatorLabel, 120) || null, c.userId]);
  return rows[0];
}

export async function stopTimer(client, c, entryId) {
  need(c, "manufacturing.production.post");
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_time_entries WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(entryId, "Time entry")])).rows[0];
  if (!entry) throw new MfgError(404, "Time entry was not found.", "MFG_ENTRY_NOT_FOUND");
  if (entry.ended_at) throw new MfgError(409, "That timer has already been stopped.", "MFG_TIMER_STOPPED");
  if (entry.user_id !== c.userId && !has(c, "manufacturing.work_order.manage")) throw new MfgError(403, "Only the person who started a timer (or a planner) can stop it.", "MFG_FORBIDDEN");
  const minutes = Math.max(round((Date.now() - new Date(entry.started_at).getTime()) / 60000), 0.01);
  const op = await loadOperation(client, c, entry.operation_id);
  const { rate, cost } = await priceEntry(client, c, op, entry.entry_type, minutes);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_time_entries SET ended_at=now(),minutes=$2,rate=$3,cost=$4 WHERE id=$1 RETURNING *`, [entry.id, minutes, rate, cost]);
  await bookCost(client, c, entry.work_order_id, entry.entry_type, cost);
  return { ...rows[0], cost: seeCost(c) ? rows[0].cost : null, rate: seeCost(c) ? rows[0].rate : null };
}

export async function listTimeEntries(client, c, { workOrderId = null, limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (workOrderId) { values.push(uuid(workOrderId, "Work order")); filter = ` AND t.work_order_id=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT t.id,t.entry_type,t.operator_label,t.started_at,t.ended_at,t.minutes::text AS minutes,t.rate::text AS rate,t.cost::text AS cost,t.note,wo.id AS work_order_id,wo.work_order_number,op.sequence,op.name AS operation_name,wc.name AS work_center_name
       FROM tenant.manufacturing_time_entries t JOIN tenant.manufacturing_work_orders wo ON wo.id=t.work_order_id JOIN tenant.manufacturing_work_order_operations op ON op.id=t.operation_id LEFT JOIN tenant.manufacturing_work_centers wc ON wc.id=t.work_center_id
      WHERE t.organization_id=$1 AND t.company_id=$2${filter} ORDER BY t.started_at DESC LIMIT $${values.length}`,
    values,
  );
  return seeCost(c) ? rows : rows.map((r) => ({ ...r, rate: null, cost: null }));
}

// ---------------------------------------------------------------- inspections (F181)
// An operation flagged "inspection required" cannot be completed until a passing inspection of it is
// recorded. A failed inspection can scrap the rejected units or put the order on hold.
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
    `INSERT INTO tenant.manufacturing_inspections(organization_id,company_id,work_order_id,operation_id,quantity_inspected,quantity_rejected,result,defect_code,notes,follow_up,inspected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, wo.id, operationId, inspected, rejected, result, text(input.defectCode, 80) || null, text(input.notes, 1000) || null, followUp, c.userId],
  );
  if (followUp === "scrap") await recordScrap(client, c, wo.id, { scope: "product", quantity: rejected, category: "scrap", reasonCode: "defect", note: `Inspection: ${text(input.defectCode, 80)}`, operationId });
  if (followUp === "hold" && wo.status !== "on_hold") await holdProductionOrder(client, c, wo.id, `Failed inspection: ${text(input.defectCode, 80)}`);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.inspection.recorded", { result, rejected });
  return rows[0];
}

// Used by operation completion: is the inspection this operation needs on record and passed?
export async function operationInspectionSatisfied(client, c, operationId) {
  const latest = (await client.query(`SELECT result FROM tenant.manufacturing_inspections WHERE organization_id=$1 AND operation_id=$2 ORDER BY created_at DESC LIMIT 1`, [c.organizationId, operationId])).rows[0];
  return latest?.result === "pass";
}

export async function listInspections(client, c, { limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT i.id,i.result,i.quantity_inspected::text AS quantity_inspected,i.quantity_rejected::text AS quantity_rejected,i.defect_code,i.notes,i.follow_up,i.created_at,wo.id AS work_order_id,wo.work_order_number,item.code AS item_code,op.sequence,op.name AS operation_name
       FROM tenant.manufacturing_inspections i JOIN tenant.manufacturing_work_orders wo ON wo.id=i.work_order_id JOIN tenant.items item ON item.id=wo.item_id LEFT JOIN tenant.manufacturing_work_order_operations op ON op.id=i.operation_id
      WHERE i.organization_id=$1 AND i.company_id=$2 ORDER BY i.created_at DESC LIMIT $3`,
    [c.organizationId, c.companyId, Math.min(Math.max(Number(limit) || 250, 1), 500)],
  );
  return rows;
}

// ---------------------------------------------------------------- downtime (F188) and maintenance (F189)
export const DOWNTIME_REASONS = ["breakdown", "changeover", "no_material", "no_operator", "quality_issue", "planned_maintenance", "power_outage", "other"];

export async function startDowntime(client, c, input = {}) {
  need(c, "manufacturing.production.post");
  const centerId = uuid(input.workCenterId, "Work center");
  const center = (await client.query(`SELECT id,code,name,status,asset_id FROM tenant.manufacturing_work_centers WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, centerId])).rows[0];
  if (!center) throw new MfgError(404, "Work center was not found.", "MFG_WORK_CENTER_NOT_FOUND");
  if (!DOWNTIME_REASONS.includes(String(input.reasonCode))) throw new MfgError(400, `Reason must be one of: ${DOWNTIME_REASONS.join(", ")}.`, "MFG_REASON_CODE_INVALID");
  const category = input.category === "planned" ? "planned" : "unplanned";
  const running = (await client.query(`SELECT 1 FROM tenant.manufacturing_downtime_events WHERE organization_id=$1 AND work_center_id=$2 AND ended_at IS NULL`, [c.organizationId, center.id])).rows[0];
  if (running) throw new MfgError(409, "This work center already has downtime running; end it first.", "MFG_DOWNTIME_RUNNING");
  let maintenanceOrderId = null;
  if (input.requestMaintenance === true) {
    if (!center.asset_id) throw new MfgError(409, "This work center is not linked to an asset, so a maintenance request cannot be raised. Link one on the work center.", "MFG_NO_ASSET");
    const order = await createMaintenanceOrder(client, { organizationId: c.organizationId, companyId: c.companyId, userId: c.userId, permissions: ["assets.maintain"], roleSlugs: [] }, center.asset_id, { maintenanceType: category === "unplanned" ? "corrective" : "preventive", priority: input.reasonCode === "breakdown" ? "high" : "normal" });
    maintenanceOrderId = order.id;
  }
  const stop = input.stopWorkCenter === true && center.status === "active";
  if (stop) await client.query(`UPDATE tenant.manufacturing_work_centers SET status='maintenance',updated_at=now() WHERE id=$1`, [center.id]);
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_downtime_events(organization_id,company_id,work_center_id,work_order_id,category,reason_code,note,stopped_work_center,maintenance_order_id,logged_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, center.id, input.workOrderId ? uuid(input.workOrderId, "Work order") : null, category, input.reasonCode, text(input.note, 1000) || null, stop, maintenanceOrderId, c.userId],
  );
  await recordEvent(client, c, "work_center", center.id, "manufacturing.downtime.started", { reason: input.reasonCode, maintenanceOrderId });
  return rows[0];
}

export async function endDowntime(client, c, id) {
  need(c, "manufacturing.production.post");
  const event = (await client.query(`SELECT * FROM tenant.manufacturing_downtime_events WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Downtime")])).rows[0];
  if (!event) throw new MfgError(404, "Downtime event was not found.", "MFG_DOWNTIME_NOT_FOUND");
  if (event.ended_at) throw new MfgError(409, "This downtime has already ended.", "MFG_DOWNTIME_ENDED");
  const minutes = Math.max(round((Date.now() - new Date(event.started_at).getTime()) / 60000), 0.01);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_downtime_events SET ended_at=now(),minutes=$2 WHERE id=$1 RETURNING *`, [event.id, minutes]);
  if (event.stopped_work_center) await client.query(`UPDATE tenant.manufacturing_work_centers SET status='active',updated_at=now() WHERE id=$1 AND status='maintenance'`, [event.work_center_id]);
  return rows[0];
}

export async function listDowntime(client, c, { openOnly = false } = {}) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT d.id,d.category,d.reason_code,d.note,d.started_at,d.ended_at,d.minutes::text AS minutes,d.stopped_work_center,d.maintenance_order_id,wc.code AS work_center_code,wc.name AS work_center_name,
            amo.work_order_number AS maintenance_number,amo.status AS maintenance_status
       FROM tenant.manufacturing_downtime_events d JOIN tenant.manufacturing_work_centers wc ON wc.id=d.work_center_id LEFT JOIN tenant.asset_maintenance_orders amo ON amo.id=d.maintenance_order_id
      WHERE d.organization_id=$1 AND d.company_id=$2 ${openOnly ? "AND d.ended_at IS NULL" : ""} ORDER BY d.started_at DESC LIMIT 300`,
    [c.organizationId, c.companyId],
  );
  return rows;
}

// Downtime by reason (a Pareto) over a period: what stops the plant, ranked.
export async function getDowntimeSummary(client, c, { days = 30 } = {}) {
  need(c, "manufacturing.view");
  const span = Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 365);
  const { rows } = await client.query(
    `SELECT reason_code,category,count(*)::int AS events,COALESCE(sum(COALESCE(minutes,EXTRACT(EPOCH FROM (now()-started_at))/60)),0)::numeric(12,1)::text AS minutes
       FROM tenant.manufacturing_downtime_events WHERE organization_id=$1 AND company_id=$2 AND started_at>=now()-($3||' days')::interval GROUP BY reason_code,category ORDER BY sum(COALESCE(minutes,EXTRACT(EPOCH FROM (now()-started_at))/60)) DESC`,
    [c.organizationId, c.companyId, span],
  );
  const total = rows.reduce((t, r) => t + Number(r.minutes), 0);
  let running = 0;
  return { days: span, totalMinutes: String(round(total)), reasons: rows.map((r) => { running += Number(r.minutes); return { ...r, share: total ? Math.round((Number(r.minutes) / total) * 100) : 0, cumulative: total ? Math.round((running / total) * 100) : 0 }; }) };
}

export async function linkWorkCenterAsset(client, c, workCenterId, assetId) {
  need(c, "manufacturing.routing.manage");
  const id = uuid(workCenterId, "Work center");
  if (assetId) {
    const asset = (await client.query(`SELECT id FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(assetId, "Asset")])).rows[0];
    if (!asset) throw new MfgError(404, "Asset was not found for the active company.", "MFG_ASSET_NOT_FOUND");
  }
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_centers SET asset_id=$3,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$4 RETURNING *`, [c.organizationId, c.companyId, assetId || null, id]);
  if (!rows[0]) throw new MfgError(404, "Work center was not found.", "MFG_WORK_CENTER_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------- subcontracting (F180)
export async function sendToSubcontractor(client, c, operationId, input = {}) {
  need(c, "manufacturing.production.post");
  const op = await loadOperation(client, c, operationId);
  if (!["released", "in_progress"].includes(op.wo_status)) throw new MfgError(409, `The work order is ${op.wo_status}.`, "MFG_WORK_ORDER_STATE_INVALID");
  const routingOp = op.routing_operation_id ? (await client.query(`SELECT subcontracted FROM tenant.manufacturing_routing_operations WHERE id=$1`, [op.routing_operation_id])).rows[0] : null;
  if (!routingOp?.subcontracted) throw new MfgError(409, "Only an operation defined as subcontracted can be sent out.", "MFG_NOT_SUBCONTRACTED");
  if (op.status !== "ready") throw new MfgError(409, op.status === "pending" ? "An earlier operation must be completed first." : `This operation is ${op.status}.`, "MFG_OPERATION_STATE_INVALID");
  if (!text(input.supplierLabel, 200)) throw new MfgError(400, "Name the subcontractor.", "MFG_SUPPLIER_REQUIRED");
  const lines = Array.isArray(input.materials) ? input.materials.filter((l) => Number(l.quantity) > 0) : [];
  if (lines.length) await issueMaterials(client, c, op.work_order_id, { lines, idempotencyKey: input.idempotencyKey ? `sub:${input.idempotencyKey}` : undefined });
  await client.query(`UPDATE tenant.manufacturing_work_order_operations SET status='in_progress',started_at=now(),started_by=$3 WHERE organization_id=$1 AND id=$2`, [c.organizationId, op.id, c.userId]);
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_subcontract_jobs(organization_id,company_id,work_order_id,operation_id,supplier_label,expected_return,note,sent_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, c.companyId, op.work_order_id, op.id, text(input.supplierLabel, 200), input.expectedReturn ? String(input.expectedReturn).slice(0, 10) : null, text(input.note, 500) || null, c.userId],
  );
  await recordEvent(client, c, "work_order", op.work_order_id, "manufacturing.subcontract.sent", { supplier: text(input.supplierLabel, 200) });
  return rows[0];
}

export async function receiveFromSubcontractor(client, c, jobId, input = {}) {
  need(c, "manufacturing.production.post");
  const job = (await client.query(`SELECT * FROM tenant.manufacturing_subcontract_jobs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(jobId, "Subcontract job")])).rows[0];
  if (!job) throw new MfgError(404, "Subcontract job was not found.", "MFG_JOB_NOT_FOUND");
  if (job.status !== "sent") throw new MfgError(409, `This job is ${job.status}.`, "MFG_JOB_STATE_INVALID");
  const cost = nonNegative(input.cost, "Subcontract cost");
  const good = nonNegative(input.quantityGood, "Good quantity");
  await completeOperation(client, c, job.operation_id, { actualMinutes: 0, quantityGood: good });
  await client.query(`UPDATE tenant.manufacturing_work_orders SET subcontract_cost=subcontract_cost+$2,updated_at=now() WHERE id=$1`, [job.work_order_id, cost]);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_subcontract_jobs SET status='received',received_at=now(),quantity_good=$2,cost=$3,received_by=$4,note=COALESCE(NULLIF($5,''),note) WHERE id=$1 RETURNING *`, [job.id, good, cost, c.userId, text(input.note, 500)]);
  await recordEvent(client, c, "work_order", job.work_order_id, "manufacturing.subcontract.received", { cost });
  return { ...rows[0], cost: seeCost(c) ? rows[0].cost : null };
}

export async function listSubcontractJobs(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT j.id,j.supplier_label,j.status,j.sent_at,j.expected_return,j.received_at,j.quantity_good::text AS quantity_good,j.cost::text AS cost,j.note,wo.id AS work_order_id,wo.work_order_number,item.code AS item_code,op.sequence,op.name AS operation_name
       FROM tenant.manufacturing_subcontract_jobs j JOIN tenant.manufacturing_work_orders wo ON wo.id=j.work_order_id JOIN tenant.items item ON item.id=wo.item_id JOIN tenant.manufacturing_work_order_operations op ON op.id=j.operation_id
      WHERE j.organization_id=$1 AND j.company_id=$2 ORDER BY j.sent_at DESC LIMIT 300`,
    [c.organizationId, c.companyId],
  );
  return seeCost(c) ? rows : rows.map((r) => ({ ...r, cost: null }));
}

// Asset maintenance: plans and generated preventive work, the work-order lifecycle, parts, the downtime a
// work order causes, and repair history.
import { AssetError, dateOrNull, dateRequired, fromCents, loadAsset, loadSettings, need, nextNumber, nonNegative, oneOf, positive, qx, recordAssetEvent, requiredText, textOrNull, toCents, today, uuid, uuidOrNull } from "./common.js";

const OPEN_ORDER = ["planned", "scheduled", "in_progress", "on_hold"];

function addFrequency(dateStr, unit, value) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (unit === "days") d.setUTCDate(d.getUTCDate() + value);
  else if (unit === "weeks") d.setUTCDate(d.getUTCDate() + value * 7);
  else if (unit === "months") d.setUTCMonth(d.getUTCMonth() + value);
  else if (unit === "years") d.setUTCFullYear(d.getUTCFullYear() + value);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ F253/F254: plans and schedule
export async function listMaintenancePlans(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND p.asset_id=$${values.length}`; }
  if (filters.active !== undefined && filters.active !== "") { values.push(String(filters.active) === "true"); where += ` AND p.active=$${values.length}`; }
  const res = await qx(client, `SELECT p.*,a.asset_number,a.name AS asset_name,(p.next_due_date IS NOT NULL AND p.next_due_date<current_date) AS overdue FROM tenant.asset_maintenance_plans p JOIN tenant.assets a ON a.id=p.asset_id WHERE p.organization_id=$1${where} ORDER BY p.next_due_date NULLS LAST,a.asset_number LIMIT 300`, values);
  return res.rows;
}

export async function saveMaintenancePlan(client, c, input) {
  need(c, "assets.maintain");
  const id = uuidOrNull(input.id, "Plan");
  const asset = await loadAsset(client, c, input.assetId, {});
  if (["disposed", "draft"].includes(asset.status)) throw new AssetError(409, "A plan needs a capitalized, non-disposed asset.", "ASSET_STATE_INVALID");
  const unit = oneOf(input.frequencyUnit, ["days", "weeks", "months", "years", "meter"], "Frequency unit");
  const value = Math.round(positive(input.frequencyValue, "Frequency"));
  const type = oneOf(input.maintenanceType || "preventive", ["preventive", "predictive", "inspection", "calibration", "statutory"], "Maintenance type");
  let nextDue = dateOrNull(input.nextDueDate, "Next due date");
  if (unit !== "meter" && !nextDue) nextDue = addFrequency(today(), unit, value);
  if (unit === "meter" && (input.nextDueMeter === undefined || input.nextDueMeter === "")) throw new AssetError(400, "A meter-based plan needs the next due meter reading.", "ASSET_FIELD_REQUIRED");
  const vals = [c.organizationId, asset.id, requiredText(input.name, "Name", 200), type, unit, value, nextDue, unit === "meter" ? String(nonNegative(input.nextDueMeter, "Meter")) : null, textOrNull(input.instructions, 2000), input.active === undefined ? true : Boolean(input.active), Math.round(nonNegative(input.leadDays, "Lead days")), input.estimatedHours ? String(nonNegative(input.estimatedHours, "Hours")) : null, input.estimatedCost ? String(nonNegative(input.estimatedCost, "Cost")) : null, uuidOrNull(input.supplierId, "Supplier")];
  if (id) {
    const res = await qx(client, `UPDATE tenant.asset_maintenance_plans SET asset_id=$2,name=$3,maintenance_type=$4,frequency_unit=$5,frequency_value=$6,next_due_date=$7,next_due_meter=$8,instructions=$9,active=$10,lead_days=$11,estimated_hours=$12,estimated_cost=$13,supplier_id=$14,updated_at=now() WHERE organization_id=$1 AND id=$15 RETURNING *`, [...vals, id]);
    if (!res.rows[0]) throw new AssetError(404, "Plan was not found.", "ASSET_NOT_FOUND");
    return res.rows[0];
  }
  const res = await qx(client, `INSERT INTO tenant.asset_maintenance_plans(organization_id,asset_id,name,maintenance_type,frequency_unit,frequency_value,next_due_date,next_due_meter,instructions,active,lead_days,estimated_hours,estimated_cost,supplier_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [...vals, c.userId]);
  await recordAssetEvent(client, c, asset.id, "asset.maintenance_plan_created", { planId: res.rows[0].id });
  return res.rows[0];
}

// Turns every plan that has come inside its lead window into a planned work order, once.
export async function generateDueMaintenance(client, c, input = {}) {
  need(c, "assets.maintain");
  const asOf = dateRequired(input.asOf || today(), "As-of date");
  const settings = await loadSettings(client, c);
  const due = await qx(client,
    `SELECT p.* FROM tenant.asset_maintenance_plans p JOIN tenant.assets a ON a.id=p.asset_id
     WHERE p.organization_id=$1 AND p.active=true AND p.next_due_date IS NOT NULL AND a.status NOT IN ('disposed','draft')
       AND p.next_due_date - GREATEST(p.lead_days,$3) <= $2::date
       AND NOT EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders o WHERE o.maintenance_plan_id=p.id AND o.status IN ('planned','scheduled','in_progress','on_hold'))
     ORDER BY p.next_due_date FOR UPDATE OF p`, [c.organizationId, asOf, settings.maintenance_lead_days]);
  const created = [];
  for (const p of due.rows) {
    const number = await nextNumber(client, c, "asset_maintenance_order", "AMO");
    const o = await qx(client, `INSERT INTO tenant.asset_maintenance_orders(organization_id,asset_id,maintenance_plan_id,work_order_number,maintenance_type,priority,status,scheduled_start_at,supplier_id,source,problem_description,created_by) VALUES($1,$2,$3,$4,$5,'normal','planned',$6,$7,'plan',$8,$9) RETURNING *`,
      [c.organizationId, p.asset_id, p.id, number, p.maintenance_type, `${p.next_due_date}T09:00:00Z`, p.supplier_id, textOrNull(p.instructions, 2000), c.userId]);
    await recordAssetEvent(client, c, p.asset_id, "asset.maintenance_order.created", { maintenanceOrderId: o.rows[0].id, planId: p.id });
    created.push(o.rows[0]);
  }
  return { created: created.length, orders: created };
}

// ------------------------------------------------------------------ F252/F255: work orders
export async function listWorkOrders(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId];
  let where = "";
  if (filters.status && filters.status !== "all") { values.push(String(filters.status)); where += ` AND o.status=$${values.length}`; }
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND o.asset_id=$${values.length}`; }
  if (filters.type) { values.push(String(filters.type)); where += ` AND o.maintenance_type=$${values.length}`; }
  const res = await qx(client, `SELECT o.*,a.asset_number,a.name AS asset_name,(o.labor_cost+o.parts_cost+o.external_cost) AS total_cost FROM tenant.asset_maintenance_orders o JOIN tenant.assets a ON a.id=o.asset_id WHERE o.organization_id=$1${where} ORDER BY o.created_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function getWorkOrder(client, c, orderId) {
  need(c, "assets.view");
  const o = await qx(client, `SELECT o.*,a.asset_number,a.name AS asset_name FROM tenant.asset_maintenance_orders o JOIN tenant.assets a ON a.id=o.asset_id WHERE o.organization_id=$1 AND o.id=$2`, [c.organizationId, uuid(orderId, "Work order")]);
  if (!o.rows[0]) throw new AssetError(404, "Work order was not found.", "ASSET_NOT_FOUND");
  const parts = await qx(client, `SELECT * FROM tenant.asset_maintenance_parts WHERE organization_id=$1 AND maintenance_order_id=$2 ORDER BY created_at`, [c.organizationId, o.rows[0].id]);
  const downtime = await qx(client, `SELECT * FROM tenant.asset_downtime WHERE organization_id=$1 AND maintenance_order_id=$2 ORDER BY started_at`, [c.organizationId, o.rows[0].id]);
  return { order: o.rows[0], parts: parts.rows, downtime: downtime.rows };
}

async function setAvailabilityAfterOrder(client, c, assetId) {
  const other = await client.query(`SELECT 1 FROM tenant.asset_maintenance_orders WHERE asset_id=$1 AND status IN ('in_progress','on_hold','planned','scheduled') AND took_asset_out_of_service=true`, [assetId]);
  if (other.rows[0]) return;
  const active = await client.query(`SELECT 1 FROM tenant.asset_assignments WHERE asset_id=$1 AND assignment_status='active'`, [assetId]);
  await client.query(`UPDATE tenant.assets SET status=CASE WHEN $2 THEN 'assigned' ELSE 'available' END,updated_at=now() WHERE id=$1 AND status='in_maintenance'`, [assetId, Boolean(active.rows[0])]);
}

export async function createWorkOrder(client, c, assetId, input) {
  need(c, "assets.maintain");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (["disposed", "draft", "pending_disposal"].includes(a.status)) throw new AssetError(409, "A work order needs a capitalized, in-service asset.", "ASSET_STATE_INVALID");
  const type = oneOf(input.maintenanceType || "corrective", ["preventive", "predictive", "corrective", "breakdown", "inspection", "calibration", "statutory"], "Maintenance type");
  if (!["preventive", "predictive", "inspection", "calibration", "statutory"].includes(type) && !["corrective", "breakdown"].includes(type)) throw new AssetError(400, "Unsupported maintenance type.", "ASSET_VALUE_INVALID");
  const takeOut = input.takeOutOfService === true && ["available", "assigned"].includes(a.status);
  const number = await nextNumber(client, c, "asset_maintenance_order", "AMO");
  const dbType = ["corrective", "breakdown"].includes(type) ? "preventive" : type;
  const o = await qx(client,
    `INSERT INTO tenant.asset_maintenance_orders(organization_id,asset_id,maintenance_plan_id,work_order_number,maintenance_type,priority,status,scheduled_start_at,scheduled_end_at,internal_owner_user_id,supplier_id,procurement_document_id,source,problem_description,took_asset_out_of_service,created_by)
     VALUES($1,$2,$3,$4,$5,$6,'planned',$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [c.organizationId, a.id, uuidOrNull(input.maintenancePlanId, "Plan"), number, type === "corrective" || type === "breakdown" ? type : dbType, oneOf(input.priority || "normal", ["low", "normal", "high", "urgent"], "Priority"), input.scheduledStartAt || null, input.scheduledEndAt || null, uuidOrNull(input.internalOwnerUserId, "Owner"), uuidOrNull(input.supplierId, "Supplier"), uuidOrNull(input.procurementDocumentId, "Procurement document"), type === "breakdown" ? "breakdown" : input.source || "manual", textOrNull(input.problemDescription, 2000), takeOut, c.userId]);
  if (takeOut) {
    await client.query(`UPDATE tenant.assets SET status='in_maintenance',updated_at=now() WHERE id=$1`, [a.id]);
    await client.query(`INSERT INTO tenant.asset_downtime(organization_id,asset_id,maintenance_order_id,category,started_at,reason,recorded_by) VALUES($1,$2,$3,$4,now(),$5,$6)`, [c.organizationId, a.id, o.rows[0].id, type === "breakdown" ? "breakdown" : "planned", textOrNull(input.problemDescription, 500), c.userId]);
  }
  await recordAssetEvent(client, c, a.id, "asset.maintenance_order.created", { maintenanceOrderId: o.rows[0].id, type });
  return o.rows[0];
}

async function lockOrder(client, c, orderId) {
  const o = (await qx(client, `SELECT * FROM tenant.asset_maintenance_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(orderId, "Work order")])).rows[0];
  if (!o) throw new AssetError(404, "Work order was not found.", "ASSET_NOT_FOUND");
  return o;
}

export async function startWorkOrder(client, c, orderId) {
  need(c, "assets.maintain");
  const o = await lockOrder(client, c, orderId);
  if (!["planned", "scheduled", "on_hold"].includes(o.status)) throw new AssetError(409, "Only a planned, scheduled or held work order can be started.", "ASSET_STATE_INVALID");
  return (await qx(client, `UPDATE tenant.asset_maintenance_orders SET status='in_progress',actual_start_at=COALESCE(actual_start_at,now()),updated_at=now() WHERE id=$1 RETURNING *`, [o.id])).rows[0];
}

export async function holdWorkOrder(client, c, orderId, reason) {
  need(c, "assets.maintain");
  const o = await lockOrder(client, c, orderId);
  if (o.status !== "in_progress") throw new AssetError(409, "Only a work order in progress can be put on hold.", "ASSET_STATE_INVALID");
  return (await qx(client, `UPDATE tenant.asset_maintenance_orders SET status='on_hold',findings=COALESCE(findings||E'\\n','')||$2,updated_at=now() WHERE id=$1 RETURNING *`, [o.id, `On hold: ${requiredText(reason, "Reason", 500)}`])).rows[0];
}

export async function cancelWorkOrder(client, c, orderId, reason) {
  need(c, "assets.maintain");
  const o = await lockOrder(client, c, orderId);
  if (!OPEN_ORDER.includes(o.status)) throw new AssetError(409, "Only an open work order can be cancelled.", "ASSET_STATE_INVALID");
  const res = await qx(client, `UPDATE tenant.asset_maintenance_orders SET status='cancelled',cancelled_reason=$2,updated_at=now() WHERE id=$1 RETURNING *`, [o.id, requiredText(reason, "Reason", 500)]);
  await client.query(`UPDATE tenant.asset_downtime SET ended_at=now() WHERE maintenance_order_id=$1 AND ended_at IS NULL`, [o.id]);
  await client.query(`UPDATE tenant.asset_maintenance_orders SET took_asset_out_of_service=false WHERE id=$1`, [o.id]);
  await setAvailabilityAfterOrder(client, c, o.asset_id);
  return res.rows[0];
}

export async function addWorkOrderPart(client, c, orderId, input) {
  need(c, "assets.maintain");
  const o = await lockOrder(client, c, orderId);
  if (!["planned", "scheduled", "in_progress", "on_hold"].includes(o.status)) throw new AssetError(409, "Parts can only be added to an open work order.", "ASSET_STATE_INVALID");
  const res = await qx(client, `INSERT INTO tenant.asset_maintenance_parts(organization_id,maintenance_order_id,item_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [c.organizationId, o.id, uuid(input.itemId, "Item"), uuidOrNull(input.warehouseId, "Warehouse"), String(positive(input.quantity, "Quantity")), String(nonNegative(input.unitCost, "Unit cost"))]);
  const total = (await client.query(`SELECT COALESCE(sum(quantity*unit_cost),0)::text AS t FROM tenant.asset_maintenance_parts WHERE maintenance_order_id=$1`, [o.id])).rows[0].t;
  await client.query(`UPDATE tenant.asset_maintenance_orders SET parts_cost=$2,updated_at=now() WHERE id=$1`, [o.id, total]);
  return res.rows[0];
}

export async function completeWorkOrder(client, c, orderId, input = {}) {
  need(c, "assets.maintain");
  const o = await lockOrder(client, c, orderId);
  if (!OPEN_ORDER.includes(o.status)) throw new AssetError(409, "Only an open work order can be completed.", "ASSET_STATE_INVALID");
  const findings = textOrNull(input.findings, 2000);
  if (["corrective", "breakdown"].includes(o.maintenance_type) && !textOrNull(input.resolution, 2000)) throw new AssetError(400, "Describe the resolution before completing a repair.", "ASSET_FIELD_REQUIRED");
  await client.query(`UPDATE tenant.asset_downtime SET ended_at=now() WHERE maintenance_order_id=$1 AND ended_at IS NULL`, [o.id]);
  const measured = (await client.query(`SELECT COALESCE(sum(EXTRACT(EPOCH FROM (ended_at-started_at))/3600),0)::numeric(20,2)::text AS h FROM tenant.asset_downtime WHERE maintenance_order_id=$1`, [o.id])).rows[0].h;
  const parts = (await client.query(`SELECT COALESCE(sum(quantity*unit_cost),0)::text AS t FROM tenant.asset_maintenance_parts WHERE maintenance_order_id=$1`, [o.id])).rows[0].t;
  const res = await qx(client,
    `UPDATE tenant.asset_maintenance_orders SET status='completed',actual_start_at=COALESCE(actual_start_at,now()),actual_end_at=now(),downtime_hours=$2,labor_cost=$3,parts_cost=$4,external_cost=$5,findings=$6,resolution=$7,failure_cause=$8,completed_by=$9,updated_at=now() WHERE id=$1 RETURNING *`,
    [o.id, input.downtimeHours !== undefined && input.downtimeHours !== "" ? String(nonNegative(input.downtimeHours, "Downtime hours")) : measured, String(nonNegative(input.laborCost, "Labour cost")), parts, String(nonNegative(input.externalCost, "External cost")), findings, textOrNull(input.resolution, 2000), textOrNull(input.failureCause, 500), c.userId]);
  await setAvailabilityAfterOrder(client, c, o.asset_id);
  await client.query(`UPDATE tenant.asset_maintenance_orders SET took_asset_out_of_service=false WHERE id=$1`, [o.id]);
  if (o.maintenance_plan_id) {
    const plan = (await qx(client, `SELECT * FROM tenant.asset_maintenance_plans WHERE id=$1`, [o.maintenance_plan_id])).rows[0];
    if (plan && plan.frequency_unit !== "meter") await client.query(`UPDATE tenant.asset_maintenance_plans SET last_completed_date=current_date,next_due_date=$2,updated_at=now() WHERE id=$1`, [plan.id, addFrequency(today(), plan.frequency_unit, plan.frequency_value)]);
  }
  await recordAssetEvent(client, c, o.asset_id, "asset.maintenance_order.completed", { maintenanceOrderId: o.id });
  return res.rows[0];
}

// F255: the repair history of an asset, with what it has cost.
export async function getRepairHistory(client, c, assetId) {
  need(c, "assets.view");
  const a = await loadAsset(client, c, assetId);
  const rows = await qx(client, `SELECT o.*,(o.labor_cost+o.parts_cost+o.external_cost) AS total_cost FROM tenant.asset_maintenance_orders o WHERE o.organization_id=$1 AND o.asset_id=$2 AND o.status='completed' ORDER BY o.actual_end_at DESC`, [c.organizationId, a.id]);
  const total = rows.rows.reduce((s, r) => s + toCents(r.total_cost), 0n);
  return { asset: { id: a.id, asset_number: a.asset_number, name: a.name }, repairs: rows.rows, totalCost: fromCents(total), repairCount: rows.rows.length };
}


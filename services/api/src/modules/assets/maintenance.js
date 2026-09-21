// Maintenance and reliability (F252-F257) and inspection/calibration (F258-F259): plans and generated
// preventive work, the work-order lifecycle, parts, downtime, repair history, warranties and claims,
// inspections that raise corrective work, and calibration that takes failed equipment out of service.
import { AssetError, dateOrNull, dateRequired, fromCents, loadAsset, loadSettings, need, nextNumber, nonNegative, oneOf, positive, qx, recordAssetEvent, requiredText, textOrNull, toCents, today, uuid, uuidOrNull } from "./common.js";

const OPEN_ORDER = ["planned", "scheduled", "in_progress", "on_hold"];
const RATINGS = ["excellent", "good", "fair", "poor", "critical"];

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
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND p.asset_id=$${values.length}`; }
  if (filters.active !== undefined && filters.active !== "") { values.push(String(filters.active) === "true"); where += ` AND p.active=$${values.length}`; }
  const res = await qx(client, `SELECT p.*,a.asset_number,a.name AS asset_name,(p.next_due_date IS NOT NULL AND p.next_due_date<current_date) AS overdue FROM tenant.asset_maintenance_plans p JOIN tenant.assets a ON a.id=p.asset_id WHERE p.organization_id=$1 AND p.company_id=$2${where} ORDER BY p.next_due_date NULLS LAST,a.asset_number LIMIT 300`, values);
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
  const vals = [c.organizationId, c.companyId, asset.id, requiredText(input.name, "Name", 200), type, unit, value, nextDue, unit === "meter" ? String(nonNegative(input.nextDueMeter, "Meter")) : null, textOrNull(input.instructions, 2000), input.active === undefined ? true : Boolean(input.active), Math.round(nonNegative(input.leadDays, "Lead days")), input.estimatedHours ? String(nonNegative(input.estimatedHours, "Hours")) : null, input.estimatedCost ? String(nonNegative(input.estimatedCost, "Cost")) : null, uuidOrNull(input.supplierId, "Supplier")];
  if (id) {
    const res = await qx(client, `UPDATE tenant.asset_maintenance_plans SET asset_id=$3,name=$4,maintenance_type=$5,frequency_unit=$6,frequency_value=$7,next_due_date=$8,next_due_meter=$9,instructions=$10,active=$11,lead_days=$12,estimated_hours=$13,estimated_cost=$14,supplier_id=$15,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$16 RETURNING *`, [...vals, id]);
    if (!res.rows[0]) throw new AssetError(404, "Plan was not found.", "ASSET_NOT_FOUND");
    return res.rows[0];
  }
  const res = await qx(client, `INSERT INTO tenant.asset_maintenance_plans(organization_id,company_id,asset_id,name,maintenance_type,frequency_unit,frequency_value,next_due_date,next_due_meter,instructions,active,lead_days,estimated_hours,estimated_cost,supplier_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [...vals, c.userId]);
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
     WHERE p.organization_id=$1 AND p.company_id=$2 AND p.active=true AND p.next_due_date IS NOT NULL AND a.status NOT IN ('disposed','draft')
       AND p.next_due_date - GREATEST(p.lead_days,$4) <= $3::date
       AND NOT EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders o WHERE o.maintenance_plan_id=p.id AND o.status IN ('planned','scheduled','in_progress','on_hold'))
     ORDER BY p.next_due_date FOR UPDATE OF p`, [c.organizationId, c.companyId, asOf, settings.maintenance_lead_days]);
  const created = [];
  for (const p of due.rows) {
    const number = await nextNumber(client, c, "asset_maintenance_order", "AMO");
    const o = await qx(client, `INSERT INTO tenant.asset_maintenance_orders(organization_id,company_id,asset_id,maintenance_plan_id,work_order_number,maintenance_type,priority,status,scheduled_start_at,supplier_id,source,problem_description,created_by) VALUES($1,$2,$3,$4,$5,$6,'normal','planned',$7,$8,'plan',$9,$10) RETURNING *`,
      [c.organizationId, c.companyId, p.asset_id, p.id, number, p.maintenance_type, `${p.next_due_date}T09:00:00Z`, p.supplier_id, textOrNull(p.instructions, 2000), c.userId]);
    await recordAssetEvent(client, c, p.asset_id, "asset.maintenance_order.created", { maintenanceOrderId: o.rows[0].id, planId: p.id });
    created.push(o.rows[0]);
  }
  return { created: created.length, orders: created };
}

// ------------------------------------------------------------------ F252/F255: work orders
export async function listWorkOrders(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status && filters.status !== "all") { values.push(String(filters.status)); where += ` AND o.status=$${values.length}`; }
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND o.asset_id=$${values.length}`; }
  if (filters.type) { values.push(String(filters.type)); where += ` AND o.maintenance_type=$${values.length}`; }
  const res = await qx(client, `SELECT o.*,a.asset_number,a.name AS asset_name,(o.labor_cost+o.parts_cost+o.external_cost) AS total_cost FROM tenant.asset_maintenance_orders o JOIN tenant.assets a ON a.id=o.asset_id WHERE o.organization_id=$1 AND o.company_id=$2${where} ORDER BY o.created_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function getWorkOrder(client, c, orderId) {
  need(c, "assets.view");
  const o = await qx(client, `SELECT o.*,a.asset_number,a.name AS asset_name FROM tenant.asset_maintenance_orders o JOIN tenant.assets a ON a.id=o.asset_id WHERE o.organization_id=$1 AND o.company_id=$2 AND o.id=$3`, [c.organizationId, c.companyId, uuid(orderId, "Work order")]);
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
    `INSERT INTO tenant.asset_maintenance_orders(organization_id,company_id,asset_id,maintenance_plan_id,work_order_number,maintenance_type,priority,status,scheduled_start_at,scheduled_end_at,internal_owner_user_id,supplier_id,procurement_document_id,source,problem_description,took_asset_out_of_service,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId, c.companyId, a.id, uuidOrNull(input.maintenancePlanId, "Plan"), number, type === "corrective" || type === "breakdown" ? type : dbType, oneOf(input.priority || "normal", ["low", "normal", "high", "urgent"], "Priority"), input.scheduledStartAt || null, input.scheduledEndAt || null, uuidOrNull(input.internalOwnerUserId, "Owner"), uuidOrNull(input.supplierId, "Supplier"), uuidOrNull(input.procurementDocumentId, "Procurement document"), type === "breakdown" ? "breakdown" : input.source || "manual", textOrNull(input.problemDescription, 2000), takeOut, c.userId]);
  if (takeOut) {
    await client.query(`UPDATE tenant.assets SET status='in_maintenance',updated_at=now() WHERE id=$1`, [a.id]);
    await client.query(`INSERT INTO tenant.asset_downtime(organization_id,company_id,asset_id,maintenance_order_id,category,started_at,reason,recorded_by) VALUES($1,$2,$3,$4,$5,now(),$6,$7)`, [c.organizationId, c.companyId, a.id, o.rows[0].id, type === "breakdown" ? "breakdown" : "planned", textOrNull(input.problemDescription, 500), c.userId]);
  }
  await recordAssetEvent(client, c, a.id, "asset.maintenance_order.created", { maintenanceOrderId: o.rows[0].id, type });
  return o.rows[0];
}

async function lockOrder(client, c, orderId) {
  const o = (await qx(client, `SELECT * FROM tenant.asset_maintenance_orders WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(orderId, "Work order")])).rows[0];
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
  const warranty = await client.query(`SELECT id FROM tenant.asset_warranties WHERE asset_id=$1 AND start_date<=current_date AND end_date>=current_date LIMIT 1`, [o.asset_id]);
  await recordAssetEvent(client, c, o.asset_id, "asset.maintenance_order.completed", { maintenanceOrderId: o.id });
  return { ...res.rows[0], under_warranty: Boolean(warranty.rows[0]), warranty_id: warranty.rows[0]?.id ?? null };
}

// F255: the repair history of an asset, with what it has cost.
export async function getRepairHistory(client, c, assetId) {
  need(c, "assets.view");
  const a = await loadAsset(client, c, assetId);
  const rows = await qx(client, `SELECT o.*,(o.labor_cost+o.parts_cost+o.external_cost) AS total_cost FROM tenant.asset_maintenance_orders o WHERE o.organization_id=$1 AND o.asset_id=$2 AND o.status='completed' ORDER BY o.actual_end_at DESC`, [c.organizationId, a.id]);
  const total = rows.rows.reduce((s, r) => s + toCents(r.total_cost), 0n);
  return { asset: { id: a.id, asset_number: a.asset_number, name: a.name }, repairs: rows.rows, totalCost: fromCents(total), repairCount: rows.rows.length };
}

// ------------------------------------------------------------------ F256: downtime
export async function listDowntime(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND d.asset_id=$${values.length}`; }
  const res = await qx(client, `SELECT d.*,a.asset_number,a.name AS asset_name,ROUND(EXTRACT(EPOCH FROM (COALESCE(d.ended_at,now())-d.started_at))/3600,2) AS hours FROM tenant.asset_downtime d JOIN tenant.assets a ON a.id=d.asset_id WHERE d.organization_id=$1 AND d.company_id=$2${where} ORDER BY d.started_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function recordDowntime(client, c, assetId, input) {
  need(c, "assets.maintain");
  const a = await loadAsset(client, c, assetId);
  const started = new Date(input.startedAt);
  const ended = input.endedAt ? new Date(input.endedAt) : null;
  if (Number.isNaN(started.getTime())) throw new AssetError(400, "Start time is not valid.", "ASSET_DATE_INVALID");
  if (ended && (Number.isNaN(ended.getTime()) || ended < started)) throw new AssetError(400, "The end time cannot be before the start.", "ASSET_DATE_INVALID");
  const res = await qx(client, `INSERT INTO tenant.asset_downtime(organization_id,company_id,asset_id,maintenance_order_id,category,started_at,ended_at,reason,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, a.id, uuidOrNull(input.maintenanceOrderId, "Work order"), oneOf(input.category || "breakdown", ["breakdown", "planned", "other"], "Category"), started.toISOString(), ended?.toISOString() ?? null, textOrNull(input.reason, 500), c.userId]);
  await recordAssetEvent(client, c, a.id, "asset.downtime_recorded", { downtimeId: res.rows[0].id });
  return res.rows[0];
}

export async function endDowntime(client, c, downtimeId, endedAt) {
  need(c, "assets.maintain");
  const at = endedAt ? new Date(endedAt) : new Date();
  const res = await qx(client, `UPDATE tenant.asset_downtime SET ended_at=$4 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND ended_at IS NULL AND started_at<=$4 RETURNING *`, [c.organizationId, c.companyId, uuid(downtimeId, "Downtime"), at.toISOString()]);
  if (!res.rows[0]) throw new AssetError(409, "That downtime is already closed or the end precedes its start.", "ASSET_STATE_INVALID");
  return res.rows[0];
}

// ------------------------------------------------------------------ F257: warranties and claims
export async function listWarranties(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND w.asset_id=$${values.length}`; }
  const settings = await loadSettings(client, c);
  values.push(settings.warranty_alert_days);
  const res = await qx(client, `SELECT w.*,a.asset_number,a.name AS asset_name,(w.end_date-current_date) AS days_remaining,
      CASE WHEN w.end_date<current_date THEN 'expired' WHEN w.end_date<=current_date+$${values.length}::int THEN 'expiring' ELSE 'active' END AS warranty_status
    FROM tenant.asset_warranties w JOIN tenant.assets a ON a.id=w.asset_id WHERE w.organization_id=$1 AND w.company_id=$2${where} ORDER BY w.end_date LIMIT 300`, values);
  return res.rows;
}

export async function saveWarranty(client, c, input) {
  need(c, "assets.maintain");
  const a = await loadAsset(client, c, input.assetId);
  const start = dateRequired(input.startDate, "Start date");
  const end = dateRequired(input.endDate, "End date");
  if (end < start) throw new AssetError(400, "The warranty end cannot be before its start.", "ASSET_DATE_INVALID");
  const res = await qx(client, `INSERT INTO tenant.asset_warranties(organization_id,company_id,asset_id,supplier_id,provider_name,warranty_type,start_date,end_date,coverage,terms,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, a.id, uuidOrNull(input.supplierId, "Supplier"), textOrNull(input.providerName, 200), oneOf(input.warrantyType || "manufacturer", ["manufacturer", "extended", "service_contract", "amc"], "Warranty type"), start, end, textOrNull(input.coverage, 1000), textOrNull(input.terms, 2000), c.userId]);
  await client.query(`UPDATE tenant.assets SET warranty_start_date=$2,warranty_end_date=(SELECT max(end_date) FROM tenant.asset_warranties WHERE asset_id=$1),updated_at=now() WHERE id=$1`, [a.id, start]);
  await recordAssetEvent(client, c, a.id, "asset.warranty_added", { warrantyId: res.rows[0].id });
  return res.rows[0];
}

export async function listWarrantyClaims(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND cl.status=$${values.length}`; }
  const res = await qx(client, `SELECT cl.*,a.asset_number,a.name AS asset_name FROM tenant.asset_warranty_claims cl JOIN tenant.assets a ON a.id=cl.asset_id WHERE cl.organization_id=$1 AND cl.company_id=$2${where} ORDER BY cl.claim_date DESC LIMIT 300`, values);
  return res.rows;
}

export async function createWarrantyClaim(client, c, input) {
  need(c, "assets.maintain");
  const w = (await qx(client, `SELECT * FROM tenant.asset_warranties WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.warrantyId, "Warranty")])).rows[0];
  if (!w) throw new AssetError(404, "Warranty was not found.", "ASSET_NOT_FOUND");
  const date = dateRequired(input.claimDate || today(), "Claim date");
  if (date < String(w.start_date) || date > String(w.end_date)) throw new AssetError(409, "The claim date falls outside the warranty period.", "ASSET_WARRANTY_EXPIRED");
  const res = await qx(client, `INSERT INTO tenant.asset_warranty_claims(organization_id,company_id,warranty_id,asset_id,maintenance_order_id,claim_date,description,claimed_amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, w.id, w.asset_id, uuidOrNull(input.maintenanceOrderId, "Work order"), date, requiredText(input.description, "Description", 1000), String(nonNegative(input.claimedAmount, "Claimed amount")), c.userId]);
  await recordAssetEvent(client, c, w.asset_id, "asset.warranty_claim_created", { claimId: res.rows[0].id });
  return res.rows[0];
}

export async function updateWarrantyClaim(client, c, claimId, input) {
  need(c, "assets.maintain");
  const cl = (await qx(client, `SELECT * FROM tenant.asset_warranty_claims WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(claimId, "Claim")])).rows[0];
  if (!cl) throw new AssetError(404, "Claim was not found.", "ASSET_NOT_FOUND");
  const status = oneOf(input.status, ["open", "approved", "rejected", "settled"], "Status");
  if (["settled", "rejected"].includes(cl.status)) throw new AssetError(409, "A settled or rejected claim is final.", "ASSET_STATE_INVALID");
  const recovered = nonNegative(input.recoveredAmount, "Recovered amount", Number(cl.recovered_amount));
  if (status === "settled" && recovered > Number(cl.claimed_amount)) throw new AssetError(409, "The recovered amount cannot exceed what was claimed.", "ASSET_NUMBER_INVALID");
  return (await qx(client, `UPDATE tenant.asset_warranty_claims SET status=$2,recovered_amount=$3 WHERE id=$1 RETURNING *`, [cl.id, status, String(recovered)])).rows[0];
}

// ------------------------------------------------------------------ F258: inspections
export async function listInspections(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND i.asset_id=$${values.length}`; }
  if (filters.result) { values.push(String(filters.result)); where += ` AND i.result=$${values.length}`; }
  const res = await qx(client, `SELECT i.*,a.asset_number,a.name AS asset_name FROM tenant.asset_inspections i JOIN tenant.assets a ON a.id=i.asset_id WHERE i.organization_id=$1 AND i.company_id=$2${where} ORDER BY i.inspection_date DESC,i.created_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function recordInspection(client, c, assetId, input) {
  need(c, "assets.inspect");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (["draft", "disposed"].includes(a.status)) throw new AssetError(409, "Only a capitalized, non-disposed asset can be inspected.", "ASSET_STATE_INVALID");
  const checklist = Array.isArray(input.checklist) ? input.checklist.map((i) => ({ item: requiredText(i.item, "Checklist item", 300), passed: i.passed === true, note: textOrNull(i.note, 300) })) : [];
  const result = oneOf(input.result || (checklist.some((i) => !i.passed) ? "fail" : "pass"), ["pass", "conditional", "fail"], "Result");
  const rating = oneOf(input.conditionRating || a.condition_rating, RATINGS, "Condition");
  const correctiveNeeded = input.correctiveActionRequired === true || result === "fail";
  const date = dateRequired(input.inspectionDate || today(), "Inspection date");
  const number = await nextNumber(client, c, "asset_inspection", "INS");
  let order = null;
  if (correctiveNeeded) order = await createWorkOrder(client, { ...c, permissions: [...(c.permissions || []), "assets.maintain"] }, a.id, { maintenanceType: "corrective", source: "inspection", priority: result === "fail" ? "high" : "normal", problemDescription: textOrNull(input.findings, 1000) || `Corrective action from inspection ${number}`, takeOutOfService: input.takeOutOfService === true });
  const res = await qx(client,
    `INSERT INTO tenant.asset_inspections(organization_id,company_id,asset_id,inspection_number,inspection_type,inspection_date,condition_rating,location_verified,custodian_verified,findings,corrective_action_required,corrective_action_due_date,inspected_by,checklist,result,next_due_date,corrective_order_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17) RETURNING *`,
    [c.organizationId, c.companyId, a.id, number, oneOf(input.inspectionType || "condition", ["condition", "custody", "safety", "compliance", "calibration"], "Inspection type"), date, rating, input.locationVerified === true, input.custodianVerified === true, textOrNull(input.findings, 2000), correctiveNeeded, dateOrNull(input.correctiveActionDueDate, "Due date"), c.userId, JSON.stringify(checklist), result, dateOrNull(input.nextDueDate, "Next due"), order?.id ?? null]);
  await client.query(`UPDATE tenant.assets SET condition_rating=$2,updated_at=now() WHERE id=$1`, [a.id, rating]);
  await recordAssetEvent(client, c, a.id, "asset.inspected", { inspectionId: res.rows[0].id, result });
  return { ...res.rows[0], corrective_order: order };
}

// ------------------------------------------------------------------ F259: calibration
export async function listCalibrations(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND k.asset_id=$${values.length}`; }
  const settings = await loadSettings(client, c);
  values.push(settings.calibration_alert_days);
  const res = await qx(client, `SELECT k.*,a.asset_number,a.name AS asset_name,
      CASE WHEN k.due_on<current_date THEN 'overdue' WHEN k.due_on<=current_date+$${values.length}::int THEN 'due_soon' ELSE 'valid' END AS calibration_status
    FROM tenant.asset_calibrations k JOIN tenant.assets a ON a.id=k.asset_id WHERE k.organization_id=$1 AND k.company_id=$2${where} ORDER BY k.calibrated_on DESC LIMIT 300`, values);
  return res.rows;
}

export async function recordCalibration(client, c, assetId, input) {
  need(c, "assets.inspect");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (["draft", "disposed"].includes(a.status)) throw new AssetError(409, "Only a capitalized, non-disposed asset can be calibrated.", "ASSET_STATE_INVALID");
  const on = dateRequired(input.calibratedOn || today(), "Calibration date");
  const due = dateRequired(input.dueOn, "Next due date");
  if (due < on) throw new AssetError(400, "The next due date cannot precede the calibration.", "ASSET_DATE_INVALID");
  const result = oneOf(input.result, ["pass", "adjusted", "fail"], "Result");
  if (result === "fail" && !textOrNull(input.asFound, 500)) throw new AssetError(400, "Record the as-found reading for a failed calibration.", "ASSET_FIELD_REQUIRED");
  const number = await nextNumber(client, c, "asset_calibration", "CAL");
  const res = await qx(client, `INSERT INTO tenant.asset_calibrations(organization_id,company_id,asset_id,calibration_number,calibrated_on,due_on,standard_reference,as_found,as_left,result,certificate_number,performed_by_name,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, a.id, number, on, due, textOrNull(input.standardReference, 300), textOrNull(input.asFound, 500), textOrNull(input.asLeft, 500), result, textOrNull(input.certificateNumber, 100), textOrNull(input.performedByName, 200), c.userId]);
  let order = null;
  if (result === "fail") {
    order = await createWorkOrder(client, { ...c, permissions: [...(c.permissions || []), "assets.maintain"] }, a.id, { maintenanceType: "calibration", source: "calibration", priority: "high", problemDescription: `Failed calibration ${number}: as found ${input.asFound}`, takeOutOfService: true });
  }
  await client.query(`UPDATE tenant.assets SET calibration_due_date=$2,updated_at=now() WHERE id=$1`, [a.id, due]);
  await recordAssetEvent(client, c, a.id, "asset.calibrated", { calibrationId: res.rows[0].id, result });
  return { ...res.rows[0], corrective_order: order };
}

// Custody and movement (F239-F241): assignment and return, the transfer workflow (request, approve,
// complete), and the effective-dated, immutable movement history every custody/location change writes.
import { AssetError, dateRequired, loadAsset, loadSettings, need, nextNumber, oneOf, qx, recordAssetEvent, requiredText, textOrNull, today, uuid, uuidOrNull } from "./common.js";

const MOVABLE = ["available", "assigned", "in_maintenance"];

async function movement(client, c, asset, type, to, extra = {}) {
  await client.query(
    `INSERT INTO tenant.asset_movements(organization_id,company_id,asset_id,movement_type,effective_date,from_user_id,to_user_id,from_department_id,to_department_id,from_cost_center_id,to_cost_center_id,from_branch_id,to_branch_id,from_location_id,to_location_id,reference_type,reference_id,reason,actor_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [c.organizationId, c.companyId, asset.id, type, extra.effectiveDate || today(), asset.current_user_id, to.userId ?? null, asset.current_department_id, to.departmentId ?? null, asset.current_cost_center_id, to.costCenterId ?? null, asset.branch_id, to.branchId ?? asset.branch_id, asset.location_id, to.locationId ?? null, extra.referenceType ?? null, extra.referenceId ?? null, textOrNull(extra.reason, 500), c.userId]);
}

async function checkLocation(client, c, locationId) {
  if (!locationId) return;
  const r = await client.query(`SELECT 1 FROM tenant.asset_locations WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active=true`, [c.organizationId, c.companyId, locationId]);
  if (!r.rows[0]) throw new AssetError(409, "The location does not exist or is inactive.", "ASSET_LOCATION_INVALID");
}

export async function assignAssetToCustodian(client, c, assetId, input) {
  need(c, "assets.assign");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (!["available", "assigned"].includes(a.status)) throw new AssetError(409, "Only an available or already-assigned asset can be assigned.", "ASSET_STATE_INVALID");
  const to = { userId: uuidOrNull(input.userId, "Custodian"), departmentId: uuidOrNull(input.departmentId, "Department"), costCenterId: uuidOrNull(input.costCenterId, "Cost centre"), locationId: uuidOrNull(input.locationId, "Location") };
  if (!to.userId && !to.departmentId && !to.costCenterId) throw new AssetError(400, "Choose a custodian, a department or a cost centre.", "ASSET_FIELD_REQUIRED");
  await checkLocation(client, c, to.locationId);
  const effective = dateRequired(input.effectiveDate || today(), "Effective date");
  await client.query(`UPDATE tenant.asset_assignments SET assignment_status='returned',returned_at=now(),returned_by=$3,condition_in=COALESCE(condition_in,'reassigned') WHERE organization_id=$1 AND asset_id=$2 AND assignment_status='active'`, [c.organizationId, a.id, c.userId]);
  const assignment = (await qx(client,
    `INSERT INTO tenant.asset_assignments(organization_id,asset_id,assigned_to_user_id,assigned_to_department_id,assigned_to_cost_center_id,location_text,assigned_until,condition_out,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, a.id, to.userId, to.departmentId, to.costCenterId, textOrNull(input.locationText, 300), input.assignedUntil || null, textOrNull(input.conditionOut, 300), c.userId])).rows[0];
  await movement(client, c, a, "assignment", to, { effectiveDate: effective, referenceType: "asset_assignment", referenceId: assignment.id, reason: input.reason });
  await client.query(`UPDATE tenant.assets SET status='assigned',current_user_id=$4,current_department_id=$5,current_cost_center_id=$6,location_id=COALESCE($7,location_id),current_location_text=COALESCE($8,current_location_text),updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [c.organizationId, c.companyId, a.id, to.userId, to.departmentId, to.costCenterId, to.locationId, textOrNull(input.locationText, 300)]);
  await recordAssetEvent(client, c, a.id, "asset.assigned", { assignmentId: assignment.id });
  return assignment;
}

export async function returnAsset(client, c, assetId, input = {}) {
  need(c, "assets.assign");
  const a = await loadAsset(client, c, assetId, { lock: true });
  const active = await client.query(`SELECT * FROM tenant.asset_assignments WHERE organization_id=$1 AND asset_id=$2 AND assignment_status='active' FOR UPDATE`, [c.organizationId, a.id]);
  if (!active.rows[0]) throw new AssetError(409, "The asset has no active assignment to return.", "ASSET_STATE_INVALID");
  const condition = input.conditionRating ? oneOf(input.conditionRating, ["excellent", "good", "fair", "poor", "critical"], "Condition") : a.condition_rating;
  await client.query(`UPDATE tenant.asset_assignments SET assignment_status='returned',returned_at=now(),returned_by=$3,condition_in=$4 WHERE id=$2 AND organization_id=$1`, [c.organizationId, active.rows[0].id, c.userId, textOrNull(input.conditionIn, 300) || condition]);
  await movement(client, c, a, "return", { userId: null, departmentId: null, costCenterId: null, locationId: input.locationId ? uuid(input.locationId, "Location") : a.location_id }, { effectiveDate: dateRequired(input.effectiveDate || today(), "Effective date"), referenceType: "asset_assignment", referenceId: active.rows[0].id, reason: input.reason });
  await client.query(`UPDATE tenant.assets SET status='available',current_user_id=NULL,current_department_id=NULL,current_cost_center_id=NULL,condition_rating=$4,location_id=COALESCE($5,location_id),updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, a.id, condition, input.locationId ? uuid(input.locationId, "Location") : null]);
  await recordAssetEvent(client, c, a.id, "asset.returned", { condition });
  return { ok: true, assetId: a.id };
}

export async function listAssignments(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND asg.assignment_status=$${values.length}`; }
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND asg.asset_id=$${values.length}`; }
  const res = await qx(client, `SELECT asg.*,a.asset_number,a.name AS asset_name,usr.full_name AS custodian_name FROM tenant.asset_assignments asg JOIN tenant.assets a ON a.id=asg.asset_id LEFT JOIN public.users usr ON usr.id=asg.assigned_to_user_id WHERE asg.organization_id=$1 AND a.company_id=$2${where} ORDER BY asg.assigned_from DESC LIMIT 300`, values);
  return res.rows;
}

export async function listAssetMovements(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND m.asset_id=$${values.length}`; }
  const res = await qx(client, `SELECT m.*,a.asset_number,a.name AS asset_name FROM tenant.asset_movements m JOIN tenant.assets a ON a.id=m.asset_id WHERE m.organization_id=$1 AND m.company_id=$2${where} ORDER BY m.effective_date DESC,m.created_at DESC LIMIT 300`, values);
  return res.rows;
}

// ------------------------------------------------------------------ transfers
export async function listAssetTransfers(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND t.status=$${values.length}`; }
  const res = await qx(client, `SELECT t.*,a.asset_number,a.name AS asset_name FROM tenant.asset_transfers t JOIN tenant.assets a ON a.id=t.asset_id WHERE t.organization_id=$1 AND t.company_id=$2${where} ORDER BY t.created_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function requestAssetTransfer(client, c, assetId, input) {
  need(c, "assets.transfer");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (!MOVABLE.includes(a.status)) throw new AssetError(409, "Only an in-service asset can be transferred.", "ASSET_STATE_INVALID");
  const to = { branchId: uuidOrNull(input.toBranchId, "Branch"), departmentId: uuidOrNull(input.toDepartmentId, "Department"), costCenterId: uuidOrNull(input.toCostCenterId, "Cost centre"), locationId: uuidOrNull(input.toLocationId, "Location"), userId: uuidOrNull(input.toUserId, "Custodian") };
  if (!Object.values(to).some(Boolean)) throw new AssetError(400, "Choose at least one destination (location, department, cost centre, branch or custodian).", "ASSET_FIELD_REQUIRED");
  await checkLocation(client, c, to.locationId);
  const open = await client.query(`SELECT 1 FROM tenant.asset_transfers WHERE asset_id=$1 AND status IN ('submitted','approved')`, [a.id]);
  if (open.rows[0]) throw new AssetError(409, "This asset already has a transfer in progress.", "ASSET_TRANSFER_OPEN");
  const number = await nextNumber(client, c, "asset_transfer", "ATR");
  const res = await qx(client,
    `INSERT INTO tenant.asset_transfers(organization_id,company_id,asset_id,transfer_number,from_branch_id,to_branch_id,from_department_id,to_department_id,from_cost_center_id,to_cost_center_id,from_location_id,to_location_id,from_user_id,to_user_id,reason,status,requested_by,effective_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'submitted',$16,$17) RETURNING *`,
    [c.organizationId, c.companyId, a.id, number, a.branch_id, to.branchId, a.current_department_id, to.departmentId, a.current_cost_center_id, to.costCenterId, a.location_id, to.locationId, a.current_user_id, to.userId, requiredText(input.reason, "Reason", 500), c.userId, dateRequired(input.effectiveDate || today(), "Effective date")]);
  await recordAssetEvent(client, c, a.id, "asset.transfer_requested", { transferId: res.rows[0].id });
  const settings = await loadSettings(client, c);
  if (!settings.require_transfer_approval) return completeAssetTransfer(client, { ...c, permissions: [...(c.permissions || []), "assets.manage"] }, res.rows[0].id, { skipApprovalCheck: true });
  return res.rows[0];
}

export async function approveAssetTransfer(client, c, transferId) {
  need(c, "assets.manage");
  const t = (await qx(client, `SELECT * FROM tenant.asset_transfers WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(transferId, "Transfer")])).rows[0];
  if (!t) throw new AssetError(404, "Transfer was not found.", "ASSET_NOT_FOUND");
  if (t.status !== "submitted") throw new AssetError(409, "Only a submitted transfer can be approved.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && t.requested_by === c.userId) throw new AssetError(409, "The requester cannot approve their own transfer.", "SELF_APPROVAL_BLOCKED");
  return (await qx(client, `UPDATE tenant.asset_transfers SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *`, [t.id, c.userId])).rows[0];
}

export async function rejectAssetTransfer(client, c, transferId, reason) {
  need(c, "assets.manage");
  const res = await qx(client, `UPDATE tenant.asset_transfers SET status='rejected',approved_by=$4,approved_at=now(),rejected_reason=$5 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='submitted' RETURNING *`, [c.organizationId, c.companyId, uuid(transferId, "Transfer"), c.userId, requiredText(reason, "Reason", 500)]);
  if (!res.rows[0]) throw new AssetError(409, "Only a submitted transfer can be rejected.", "ASSET_STATE_INVALID");
  return res.rows[0];
}

export async function cancelAssetTransfer(client, c, transferId) {
  need(c, "assets.transfer");
  const res = await qx(client, `UPDATE tenant.asset_transfers SET status='cancelled' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('submitted','approved') AND requested_by=$4 RETURNING *`, [c.organizationId, c.companyId, uuid(transferId, "Transfer"), c.userId]);
  if (!res.rows[0]) throw new AssetError(409, "Only your own open transfer can be cancelled.", "ASSET_STATE_INVALID");
  return res.rows[0];
}

export async function completeAssetTransfer(client, c, transferId, options = {}) {
  need(c, "assets.transfer");
  const t = (await qx(client, `SELECT * FROM tenant.asset_transfers WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(transferId, "Transfer")])).rows[0];
  if (!t) throw new AssetError(404, "Transfer was not found.", "ASSET_NOT_FOUND");
  if (!options.skipApprovalCheck && t.status !== "approved") throw new AssetError(409, "A transfer must be approved before it is completed.", "ASSET_STATE_INVALID");
  if (options.skipApprovalCheck && t.status !== "submitted") throw new AssetError(409, "Transfer is not in a completable state.", "ASSET_STATE_INVALID");
  const a = await loadAsset(client, c, t.asset_id, { lock: true });
  if (!MOVABLE.includes(a.status)) throw new AssetError(409, "The asset is no longer in a state that can be transferred.", "ASSET_STATE_INVALID");
  const to = { branchId: t.to_branch_id, departmentId: t.to_department_id, costCenterId: t.to_cost_center_id, locationId: t.to_location_id, userId: t.to_user_id };
  await movement(client, c, a, "transfer", to, { effectiveDate: t.effective_date, referenceType: "asset_transfer", referenceId: t.id, reason: t.reason });
  if (to.userId) {
    await client.query(`UPDATE tenant.asset_assignments SET assignment_status='returned',returned_at=now(),returned_by=$3 WHERE organization_id=$1 AND asset_id=$2 AND assignment_status='active'`, [c.organizationId, a.id, c.userId]);
    await client.query(`INSERT INTO tenant.asset_assignments(organization_id,asset_id,assigned_to_user_id,assigned_to_department_id,assigned_to_cost_center_id,assigned_by) VALUES($1,$2,$3,$4,$5,$6)`, [c.organizationId, a.id, to.userId, to.departmentId ?? a.current_department_id, to.costCenterId ?? a.current_cost_center_id, c.userId]);
  }
  await client.query(
    `UPDATE tenant.assets SET branch_id=COALESCE($4,branch_id),current_department_id=COALESCE($5,current_department_id),current_cost_center_id=COALESCE($6,current_cost_center_id),location_id=COALESCE($7,location_id),
       current_user_id=COALESCE($8,current_user_id),status=CASE WHEN $8::uuid IS NOT NULL THEN 'assigned' ELSE status END,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [c.organizationId, c.companyId, a.id, to.branchId, to.departmentId, to.costCenterId, to.locationId, to.userId]);
  await recordAssetEvent(client, c, a.id, "asset.transferred", { transferId: t.id });
  return (await qx(client, `UPDATE tenant.asset_transfers SET status='completed',completed_by=$2,completed_at=now(),approved_by=COALESCE(approved_by,$2),approved_at=COALESCE(approved_at,now()) WHERE id=$1 RETURNING *`, [t.id, c.userId])).rows[0];
}

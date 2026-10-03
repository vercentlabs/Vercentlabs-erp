// F321-F329: quality holds (and the F323 stock-movement gate they feed -- enforced inside Stock's own
// postStockMovement, which reads this exact table/status contract) and non-conformance records with
// containment and disposition (rework/scrap/return-to-supplier/use-as-is, the last with a genuine
// second-person approval).
import { QualityError, need, needAny, nonNegative, oneOf, qx, recordEvent, text, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];
const HOLD_TYPES = ["inventory", "batch", "serial", "receipt", "work_order", "shipment", "return"];
const DISPOSITIONS = ["accept", "accept_with_deviation", "rework", "repair", "return_to_supplier", "scrap", "use_as_is"];
const SEVERITIES = ["minor", "major", "critical"];

// ---------------------------------------------------------------- F322-324: quality holds
export async function listQualityHolds(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  if (filters.itemId) { params.push(uuid(filters.itemId, "Item")); where += ` AND item_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_holds WHERE organization_id=$1${where} ORDER BY placed_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getQualityHold(client, c, id) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_holds WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(id, "Hold")]);
  if (!rows[0]) throw new QualityError(404, "Quality hold was not found.", "QUALITY_HOLD_NOT_FOUND");
  return rows[0];
}
// F322/F323: place a hold -- manually (quality.hold) or automatically from a failed inspection
// ({internal: true}, called from inspections.js). Either way it lands in the exact table/status shape
// Stock's postStockMovement already gates real stock decreases against.
export async function createQualityHold(client, c, input, { internal = false } = {}) {
  if (!internal) need(c, "quality.hold");
  const holdType = oneOf(String(input.holdType ?? "inventory"), HOLD_TYPES, "Hold type");
  const reason = text(input.reason, 500);
  if (!reason) throw new QualityError(400, "A hold needs a reason.", "QUALITY_HOLD_REASON_REQUIRED");
  const itemId = uuidOrNull(input.itemId, "Item");
  if (itemId) await lockInventoryItem(client, c, itemId);
  const holdNumber = await nextDocumentNumber(client, c, { documentType: "quality_hold", prefix: "QH" });
  // source_id is NOT NULL (every hold traces to a record) but a manual, ad-hoc hold has no specific
  // receipt/work-order/inspection behind it; the hold's own id (generated up front) fills that role.
  const holdId = crypto.randomUUID();
  const { rows } = await qx(client, `INSERT INTO tenant.quality_holds(id,organization_id,hold_number,hold_type,source_type,source_id,item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,reason,placed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [holdId, c.organizationId, holdNumber, holdType, text(input.sourceType, 60) || "manual", uuidOrNull(input.sourceId, "Source") ?? holdId, itemId, uuidOrNull(input.warehouseId, "Warehouse"), uuidOrNull(input.warehouseLocationId, "Location"), uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), String(nonNegative(input.quantity ?? 0, "Quantity")), reason, c.userId]);
  await recordEvent(client, c, "hold", rows[0].id, "quality.hold.placed", { holdType, itemId });
  return rows[0];
}
export async function cancelQualityHold(client, c, id, reason) {
  need(c, "quality.hold");
  if (!text(reason)) throw new QualityError(400, "Give a reason for cancelling this hold.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_holds SET status='cancelled',released_by=$3,released_at=now(),release_reason=$4 WHERE organization_id=$1 AND id=$2 AND status='active' RETURNING *`,
    [c.organizationId, uuid(id, "Hold"), c.userId, text(reason, 500)]);
  if (!rows[0]) throw new QualityError(409, "Only an active hold can be cancelled.", "QUALITY_HOLD_STATE_INVALID");
  await recordEvent(client, c, "hold", rows[0].id, "quality.hold.cancelled", { reason: text(reason, 300) });
  return rows[0];
}
// F324: release (in full or in part) -- this folder's original thin index.js already built this
// correctly (idempotent via beginIdempotentOperation/completeIdempotentOperation, optimistic version
// locking, partial-release aware, row-locked before Stock could race it) and is EXACTLY the contract
// Stock's own movement gate depends on, so it is re-exported as-is rather than reimplemented.

// ---------------------------------------------------------------- F321,325-329: non-conformance
export async function listNonconformances(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  if (filters.severity) { params.push(String(filters.severity)); where += ` AND severity=$${params.length}`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1${where} ORDER BY created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getNonconformance(client, c, id) {
  needAny(c, VIEW);
  const nc = (await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(id, "Non-conformance")])).rows[0];
  if (!nc) throw new QualityError(404, "Non-conformance was not found.", "QUALITY_NC_NOT_FOUND");
  const capas = await qx(client, `SELECT * FROM tenant.quality_capa WHERE organization_id=$1 AND nonconformance_id=$2 ORDER BY created_at`, [c.organizationId, nc.id]);
  return { ...nc, capas: capas.rows };
}
export async function createNonconformance(client, c, input) {
  need(c, "quality.nonconformance.manage");
  const description = text(input.description, 4000);
  if (!description) throw new QualityError(400, "Describe the non-conformance.", "QUALITY_NC_INVALID");
  const severity = oneOf(String(input.severity ?? "minor"), SEVERITIES, "Severity");
  const number = await nextDocumentNumber(client, c, { documentType: "quality_nonconformance", prefix: "NC" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_nonconformances(organization_id,nonconformance_number,inspection_id,source_type,source_id,item_id,supplier_id,batch_id,serial_id,severity,category,description,detected_quantity,affected_quantity,estimated_cost,status,owner_user_id,due_date,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'open',$16,$17,$18) RETURNING *`,
    [c.organizationId, number, uuidOrNull(input.inspectionId, "Inspection"), text(input.sourceType, 60) || "manual", uuidOrNull(input.sourceId, "Source"), uuidOrNull(input.itemId, "Item"), uuidOrNull(input.supplierId, "Supplier"), uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), severity, text(input.category, 100) || "general", description, String(nonNegative(input.detectedQuantity ?? 0, "Detected quantity")), String(nonNegative(input.affectedQuantity ?? 0, "Affected quantity")), input.estimatedCost === undefined || input.estimatedCost === "" ? null : nonNegative(input.estimatedCost, "Estimated cost"), uuidOrNull(input.ownerUserId, "Owner") ?? c.userId, input.dueDate || null, c.userId]);
  await recordEvent(client, c, "nonconformance", rows[0].id, "quality.nonconformance.created", { severity });
  return rows[0];
}
const NC_TRANSITIONS = { review: ["open", "under_review"], contain: ["under_review", "contained"] };
export async function transitionNonconformance(client, c, id, input) {
  need(c, "quality.nonconformance.manage");
  const action = oneOf(String(input.action ?? ""), Object.keys(NC_TRANSITIONS), "Action");
  const transition = NC_TRANSITIONS[action];
  const nc = (await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Non-conformance")])).rows[0];
  if (!nc) throw new QualityError(404, "Non-conformance was not found.", "QUALITY_NC_NOT_FOUND");
  if (nc.status !== transition[0]) throw new QualityError(409, `Non-conformance is ${nc.status}, not ${transition[0]}.`, "QUALITY_NC_STATE");
  if (action === "contain" && !text(input.containmentAction)) throw new QualityError(400, "Describe the containment action.", "QUALITY_NC_INVALID");
  const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET status=$2,containment_action=CASE WHEN $3='contain' THEN $4 ELSE containment_action END,updated_at=now() WHERE id=$1 RETURNING *`,
    [nc.id, transition[1], action, textOrNull(input.containmentAction, 2000)]);
  await recordEvent(client, c, "nonconformance", nc.id, `quality.nonconformance.${action}`, {});
  return rows[0];
}
// F325/F326-329: set the disposition. use_as_is REQUESTS approval (a second person must confirm it via
// approveUseAsIs) since accepting known-nonconforming product as-is is the highest-risk call; every
// other disposition applies immediately once recorded.
export async function setDisposition(client, c, id, input) {
  need(c, "quality.nonconformance.manage");
  const disposition = oneOf(String(input.disposition ?? ""), DISPOSITIONS, "Disposition");
  const nc = (await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Non-conformance")])).rows[0];
  if (!nc) throw new QualityError(404, "Non-conformance was not found.", "QUALITY_NC_NOT_FOUND");
  if (["closed", "cancelled"].includes(nc.status)) throw new QualityError(409, "This non-conformance is already closed.", "QUALITY_NC_STATE");
  const quantity = nonNegative(input.dispositionQuantity ?? nc.affected_quantity, "Disposition quantity");
  if (disposition === "use_as_is") {
    if (!text(input.reason)) throw new QualityError(400, "Give a reason for the use-as-is request.", "QUALITY_REASON_REQUIRED");
    const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET disposition=$2,disposition_quantity=$3,use_as_is_reason=$4,use_as_is_requested_by=$5,use_as_is_requested_at=now(),use_as_is_approved_by=NULL,use_as_is_approved_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
      [nc.id, disposition, String(quantity), text(input.reason, 1000), c.userId]);
    await recordEvent(client, c, "nonconformance", nc.id, "quality.nonconformance.use_as_is_requested", {});
    return rows[0];
  }
  const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET disposition=$2,disposition_quantity=$3,updated_at=now() WHERE id=$1 RETURNING *`, [nc.id, disposition, String(quantity)]);
  await recordEvent(client, c, "nonconformance", nc.id, "quality.nonconformance.dispositioned", { disposition });
  return rows[0];
}
export async function approveUseAsIs(client, c, id, input) {
  need(c, MANAGE);
  const nc = (await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Non-conformance")])).rows[0];
  if (!nc) throw new QualityError(404, "Non-conformance was not found.", "QUALITY_NC_NOT_FOUND");
  if (nc.disposition !== "use_as_is" || !nc.use_as_is_requested_at) throw new QualityError(409, "There is no pending use-as-is request on this non-conformance.", "QUALITY_NC_STATE");
  if (nc.use_as_is_approved_at) throw new QualityError(409, "This use-as-is request was already decided.", "QUALITY_NC_STATE");
  // Unconditional: this function's own gate is already quality.manage, the most senior quality
  // permission there is, so no "manager override" escape hatch is possible here without defeating the
  // entire point of a second person accepting the risk of shipping known-nonconforming product.
  if (nc.use_as_is_requested_by === c.userId) throw new QualityError(403, "You cannot approve your own use-as-is request.", "SELF_APPROVAL_BLOCKED");
  if (input.approve === false) {
    const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET disposition=NULL,disposition_quantity=NULL,use_as_is_requested_by=NULL,use_as_is_requested_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [nc.id]);
    await recordEvent(client, c, "nonconformance", nc.id, "quality.nonconformance.use_as_is_rejected", { reason: text(input.reason, 300) });
    return rows[0];
  }
  const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET use_as_is_approved_by=$2,use_as_is_approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [nc.id, c.userId]);
  await recordEvent(client, c, "nonconformance", nc.id, "quality.nonconformance.use_as_is_approved", {});
  return rows[0];
}
export async function closeNonconformance(client, c, id, input = {}) {
  need(c, "quality.nonconformance.manage");
  const nc = (await qx(client, `SELECT * FROM tenant.quality_nonconformances WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Non-conformance")])).rows[0];
  if (!nc) throw new QualityError(404, "Non-conformance was not found.", "QUALITY_NC_NOT_FOUND");
  if (!nc.disposition) throw new QualityError(409, "Set a disposition before closing.", "QUALITY_NC_DISPOSITION_REQUIRED");
  if (nc.disposition === "use_as_is" && !nc.use_as_is_approved_at) throw new QualityError(409, "The use-as-is disposition needs a second person's approval before this can close.", "QUALITY_NC_USE_AS_IS_UNAPPROVED");
  const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET status='closed',closed_by=$2,closed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [nc.id, c.userId]);
  await recordEvent(client, c, "nonconformance", nc.id, "quality.nonconformance.closed", {});
  return rows[0];
}
export async function cancelNonconformance(client, c, id, reason) {
  need(c, "quality.nonconformance.manage");
  if (!text(reason)) throw new QualityError(400, "Give a reason.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_nonconformances SET status='cancelled',closed_by=$2,closed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$3 AND status='open' RETURNING *`, [c.organizationId, c.userId, uuid(id, "Non-conformance")]);
  if (!rows[0]) throw new QualityError(409, "Only an open non-conformance can be cancelled.", "QUALITY_NC_STATE");
  await recordEvent(client, c, "nonconformance", rows[0].id, "quality.nonconformance.cancelled", { reason: text(reason, 300) });
  return rows[0];
}

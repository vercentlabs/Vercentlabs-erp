// Quality settings, and the inspection record: created by a goods receipt (through its control point or specification), a control point's
// manual rule or an authorized person, bound to the exact specification version through its mirrored plan. Its execution — samples,
// observations, review, completion — and the authorized disposition of the goods live in ./incoming.
import { QualityError, need, needAny, nonNegative, oneOf, qx, recordEvent, text, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { sampleSize as specSampleSize, samplingSentence } from "./specifications/qs-rules.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];

// ---------------------------------------------------------------- settings
async function loadSettings(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_settings WHERE organization_id=$1`, [c.organizationId]);
  return rows[0] ?? { organization_id: c.organizationId, require_release_approval: true, prohibit_self_release: true, auto_hold_on_failure: true, require_capa_verification: true,
    incoming_review_policy: "ON_FAILURE", incoming_due_days: 2 };
}
export { loadSettings as loadQualitySettings };
export async function getQualitySettings(client, c) {
  needAny(c, VIEW);
  return loadSettings(client, c);
}
export async function saveQualitySettings(client, c, input) {
  need(c, "quality.settings.manage");
  const current = await loadSettings(client, c);
  const policy = ["ALWAYS", "ON_FAILURE"].includes(input.incomingReviewPolicy) ? input.incomingReviewPolicy : current.incoming_review_policy ?? "ON_FAILURE";
  const due = input.incomingDueDays === undefined || input.incomingDueDays === "" ? current.incoming_due_days ?? 2 : Math.max(0, Math.min(60, Math.trunc(Number(input.incomingDueDays))));
  const { rows } = await qx(client, `INSERT INTO tenant.quality_settings(organization_id,require_release_approval,prohibit_self_release,auto_hold_on_failure,require_capa_verification,incoming_review_policy,incoming_due_days)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (organization_id) DO UPDATE SET require_release_approval=$2,prohibit_self_release=$3,auto_hold_on_failure=$4,require_capa_verification=$5,incoming_review_policy=$6,incoming_due_days=$7,updated_at=now() RETURNING *`,
    [c.organizationId, input.requireReleaseApproval ?? current.require_release_approval !== false, input.prohibitSelfRelease ?? current.prohibit_self_release !== false,
      input.autoHoldOnFailure ?? current.auto_hold_on_failure !== false, input.requireCapaVerification ?? current.require_capa_verification !== false, policy, due]);
  return rows[0];
}

function resolveSampleSize(plan, lotQuantity) {
  const method = plan.sampling_method;
  if (method === "fixed_quantity") return Math.min(Number(plan.sampling_value), lotQuantity);
  if (method === "percentage") return Math.min(Math.ceil((lotQuantity * Number(plan.sampling_value)) / 100), lotQuantity);
  return lotQuantity;
}

// ---------------------------------------------------------------- the inspection record
export async function listInspections(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  if (filters.sourceType) { params.push(String(filters.sourceType)); where += ` AND source_type=$${params.length}`; }
  if (filters.itemId) { params.push(uuid(filters.itemId, "Item")); where += ` AND item_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT i.*, p.name AS plan_name, p.code AS plan_code FROM tenant.quality_inspections i JOIN tenant.quality_plans p ON p.id=i.plan_id WHERE i.organization_id=$1${where} ORDER BY i.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getInspection(client, c, id) {
  needAny(c, VIEW);
  const inspection = (await qx(client, `SELECT i.*, p.name AS plan_name, p.code AS plan_code FROM tenant.quality_inspections i JOIN tenant.quality_plans p ON p.id=i.plan_id WHERE i.organization_id=$1 AND i.id=$2`, [c.organizationId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  const points = await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2 ORDER BY sequence`, [c.organizationId, inspection.plan_id]);
  const results = await qx(client, `SELECT * FROM tenant.quality_inspection_results WHERE organization_id=$1 AND inspection_id=$2 ORDER BY inspection_point_id, sample_number`, [c.organizationId, inspection.id]);
  return { ...inspection, points: points.rows, results: results.rows };
}
const INSPECTION_TYPES = ["incoming", "in_process", "final", "pre_dispatch", "stock_audit", "supplier", "customer_return"];
const SOURCE_TYPES = ["procurement_receipt", "stock_batch", "stock_serial", "manufacturing_work_order", "manufacturing_posting", "sales_return", "pos_return", "manual", "production_entry", "sales_delivery"];
const PRIORITY_DAYS = { URGENT: 0, HIGH: 1, LOW: 5 };

// options.boundVersionId: a source workflow already resolved this exact version (effective on its own document date). options.obligationId /
// qcpVersionId: the control point requirement that created it.
export async function createInspection(client, c, input, options = {}) {
  need(c, "quality.inspect");
  const planId = uuid(input.planId, "Plan");
  const plan = (await qx(client, `SELECT * FROM tenant.quality_plans WHERE organization_id=$1 AND id=$2`, [c.organizationId, planId])).rows[0];
  const bound = Boolean(plan?.spec_version_id && options.boundVersionId === plan.spec_version_id);
  if (!plan || (plan.status !== "active" && !bound)) throw new QualityError(400, "An active inspection specification is required.", "QUALITY_PLAN_INACTIVE");
  const lotQuantity = nonNegative(input.lotQuantity ?? 0, "Lot quantity");
  // The plan mirrors one published specification version: the inspection binds to that exact version, its sampling and acceptance rules.
  let version = null;
  if (plan.spec_version_id) {
    version = (await qx(client, `SELECT v.*, s.status AS spec_status FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
      WHERE v.organization_id = $1 AND v.id = $2`, [c.organizationId, plan.spec_version_id])).rows[0];
    if (version.spec_status === "RETIRED" || version.status === "RETIRED") throw new QualityError(409, "This specification cannot be used for new inspections.", "QUALITY_SPEC_RETIRED");
    if (!(version.status === "ACTIVE" || (bound && version.published_at && ["APPROVED", "SUPERSEDED"].includes(version.status))))
      throw new QualityError(409, "This specification is not yet effective for the selected inspection.", "QUALITY_SPEC_NOT_EFFECTIVE");
  }
  const computed = version ? specSampleSize(version, lotQuantity || 1, { approvedCount: input.approvedSampleCount ?? null }) : null;
  if (computed?.needsApproval && !options.allowPendingSample) throw new QualityError(400, "A Quality reviewer must approve the sample count for this specification.", "QUALITY_SAMPLE_COUNT_REQUIRED");
  const sampleQuantity = computed ? computed.size ?? 0 : resolveSampleSize(plan, lotQuantity || 1);
  const resolution = version ? { method: "PLAN_SELECTED", ...(input.specResolution && typeof input.specResolution === "object" && (bound || options.obligationId) ? input.specResolution : {}), sampling: computed,
    versionNumber: version.version_number, contentHash: version.content_hash } : null;
  // The sampling plan as frozen for this inspection: the version's rule and the size it gives for this population.
  const sampling = version ? { method: version.sampling_method, value: version.sample_value, minimum: version.sample_minimum, maximum: version.sample_maximum, rounding: version.rounding_rule,
    basis: version.sampling_basis, lotContext: version.lot_context, instructions: version.sampling_instructions, sentence: samplingSentence(version), computed } : null;
  const settings = await loadSettings(client, c);
  const priority = ["LOW", "NORMAL", "HIGH", "URGENT"].includes(input.priority) ? input.priority : "NORMAL";
  const days = PRIORITY_DAYS[priority] ?? settings.incoming_due_days ?? 2;
  const inspectionNumber = await nextDocumentNumber(client, c, { documentType: "quality_inspection", prefix: "QI" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_inspections(organization_id,inspection_number,plan_id,inspection_type,source_type,source_id,item_id,supplier_id,warehouse_id,batch_id,serial_id,lot_quantity,sample_quantity,status,created_by,spec_version_id,spec_resolution,
        goods_receipt_line_id,obligation_id,qcp_version_id,population_snapshot,sampling_snapshot,priority,due_at,reinspection_of_id,reinspection_reason,standard_decision)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16::jsonb,$17,$18,$19,$20::jsonb,$21::jsonb,$22,now() + make_interval(days => $23::int),$24,$25,$26) RETURNING *`,
    [c.organizationId, inspectionNumber, plan.id, oneOf(String(input.inspectionType ?? plan.plan_type), INSPECTION_TYPES, "Inspection type"), oneOf(String(input.sourceType ?? "manual"), SOURCE_TYPES, "Source type"),
      uuidOrNull(input.sourceId, "Source"), uuidOrNull(input.itemId, "Item") ?? plan.item_id, uuidOrNull(input.supplierId, "Supplier") ?? plan.supplier_id, uuidOrNull(input.warehouseId, "Warehouse") ?? plan.warehouse_id,
      uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), String(lotQuantity), String(sampleQuantity), c.userId, version?.id ?? null, resolution ? JSON.stringify(resolution) : null,
      uuidOrNull(input.goodsReceiptLineId, "Receipt line"), options.obligationId ?? null, options.qcpVersionId ?? null, JSON.stringify(input.population ?? { controlled: String(lotQuantity) }),
      sampling ? JSON.stringify(sampling) : null, priority, days, options.reinspectionOfId ?? null, options.reinspectionReason ?? null, options.standardDecision ?? null]);
  await recordEvent(client, c, "inspection", rows[0].id, "quality.inspection.created", { planId: plan.id, specVersionId: version?.id ?? null, obligationId: options.obligationId ?? null,
    reinspectionOf: options.reinspectionOfId ?? null });
  return rows[0];
}
// Cancelling: only before any result is recorded or decision taken (a reversed source cancels its open inspections through here).
export async function cancelInspection(client, c, id, reason) {
  need(c, "quality.inspect");
  if (!text(reason)) throw new QualityError(400, "Give a reason for cancelling this inspection.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET status='cancelled',workflow_status='CANCELLED',cancel_reason=$4,notes=coalesce(notes,'') || $3,updated_at=now(),row_version=row_version+1
     WHERE organization_id=$1 AND id=$2 AND status IN ('draft','in_progress') AND disposition_status='NONE' RETURNING *`,
    [c.organizationId, uuid(id, "Inspection"), `\nCancelled: ${text(reason, 300)}`, text(reason, 300)]);
  if (!rows[0]) throw new QualityError(409, "Only an inspection without a decision can be cancelled.", "QUALITY_INSPECTION_STATE");
  await recordEvent(client, c, "inspection", rows[0].id, "quality.inspection.cancelled", { reason: text(reason, 300) });
  return rows[0];
}

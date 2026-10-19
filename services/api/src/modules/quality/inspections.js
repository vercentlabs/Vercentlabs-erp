// F308-F320: quality standards/plans (inspection specifications with points, tolerances and sample size),
// incoming/in-process/final inspection, measurement and pass/fail checks, and inspection results —
// the server computes pass/fail from each point's own tolerance/allowed-values rather than trusting a
// caller-supplied verdict, a real integrity improvement over this folder's original thin stub.
import { notifyPermissionHolders } from "../../core/platform/notifications/index.js";
import { QualityError, has, need, needAny, nonNegative, oneOf, qx, recordEvent, text, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { noteInspectionOnHold } from "../stock/quality-holds.js";
import { aggregateOutcome, evaluateCharacteristic, sampleSize as specSampleSize } from "./specifications/qs-rules.js";
import { noteObligationInspection } from "./control-points/qcp-engine.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];

// ---------------------------------------------------------------- settings
async function loadSettings(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_settings WHERE organization_id=$1`, [c.organizationId]);
  return rows[0] ?? { organization_id: c.organizationId, require_release_approval: true, prohibit_self_release: true, auto_hold_on_failure: true, require_capa_verification: true };
}
export async function getQualitySettings(client, c) {
  needAny(c, VIEW);
  return loadSettings(client, c);
}
export async function saveQualitySettings(client, c, input) {
  need(c, "quality.settings.manage");
  const { rows } = await qx(client, `INSERT INTO tenant.quality_settings(organization_id,require_release_approval,prohibit_self_release,auto_hold_on_failure,require_capa_verification) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (organization_id) DO UPDATE SET require_release_approval=$2,prohibit_self_release=$3,auto_hold_on_failure=$4,require_capa_verification=$5,updated_at=now() RETURNING *`,
    [c.organizationId, input.requireReleaseApproval !== false, input.prohibitSelfRelease !== false, input.autoHoldOnFailure !== false, input.requireCapaVerification !== false]);
  return rows[0];
}

function resolveSampleSize(plan, lotQuantity) {
  const method = plan.sampling_method;
  if (method === "fixed_quantity") return Math.min(Number(plan.sampling_value), lotQuantity);
  if (method === "percentage") return Math.min(Math.ceil((lotQuantity * Number(plan.sampling_value)) / 100), lotQuantity);
  return lotQuantity;
}

// Inspection plans are no longer written here: each published Inspection Specification version is mirrored as a plan
// (./specifications), which an inspection binds to together with the exact version.

// ---------------------------------------------------------------- F312-320: inspections
const INSPECTION_TYPES = ["incoming", "in_process", "final", "stock_audit", "supplier", "customer_return"];
const SOURCE_TYPES = ["procurement_receipt", "stock_batch", "stock_serial", "manufacturing_work_order", "manufacturing_posting", "sales_return", "pos_return", "manual"];

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
// options.boundVersionId: a source workflow already resolved this exact version (effective on its own document date).
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
  const resolution = version ? { method: "PLAN_SELECTED", ...(input.specResolution && typeof input.specResolution === "object" && bound ? input.specResolution : {}), sampling: computed,
    versionNumber: version.version_number, contentHash: version.content_hash } : null;
  const inspectionNumber = await nextDocumentNumber(client, c, { documentType: "quality_inspection", prefix: "QI" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_inspections(organization_id,inspection_number,plan_id,inspection_type,source_type,source_id,item_id,supplier_id,warehouse_id,batch_id,serial_id,lot_quantity,sample_quantity,status,created_by,spec_version_id,spec_resolution)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16::jsonb) RETURNING *`,
    [c.organizationId, inspectionNumber, plan.id, oneOf(String(input.inspectionType ?? plan.plan_type), INSPECTION_TYPES, "Inspection type"), oneOf(String(input.sourceType ?? "manual"), SOURCE_TYPES, "Source type"), uuidOrNull(input.sourceId, "Source"), uuidOrNull(input.itemId, "Item") ?? plan.item_id, uuidOrNull(input.supplierId, "Supplier") ?? plan.supplier_id, uuidOrNull(input.warehouseId, "Warehouse") ?? plan.warehouse_id, uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), String(lotQuantity), String(sampleQuantity), c.userId, version?.id ?? null, resolution ? JSON.stringify(resolution) : null]);
  await recordEvent(client, c, "inspection", rows[0].id, "quality.inspection.created", { planId: plan.id, specVersionId: version?.id ?? null });
  return getInspection(client, c, rows[0].id);
}

// A specification-bound point is evaluated by its characteristic's definition (decimal-safe limits, inclusive / exclusive boundaries, approved
// conversions): a missing or invalid observation is incomplete, never a pass.
function specObservation(ch, result) {
  const status = String(result.resultStatus ?? "").toLowerCase();
  if (status === "not_applicable") return { notApplicable: true };
  switch (ch.check_type) {
    case "NUMERIC_RANGE": case "NUMERIC_TARGET_TOLERANCE":
      return { value: result.numericValue === undefined || result.numericValue === null || result.numericValue === "" ? null : String(result.numericValue).trim(), unit: result.unit };
    case "BOOLEAN":
      return { value: result.booleanValue === true || result.booleanValue === false ? result.booleanValue : status ? (status === "pass") === (ch.expected_boolean !== false) : null };
    case "ENUM": return { choice: result.textValue };
    case "VISUAL": return { judgement: status || (result.booleanValue === true ? "pass" : result.booleanValue === false ? "fail" : "") };
    default: return { value: result.textValue || result.remarks || status || null, note: result.remarks, judgement: status };
  }
}
function checkSpecified(point, ch, result) {
  const evaluated = evaluateCharacteristic(ch, specObservation(ch, result));
  if (evaluated.outcome === "PASS") return "pass";
  if (evaluated.outcome === "FAIL") return "fail";
  if (evaluated.outcome === "NOT_APPLICABLE" || evaluated.outcome === "RECORDED") return "not_applicable";
  throw new QualityError(400, `${point.characteristic}: ${evaluated.reason ?? "record a valid result."}`, evaluated.outcome === "INVALID_UNIT" ? "QUALITY_SPEC_UOM_INVALID" : "QUALITY_RESULT_INVALID");
}
const specCharacteristics = async (client, c, points) => {
  const ids = points.map((p) => p.spec_characteristic_id).filter(Boolean);
  if (!ids.length) return new Map();
  return new Map((await qx(client, `SELECT * FROM tenant.quality_inspection_characteristics WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids])).rows.map((ch) => [ch.id, ch]));
};
function checkTolerance(point, result) {
  if (point.result_type === "numeric") {
    const v = result.numericValue === undefined || result.numericValue === "" ? null : Number(result.numericValue);
    if (v === null || Number.isNaN(v)) throw new QualityError(400, `${point.characteristic} needs a numeric value.`, "QUALITY_RESULT_INVALID");
    const lower = point.lower_limit === null ? -Infinity : Number(point.lower_limit);
    const upper = point.upper_limit === null ? Infinity : Number(point.upper_limit);
    return v >= lower && v <= upper ? "pass" : "fail";
  }
  if (point.result_type === "selection") {
    const v = text(result.textValue, 60);
    if (!v) throw new QualityError(400, `${point.characteristic} needs a selected value.`, "QUALITY_RESULT_INVALID");
    return (point.allowed_values ?? []).includes(v) ? "pass" : "fail";
  }
  // boolean/text: the inspector states the verdict directly (there is no server-derivable tolerance)
  return oneOf(String(result.resultStatus ?? ""), ["pass", "fail", "not_applicable"], `${point.characteristic}'s result`);
}
export async function recordInspectionResults(client, c, id, input) {
  need(c, "quality.inspect");
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["draft", "in_progress"].includes(inspection.status)) throw new QualityError(409, "This inspection is not open for results.", "QUALITY_INSPECTION_STATE");
  const points = (await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2`, [c.organizationId, inspection.plan_id])).rows;
  const byId = new Map(points.map((p) => [p.id, p]));
  const specified = await specCharacteristics(client, c, points);
  const results = Array.isArray(input.results) ? input.results : [];
  if (!results.length) throw new QualityError(400, "At least one result is required.", "QUALITY_RESULT_REQUIRED");
  let anyFail = false;
  let anyCriticalFail = false;
  let nonConformingSamples = 0;
  for (const result of results) {
    const point = byId.get(String(result.inspectionPointId));
    if (!point) throw new QualityError(400, "That inspection point does not belong to this inspection's plan.", "QUALITY_POINT_MISMATCH");
    const ch = point.spec_characteristic_id ? specified.get(point.spec_characteristic_id) : null;
    const status = ch ? checkSpecified(point, ch, result) : checkTolerance(point, result);
    if (status === "fail") { anyFail = true; nonConformingSamples += 1; if (point.critical) anyCriticalFail = true; }
    await qx(client, `INSERT INTO tenant.quality_inspection_results(organization_id,inspection_id,inspection_point_id,sample_number,numeric_value,boolean_value,text_value,result_status,remarks,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (inspection_id,inspection_point_id,sample_number) DO UPDATE SET numeric_value=EXCLUDED.numeric_value,boolean_value=EXCLUDED.boolean_value,text_value=EXCLUDED.text_value,result_status=EXCLUDED.result_status,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by,recorded_at=now()`,
      [c.organizationId, inspection.id, point.id, Math.trunc(nonNegative(result.sampleNumber ?? 1, "Sample number", 1)) || 1, result.numericValue ?? null, result.booleanValue ?? null, point.result_type === "selection" ? text(result.textValue, 120) : (result.textValue ?? null), status,
        textOrNull(result.remarks, 500) ?? (ch?.judgement === "INFORMATIONAL" ? "Recorded (information only)" : null), c.userId]);
  }
  await qx(client, `UPDATE tenant.quality_inspections SET status='in_progress',updated_at=now() WHERE id=$1`, [inspection.id]);
  return { anyFail, anyCriticalFail, nonConformingSamples, ...(await getInspection(client, c, inspection.id)) };
}
export async function completeInspection(client, c, id, input = {}) {
  need(c, "quality.inspect");
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["draft", "in_progress"].includes(inspection.status)) throw new QualityError(409, "This inspection is already finalized.", "QUALITY_INSPECTION_STATE");
  const results = (await qx(client, `SELECT * FROM tenant.quality_inspection_results WHERE organization_id=$1 AND inspection_id=$2`, [c.organizationId, inspection.id])).rows;
  if (!results.length) throw new QualityError(400, "Record results before completing the inspection.", "QUALITY_RESULT_REQUIRED");
  const points = (await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2`, [c.organizationId, inspection.plan_id])).rows;
  const criticalIds = new Set(points.filter((p) => p.critical).map((p) => p.id));
  const failed = results.filter((r) => r.result_status === "fail");
  const anyCriticalFail = failed.some((r) => criticalIds.has(r.inspection_point_id));

  let overall = anyCriticalFail || failed.length ? "failed" : "passed";
  if (inspection.spec_version_id) {
    // The bound version's decision rule: every required check, allowed defects per severity, or an authorized review. A critical failure
    // always fails; informational checks never decide.
    const version = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE id = $1`, [inspection.spec_version_id])).rows[0];
    const chars = (await qx(client, `SELECT * FROM tenant.quality_inspection_characteristics WHERE version_id = $1 ORDER BY sequence`, [inspection.spec_version_id])).rows;
    const charOf = new Map(points.map((p) => [p.id, p.spec_characteristic_id]));
    const numbers = [...new Set(results.map((r) => r.sample_number))].sort((a, b) => a - b);
    const outcome = { pass: "PASS", fail: "FAIL", not_applicable: "NOT_APPLICABLE" };
    const proposal = aggregateOutcome(version, chars, numbers.map((n) => ({ results: Object.fromEntries(results.filter((r) => r.sample_number === n)
      .map((r) => [charOf.get(r.inspection_point_id), { outcome: outcome[r.result_status] }])) })));
    if (proposal.proposed === "INCOMPLETE") throw new QualityError(400, "Record every required check of each inspected sample before completing.", "QUALITY_RESULT_REQUIRED");
    if (proposal.proposed === "REVIEW_REQUIRED") {
      if (!["passed", "failed"].includes(input.reviewDecision)) throw new QualityError(409, "This specification needs an authorized review decision (passed or failed).", "QUALITY_REVIEW_REQUIRED");
      if (!has(c, "quality.release") && !has(c, MANAGE)) throw new QualityError(403, "Only someone who may release inspections can decide this review.", "QUALITY_FORBIDDEN");
      overall = input.reviewDecision;
    } else overall = proposal.proposed === "PASS" ? "passed" : "failed";
  }
  const lot = Number(inspection.lot_quantity);
  const rejectedRatio = results.length ? failed.length / results.length : 0;
  const rejectedQuantity = overall === "failed" ? Math.max(Math.round(lot * rejectedRatio), lot > 0 ? 1 : 0) : Number(input.rejectedQuantity ?? 0);
  const acceptedQuantity = Math.max(lot - rejectedQuantity, 0);

  await qx(client, `UPDATE tenant.quality_inspections SET status=$3,overall_result=$3,accepted_quantity=$4,rejected_quantity=$5,inspected_by=$6,inspected_at=now(),notes=$7,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, inspection.id, overall, String(acceptedQuantity), String(rejectedQuantity), c.userId, textOrNull(input.notes, 2000)]);

  // The inspected stock is on an Inventory Quality Hold (a goods receipt puts it there): the outcome is recorded on that hold, where Quality
  // releases, escalates or disposes of it.
  if (inspection.source_id && inspection.item_id) await noteInspectionOnHold(client, c, { sourceDocumentId: inspection.source_id, itemId: inspection.item_id, result: overall === "failed" ? (acceptedQuantity > 0 ? "partial_pass" : "fail") : "pass",
    inspectionNumber: inspection.inspection_number, accepted: acceptedQuantity, rejected: rejectedQuantity });
  await noteObligationInspection(client, c, inspection.id, { overall, accepted: acceptedQuantity, rejected: rejectedQuantity });
  await recordEvent(client, c, "inspection", inspection.id, "quality.inspection.completed", { overall });
  if (overall === "failed")
    await notifyPermissionHolders(client, c, "quality.manage", { category: "quality_issue", title: `Inspection ${inspection.inspection_number ?? ""} failed`.replace("  ", " "),
      message: `${rejectedQuantity} of ${lot} rejected. Raise a non-conformance or decide what happens to the stock.`, href: `/quality/inspection/${inspection.id}`,
      entityType: "quality_inspection", entityId: inspection.id });
  return getInspection(client, c, inspection.id);
}
export async function releaseInspection(client, c, id, input = {}) {
  need(c, "quality.release");
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["passed", "conditionally_accepted"].includes(inspection.status)) throw new QualityError(409, "Only a passed or conditionally accepted inspection can be released.", "QUALITY_INSPECTION_STATE");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_release && inspection.inspected_by === c.userId && !has(c, MANAGE)) throw new QualityError(403, "The inspector cannot release their own inspection.", "SELF_APPROVAL_BLOCKED");
  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET released_by=$3,released_at=now(),notes=coalesce($4,notes),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, inspection.id, c.userId, textOrNull(input.notes, 2000)]);
  await recordEvent(client, c, "inspection", inspection.id, "quality.inspection.released", {});
  return rows[0];
}
export async function cancelInspection(client, c, id, reason) {
  need(c, "quality.inspect");
  if (!text(reason)) throw new QualityError(400, "Give a reason for cancelling this inspection.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET status='cancelled',notes=coalesce(notes,'') || $3,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('draft','in_progress') RETURNING *`,
    [c.organizationId, uuid(id, "Inspection"), `\nCancelled: ${text(reason, 300)}`]);
  if (!rows[0]) throw new QualityError(409, "Only a draft or in-progress inspection can be cancelled.", "QUALITY_INSPECTION_STATE");
  return rows[0];
}

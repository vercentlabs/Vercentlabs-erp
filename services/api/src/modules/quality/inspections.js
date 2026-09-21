// F308-F320: quality standards/plans (with inspection points and tolerances), sampling plans (AQL),
// incoming/in-process/final inspection, measurement and pass/fail checks, and inspection results —
// the server computes pass/fail from each point's own tolerance/allowed-values rather than trusting a
// caller-supplied verdict, a real integrity improvement over this folder's original thin stub.
import { QualityError, has, need, needAny, nonNegative, oneOf, positive, qx, recordEvent, text, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/document-numbering.js";
import { createQualityHold } from "./nonconformance.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];
const RESULT_TYPES = ["numeric", "boolean", "text", "selection"];
const SAMPLING_METHODS = ["full", "fixed_quantity", "percentage", "aql"];
const PLAN_TYPES = ["incoming", "in_process", "final", "stock_audit", "supplier", "customer_return"];

// ---------------------------------------------------------------- settings
async function loadSettings(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return rows[0] ?? { organization_id: c.organizationId, company_id: c.companyId, require_release_approval: true, prohibit_self_release: true, auto_hold_on_failure: true, require_capa_verification: true };
}
export async function getQualitySettings(client, c) {
  needAny(c, VIEW);
  return loadSettings(client, c);
}
export async function saveQualitySettings(client, c, input) {
  need(c, "quality.settings.manage");
  const { rows } = await qx(client, `INSERT INTO tenant.quality_settings(organization_id,company_id,require_release_approval,prohibit_self_release,auto_hold_on_failure,require_capa_verification) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (organization_id,company_id) DO UPDATE SET require_release_approval=$3,prohibit_self_release=$4,auto_hold_on_failure=$5,require_capa_verification=$6,updated_at=now() RETURNING *`,
    [c.organizationId, c.companyId, input.requireReleaseApproval !== false, input.prohibitSelfRelease !== false, input.autoHoldOnFailure !== false, input.requireCapaVerification !== false]);
  return rows[0];
}

// ---------------------------------------------------------------- F315: AQL sampling plans
export async function listSamplingPlans(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_sampling_plans WHERE organization_id=$1 AND company_id=$2 ORDER BY code, lot_size_from`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveSamplingPlan(client, c, input) {
  need(c, "quality.sampling.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new QualityError(400, "A sampling plan needs a code and a name.", "QUALITY_SAMPLING_INVALID");
  const lotFrom = Math.trunc(positive(input.lotSizeFrom, "Lot size from"));
  const lotTo = input.lotSizeTo === undefined || input.lotSizeTo === "" ? null : Math.trunc(positive(input.lotSizeTo, "Lot size to"));
  if (lotTo !== null && lotTo < lotFrom) throw new QualityError(400, "Lot size to cannot be less than lot size from.", "QUALITY_SAMPLING_INVALID");
  const sampleSize = Math.trunc(positive(input.sampleSize, "Sample size"));
  const acceptanceNumber = Math.trunc(nonNegative(input.acceptanceNumber ?? 0, "Acceptance number"));
  const rejectionNumber = Math.trunc(positive(input.rejectionNumber, "Rejection number"));
  if (rejectionNumber < acceptanceNumber) throw new QualityError(400, "The rejection number cannot be less than the acceptance number.", "QUALITY_SAMPLING_INVALID");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.quality_sampling_plans SET name=$4,aql_level=$5,lot_size_from=$6,lot_size_to=$7,sample_size=$8,acceptance_number=$9,rejection_number=$10,active=$11 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Sampling plan"), name, textOrNull(input.aqlLevel, 10) ?? "II", lotFrom, lotTo, sampleSize, acceptanceNumber, rejectionNumber, input.active !== false]);
    if (!rows[0]) throw new QualityError(404, "Sampling plan was not found.", "QUALITY_SAMPLING_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.quality_sampling_plans(organization_id,company_id,code,name,aql_level,lot_size_from,lot_size_to,sample_size,acceptance_number,rejection_number,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [c.organizationId, c.companyId, code, name, textOrNull(input.aqlLevel, 10) ?? "II", lotFrom, lotTo, sampleSize, acceptanceNumber, rejectionNumber, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new QualityError(409, `Sampling plan ${code} already exists.`, "QUALITY_SAMPLING_DUPLICATE");
    throw e;
  }
}
async function resolveSampleSize(client, c, plan, lotQuantity, samplingPlanCode) {
  const method = plan.sampling_method;
  if (method === "full") return { sampleQuantity: lotQuantity, samplingPlan: null };
  if (method === "fixed_quantity") return { sampleQuantity: Math.min(Number(plan.sampling_value), lotQuantity), samplingPlan: null };
  if (method === "percentage") return { sampleQuantity: Math.min(Math.ceil((lotQuantity * Number(plan.sampling_value)) / 100), lotQuantity), samplingPlan: null };
  // aql
  const code = text(samplingPlanCode, 30).toUpperCase();
  if (!code) throw new QualityError(400, "This plan samples by AQL; give the sampling plan code to use.", "QUALITY_SAMPLING_REQUIRED");
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_sampling_plans WHERE organization_id=$1 AND company_id=$2 AND code=$3 AND active AND lot_size_from<=$4 AND (lot_size_to IS NULL OR lot_size_to>=$4)`, [c.organizationId, c.companyId, code, lotQuantity]);
  const samplingPlan = rows[0];
  if (!samplingPlan) throw new QualityError(400, `No active sampling plan ${code} covers a lot size of ${lotQuantity}.`, "QUALITY_SAMPLING_NOT_FOUND");
  return { sampleQuantity: Math.min(Number(samplingPlan.sample_size), lotQuantity), samplingPlan };
}

// ---------------------------------------------------------------- F308-311/F318: quality plans
export async function listQualityPlans(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.planType) { params.push(String(filters.planType)); where += ` AND plan_type=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  if (filters.itemId) { params.push(uuid(filters.itemId, "Item")); where += ` AND item_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT p.*, (SELECT count(*)::int FROM tenant.quality_inspection_points pt WHERE pt.plan_id=p.id) AS point_count FROM tenant.quality_plans p WHERE organization_id=$1 AND company_id=$2${where} ORDER BY code, version DESC`, params);
  return rows;
}
export async function getQualityPlan(client, c, id) {
  needAny(c, VIEW);
  const plan = (await qx(client, `SELECT * FROM tenant.quality_plans WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Plan")])).rows[0];
  if (!plan) throw new QualityError(404, "Quality plan was not found.", "QUALITY_PLAN_NOT_FOUND");
  const points = await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2 ORDER BY sequence`, [c.organizationId, plan.id]);
  return { ...plan, points: points.rows };
}
function validatePoint(point, index) {
  const characteristic = text(point.characteristic, 200);
  if (!characteristic) throw new QualityError(400, `Point ${index + 1} needs a characteristic.`, "QUALITY_POINT_INVALID");
  const resultType = oneOf(String(point.resultType ?? "boolean"), RESULT_TYPES, `Point ${index + 1} result type`);
  if (resultType === "numeric") {
    const lower = point.lowerLimit === undefined || point.lowerLimit === "" ? null : Number(point.lowerLimit);
    const upper = point.upperLimit === undefined || point.upperLimit === "" ? null : Number(point.upperLimit);
    if (lower !== null && upper !== null && lower > upper) throw new QualityError(400, `Point ${index + 1}: the lower limit is above the upper limit.`, "QUALITY_POINT_INVALID");
  }
  if (resultType === "selection" && !(Array.isArray(point.allowedValues) && point.allowedValues.length)) throw new QualityError(400, `Point ${index + 1}: a selection check needs allowed values.`, "QUALITY_POINT_INVALID");
  return { characteristic, inspectionMethod: text(point.inspectionMethod, 200) || "Visual", resultType, lowerLimit: point.lowerLimit ?? null, targetValue: point.targetValue ?? null, upperLimit: point.upperLimit ?? null, unit: textOrNull(point.unit, 30), allowedValues: resultType === "selection" ? point.allowedValues.map((v) => text(v, 60)) : [], critical: Boolean(point.critical), destructive: Boolean(point.destructive), instructions: textOrNull(point.instructions, 1000) };
}
export async function createQualityPlan(client, c, input) {
  need(c, "quality.plan.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 200);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new QualityError(400, "A quality plan needs a code and a name.", "QUALITY_PLAN_INVALID");
  const planType = oneOf(String(input.planType ?? "incoming"), PLAN_TYPES, "Plan type");
  const points = Array.isArray(input.points) ? input.points : [];
  if (!points.length) throw new QualityError(400, "A quality plan needs at least one inspection point.", "QUALITY_PLAN_INVALID");
  const validated = points.map(validatePoint);
  const samplingMethod = oneOf(String(input.samplingMethod ?? "full"), SAMPLING_METHODS, "Sampling method");
  const samplingValue = Number(input.samplingValue ?? 100);
  if (samplingMethod === "percentage" && (samplingValue <= 0 || samplingValue > 100)) throw new QualityError(400, "A percentage sampling value must be between 0 and 100.", "QUALITY_PLAN_INVALID");

  const { rows } = await qx(client, `INSERT INTO tenant.quality_plans(organization_id,company_id,code,name,description,plan_type,item_id,item_group_id,supplier_id,warehouse_id,manufacturing_operation_sequence,version,status,effective_from,effective_to,sampling_method,sampling_value,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'draft',$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId, c.companyId, code, name, textOrNull(input.description, 1000), planType, uuidOrNull(input.itemId, "Item"), uuidOrNull(input.itemGroupId, "Item group"), uuidOrNull(input.supplierId, "Supplier"), uuidOrNull(input.warehouseId, "Warehouse"), input.manufacturingOperationSequence ? Math.trunc(Number(input.manufacturingOperationSequence)) : null, input.effectiveFrom || null, input.effectiveTo || null, samplingMethod, String(samplingValue), c.userId]).catch((e) => {
    if (e.code === "23505") throw new QualityError(409, `Quality plan ${code} v1 already exists.`, "QUALITY_PLAN_DUPLICATE");
    throw e;
  });
  const plan = rows[0];
  for (const [index, point] of validated.entries()) {
    await qx(client, `INSERT INTO tenant.quality_inspection_points(organization_id,plan_id,sequence,characteristic,inspection_method,result_type,lower_limit,target_value,upper_limit,unit,allowed_values,critical,destructive,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [c.organizationId, plan.id, index + 1, point.characteristic, point.inspectionMethod, point.resultType, point.lowerLimit, point.targetValue, point.upperLimit, point.unit, JSON.stringify(point.allowedValues), point.critical, point.destructive, point.instructions]);
  }
  await recordEvent(client, c, "quality_plan", plan.id, "quality.plan.created", { code });
  return getQualityPlan(client, c, plan.id);
}
// A second person approves a plan before it governs real inspections -- self-approval blocked unless
// they hold quality.manage (matching the escape hatch every other module gives its managers).
export async function approveQualityPlan(client, c, id) {
  need(c, "quality.plan.manage");
  const plan = (await qx(client, `SELECT * FROM tenant.quality_plans WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Plan")])).rows[0];
  if (!plan) throw new QualityError(404, "Quality plan was not found.", "QUALITY_PLAN_NOT_FOUND");
  if (plan.status !== "draft") throw new QualityError(409, "Only a draft plan can be approved.", "QUALITY_PLAN_STATE");
  if (plan.created_by === c.userId && !has(c, MANAGE)) throw new QualityError(403, "You cannot approve your own quality plan.", "SELF_APPROVAL_BLOCKED");
  const { rows } = await qx(client, `UPDATE tenant.quality_plans SET status='active',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [plan.id, c.userId]);
  await recordEvent(client, c, "quality_plan", plan.id, "quality.plan.approved", {});
  return rows[0];
}
export async function reviseQualityPlan(client, c, id) {
  need(c, "quality.plan.manage");
  const plan = await getQualityPlan(client, c, id);
  const { rows } = await qx(client, `INSERT INTO tenant.quality_plans(organization_id,company_id,code,name,description,plan_type,item_id,item_group_id,supplier_id,warehouse_id,manufacturing_operation_sequence,version,status,effective_from,effective_to,sampling_method,sampling_value,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$15,$16,$17) RETURNING *`,
    [c.organizationId, c.companyId, plan.code, plan.name, plan.description, plan.plan_type, plan.item_id, plan.item_group_id, plan.supplier_id, plan.warehouse_id, plan.manufacturing_operation_sequence, plan.version + 1, plan.effective_from, plan.effective_to, plan.sampling_method, plan.sampling_value, c.userId]);
  const revised = rows[0];
  for (const point of plan.points) {
    await qx(client, `INSERT INTO tenant.quality_inspection_points(organization_id,plan_id,sequence,characteristic,inspection_method,result_type,lower_limit,target_value,upper_limit,unit,allowed_values,critical,destructive,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [c.organizationId, revised.id, point.sequence, point.characteristic, point.inspection_method, point.result_type, point.lower_limit, point.target_value, point.upper_limit, point.unit, JSON.stringify(point.allowed_values ?? []), point.critical, point.destructive, point.instructions]);
  }
  await recordEvent(client, c, "quality_plan", revised.id, "quality.plan.revised", { fromVersion: plan.version });
  return getQualityPlan(client, c, revised.id);
}
export async function retireQualityPlan(client, c, id, reason) {
  need(c, "quality.plan.manage");
  if (!text(reason)) throw new QualityError(400, "Give a reason for retiring this plan.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_plans SET status='obsolete',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('active','inactive') RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Plan")]);
  if (!rows[0]) throw new QualityError(409, "Only an active or inactive plan can be retired.", "QUALITY_PLAN_STATE");
  await recordEvent(client, c, "quality_plan", rows[0].id, "quality.plan.retired", { reason: text(reason, 300) });
  return rows[0];
}

// ---------------------------------------------------------------- F312-320: inspections
const INSPECTION_TYPES = ["incoming", "in_process", "final", "stock_audit", "supplier", "customer_return"];
const SOURCE_TYPES = ["procurement_receipt", "stock_batch", "stock_serial", "manufacturing_work_order", "manufacturing_posting", "sales_return", "pos_return", "manual"];

export async function listInspections(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  if (filters.sourceType) { params.push(String(filters.sourceType)); where += ` AND source_type=$${params.length}`; }
  if (filters.itemId) { params.push(uuid(filters.itemId, "Item")); where += ` AND item_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT i.*, p.name AS plan_name, p.code AS plan_code FROM tenant.quality_inspections i JOIN tenant.quality_plans p ON p.id=i.plan_id WHERE i.organization_id=$1 AND i.company_id=$2${where} ORDER BY i.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getInspection(client, c, id) {
  needAny(c, VIEW);
  const inspection = (await qx(client, `SELECT i.*, p.name AS plan_name, p.code AS plan_code FROM tenant.quality_inspections i JOIN tenant.quality_plans p ON p.id=i.plan_id WHERE i.organization_id=$1 AND i.company_id=$2 AND i.id=$3`, [c.organizationId, c.companyId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  const points = await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2 ORDER BY sequence`, [c.organizationId, inspection.plan_id]);
  const results = await qx(client, `SELECT * FROM tenant.quality_inspection_results WHERE organization_id=$1 AND inspection_id=$2 ORDER BY inspection_point_id, sample_number`, [c.organizationId, inspection.id]);
  return { ...inspection, points: points.rows, results: results.rows };
}
export async function createInspection(client, c, input) {
  need(c, "quality.inspect");
  const plan = (await qx(client, `SELECT * FROM tenant.quality_plans WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`, [c.organizationId, c.companyId, uuid(input.planId, "Plan")])).rows[0];
  if (!plan) throw new QualityError(400, "An active quality plan is required.", "QUALITY_PLAN_INACTIVE");
  const lotQuantity = nonNegative(input.lotQuantity ?? 0, "Lot quantity");
  const { sampleQuantity, samplingPlan } = await resolveSampleSize(client, c, plan, lotQuantity || 1, input.samplingPlanCode);
  const inspectionNumber = await nextDocumentNumber(client, c, { documentType: "quality_inspection", prefix: "QI" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_inspections(organization_id,company_id,inspection_number,plan_id,inspection_type,source_type,source_id,item_id,supplier_id,warehouse_id,batch_id,serial_id,lot_quantity,sample_quantity,status,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15) RETURNING *`,
    [c.organizationId, c.companyId, inspectionNumber, plan.id, oneOf(String(input.inspectionType ?? plan.plan_type), INSPECTION_TYPES, "Inspection type"), oneOf(String(input.sourceType ?? "manual"), SOURCE_TYPES, "Source type"), uuidOrNull(input.sourceId, "Source"), uuidOrNull(input.itemId, "Item") ?? plan.item_id, uuidOrNull(input.supplierId, "Supplier") ?? plan.supplier_id, uuidOrNull(input.warehouseId, "Warehouse") ?? plan.warehouse_id, uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), String(lotQuantity), String(sampleQuantity), c.userId]);
  await recordEvent(client, c, "inspection", rows[0].id, "quality.inspection.created", { planId: plan.id, samplingPlan: samplingPlan?.code ?? null });
  return getInspection(client, c, rows[0].id);
}

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
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["draft", "in_progress"].includes(inspection.status)) throw new QualityError(409, "This inspection is not open for results.", "QUALITY_INSPECTION_STATE");
  const points = (await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2`, [c.organizationId, inspection.plan_id])).rows;
  const byId = new Map(points.map((p) => [p.id, p]));
  const results = Array.isArray(input.results) ? input.results : [];
  if (!results.length) throw new QualityError(400, "At least one result is required.", "QUALITY_RESULT_REQUIRED");
  let anyFail = false;
  let anyCriticalFail = false;
  let nonConformingSamples = 0;
  for (const result of results) {
    const point = byId.get(String(result.inspectionPointId));
    if (!point) throw new QualityError(400, "That inspection point does not belong to this inspection's plan.", "QUALITY_POINT_MISMATCH");
    const status = checkTolerance(point, result);
    if (status === "fail") { anyFail = true; nonConformingSamples += 1; if (point.critical) anyCriticalFail = true; }
    await qx(client, `INSERT INTO tenant.quality_inspection_results(organization_id,inspection_id,inspection_point_id,sample_number,numeric_value,boolean_value,text_value,result_status,remarks,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (inspection_id,inspection_point_id,sample_number) DO UPDATE SET numeric_value=EXCLUDED.numeric_value,boolean_value=EXCLUDED.boolean_value,text_value=EXCLUDED.text_value,result_status=EXCLUDED.result_status,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by,recorded_at=now()`,
      [c.organizationId, inspection.id, point.id, Math.trunc(nonNegative(result.sampleNumber ?? 1, "Sample number", 1)) || 1, result.numericValue ?? null, result.booleanValue ?? null, point.result_type === "selection" ? text(result.textValue, 60) : (result.textValue ?? null), status, textOrNull(result.remarks, 500), c.userId]);
  }
  await qx(client, `UPDATE tenant.quality_inspections SET status='in_progress',updated_at=now() WHERE id=$1`, [inspection.id]);
  return { anyFail, anyCriticalFail, nonConformingSamples, ...(await getInspection(client, c, inspection.id)) };
}
export async function completeInspection(client, c, id, input = {}) {
  need(c, "quality.inspect");
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["draft", "in_progress"].includes(inspection.status)) throw new QualityError(409, "This inspection is already finalized.", "QUALITY_INSPECTION_STATE");
  const results = (await qx(client, `SELECT * FROM tenant.quality_inspection_results WHERE organization_id=$1 AND inspection_id=$2`, [c.organizationId, inspection.id])).rows;
  if (!results.length) throw new QualityError(400, "Record results before completing the inspection.", "QUALITY_RESULT_REQUIRED");
  const points = (await qx(client, `SELECT * FROM tenant.quality_inspection_points WHERE organization_id=$1 AND plan_id=$2`, [c.organizationId, inspection.plan_id])).rows;
  const criticalIds = new Set(points.filter((p) => p.critical).map((p) => p.id));
  const failed = results.filter((r) => r.result_status === "fail");
  const anyCriticalFail = failed.some((r) => criticalIds.has(r.inspection_point_id));

  let overall = "passed";
  if (anyCriticalFail) overall = "failed";
  else if (failed.length) {
    // non-critical failures: an AQL-sampled inspection accepts up to its acceptance number
    let acceptanceNumber = 0;
    if (inspection.sample_quantity > 0) {
      const sp = (await qx(client, `SELECT acceptance_number FROM tenant.quality_sampling_plans WHERE organization_id=$1 AND company_id=$2 AND sample_size=$3 LIMIT 1`, [c.organizationId, c.companyId, Math.trunc(Number(inspection.sample_quantity))])).rows[0];
      acceptanceNumber = sp ? Number(sp.acceptance_number) : 0;
    }
    overall = failed.length <= acceptanceNumber && acceptanceNumber > 0 ? "conditionally_accepted" : "failed";
  }
  const lot = Number(inspection.lot_quantity);
  const rejectedRatio = results.length ? failed.length / results.length : 0;
  const rejectedQuantity = overall === "failed" ? Math.max(Math.round(lot * rejectedRatio), lot > 0 && failed.length ? 1 : 0) : Number(input.rejectedQuantity ?? 0);
  const acceptedQuantity = Math.max(lot - rejectedQuantity, 0);

  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET status=$4,overall_result=$4,accepted_quantity=$5,rejected_quantity=$6,inspected_by=$7,inspected_at=now(),notes=$8,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, inspection.id, overall, String(acceptedQuantity), String(rejectedQuantity), c.userId, textOrNull(input.notes, 2000)]);

  if (overall === "failed") {
    const settings = await loadSettings(client, c);
    if (settings.auto_hold_on_failure && inspection.item_id) {
      await createQualityHold(client, c, {
        holdType: inspection.batch_id ? "batch" : inspection.serial_id ? "serial" : "inventory",
        sourceType: inspection.source_type, sourceId: inspection.source_id || inspection.id,
        itemId: inspection.item_id, warehouseId: inspection.warehouse_id, batchId: inspection.batch_id, serialId: inspection.serial_id,
        quantity: rejectedQuantity || 0, reason: `Automatic hold: inspection ${inspection.inspection_number} failed.`,
      }, { internal: true });
    }
  }
  await recordEvent(client, c, "inspection", inspection.id, "quality.inspection.completed", { overall });
  return getInspection(client, c, inspection.id);
}
export async function releaseInspection(client, c, id, input = {}) {
  need(c, "quality.release");
  const inspection = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Inspection")])).rows[0];
  if (!inspection) throw new QualityError(404, "Inspection was not found.", "QUALITY_INSPECTION_NOT_FOUND");
  if (!["passed", "conditionally_accepted"].includes(inspection.status)) throw new QualityError(409, "Only a passed or conditionally accepted inspection can be released.", "QUALITY_INSPECTION_STATE");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_release && inspection.inspected_by === c.userId && !has(c, MANAGE)) throw new QualityError(403, "The inspector cannot release their own inspection.", "SELF_APPROVAL_BLOCKED");
  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET released_by=$4,released_at=now(),notes=coalesce($5,notes),updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, inspection.id, c.userId, textOrNull(input.notes, 2000)]);
  await recordEvent(client, c, "inspection", inspection.id, "quality.inspection.released", {});
  return rows[0];
}
export async function cancelInspection(client, c, id, reason) {
  need(c, "quality.inspect");
  if (!text(reason)) throw new QualityError(400, "Give a reason for cancelling this inspection.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_inspections SET status='cancelled',notes=coalesce(notes,'') || $4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('draft','in_progress') RETURNING *`,
    [c.organizationId, c.companyId, uuid(id, "Inspection"), `\nCancelled: ${text(reason, 300)}`]);
  if (!rows[0]) throw new QualityError(409, "Only a draft or in-progress inspection can be cancelled.", "QUALITY_INSPECTION_STATE");
  return rows[0];
}

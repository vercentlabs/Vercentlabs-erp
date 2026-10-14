// Production Quality Inspection — the shared core: permissions, errors, the inspection and its results and defects, which orders and entries
// may be inspected (output awaiting inspection, less what is held), checklist criteria (validated when a revision is made, evaluated on the
// server when results are recorded), the checks a decision must pass, the review the company's policy asks for and the content hash it binds.
import { createHash } from "node:crypto";

import { MoError, STATUS_LABEL, settingsOf } from "../orders/mo-core.js";
import { D, ZERO, add, decisionsOf, entryFigures, has, loadProductionOrder, max, q, sub, text, uuid } from "../production/production-core.js";

export const QI = Object.freeze({
  view: "manufacturing.qi.view", create: "manufacturing.qi.create", editDraft: "manufacturing.qi.edit_draft", submit: "manufacturing.qi.submit", finalize: "manufacturing.qi.finalize",
  approveException: "manufacturing.qi.approve_exception", hold: "manufacturing.qi.hold", releaseHold: "manufacturing.qi.release_hold", reinspect: "manufacturing.qi.reinspect",
  correct: "manufacturing.qi.correct", templateManage: "manufacturing.qi.template_manage", export: "manufacturing.qi.export",
});
export const QI_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", IN_PROGRESS: "In progress", PENDING_REVIEW: "Pending review", FINALIZED: "Finalized", CANCELLED: "Cancelled",
  RECOVERY_REQUIRED: "Recovery required" });
export const OPEN = new Set(["DRAFT", "IN_PROGRESS", "PENDING_REVIEW"]);
export const SEVERITIES = new Set(["MINOR", "MAJOR", "CRITICAL"]);
export const REJECTION_DISPOSITIONS = new Set(["QUARANTINE", "SCRAP", "REWORK"]);
export const CRITERION_TYPES = new Set(["PASS_FAIL", "NUMERIC", "TEXT", "CHOICE"]);
export const isoDay = (value) => {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const MESSAGES = Object.freeze({
  MFG_QI_MO_INVALID: "Select a valid Manufacturing Order.",
  MFG_QI_NOT_FOUND: "The inspection was not found.",
  MFG_QI_PRODUCTION_NOT_REPORTED: "Production must be recorded before final inspection.",
  MFG_QI_SOURCE_INVALID: "This production entry is not eligible for inspection.",
  MFG_QI_QTY_INVALID: "Enter a valid inspection quantity.",
  MFG_QI_QTY_EXCEEDS: "The quantity exceeds output still available for inspection.",
  MFG_QI_TEMPLATE_MISSING: "Assign a Quality checklist for this product.",
  MFG_QI_TEMPLATE_INVALID: "The checklist is not valid.",
  MFG_QI_CHECK_INCOMPLETE: "Complete the required inspection checks.",
  MFG_QI_MEASUREMENT_INVALID: "Enter a valid measurement.",
  MFG_QI_TOLERANCE_FAILED: "A measurement is outside the allowed range.",
  MFG_QI_CRITICAL_FAILURE: "A critical Quality check failed. The output cannot be accepted normally.",
  MFG_QI_DEFECT_REASON_REQUIRED: "Select a reason for rejected output.",
  MFG_QI_DECISION_EXCEEDS: "The Quality decision exceeds uninspected output.",
  MFG_QI_ALREADY_DISPOSED: "Some of this output already has a final Quality decision.",
  MFG_QI_SERIAL_INVALID: "One or more serial numbers are invalid.",
  MFG_QI_ALREADY_FINALIZED: "This inspection has already been finalized.",
  MFG_QI_HOLD_ACTIVE: "The output is on Quality Hold.",
  MFG_QI_RECEIPT_EXISTS: "Some goods were already received. Use the controlled correction workflow.",
  MFG_QI_VERSION_CONFLICT: "Another user updated this inspection. Refresh before proceeding.",
  MFG_QI_OUTCOME_UNKNOWN: "Checking the previous decision. Do not submit again.",
  MFG_QI_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_QI_REVIEW_REQUIRED: "This inspection needs a review before it is final.",
  MFG_QI_REVIEW_SELF: "Someone other than the inspector reviews this inspection.",
  MFG_QI_REASON_REQUIRED: "Give a reason.",
  MFG_QI_STATE_INVALID: "This action is not available in the inspection's current status.",
});
export const qiError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needQi = (c, permission) => { if (!has(c, permission)) throw qiError(403, "MFG_QI_PERMISSION_DENIED"); };

export async function loadQiOrder(client, c, orderId, options) {
  try { return await loadProductionOrder(client, c, uuid(orderId, "Manufacturing order"), options); } catch (error) {
    if (["MFG_PARTIAL_MO_NOT_FOUND", "MFG_MO_NOT_FOUND"].includes(error.code)) throw qiError(404, "MFG_QI_MO_INVALID");
    throw error;
  }
}
export async function loadInspection(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_quality_inspections WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(id, "Inspection")])).rows[0];
  if (!row) throw qiError(404, "MFG_QI_NOT_FOUND");
  return row;
}
export async function loadResults(client, c, inspectionId) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_quality_inspection_results WHERE organization_id = $1 AND inspection_id = $2 ORDER BY sequence, criterion_key`,
    [c.organizationId, inspectionId])).rows;
}
export async function loadDefects(client, c, inspectionId) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_quality_defects WHERE organization_id = $1 AND inspection_id = $2 ORDER BY created_at`, [c.organizationId, inspectionId])).rows;
}

export async function qiSettings(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT qi_template_required, qi_review_required, qi_deviation_allowed, qi_sample_decides_batch FROM tenant.manufacturing_settings WHERE organization_id = $1`,
    [c.organizationId])).rows[0] ?? {};
  return { ...settings, templateRequired: Boolean(row.qi_template_required), reviewRequired: Boolean(row.qi_review_required), deviationAllowed: Boolean(row.qi_deviation_allowed),
    sampleDecidesBatch: Boolean(row.qi_sample_decides_batch) };
}

// Output is inspected while production runs (in progress, or on hold — inspection may continue).
export function requireInspectable(order) {
  if (["IN_PROGRESS", "ON_HOLD"].includes(order.status)) return;
  throw qiError(409, "MFG_QI_MO_INVALID", order.status === "RELEASED" ? `${order.mo_number} is released: production must be recorded before final inspection.`
    : `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: output is inspected while an order is in production.`);
}

// Every reported entry with its figures: awaiting inspection, of which held, and what is free to decide now.
export async function inspectableSources(client, c, order, { lock = false } = {}) {
  const rows = (await client.query(
    `SELECT entry.*, batch.batch_reference, batch.production_location_id AS batch_location_id
       FROM tenant.manufacturing_production_entries entry LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
      WHERE entry.organization_id = $1 AND entry.manufacturing_order_id = $2 AND entry.status IN ('REPORTED', 'RECOVERY_REQUIRED')
      ORDER BY entry.posted_at, entry.entry_number${lock ? " FOR UPDATE OF entry" : ""}`, [c.organizationId, order.id])).rows;
  const decided = await decisionsOf(client, c, rows.map((row) => row.id));
  return rows.map((row) => {
    const figures = entryFigures(row, decided.get(row.id));
    return { row, figures, available: row.status === "REPORTED" ? max(sub(figures.pending, figures.held), ZERO) : ZERO };
  });
}

// ------------------------------------------------------------------ checklists
// A revision's criteria as given, checked and normalised (keys stable across revisions where the name stays the same).
export function normaliseCriteria(input) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "A checklist has at least one check.");
  if (list.length > 100) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "A checklist has at most 100 checks.");
  const keys = new Set();
  return list.map((raw, index) => {
    const name = text(raw?.name, 200);
    if (!name || name.length < 2) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `Check ${index + 1}: give it a name.`);
    const type = String(raw.type ?? "PASS_FAIL").toUpperCase();
    if (!CRITERION_TYPES.has(type)) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `${name}: choose pass/fail, measurement, text or choice.`);
    let key = text(raw.key, 60) || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || `check_${index + 1}`;
    while (keys.has(key)) key = `${key}_${index + 1}`;
    keys.add(key);
    const number = (value, label) => {
      if (value === undefined || value === null || value === "") return null;
      if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `${name}: the ${label} limit is not a number.`);
      return String(value).trim();
    };
    const lower = type === "NUMERIC" ? number(raw.lower, "lower") : null;
    const upper = type === "NUMERIC" ? number(raw.upper, "upper") : null;
    if (type === "NUMERIC" && lower === null && upper === null) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `${name}: a measurement needs a lower or an upper limit.`);
    if (lower !== null && upper !== null && Number(lower) > Number(upper)) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `${name}: the lower limit is above the upper limit.`);
    const choices = type === "CHOICE" ? [...new Set((Array.isArray(raw.choices) ? raw.choices : String(raw.choices ?? "").split(",")).map((value) => text(value, 80)).filter(Boolean))] : [];
    if (type === "CHOICE" && choices.length < 2) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", `${name}: give at least two choices.`);
    const acceptedChoices = type === "CHOICE" ? (Array.isArray(raw.acceptedChoices) ? raw.acceptedChoices : String(raw.acceptedChoices ?? "").split(",")).map((value) => text(value, 80)).filter((value) => choices.includes(value)) : [];
    return { key, name, type, unit: type === "NUMERIC" ? text(raw.unit, 20) || null : null, lower, upper, choices, acceptedChoices, required: raw.required !== false,
      critical: raw.critical === true, instructions: text(raw.instructions, 500) || null, sequence: index + 1 };
  });
}
export const criteriaHash = (criteria) => createHash("sha256").update(JSON.stringify(criteria)).digest("hex");

// The result of each check as recorded, evaluated on the server (a measurement against its limits, a choice against the accepted ones).
export function evaluate(criteria, results) {
  return criteria.map((criterion) => {
    const recorded = results.find((row) => (row.criterion_key ?? row.key) === criterion.key) ?? null;
    const value = recorded ? (recorded.value === null || recorded.value === undefined ? "" : String(recorded.value).trim()) : "";
    const out = { key: criterion.key, name: criterion.name, type: criterion.type, critical: criterion.critical, required: criterion.required, value: value || null, numericValue: null,
      result: null, problem: null, notes: recorded?.notes ?? null };
    if (!value) {
      if (criterion.required) out.problem = "MFG_QI_CHECK_INCOMPLETE";
      return out;
    }
    if (criterion.type === "PASS_FAIL") {
      const upper = value.toUpperCase();
      if (!["PASS", "FAIL", "NA"].includes(upper)) { out.problem = "MFG_QI_MEASUREMENT_INVALID"; return out; }
      if (upper === "NA" && criterion.required) { out.problem = "MFG_QI_CHECK_INCOMPLETE"; return out; }
      out.result = upper;
      out.value = upper;
    } else if (criterion.type === "NUMERIC") {
      if (!/^-?\d+(\.\d+)?$/.test(value)) { out.problem = "MFG_QI_MEASUREMENT_INVALID"; return out; }
      out.numericValue = value;
      const number = Number(value);
      out.result = (criterion.lower !== null && number < Number(criterion.lower)) || (criterion.upper !== null && number > Number(criterion.upper)) ? "FAIL" : "PASS";
    } else if (criterion.type === "CHOICE") {
      if (!criterion.choices.includes(value)) { out.problem = "MFG_QI_MEASUREMENT_INVALID"; return out; }
      out.result = !criterion.acceptedChoices.length || criterion.acceptedChoices.includes(value) ? "PASS" : "FAIL";
    } else {
      out.result = "PASS";
    }
    return out;
  });
}

// The checks a decision must pass, as problems (code, message): complete and valid results, a failure answered by rejection or a hold, a critical
// failure never accepted normally, rejected output with its reason and what becomes of it, never more decided than examined.
export function decisionProblems(inspection, evaluated, defects, settings) {
  const problems = [];
  const accepted = D(inspection.accepted_quantity);
  const rejected = D(inspection.rejected_quantity);
  const held = D(inspection.hold_quantity);
  const scope = D(inspection.scope_quantity);
  const examined = D(inspection.examined_quantity);
  for (const row of evaluated) {
    if (row.problem === "MFG_QI_CHECK_INCOMPLETE") problems.push({ code: row.problem, message: `${row.name}: record the result.` });
    if (row.problem === "MFG_QI_MEASUREMENT_INVALID") problems.push({ code: row.problem, message: `${row.name}: "${row.value}" is not a valid ${row.type === "NUMERIC" ? "measurement" : "result"}.` });
  }
  if (inspection.inspection_stage === "IN_PROCESS") {
    if (accepted > ZERO || rejected > ZERO || held > ZERO) problems.push({ code: "MFG_QI_DECISION_EXCEEDS", message: "An in-process check records results only: output is decided by a final inspection." });
    return { problems, deviation: false };
  }
  if (add(add(accepted, rejected), held) === ZERO) problems.push({ code: "MFG_QI_QTY_INVALID", message: "Decide the output: accepted, rejected or held." });
  if (add(add(accepted, rejected), held) > scope) problems.push({ code: "MFG_QI_DECISION_EXCEEDS", message: `Accepted, rejected and held come to more than the ${q(scope)} this inspection covers.` });
  if (add(accepted, rejected) > examined && !(settings.sampleDecidesBatch && inspection.sampling_basis === "BATCH_POLICY")) {
    problems.push({ code: "MFG_QI_DECISION_EXCEEDS", message: `Only the ${q(examined)} units actually examined can be accepted or rejected; the rest stay awaiting inspection.` });
  }
  if (rejected > ZERO && !(text(inspection.rejection_reason, 500).length >= 3 || defects.length)) problems.push({ code: "MFG_QI_DEFECT_REASON_REQUIRED", message: "Say why output is rejected, or record its defects." });
  if (rejected > ZERO && !REJECTION_DISPOSITIONS.has(inspection.rejection_disposition)) problems.push({ code: "MFG_QI_DEFECT_REASON_REQUIRED", message: "Choose what happens to rejected output: quarantine, rework or scrap." });
  if (held > ZERO && text(inspection.hold_reason, 500).length < 3) problems.push({ code: "MFG_QI_REASON_REQUIRED", message: "Say why output is held." });
  for (const defect of defects) {
    if (D(defect.affected_quantity) > examined) problems.push({ code: "MFG_QI_QTY_INVALID", message: `Defect ${defect.reason_code} affects more units than were examined.` });
  }
  const failed = evaluated.filter((row) => row.result === "FAIL");
  const critical = failed.some((row) => row.critical) || defects.some((defect) => defect.severity === "CRITICAL");
  let deviation = false;
  if (critical && accepted > ZERO) {
    if (settings.deviationAllowed && inspection.deviation_requested) deviation = true;
    else problems.push({ code: "MFG_QI_CRITICAL_FAILURE", message: settings.deviationAllowed ? "A critical check failed: reject or hold the output, or ask for acceptance under a documented deviation." : MESSAGES.MFG_QI_CRITICAL_FAILURE });
  } else if (failed.length && rejected === ZERO && held === ZERO) {
    problems.push({ code: "MFG_QI_TOLERANCE_FAILED", message: `${failed.map((row) => row.name).join(", ")} failed: reject or hold the failing units.` });
  }
  return { problems, deviation };
}

// Why this inspection needs a review before it is final (empty: none).
export function reviewReasons(settings, deviation) {
  return [settings.reviewRequired ? "The company reviews every inspection" : null, deviation ? "Acceptance under a deviation after a critical failure" : null].filter(Boolean);
}

export function contentHash(inspection, results, defects) {
  return createHash("sha256").update(JSON.stringify({
    entry: inspection.production_entry_id, scope: q(D(inspection.scope_quantity)), examined: q(D(inspection.examined_quantity)), accepted: q(D(inspection.accepted_quantity)),
    rejected: q(D(inspection.rejected_quantity)), held: q(D(inspection.hold_quantity)), disposition: inspection.rejection_disposition ?? null, deviation: Boolean(inspection.deviation_requested),
    results: results.map((row) => [row.criterion_key ?? row.key, row.value ?? null]).sort(), defects: defects.map((row) => [row.reason_code, row.severity, q(D(row.affected_quantity))]).sort(),
  })).digest("hex");
}

export { D, MoError, STATUS_LABEL, ZERO, add, has, max, q, sub, text, uuid };

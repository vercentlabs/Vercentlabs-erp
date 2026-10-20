// Production Quality Inspection — the commands: checklists and their revisions; an inspection from a production entry (its checklist frozen);
// results, defects and the decision recorded while it is open; submission for the review the company's policy (or a deviation) asks for and
// that review; finalization — the one authoritative quality decision, posted once under `mqi:<id>:v<version>` with the output claimed under
// the order's and the entry's locks; holds placed and released, reinspection of held output, quality corrections after review or rework,
// cancellation, printing, recovery and evidence files. Nothing here moves stock, consumes material or posts to Finance.
import { randomUUID } from "node:crypto";

import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { atomically, event as orderEvent, moError, nextNumber } from "../orders/mo-core.js";
import { outputQuantity } from "../production/production-core.js";
import {
  D, MoError, OPEN, QI, REJECTION_DISPOSITIONS, SEVERITIES, ZERO, add, contentHash, criteriaHash, decisionProblems, evaluate, has, inspectableSources, loadDefects, loadInspection,
  loadQiOrder, loadResults, needQi, normaliseCriteria, q, qiError, qiSettings, requireInspectable, reviewReasons, sub, text, uuid,
} from "./qi-core.js";
import { getQualityInspection } from "./qi-read.js";

const FILE_ENTITY = "manufacturing.quality_inspection";
async function inspectionEvent(client, c, inspectionId, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_quality_inspection_events (organization_id, inspection_id, action, from_status, to_status, summary, details, actor_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [c.organizationId, inspectionId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
async function entryEvent(client, c, entryId, action, summary) {
  await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,'{}'::jsonb,$5)`,
    [c.organizationId, entryId, action, summary ? String(summary).slice(0, 1000) : null, c.userId ?? null]);
}
const versionCheck = (inspection, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(inspection.row_version)) throw qiError(409, "MFG_QI_VERSION_CONFLICT");
};

// ------------------------------------------------------------------ checklists
// input: { name, finishedItemId?, inspectionStage?, criteria, notes? } — the checklist and its first revision, in force at once.
export async function createQualityTemplate(client, c, input = {}) {
  needQi(c, QI.templateManage);
  const name = text(input.name, 160);
  if (name.length < 2) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "Give the checklist a name.");
  const stage = String(input.inspectionStage ?? "FINAL").toUpperCase();
  if (!["FINAL", "IN_PROCESS"].includes(stage)) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "Choose final or in-process inspection.");
  let itemId = null;
  if (input.finishedItemId) {
    itemId = uuid(input.finishedItemId, "Product");
    if (!(await client.query(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0]) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "That product was not found.");
  }
  const criteria = normaliseCriteria(input.criteria);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_quality_template");
  await client.query(`INSERT INTO tenant.manufacturing_quality_templates (id, organization_id, template_number, name, finished_item_id, inspection_stage, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, c.organizationId, number, name, itemId, stage, c.userId ?? null]);
  await client.query(`INSERT INTO tenant.manufacturing_quality_template_revisions (organization_id, template_id, revision_number, criteria, notes, content_hash, created_by) VALUES ($1,$2,1,$3::jsonb,$4,$5,$6)`,
    [c.organizationId, id, JSON.stringify(criteria), text(input.notes, 1000) || null, criteriaHash(criteria), c.userId ?? null]);
  const { getQualityTemplate } = await import("./qi-read.js");
  return getQualityTemplate(client, c, id);
}
// input: { criteria, notes? } — a new revision in force from now; the one before is superseded (inspections keep the revision they used).
export async function createQualityTemplateRevision(client, c, templateId, input = {}) {
  needQi(c, QI.templateManage);
  const template = (await client.query(`SELECT * FROM tenant.manufacturing_quality_templates WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(templateId, "Checklist")])).rows[0];
  if (!template) throw qiError(404, "MFG_QI_TEMPLATE_MISSING", "That checklist was not found.");
  const criteria = normaliseCriteria(input.criteria);
  const latest = (await client.query(`SELECT max(revision_number) AS n FROM tenant.manufacturing_quality_template_revisions WHERE template_id = $1`, [template.id])).rows[0].n ?? 0;
  await client.query(`UPDATE tenant.manufacturing_quality_template_revisions SET status = 'SUPERSEDED', superseded_at = clock_timestamp() WHERE organization_id = $1 AND template_id = $2 AND status = 'ACTIVE'`,
    [c.organizationId, template.id]);
  await client.query(`INSERT INTO tenant.manufacturing_quality_template_revisions (organization_id, template_id, revision_number, criteria, notes, content_hash, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [c.organizationId, template.id, latest + 1, JSON.stringify(criteria), text(input.notes, 1000) || null, criteriaHash(criteria), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_quality_templates SET updated_at = now() WHERE id = $1`, [template.id]);
  const { getQualityTemplate } = await import("./qi-read.js");
  return getQualityTemplate(client, c, template.id);
}
export async function setQualityTemplateStatus(client, c, templateId, input = {}) {
  needQi(c, QI.templateManage);
  const status = String(input.status ?? "").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(status)) throw qiError(400, "MFG_QI_TEMPLATE_INVALID", "Choose active or inactive.");
  const row = (await client.query(`UPDATE tenant.manufacturing_quality_templates SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
    [c.organizationId, uuid(templateId, "Checklist"), status])).rows[0];
  if (!row) throw qiError(404, "MFG_QI_TEMPLATE_MISSING", "That checklist was not found.");
  const { getQualityTemplate } = await import("./qi-read.js");
  return getQualityTemplate(client, c, row.id);
}
// The checklist in force for a product at a stage: the product's own, else a company-wide one.
export async function activeChecklist(client, c, itemId, stage) {
  return (await client.query(
    `SELECT template.id AS template_id, template.template_number, template.name, revision.id AS revision_id, revision.revision_number, revision.criteria
       FROM tenant.manufacturing_quality_templates template JOIN tenant.manufacturing_quality_template_revisions revision ON revision.template_id = template.id AND revision.status = 'ACTIVE'
      WHERE template.organization_id = $1 AND template.status = 'ACTIVE' AND template.inspection_stage = $3 AND (template.finished_item_id = $2 OR template.finished_item_id IS NULL)
      ORDER BY (template.finished_item_id IS NULL), template.created_at DESC LIMIT 1`, [c.organizationId, itemId, stage])).rows[0] ?? null;
}

// ------------------------------------------------------------------ drafts
// input: { manufacturingOrderId, productionEntryId, inspectionStage?, quantity, uomId?, examinedQuantity?, productionLocationId?, inspectedAt?, notes?, idempotencyKey?, basic? }
export async function createInspectionDraft(client, c, input = {}) {
  needQi(c, QI.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_quality_inspections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { ...(await getQualityInspection(client, c, existing.id)), replayed: true };
  }
  const order = await loadQiOrder(client, c, input.manufacturingOrderId, { lock: true });
  if (order.status === "DRAFT" || order.status === "AWAITING_APPROVAL" || order.status === "RELEASED") throw qiError(409, "MFG_QI_PRODUCTION_NOT_REPORTED", `${order.mo_number} has no reported production yet.`);
  requireInspectable(order);
  const stage = String(input.inspectionStage ?? "FINAL").toUpperCase();
  if (!["FINAL", "IN_PROCESS"].includes(stage)) throw qiError(400, "MFG_QI_SOURCE_INVALID", "Choose a final or an in-process inspection.");
  const source = (await inspectableSources(client, c, order)).find((entry) => entry.row.id === input.productionEntryId);
  if (!source) throw qiError(400, "MFG_QI_SOURCE_INVALID", `Choose a reported production entry of ${order.mo_number}.`);
  if (source.row.status !== "REPORTED") throw qiError(409, "MFG_QI_SOURCE_INVALID", `${source.row.entry_number} needs recovery before it is inspected.`);
  const scope = await quantityOf(client, c, order, input.quantity, input.uomId);
  if (stage === "FINAL" && scope.base > source.available) {
    throw qiError(409, source.figures.held > ZERO && scope.base <= source.figures.pending ? "MFG_QI_HOLD_ACTIVE" : "MFG_QI_QTY_EXCEEDS",
      `${source.row.entry_number}: ${q(source.available)} awaits inspection${source.figures.held > ZERO ? ` (${q(source.figures.held)} more is on hold: release or reinspect it)` : ""}.`, { available: q(source.available) });
  }
  const examined = input.examinedQuantity === undefined || input.examinedQuantity === null || input.examinedQuantity === "" ? scope.base : (await quantityOf(client, c, order, input.examinedQuantity, input.uomId)).base;
  if (examined > scope.base) throw qiError(400, "MFG_QI_QTY_INVALID", "More units cannot be examined than the inspection covers.");
  const settings = await qiSettings(client, c);
  const checklist = await activeChecklist(client, c, order.finished_item_id, stage);
  if (!checklist && stage === "FINAL" && settings.templateRequired) throw qiError(409, "MFG_QI_TEMPLATE_MISSING");
  if (!checklist && stage === "IN_PROCESS") throw qiError(409, "MFG_QI_TEMPLATE_MISSING", "An in-process check uses an in-process checklist for this product.");
  const basis = examined < scope.base ? (settings.sampleDecidesBatch ? "BATCH_POLICY" : "SAMPLE") : "FULL";
  const locationId = input.productionLocationId ? uuid(input.productionLocationId, "Location") : source.row.batch_location_id ?? null;
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_quality_inspection");
  const inspectedAt = input.inspectedAt && !Number.isNaN(Date.parse(input.inspectedAt)) ? new Date(input.inspectedAt) : new Date();
  if (inspectedAt.getTime() > Date.now() + 5 * 60_000) throw qiError(400, "MFG_QI_QTY_INVALID", "An inspection is not dated in the future.");
  await client.query(
    `INSERT INTO tenant.manufacturing_quality_inspections (id, organization_id, inspection_number, manufacturing_order_id, production_entry_id, production_batch_id, finished_item_id, bom_revision_id,
       production_location_id, inspection_stage, template_revision_id, criteria, scope_quantity, entered_quantity, uom_id, examined_quantity, sampling_basis, inspector_id, inspected_at, notes,
       created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [id, c.organizationId, number, order.id, source.row.id, source.row.production_batch_id ?? null, order.finished_item_id, order.bom_revision_id ?? null, locationId, stage, checklist?.revision_id ?? null,
      JSON.stringify(checklist?.criteria ?? []), q(scope.base), scope.entered, scope.uomId, q(examined), basis, c.userId ?? null, inspectedAt.toISOString(), text(input.notes, 2000) || null, c.userId ?? null, key]);
  await refreshHash(client, c, id);
  await inspectionEvent(client, c, id, "CREATED", { to: "DRAFT", summary: `${number}: ${source.row.entry_number}, ${q(scope.base)} covered${checklist ? ` · checklist ${checklist.template_number} rev ${checklist.revision_number}` : " · basic"}` });
  return getQualityInspection(client, c, id);
}
async function quantityOf(client, c, order, raw, uomId) {
  try { return await outputQuantity(client, c, order, raw, uomId === null ? null : uomId || undefined); } catch (error) { throw qiError(400, "MFG_QI_QTY_INVALID", error.message); }
}
async function refreshHash(client, c, id) {
  const inspection = await loadInspection(client, c, id);
  const hash = contentHash(inspection, await loadResults(client, c, id), await loadDefects(client, c, id));
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET content_hash = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, id, hash]);
  return hash;
}

// input: { expectedVersion?, results?: [{ key, value, notes? }], defects?: [{ reasonCode, severity, affectedQuantity, observation? }], acceptedQuantity?, rejectedQuantity?,
// holdQuantity?, rejectionReason?, rejectionDisposition?, reworkAssignedTo?, holdReason?, deviationRequested?, examinedQuantity?, notes? }
// Recording anything takes the inspection in progress; a submitted one returns to in progress and its review is withdrawn.
export async function recordInspectionResults(client, c, id, input = {}) {
  needQi(c, QI.editDraft);
  const inspection = await loadInspection(client, c, id, { lock: true });
  if (!OPEN.has(inspection.status)) throw qiError(409, inspection.status === "FINALIZED" ? "MFG_QI_ALREADY_FINALIZED" : "MFG_QI_STATE_INVALID");
  versionCheck(inspection, input.expectedVersion);
  const order = await loadQiOrder(client, c, inspection.manufacturing_order_id);
  const criteria = inspection.criteria ?? [];
  if (Array.isArray(input.results)) {
    for (const row of input.results) {
      const criterion = criteria.find((entry) => entry.key === row.key);
      if (!criterion) throw qiError(400, "MFG_QI_MEASUREMENT_INVALID", `"${row.key}" is not a check of this inspection's checklist.`);
      const [evaluated] = evaluate([criterion], [{ criterion_key: criterion.key, value: row.value, notes: row.notes }]);
      await client.query(
        `INSERT INTO tenant.manufacturing_quality_inspection_results (organization_id, inspection_id, criterion_key, sequence, value, numeric_value, result, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (inspection_id, criterion_key) DO UPDATE SET value = $5, numeric_value = $6, result = $7, notes = $8`,
        [c.organizationId, inspection.id, criterion.key, criterion.sequence ?? 0, evaluated.value, evaluated.numericValue, evaluated.result, text(row.notes, 1000) || null]);
    }
  }
  if (Array.isArray(input.defects)) {
    await client.query(`DELETE FROM tenant.manufacturing_quality_defects WHERE organization_id = $1 AND inspection_id = $2`, [c.organizationId, inspection.id]);
    for (const [index, defect] of input.defects.entries()) {
      const reason = text(defect.reasonCode, 80).toUpperCase().replace(/\s+/g, "_");
      if (reason.length < 2) throw qiError(400, "MFG_QI_DEFECT_REASON_REQUIRED", `Defect ${index + 1}: choose its reason.`);
      const severity = String(defect.severity ?? "").toUpperCase();
      if (!SEVERITIES.has(severity)) throw qiError(400, "MFG_QI_DEFECT_REASON_REQUIRED", `Defect ${index + 1}: choose minor, major or critical.`);
      const affected = (await quantityOf(client, c, order, defect.affectedQuantity, null)).base;
      await client.query(`INSERT INTO tenant.manufacturing_quality_defects (organization_id, inspection_id, reason_code, severity, affected_quantity, observation) VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.organizationId, inspection.id, reason, severity, q(affected), text(defect.observation, 1000) || null]);
    }
  }
  const amount = async (field, fallback) => {
    if (input[field] === undefined) return fallback;
    if (input[field] === null || input[field] === "" || Number(input[field]) === 0) return ZERO;
    return (await quantityOf(client, c, order, input[field], null)).base;
  };
  const accepted = await amount("acceptedQuantity", D(inspection.accepted_quantity));
  const rejected = await amount("rejectedQuantity", D(inspection.rejected_quantity));
  const held = await amount("holdQuantity", D(inspection.hold_quantity));
  const examined = input.examinedQuantity === undefined ? D(inspection.examined_quantity) : (await quantityOf(client, c, order, input.examinedQuantity, null)).base;
  if (examined > D(inspection.scope_quantity)) throw qiError(400, "MFG_QI_QTY_INVALID", "More units cannot be examined than the inspection covers.");
  if (add(add(accepted, rejected), held) > D(inspection.scope_quantity)) {
    throw qiError(409, "MFG_QI_DECISION_EXCEEDS", `Accepted, rejected and held come to more than the ${q(D(inspection.scope_quantity))} this inspection covers.`);
  }
  const disposition = input.rejectionDisposition === undefined ? inspection.rejection_disposition : input.rejectionDisposition ? String(input.rejectionDisposition).toUpperCase() : null;
  if ((disposition && !REJECTION_DISPOSITIONS.has(disposition)) || (rejected > ZERO && !disposition)) throw qiError(400, "MFG_QI_DEFECT_REASON_REQUIRED", "Choose what happens to rejected output: quarantine, rework or scrap.");
  const pick = (field, column, max) => (input[field] === undefined ? inspection[column] : text(input[field], max) || null);
  const settings = await qiSettings(client, c);
  const basis = examined < D(inspection.scope_quantity) ? (settings.sampleDecidesBatch ? "BATCH_POLICY" : "SAMPLE") : "FULL";
  await client.query(
    `UPDATE tenant.manufacturing_quality_inspections SET accepted_quantity = $3, rejected_quantity = $4, hold_quantity = $5, examined_quantity = $6, sampling_basis = $7,
       rejection_reason = $8, rejection_disposition = $9, rework_assigned_to = $10, hold_reason = $11, notes = $12, deviation_requested = $13,
       status = 'IN_PROGRESS', review_hash = NULL, review_reasons = NULL, submitted_by = NULL, submitted_at = NULL, review_decision = NULL, reviewer_id = NULL, reviewed_at = NULL,
       row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, inspection.id, q(accepted), q(rejected), q(held), q(examined), basis, pick("rejectionReason", "rejection_reason", 1000), rejected > ZERO ? disposition : null,
      pick("reworkAssignedTo", "rework_assigned_to", 200), held > ZERO ? pick("holdReason", "hold_reason", 1000) : null, pick("notes", "notes", 2000),
      input.deviationRequested === undefined ? inspection.deviation_requested : input.deviationRequested === true]);
  await refreshHash(client, c, inspection.id);
  await inspectionEvent(client, c, inspection.id, "RECORDED", { from: inspection.status, to: "IN_PROGRESS",
    summary: `${q(accepted)} accepted · ${q(rejected)} rejected · ${q(held)} held${inspection.status === "PENDING_REVIEW" ? " (the review was withdrawn)" : ""}` });
  return getQualityInspection(client, c, inspection.id);
}

// What finalizing would do now: the checklist evaluated, the decision checked, the review needed and what the entry still has to decide.
export async function validateInspection(client, c, id) {
  needQi(c, QI.view);
  const inspection = await loadInspection(client, c, id);
  const order = await loadQiOrder(client, c, inspection.manufacturing_order_id);
  const results = await loadResults(client, c, inspection.id);
  const defects = await loadDefects(client, c, inspection.id);
  const evaluated = evaluate(inspection.criteria ?? [], results);
  const settings = await qiSettings(client, c);
  const { problems, deviation } = decisionProblems(inspection, evaluated, defects, settings);
  if (!OPEN.has(inspection.status)) problems.unshift({ code: inspection.status === "FINALIZED" ? "MFG_QI_ALREADY_FINALIZED" : "MFG_QI_STATE_INVALID", message: `${inspection.inspection_number} is ${inspection.status.toLowerCase().replace(/_/g, " ")}.` });
  try { requireInspectable(order); } catch (error) { problems.push({ code: error.code, message: error.message }); }
  const source = (await inspectableSources(client, c, order)).find((entry) => entry.row.id === inspection.production_entry_id);
  const decided = add(add(D(inspection.accepted_quantity), D(inspection.rejected_quantity)), D(inspection.hold_quantity));
  if (inspection.inspection_stage === "FINAL" && source && decided > source.available) {
    problems.push({ code: "MFG_QI_ALREADY_DISPOSED", message: `${source.row.entry_number}: only ${q(source.available)} still awaits a decision.` });
  }
  const reasons = reviewReasons(settings, deviation);
  const reviewed = inspection.review_decision === "APPROVED" && inspection.review_hash === inspection.content_hash;
  return { inspectionId: inspection.id, inspectionNumber: inspection.inspection_number, ok: problems.length === 0, checkedAt: new Date().toISOString(), problems,
    review: { required: reasons.length > 0, reasons, approved: reviewed }, readiness: problems.length ? "BLOCKED" : reasons.length && !reviewed ? "NEEDS_REVIEW" : "READY",
    evaluated, available: source ? q(source.available) : "0", criticalFailure: evaluated.some((row) => row.result === "FAIL" && row.critical) || defects.some((row) => row.severity === "CRITICAL") };
}

// ------------------------------------------------------------------ review
// input: { expectedVersion? } — for the review the company's policy or a deviation asks for; bound to the exact content.
export async function submitInspection(client, c, id, input = {}) {
  needQi(c, QI.submit);
  const inspection = await loadInspection(client, c, id, { lock: true });
  if (!["DRAFT", "IN_PROGRESS"].includes(inspection.status)) throw qiError(409, inspection.status === "FINALIZED" ? "MFG_QI_ALREADY_FINALIZED" : "MFG_QI_STATE_INVALID");
  versionCheck(inspection, input.expectedVersion);
  const check = await validateInspection(client, c, inspection.id);
  if (check.problems.length) throw qiError(409, check.problems[0].code, check.problems[0].message, { problems: check.problems });
  if (!check.review.required) throw qiError(409, "MFG_QI_STATE_INVALID", "This inspection needs no review: finalize it.");
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET status = 'PENDING_REVIEW', review_hash = content_hash, review_reasons = $3::jsonb, submitted_by = $4, submitted_at = clock_timestamp(),
      review_decision = NULL, reviewer_id = NULL, reviewed_at = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, inspection.id, JSON.stringify(check.review.reasons), c.userId ?? null]);
  await inspectionEvent(client, c, inspection.id, "SUBMITTED", { from: inspection.status, to: "PENDING_REVIEW", summary: check.review.reasons.join(", ") });
  return getQualityInspection(client, c, inspection.id);
}
// input: { decision: APPROVE | RETURN, note?, idempotencyKey? } — by someone other than the inspector; an approval finalizes the inspection.
export async function reviewInspection(client, c, id, input = {}) {
  needQi(c, QI.approveException);
  const inspection = await loadInspection(client, c, id, { lock: true });
  if (inspection.status !== "PENDING_REVIEW") throw qiError(409, "MFG_QI_STATE_INVALID", "This inspection is not waiting for a review.");
  const settings = await qiSettings(client, c);
  if ([inspection.inspector_id, inspection.submitted_by].includes(c.userId) && !settings.varianceSelfApproval) throw qiError(409, "MFG_QI_REVIEW_SELF");
  if (inspection.review_hash !== inspection.content_hash) throw qiError(409, "MFG_QI_VERSION_CONFLICT");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "RETURN") {
    if (!note || note.length < 3) throw qiError(400, "MFG_QI_REASON_REQUIRED", "Say why the inspection is returned.");
    await client.query(`UPDATE tenant.manufacturing_quality_inspections SET status = 'IN_PROGRESS', review_decision = 'RETURNED', reviewer_id = $3, reviewed_at = clock_timestamp(), review_note = $4,
        row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.id, c.userId ?? null, note]);
    await inspectionEvent(client, c, inspection.id, "RETURNED", { from: "PENDING_REVIEW", to: "IN_PROGRESS", summary: note });
    return getQualityInspection(client, c, inspection.id);
  }
  if (decision !== "APPROVE") throw qiError(400, "MFG_QI_STATE_INVALID", "Approve or return the inspection.");
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET review_decision = 'APPROVED', reviewer_id = $3, reviewed_at = clock_timestamp(), review_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, inspection.id, c.userId ?? null, note]);
  await inspectionEvent(client, c, inspection.id, "REVIEWED", { summary: note ?? "Approved" });
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), QI.finalize])] };
  return (await finalizeInspection(client, ctx, inspection.id, {})).inspection;
}

// ------------------------------------------------------------------ finalization
// input: { expectedVersion?, expectedEntryVersion? }. Under the order's and the entry's locks: the checklist and decision checked again, the review
// (where needed) approved for exactly this content, the output still free to decide (nothing held, nothing decided by another inspection); then
// one quality decision posted (accepted and rejected leave what awaits inspection), a hold placed for what is held — once.
export async function finalizeInspection(client, c, id, input = {}) {
  needQi(c, QI.finalize);
  const inspection = await loadInspection(client, c, id, { lock: true });
  const key = `mqi:${inspection.id}:v${inspection.row_version}`;
  if (inspection.status === "FINALIZED" || inspection.status === "RECOVERY_REQUIRED") {
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(inspection.row_version)) {
      return { replayed: true, inspection: await getQualityInspection(client, c, inspection.id) };
    }
    throw qiError(409, "MFG_QI_ALREADY_FINALIZED");
  }
  if (!OPEN.has(inspection.status)) throw qiError(409, "MFG_QI_STATE_INVALID", `${inspection.inspection_number} is ${inspection.status.toLowerCase()}.`);
  versionCheck(inspection, input.expectedVersion);
  const order = await loadQiOrder(client, c, inspection.manufacturing_order_id, { lock: true });
  requireInspectable(order);
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, inspection.production_entry_id])).rows[0];
  if (!entry || entry.status !== "REPORTED") throw qiError(409, "MFG_QI_SOURCE_INVALID", "The production entry is no longer reported.");
  if (input.expectedEntryVersion !== undefined && input.expectedEntryVersion !== null && Number(input.expectedEntryVersion) !== Number(entry.row_version)) throw qiError(409, "MFG_QI_VERSION_CONFLICT");
  const settings = await qiSettings(client, c);
  if (entry.posted_by && entry.posted_by === c.userId && !settings.selfApproval) throw qiError(403, "MFG_QI_PERMISSION_DENIED", "Someone other than the person who reported this output decides its quality.");
  const results = await loadResults(client, c, inspection.id);
  const defects = await loadDefects(client, c, inspection.id);
  if (contentHash(inspection, results, defects) !== inspection.content_hash) throw qiError(409, "MFG_QI_VERSION_CONFLICT");
  const evaluated = evaluate(inspection.criteria ?? [], results);
  const { problems, deviation } = decisionProblems(inspection, evaluated, defects, settings);
  if (problems.length) throw qiError(409, problems[0].code, problems[0].message, { problems });
  const reasons = reviewReasons(settings, deviation);
  if (reasons.length && !(inspection.review_decision === "APPROVED" && inspection.review_hash === inspection.content_hash)) {
    throw qiError(409, "MFG_QI_REVIEW_REQUIRED", `Needs a review: ${reasons.join(", ")}.`, { reasons });
  }
  const accepted = D(inspection.accepted_quantity);
  const rejected = D(inspection.rejected_quantity);
  const held = D(inspection.hold_quantity);
  // The claim: what still awaits inspection, less what is held, covers the whole decision.
  const free = sub(D(entry.pending_remaining), D(entry.quality_hold_quantity ?? 0));
  if (inspection.inspection_stage === "FINAL" && add(add(accepted, rejected), held) > free) {
    throw qiError(409, D(entry.quality_hold_quantity ?? 0) > ZERO && add(add(accepted, rejected), held) <= D(entry.pending_remaining) ? "MFG_QI_HOLD_ACTIVE" : "MFG_QI_ALREADY_DISPOSED",
      `${entry.entry_number}: only ${q(free)} still awaits a decision — another inspection decided some of it.`);
  }
  // Quality's in-process gate (MVP 32): output is accepted only up to what every blocking in-process requirement on the entry cleared.
  if (accepted > ZERO) {
    const { assertProductionAcceptance } = await import("../../quality/inprocess/ip-engine.js");
    await assertProductionAcceptance(client, c, { entryId: entry.id, quantity: q(accepted) });
  }
  let decisionId = null;
  let holdId = null;
  if (add(accepted, rejected) > ZERO) {
    const reason = text(inspection.rejection_reason, 500) || (defects.length ? defects.map((row) => `${row.reason_code.toLowerCase().replace(/_/g, " ")} (${row.severity.toLowerCase()})`).join(", ").slice(0, 500) : null);
    decisionId = randomUUID();
    await client.query(
      `INSERT INTO tenant.manufacturing_quality_decisions (id, organization_id, manufacturing_order_id, production_entry_id, accepted_quantity, rejected_quantity, rejection_reason, disposition,
         inspection_reference, idempotency_key, decided_by, rejection_disposition, reason_code, inspection_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [decisionId, c.organizationId, order.id, entry.id, q(accepted), q(rejected), rejected > ZERO ? reason : null,
        rejected > ZERO ? (inspection.rejection_disposition === "SCRAP" ? "SCRAP" : "REWORK") : null, inspection.inspection_number, key, c.userId ?? null,
        rejected > ZERO ? inspection.rejection_disposition : null, defects[0]?.reason_code ?? null, inspection.id]);
    await client.query(`UPDATE tenant.manufacturing_production_entries SET pending_remaining = pending_remaining - $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(add(accepted, rejected))]);
    await client.query(`UPDATE tenant.manufacturing_orders SET accepted_quantity = accepted_quantity + $3, rejected_quantity = rejected_quantity + $4, pending_inspection_quantity = pending_inspection_quantity - $5,
        version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, q(accepted), q(rejected), q(add(accepted, rejected))]);
  }
  if (held > ZERO) {
    holdId = randomUUID();
    await client.query(`INSERT INTO tenant.manufacturing_quality_holds (id, organization_id, manufacturing_order_id, production_entry_id, inspection_id, quantity, reason, placed_by, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [holdId, c.organizationId, order.id, entry.id, inspection.id, q(held), inspection.hold_reason, c.userId ?? null, `${key}:hold`]);
    await client.query(`UPDATE tenant.manufacturing_production_entries SET quality_hold_quantity = quality_hold_quantity + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(held)]);
  }
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET status = 'FINALIZED', finalize_key = $3, quality_decision_id = $4, hold_id = $5, finalized_by = $6, finalized_at = clock_timestamp()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.id, key, decisionId, holdId, c.userId ?? null]);
  const summary = inspection.inspection_stage === "IN_PROCESS" ? `${inspection.inspection_number}: in-process check recorded`
    : `${inspection.inspection_number}: ${q(accepted)} accepted · ${q(rejected)} rejected${rejected > ZERO ? ` (${inspection.rejection_disposition.toLowerCase()})` : ""}${held > ZERO ? ` · ${q(held)} on hold` : ""}`;
  await inspectionEvent(client, c, inspection.id, "FINALIZED", { from: inspection.status, to: "FINALIZED", summary, details: { key, deviation } });
  await entryEvent(client, c, entry.id, "QUALITY_DECIDED", summary);
  await orderEvent(client, c, order.id, "QUALITY_DECIDED", { summary, details: { inspectionId: inspection.id } });
  return { inspection: await getQualityInspection(client, c, inspection.id) };
}

// Quality's in-process disposition scraps part of an entry's output awaiting inspection (input: { entryId, quantity, reason, reference, idempotencyKey }).
// Manufacturing records it as its own quality decision — rejected, scrap — under the order's and the entry's locks, once per key: what still
// awaits inspection (less what is held) must cover it. Returns the decision.
export async function recordInProcessScrap(client, c, input = {}) {
  needQi(c, QI.finalize);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const prior = (await client.query(`SELECT id FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (prior) return { decisionId: prior.id, replayed: true };
  const entry0 = (await client.query(`SELECT manufacturing_order_id FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.entryId, "Production entry")])).rows[0];
  if (!entry0) throw qiError(400, "MFG_QI_SOURCE_INVALID");
  const order = await loadQiOrder(client, c, entry0.manufacturing_order_id, { lock: true });
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, input.entryId])).rows[0];
  if (entry.status !== "REPORTED") throw qiError(409, "MFG_QI_SOURCE_INVALID", "The production entry is no longer reported.");
  const quantity = D(String(input.quantity ?? "0"));
  if (quantity <= ZERO) throw qiError(400, "MFG_QI_QTY_INVALID", "Enter the quantity scrapped.");
  const free = sub(D(entry.pending_remaining), D(entry.quality_hold_quantity ?? 0));
  if (quantity > free) throw qiError(409, "MFG_QI_ALREADY_DISPOSED", `${entry.entry_number}: only ${q(free)} still awaits a decision.`);
  const reason = text(input.reason, 500) || "Scrapped by Quality's in-process disposition";
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO tenant.manufacturing_quality_decisions (id, organization_id, manufacturing_order_id, production_entry_id, accepted_quantity, rejected_quantity, rejection_reason, disposition,
       inspection_reference, idempotency_key, decided_by, rejection_disposition, reason_code) VALUES ($1,$2,$3,$4,0,$5,$6,'SCRAP',$7,$8,$9,'SCRAP','IN_PROCESS_FAILURE')`,
    [decisionId, c.organizationId, order.id, entry.id, q(quantity), reason, text(input.reference, 120) || null, key, c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_production_entries SET pending_remaining = pending_remaining - $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(quantity)]);
  await client.query(`UPDATE tenant.manufacturing_orders SET rejected_quantity = rejected_quantity + $3, pending_inspection_quantity = pending_inspection_quantity - $3, version = version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, q(quantity)]);
  const summary = `${text(input.reference, 120) || "In-process disposition"}: ${q(quantity)} scrapped — ${reason}`;
  await entryEvent(client, c, entry.id, "QUALITY_DECIDED", summary);
  await orderEvent(client, c, order.id, "QUALITY_DECIDED", { summary, details: { decisionId, inProcess: true } });
  return { decisionId, replayed: false };
}

// Quality's final disposition accepts part of an entry's output awaiting inspection (input: { entryId, quantity, reason, reference, idempotencyKey }).
// Manufacturing records it as its own quality decision — accepted — under the order's and the entry's locks, once per key, through the same
// checks as a final inspection: what still awaits inspection (less what is held) covers it, Quality's gates allow it, and the person who reported
// the output doesn't accept it (unless the company allows it). The accepted output is then received through the finished-goods receipt.
export async function recordQualityAcceptance(client, c, input = {}) {
  needQi(c, QI.finalize);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const prior = (await client.query(`SELECT id FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (prior) return { decisionId: prior.id, replayed: true };
  const entry0 = (await client.query(`SELECT manufacturing_order_id FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.entryId, "Production entry")])).rows[0];
  if (!entry0) throw qiError(400, "MFG_QI_SOURCE_INVALID");
  const order = await loadQiOrder(client, c, entry0.manufacturing_order_id, { lock: true });
  requireInspectable(order);
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, input.entryId])).rows[0];
  if (entry.status !== "REPORTED") throw qiError(409, "MFG_QI_SOURCE_INVALID", "The production entry is no longer reported.");
  const settings = await qiSettings(client, c);
  if (entry.posted_by && entry.posted_by === c.userId && !settings.selfApproval) throw qiError(403, "MFG_QI_PERMISSION_DENIED", "Someone other than the person who reported this output decides its quality.");
  const quantity = D(String(input.quantity ?? "0"));
  if (quantity <= ZERO) throw qiError(400, "MFG_QI_QTY_INVALID", "Enter the quantity accepted.");
  const free = sub(D(entry.pending_remaining), D(entry.quality_hold_quantity ?? 0));
  if (quantity > free) throw qiError(409, "MFG_QI_ALREADY_DISPOSED", `${entry.entry_number}: only ${q(free)} still awaits a decision.`);
  const { assertProductionAcceptance } = await import("../../quality/inprocess/ip-engine.js");
  await assertProductionAcceptance(client, c, { entryId: entry.id, quantity: q(quantity) });
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO tenant.manufacturing_quality_decisions (id, organization_id, manufacturing_order_id, production_entry_id, accepted_quantity, rejected_quantity, inspection_reference,
       idempotency_key, decided_by) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
    [decisionId, c.organizationId, order.id, entry.id, q(quantity), text(input.reference, 120) || null, key, c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_production_entries SET pending_remaining = pending_remaining - $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(quantity)]);
  await client.query(`UPDATE tenant.manufacturing_orders SET accepted_quantity = accepted_quantity + $3, pending_inspection_quantity = pending_inspection_quantity - $3, version = version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, q(quantity)]);
  const summary = `${text(input.reference, 120) || "Final inspection"}: ${q(quantity)} accepted${input.reason ? ` — ${text(input.reason, 300)}` : ""}`;
  await entryEvent(client, c, entry.id, "QUALITY_DECIDED", summary);
  await orderEvent(client, c, order.id, "QUALITY_DECIDED", { summary, details: { decisionId, finalInspection: true } });
  return { decisionId, replayed: false };
}

// input: { reason, expectedVersion? }
export async function cancelInspection(client, c, id, input = {}) {
  needQi(c, QI.editDraft);
  const inspection = await loadInspection(client, c, id, { lock: true });
  if (inspection.status === "CANCELLED") return getQualityInspection(client, c, inspection.id);
  if (!OPEN.has(inspection.status)) throw qiError(409, inspection.status === "FINALIZED" ? "MFG_QI_ALREADY_FINALIZED" : "MFG_QI_STATE_INVALID");
  versionCheck(inspection, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw qiError(400, "MFG_QI_REASON_REQUIRED", "Say why the inspection is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.id, c.userId ?? null, reason]);
  await inspectionEvent(client, c, inspection.id, "CANCELLED", { from: inspection.status, to: "CANCELLED", summary: reason });
  return getQualityInspection(client, c, inspection.id);
}

// ------------------------------------------------------------------ the order's quick decision (the same finalization path)
// The order's "Quality decision" (input: { entryId, acceptedQuantity?, rejectedQuantity?, rejectionReason?, disposition?, reasonCode?, inspectionReference?, idempotencyKey }):
// a basic inspection created and finalized at once. A product with a checklist is inspected with it instead.
export async function decideThroughInspection(client, c, orderId, input = {}) {
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const noteKey = `mo-quality:${key}`;
  const existing = (await client.query(`SELECT id, status FROM tenant.manufacturing_quality_inspections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, noteKey])).rows[0];
  if (existing) return { orderId: (await loadInspection(client, c, existing.id)).manufacturing_order_id, inspectionId: existing.id, replayed: true };
  const order = await loadQiOrder(client, c, orderId);
  if (await activeChecklist(client, c, order.finished_item_id, "FINAL")) {
    throw qiError(409, "MFG_QI_CHECK_INCOMPLETE", "This product has an inspection checklist: inspect the output from the order's Quality tab.");
  }
  const part = (field) => (input[field] === undefined || input[field] === null || input[field] === "" ? ZERO : D(String(input[field])));
  const total = add(part("acceptedQuantity"), part("rejectedQuantity"));
  if (total <= ZERO) throw qiError(400, "MFG_QI_QTY_INVALID", "Enter the quantity accepted or rejected.");
  const disposition = String(input.disposition ?? "").toUpperCase() || null;
  return atomically(client, async () => {
    const draft = await createInspectionDraft(client, c, { manufacturingOrderId: orderId, productionEntryId: input.entryId, quantity: q(total), uomId: null, idempotencyKey: noteKey,
      notes: text(input.inspectionReference, 120) ? `Reference ${text(input.inspectionReference, 120)}` : undefined });
    await recordInspectionResults(client, c, draft.id, { acceptedQuantity: input.acceptedQuantity ?? "0", rejectedQuantity: input.rejectedQuantity ?? "0",
      rejectionReason: input.rejectionReason, rejectionDisposition: part("rejectedQuantity") > ZERO ? disposition : null,
      defects: part("rejectedQuantity") > ZERO && input.reasonCode ? [{ reasonCode: input.reasonCode, severity: "MAJOR", affectedQuantity: input.rejectedQuantity }] : undefined });
    const done = await finalizeInspection(client, c, draft.id, { expectedEntryVersion: input.expectedEntryVersion });
    return { orderId: order.id, inspectionId: done.inspection.id, inspectionNumber: done.inspection.number };
  });
}

// ------------------------------------------------------------------ holds and reinspection
// input: { productionEntryId, quantity, reason, idempotencyKey? } — output awaiting inspection held for investigation; it can be neither decided nor received.
export async function placeQualityHold(client, c, orderId, input = {}) {
  needQi(c, QI.hold);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_quality_holds WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { orderId, holdId: done.id, replayed: true };
  }
  const order = await loadQiOrder(client, c, orderId, { lock: true });
  requireInspectable(order);
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, order.id, uuid(input.productionEntryId, "Production entry")])).rows[0];
  if (!entry || entry.status !== "REPORTED") throw qiError(400, "MFG_QI_SOURCE_INVALID");
  const amount = (await quantityOf(client, c, order, input.quantity, input.uomId)).base;
  const free = sub(D(entry.pending_remaining), D(entry.quality_hold_quantity ?? 0));
  if (amount > free) throw qiError(409, "MFG_QI_QTY_EXCEEDS", `${entry.entry_number}: ${q(free)} awaits inspection and is not already held.`);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw qiError(400, "MFG_QI_REASON_REQUIRED", "Say why the output is held.");
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.manufacturing_quality_holds (id, organization_id, manufacturing_order_id, production_entry_id, quantity, reason, placed_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, c.organizationId, order.id, entry.id, q(amount), reason, c.userId ?? null, key]);
  await client.query(`UPDATE tenant.manufacturing_production_entries SET quality_hold_quantity = quality_hold_quantity + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(amount)]);
  await entryEvent(client, c, entry.id, "QUALITY_HOLD", `${q(amount)} held: ${reason}`);
  await orderEvent(client, c, order.id, "QUALITY_HOLD", { summary: `${entry.entry_number}: ${q(amount)} held — ${reason}` });
  return { orderId: order.id, holdId: id };
}
// input: { note } — the held output awaits inspection again.
export async function releaseQualityHold(client, c, holdId, input = {}, { reinspection = false } = {}) {
  needQi(c, reinspection ? QI.reinspect : QI.releaseHold);
  const hold = (await client.query(`SELECT * FROM tenant.manufacturing_quality_holds WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(holdId, "Hold")])).rows[0];
  if (!hold) throw qiError(404, "MFG_QI_NOT_FOUND", "That hold was not found.");
  if (hold.status !== "ACTIVE") throw qiError(409, "MFG_QI_STATE_INVALID", "That hold is released already.");
  const note = text(input.note, 1000) || (reinspection ? "Released for reinspection" : "");
  if (note.length < 3) throw qiError(400, "MFG_QI_REASON_REQUIRED", "Say why the hold is released.");
  await loadQiOrder(client, c, hold.manufacturing_order_id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_quality_holds SET status = 'RELEASED', released_by = $3, released_at = clock_timestamp(), release_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.id, c.userId ?? null, note]);
  await client.query(`UPDATE tenant.manufacturing_production_entries SET quality_hold_quantity = quality_hold_quantity - $3 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.production_entry_id, q(D(hold.quantity))]);
  await entryEvent(client, c, hold.production_entry_id, "QUALITY_HOLD_RELEASED", `${q(D(hold.quantity))} released: ${note}`);
  await orderEvent(client, c, hold.manufacturing_order_id, "QUALITY_HOLD_RELEASED", { summary: `${q(D(hold.quantity))} released — ${note}` });
  return hold;
}
// input: { idempotencyKey?, notes? } — the hold released and a new inspection opened over exactly that output; the earlier inspection stays as it was.
export async function reinspectHeldOutput(client, c, holdId, input = {}) {
  needQi(c, QI.reinspect);
  needQi(c, QI.create);
  return atomically(client, async () => {
    const hold = await releaseQualityHold(client, c, holdId, { note: input.note ?? "Released for reinspection" }, { reinspection: true });
    return createInspectionDraft(client, c, { manufacturingOrderId: hold.manufacturing_order_id, productionEntryId: hold.production_entry_id, quantity: q(D(hold.quantity)), uomId: null,
      notes: input.notes ?? `Reinspection of held output${hold.inspection_id ? ` (first inspected on ${(await loadInspection(client, c, hold.inspection_id)).inspection_number})` : ""}`,
      idempotencyKey: input.idempotencyKey });
  });
}

// ------------------------------------------------------------------ quality corrections
// input: { productionEntryId, direction: ACCEPTED_TO_REJECTED | REJECTED_TO_ACCEPTED, kind?: REVIEW | REWORK, quantity, reason, evidence?, rejectionDisposition?, inspectionId?, idempotencyKey }
// Output already received cannot become rejected here (Inventory corrects it); rejected output already scrapped cannot become accepted.
export async function correctQualityDecision(client, c, orderId, input = {}) {
  needQi(c, QI.correct);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const done = (await client.query(`SELECT id FROM tenant.manufacturing_quality_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) return { orderId, correctionId: done.id, replayed: true };
  const order = await loadQiOrder(client, c, orderId, { lock: true });
  if (["COMPLETED", "CANCELLED"].includes(order.status)) throw qiError(409, "MFG_QI_MO_INVALID", `${order.mo_number} is ${order.status.toLowerCase()}: its quality is history.`);
  const sources = await inspectableSources(client, c, order, { lock: true });
  const source = sources.find((entry) => entry.row.id === input.productionEntryId);
  if (!source) throw qiError(400, "MFG_QI_SOURCE_INVALID");
  const direction = String(input.direction ?? "").toUpperCase();
  if (!["ACCEPTED_TO_REJECTED", "REJECTED_TO_ACCEPTED"].includes(direction)) throw qiError(400, "MFG_QI_STATE_INVALID", "Choose which way the output moves.");
  const kind = String(input.kind ?? "REVIEW").toUpperCase();
  if (!["REVIEW", "REWORK"].includes(kind)) throw qiError(400, "MFG_QI_STATE_INVALID", "Choose a review or a rework.");
  const amount = (await quantityOf(client, c, order, input.quantity, input.uomId)).base;
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw qiError(400, "MFG_QI_REASON_REQUIRED", "Say why the quality decision changes.");
  const f = source.figures;
  let disposition = null;
  if (direction === "ACCEPTED_TO_REJECTED") {
    const unreceived = sub(f.accepted, f.received);
    if (amount > unreceived) throw qiError(409, f.received > ZERO ? "MFG_QI_RECEIPT_EXISTS" : "MFG_QI_DECISION_EXCEEDS", `${source.row.entry_number}: ${q(unreceived)} accepted output is not yet received.`);
    disposition = String(input.rejectionDisposition ?? "").toUpperCase();
    if (!REJECTION_DISPOSITIONS.has(disposition)) throw qiError(400, "MFG_QI_DEFECT_REASON_REQUIRED", "Choose what happens to the rejected output: quarantine, rework or scrap.");
  } else if (amount > f.undisposed) {
    throw qiError(409, f.scrapped > ZERO ? "MFG_QI_ALREADY_DISPOSED" : "MFG_QI_DECISION_EXCEEDS", `${source.row.entry_number}: ${q(f.undisposed)} rejected output is not scrapped.`);
  }
  const number = await nextNumber(client, c, "manufacturing_quality_correction");
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.manufacturing_quality_corrections (id, organization_id, correction_number, manufacturing_order_id, production_entry_id, inspection_id, direction, kind, quantity, reason,
      evidence, rejection_disposition, idempotency_key, corrected_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, c.organizationId, number, order.id, source.row.id, input.inspectionId ? uuid(input.inspectionId, "Inspection") : null, direction, kind, q(amount), reason, text(input.evidence, 1000) || null,
      disposition, key, c.userId ?? null]);
  const column = direction === "ACCEPTED_TO_REJECTED" ? "quality_moved_to_rejected" : "quality_moved_to_accepted";
  await client.query(`UPDATE tenant.manufacturing_production_entries SET ${column} = ${column} + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, source.row.id, q(amount)]);
  const sign = direction === "ACCEPTED_TO_REJECTED" ? -1 : 1;
  await client.query(`UPDATE tenant.manufacturing_orders SET accepted_quantity = accepted_quantity + $3, rejected_quantity = rejected_quantity - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, q(sign > 0 ? amount : -amount)]);
  const summary = `${number}: ${q(amount)} ${direction === "ACCEPTED_TO_REJECTED" ? "accepted → rejected" : `rejected → accepted${kind === "REWORK" ? " after rework" : ""}`} — ${reason}`;
  await entryEvent(client, c, source.row.id, "QUALITY_CORRECTED", summary);
  await orderEvent(client, c, order.id, "QUALITY_CORRECTED", { summary });
  return { orderId: order.id, correctionId: id, correctionNumber: number };
}

// ------------------------------------------------------------------ printing, recovery, evidence
export async function recordInspectionPrint(client, c, id) {
  needQi(c, QI.export);
  const inspection = await loadInspection(client, c, id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_quality_inspections SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.id]);
  await inspectionEvent(client, c, inspection.id, inspection.print_count > 0 ? "REPRINTED" : "PRINTED", { summary: inspection.status === "FINALIZED" ? `Copy ${inspection.print_count + 1}` : "Draft preview" });
  return getQualityInspection(client, c, inspection.id);
}
// Re-check a finalized inspection against the decision and hold it posted.
export async function recoverInspection(client, c, id) {
  needQi(c, QI.approveException);
  const inspection = await loadInspection(client, c, id, { lock: true });
  if (!["FINALIZED", "RECOVERY_REQUIRED"].includes(inspection.status)) throw qiError(409, "MFG_QI_STATE_INVALID", "Only a finalized inspection is re-checked.");
  const problems = [];
  if (add(D(inspection.accepted_quantity), D(inspection.rejected_quantity)) > ZERO) {
    const decision = inspection.quality_decision_id ? (await client.query(`SELECT * FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.quality_decision_id])).rows[0] : null;
    if (!decision) problems.push("No quality decision exists for this inspection.");
    else if (D(decision.accepted_quantity) !== D(inspection.accepted_quantity) || D(decision.rejected_quantity) !== D(inspection.rejected_quantity)) problems.push("The posted decision differs from the inspection.");
  }
  if (D(inspection.hold_quantity) > ZERO && !(inspection.hold_id && (await client.query(`SELECT 1 FROM tenant.manufacturing_quality_holds WHERE id = $1`, [inspection.hold_id])).rows[0])) problems.push("The hold it placed is missing.");
  const to = problems.length ? "RECOVERY_REQUIRED" : "FINALIZED";
  if (to !== inspection.status) {
    await client.query(`UPDATE tenant.manufacturing_quality_inspections SET status = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, inspection.id, to]);
    await inspectionEvent(client, c, inspection.id, to === "FINALIZED" ? "RECOVERED" : "RECOVERY_REQUIRED", { from: inspection.status, to, summary: problems.join(" ") || "The decision agrees" });
  }
  return { check: { consistent: problems.length === 0, problems }, inspection: await getQualityInspection(client, c, inspection.id) };
}

const FILE_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
export async function prepareInspectionFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  const mimeType = FILE_TYPES[extension];
  if (!mimeType) throw qiError(400, "MFG_QI_STATE_INVALID", "Upload a photo, PDF, spreadsheet, document or text file.");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });
export async function listInspectionFiles(client, c, id) {
  needQi(c, QI.view);
  const inspection = await loadInspection(client, c, id);
  return (await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: inspection.id })).map(toFile);
}
export async function uploadInspectionFile(client, c, id, input = {}, options = {}) {
  needQi(c, QI.editDraft);
  const inspection = await loadInspection(client, c, id);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: inspection.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await inspectionEvent(client, c, inspection.id, "FILE_ADDED", { summary: file.fileName ?? file.file_name });
  return toFile(file);
}
export async function removeInspectionFile(client, c, id, fileId) {
  needQi(c, QI.editDraft);
  const inspection = await loadInspection(client, c, id);
  if (!OPEN.has(inspection.status)) throw qiError(409, "MFG_QI_ALREADY_FINALIZED", "Evidence of a finalized inspection is kept.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: inspection.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await inspectionEvent(client, c, inspection.id, "FILE_REMOVED", { summary: fileId });
  return { removed: true };
}
export async function readInspectionFile(client, c, id, fileId, options = {}) {
  needQi(c, QI.view);
  const inspection = await loadInspection(client, c, id);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, inspection.id, uuid(fileId, "File")])).rows[0];
  if (!row) throw qiError(404, "MFG_QI_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: inspection.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}

export { MoError, has };

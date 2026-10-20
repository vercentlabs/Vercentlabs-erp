// Quality — Incoming Inspection: executing an inspection a goods receipt (through its control point) or an authorized person created.
//
//   assign      the inspector, priority and due date.                                              PENDING → ASSIGNED (or reassigned)
//   start       the samples are selected from the sampling plan frozen on the inspection — S01, S02 … or the serial numbers, or one document
//               check — never more than the population.                                            → IN_PROGRESS
//   record      sample-level observations of each characteristic of the frozen specification version, evaluated on save (decimal-safe limits,
//               units, criticality); an out-of-limit measurement is saved as a failed observation, malformed input is refused. Saving again
//               keeps the earlier observation (superseded, never overwritten).
//   submit      every required check complete, required evidence attached; the inspection is evaluated (critical failures stop automatic
//               acceptance). It goes to review (always, or when it failed — the company's policy) or, when no review is needed, its evidence
//               is finalized at once.                                                               → AWAITING_REVIEW | COMPLETED
//   review      a reviewer (never the inspector, when the company prohibits it) approves — finalizing the evidence — or sends it back
//               with what to correct; every submission is kept.                                    → COMPLETED | CHANGES_REQUESTED
//   amend       a recorded result is corrected with a reason after completion, until a disposition is made on it (history kept).
//   cancel      only an inspection without a decision, with a reason.
// Completing an inspection never accepts or releases stock: that is the authorized disposition (./dispositions.js), carried out by Inventory.
import { recordEvent } from "../common.js";
import { loadQualitySettings, createInspection } from "../inspections.js";
import { aggregateOutcome, evaluateCharacteristic, sampleSize } from "../specifications/qs-rules.js";
import { ensureMirrorPlan } from "../specifications/qs-resolver.js";
import { IN, RECORDABLE, expectVersion, has, inError, need, permsOf, routeOf, text, textOrNull, uuid, uuidOrNull } from "./in-rules.js";

const EVENT = (client, c, id, type, payload = {}) => recordEvent(client, c, "inspection", id, `quality.incoming.${type}`, payload);

export async function loadIncoming(client, c, idValue, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.quality_inspections WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(idValue, "Inspection")])).rows[0];
  if (!row) throw inError(404, "QUALITY_INCOMING_NOT_FOUND");
  return row;
}
export async function versionOf(client, row) {
  if (!row.spec_version_id) throw inError(409, "QUALITY_INCOMING_SPEC_MISSING");
  const version = (await client.query(`SELECT * FROM tenant.quality_inspection_spec_versions WHERE id = $1`, [row.spec_version_id])).rows[0];
  const characteristics = (await client.query(`SELECT * FROM tenant.quality_inspection_characteristics WHERE version_id = $1 ORDER BY sequence`, [row.spec_version_id])).rows;
  return { version, characteristics };
}
const bump = (client, id, sets, values = []) => client.query(`UPDATE tenant.quality_inspections SET ${sets}, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [id, ...values]);
const isMember = async (client, c, userId) => Boolean((await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
  [c.organizationId, userId])).rows[0]);
// The inspector working it (or someone who reviews) may record; nobody else.
const mayWork = (c, row) => !row.assigned_inspector_id || row.assigned_inspector_id === c.userId || has(c, permsOf(row).review);

// ------------------------------------------------------------------ assignment
export async function assignIncomingInspector(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.assign);
  expectVersion(row, input);
  if (["COMPLETED", "CANCELLED"].includes(row.workflow_status)) throw inError(409, "QUALITY_INCOMING_STATE", "A completed or cancelled inspection is not reassigned.");
  const inspector = uuidOrNull(input.inspectorId, "Inspector");
  if (inspector && !(await isMember(client, c, inspector))) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Choose an active member of the company as inspector.");
  const priority = ["LOW", "NORMAL", "HIGH", "URGENT"].includes(input.priority) ? input.priority : row.priority;
  const due = input.dueAt ? new Date(String(input.dueAt)) : null;
  if (due && Number.isNaN(due.getTime())) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "The due date is invalid.");
  const status = row.workflow_status === "PENDING" && inspector ? "ASSIGNED" : row.workflow_status;
  await bump(client, row.id, `assigned_inspector_id = $2, assigned_at = CASE WHEN $2::uuid IS DISTINCT FROM assigned_inspector_id THEN clock_timestamp() ELSE assigned_at END, priority = $3,
      due_at = COALESCE($4, due_at), workflow_status = $5`, [inspector, priority, due ? due.toISOString() : null, status]);
  await EVENT(client, c, row.id, "assigned", { inspectorId: inspector, priority, dueAt: due ? due.toISOString() : null, from: row.assigned_inspector_id });
  return { id: row.id };
}

// ------------------------------------------------------------------ samples
// The samples a population needs under the frozen plan. input.serialIds pick the serial numbers sampled (serial-tracked goods);
// input.approvedSampleCount is a reviewer's count for a manually approved plan.
export async function startIncomingInspection(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.start);
  expectVersion(row, input);
  if (!["PENDING", "ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(row.workflow_status)) throw inError(409, "QUALITY_INCOMING_STATE");
  if (row.inspection_type === "in_process" || row.inspection_type === "final") {
    const ctx = (await client.query(`SELECT rework_required, rework_completed_at, rework_instruction FROM tenant.quality_inprocess_contexts WHERE inspection_id = $1`, [row.id])).rows[0];
    if (ctx?.rework_required && !ctx.rework_completed_at)
      throw inError(409, "QUALITY_IPQC_REWORK_PENDING", `Rework is still pending (${ctx.rework_instruction ?? "see the disposition"}): production confirms it before the reinspection starts.`);
  }
  if (row.assigned_inspector_id && row.assigned_inspector_id !== c.userId && !has(c, P.assign)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED", "This inspection is assigned to someone else.");
  const { version } = await versionOf(client, row);
  const existing = Number((await client.query(`SELECT count(*) AS n FROM tenant.quality_inspection_samples WHERE inspection_id = $1`, [row.id])).rows[0].n);
  if (!existing) {
    let computed = row.sampling_snapshot?.computed ?? sampleSize(version, Number(row.lot_quantity));
    if (computed?.needsApproval || computed?.size === null || computed?.size === undefined) {
      if (input.approvedSampleCount === undefined || input.approvedSampleCount === null || input.approvedSampleCount === "")
        throw inError(400, "QUALITY_INCOMING_SAMPLE_COUNT_INVALID", "A Quality reviewer must approve how many units to inspect.");
      if (!has(c, P.review)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED", "Only a reviewer approves the sample count.");
      computed = sampleSize(version, Number(row.lot_quantity), { approvedCount: Math.trunc(Number(input.approvedSampleCount)) });
    }
    await selectSamples(client, c, row, version, computed, input);
    await bump(client, row.id, `sample_quantity = $2, sampling_snapshot = COALESCE(sampling_snapshot, '{}'::jsonb) || jsonb_build_object('computed', $3::jsonb)`,
      [String(computed.size ?? 0), JSON.stringify(computed)]);
  }
  await bump(client, row.id, `workflow_status = CASE WHEN workflow_status IN ('PENDING', 'ASSIGNED') THEN 'IN_PROGRESS' ELSE workflow_status END, started_at = COALESCE(started_at, clock_timestamp()),
      assigned_inspector_id = COALESCE(assigned_inspector_id, $2), assigned_at = COALESCE(assigned_at, clock_timestamp()), status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END`, [c.userId ?? null]);
  await EVENT(client, c, row.id, "started", { samples: existing || undefined });
  return { id: row.id };
}

async function selectSamples(client, c, row, version, computed, input) {
  const size = Number(computed.size ?? 0);
  const population = Math.floor(Number(row.lot_quantity));
  if (size > population && version.sampling_method !== "DOCUMENT_ONLY") throw inError(400, "QUALITY_INCOMING_SAMPLE_COUNT_INVALID", `The sample (${size}) exceeds the ${population} units inspected.`);
  const insert = (sequence, code, scope, method, extra = {}) => client.query(
    `INSERT INTO tenant.quality_inspection_samples (organization_id, inspection_id, sample_code, sequence, scope, batch_id, serial_id, serial_number, selection_method, selected_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [c.organizationId, row.id, code, sequence, scope, row.batch_id, extra.serialId ?? null, extra.serialNumber ?? null, method, c.userId ?? null, extra.note ?? null]);
  if (version.sampling_method === "DOCUMENT_ONLY") return insert(1, "DOC", "DOCUMENT", "DOCUMENT", { note: "Documents and certificates" });
  const serialIds = Array.isArray(input.serialIds) ? [...new Set(input.serialIds.map((value) => uuid(value, "Serial")))] : [];
  if (serialIds.length) {
    if (serialIds.length !== size) throw inError(400, "QUALITY_INCOMING_SAMPLE_COUNT_INVALID", `Pick ${size} serial number${size === 1 ? "" : "s"} to inspect.`);
    const serials = (await client.query(`SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND id = ANY($3::uuid[])`,
      [c.organizationId, row.item_id, serialIds])).rows;
    if (serials.length !== serialIds.length) throw inError(400, "QUALITY_INCOMING_SOURCE_CHANGED", "A chosen serial number is not of this item.");
    let n = 0;
    for (const serial of serials) await insert(++n, serial.serial_number.slice(0, 60).replace(/[^A-Za-z0-9_./-]/g, "-"), "UNIT", "SERIAL", { serialId: serial.id, serialNumber: serial.serial_number });
    return null;
  }
  for (let n = 1; n <= size; n += 1) await insert(n, `S${String(n).padStart(2, "0")}`, "UNIT", "SEQUENTIAL");
  return null;
}

// ------------------------------------------------------------------ results
const KINDS = { NUMERIC_RANGE: "numeric", NUMERIC_TARGET_TOLERANCE: "numeric", BOOLEAN: "boolean", ENUM: "choice", VISUAL: "judgement", TEXT_OBSERVATION: "text" };
function observationOf(ch, entry) {
  if (entry.notApplicable) return { notApplicable: true };
  switch (KINDS[ch.check_type]) {
    case "numeric": return { value: entry.value === undefined || entry.value === null ? "" : String(entry.value).trim(), unit: entry.unit };
    case "boolean": return { value: entry.value === true || entry.value === "true" ? true : entry.value === false || entry.value === "false" ? false : "" };
    case "choice": return { choice: text(entry.value ?? entry.choice, 120) };
    case "judgement": return { judgement: text(entry.judgement ?? entry.value, 10) };
    default: return { value: text(entry.value, 2000), note: text(entry.notes, 2000), judgement: text(entry.judgement, 10) };
  }
}
// input.results: [{ sampleId, characteristicId, value?, unit?, judgement?, notApplicable?, naReason?, instrumentNote?, notes?, evidenceFileIds?, amendmentReason? }]
export async function recordIncomingResults(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.record);
  expectVersion(row, input);
  if (!RECORDABLE.includes(row.workflow_status)) throw inError(409, "QUALITY_INCOMING_STATE", row.workflow_status === "AWAITING_REVIEW" ? "The results are with the reviewer; they can't be changed now." : undefined);
  if (!mayWork(c, row)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED", "This inspection is assigned to someone else.");
  const { characteristics } = await versionOf(client, row);
  const byChar = new Map(characteristics.map((ch) => [ch.id, ch]));
  const samples = new Map((await client.query(`SELECT * FROM tenant.quality_inspection_samples WHERE inspection_id = $1`, [row.id])).rows.map((s) => [s.id, s]));
  const entries = Array.isArray(input.results) ? input.results : [];
  if (!entries.length) throw inError(400, "QUALITY_INCOMING_RESULT_MISSING", "Record at least one result.");
  let saved = 0;
  for (const entry of entries) {
    const sample = samples.get(String(entry.sampleId));
    const ch = byChar.get(String(entry.characteristicId));
    if (!sample || !ch) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "That sample or check is not part of this inspection.");
    const observation = observationOf(ch, entry);
    const blank = !observation.notApplicable && Object.entries(observation).every(([key, v]) => key === "unit" || key === "note" || v === "" || v === undefined || v === null);
    if (blank) continue;
    if (observation.notApplicable && !text(entry.naReason)) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", `${ch.name}: say why it is not applicable.`);
    // A measurement is recorded in the characteristic's own unit (a different unit is refused, never guessed).
    const evaluated = evaluateCharacteristic(ch, observation, null);
    if (["INVALID", "INVALID_UNIT"].includes(evaluated.outcome)) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", `${ch.name} (${sample.sample_code}): ${evaluated.reason}`);
    const outcome = evaluated.outcome === "JUDGEMENT_REQUIRED" ? "REQUIRES_REVIEW" : evaluated.outcome === "INCOMPLETE" ? "NOT_EVALUATED" : evaluated.outcome;
    const current = (await client.query(`SELECT * FROM tenant.quality_inspection_observations WHERE sample_id = $1 AND characteristic_id = $2 AND is_current FOR UPDATE`, [sample.id, ch.id])).rows[0];
    const amendment = textOrNull(entry.amendmentReason, 500);
    if (current && row.workflow_status === "CHANGES_REQUESTED" && current.recorded_at < (row.submitted_at ?? current.recorded_at) && !amendment)
      throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", `${ch.name} (${sample.sample_code}) was submitted already: say why it changes.`);
    const evidence = Array.isArray(entry.evidenceFileIds) ? entry.evidenceFileIds.map((value) => uuid(value, "Evidence")) : current?.evidence_file_ids ?? [];
    if (current) await client.query(`UPDATE tenant.quality_inspection_observations SET is_current = false WHERE id = $1`, [current.id]);
    await client.query(
      `INSERT INTO tenant.quality_inspection_observations (organization_id, inspection_id, sample_id, characteristic_id, numeric_value, unit_code, boolean_value, choice, judgement, text_value,
         not_applicable, na_reason, outcome, outcome_reason, measured_value, evidence_file_ids, instrument_note, notes, supersedes_id, amendment_reason, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [c.organizationId, row.id, sample.id, ch.id, KINDS[ch.check_type] === "numeric" && !observation.notApplicable ? observation.value : null, observation.unit ? text(observation.unit, 12).toUpperCase() : null,
        KINDS[ch.check_type] === "boolean" && !observation.notApplicable ? observation.value : null, KINDS[ch.check_type] === "choice" ? observation.choice || null : null,
        ["PASS", "FAIL"].includes(String(observation.judgement ?? "").toUpperCase()) ? String(observation.judgement).toUpperCase() : null, KINDS[ch.check_type] === "text" ? observation.value || null : null,
        Boolean(observation.notApplicable), observation.notApplicable ? text(entry.naReason, 500) : null, outcome, evaluated.reason ?? null, evaluated.measured ?? null, evidence,
        textOrNull(entry.instrumentNote, 300), textOrNull(entry.notes, 2000), current?.id ?? null, current ? amendment : null, c.userId ?? null]);
    saved += 1;
  }
  await bump(client, row.id, `status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END`);
  await EVENT(client, c, row.id, "results_recorded", { count: saved });
  return { id: row.id, saved, evaluation: await evaluateIncomingInspection(client, c, row.id) };
}
// The consolidated evaluation of the current observations under the frozen version's decision rule. Missing results never pass.
export async function evaluateIncomingInspection(client, c, id) {
  const row = await loadIncoming(client, c, id);
  const { version, characteristics } = await versionOf(client, row);
  const samples = (await client.query(`SELECT * FROM tenant.quality_inspection_samples WHERE inspection_id = $1 ORDER BY sequence`, [row.id])).rows;
  const observations = (await client.query(`SELECT * FROM tenant.quality_inspection_observations WHERE inspection_id = $1 AND is_current`, [row.id])).rows;
  const aggregate = aggregateOutcome(version, characteristics, samples.map((s) => ({
    results: Object.fromEntries(observations.filter((o) => o.sample_id === s.id).map((o) => [o.characteristic_id,
      { outcome: o.outcome === "NOT_EVALUATED" ? "INCOMPLETE" : o.outcome === "REQUIRES_REVIEW" ? "JUDGEMENT_REQUIRED" : o.outcome }])),
  })));
  const failed = characteristics.filter((ch) => observations.some((o) => o.characteristic_id === ch.id && o.outcome === "FAIL"))
    .map((ch) => ({ id: ch.id, name: ch.name, criticality: ch.criticality, samples: observations.filter((o) => o.characteristic_id === ch.id && o.outcome === "FAIL").length }));
  const missingEvidence = characteristics.filter((ch) => ch.evidence_required && !observations.some((o) => o.characteristic_id === ch.id && (o.evidence_file_ids ?? []).length))
    .map((ch) => ch.name);
  const needsJudgement = observations.filter((o) => o.outcome === "REQUIRES_REVIEW").length;
  const proposed = aggregate.proposed === "INCOMPLETE" ? null : aggregate.proposed === "REVIEW_REQUIRED" || needsJudgement ? "REVIEW_REQUIRED" : aggregate.proposed;
  const evaluation = { proposed, incomplete: aggregate.incomplete, criticalFail: aggregate.criticalFail, majorDefects: aggregate.majorDefects, minorDefects: aggregate.minorDefects,
    failedSamples: aggregate.samples.filter((s) => s.outcome === "FAIL").length, sampleCount: samples.length, failed, missingEvidence, needsJudgement, rule: version.decision_rule,
    evaluatedAt: new Date().toISOString() };
  await client.query(`UPDATE tenant.quality_inspections SET evaluation = $2::jsonb, proposed_outcome = $3, critical_failure = $4 WHERE id = $1`,
    [row.id, JSON.stringify(evaluation), proposed, aggregate.criticalFail]);
  return evaluation;
}

// ------------------------------------------------------------------ submit and review
export async function submitIncomingInspection(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.submit);
  expectVersion(row, input);
  if (!RECORDABLE.includes(row.workflow_status)) throw inError(409, "QUALITY_INCOMING_STATE");
  if (!mayWork(c, row)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED", "This inspection is assigned to someone else.");
  const evaluation = await evaluateIncomingInspection(client, c, row.id);
  if (!evaluation.sampleCount) throw inError(400, "QUALITY_INCOMING_RESULT_MISSING", "Start the inspection and record its samples first.");
  if (evaluation.incomplete) throw inError(400, "QUALITY_INCOMING_RESULT_MISSING", `${evaluation.incomplete} required check${evaluation.incomplete === 1 ? " is" : "s are"} not recorded yet.`);
  if (evaluation.missingEvidence.length) throw inError(400, "QUALITY_INCOMING_EVIDENCE_MISSING", `Attach evidence for: ${evaluation.missingEvidence.join(", ")}.`);
  const settings = await loadQualitySettings(client, c);
  const review = settings.incoming_review_policy === "ALWAYS" || evaluation.proposed !== "PASS" || evaluation.criticalFail;
  const number = Number((await client.query(`SELECT count(*) AS n FROM tenant.quality_inspection_reviews WHERE inspection_id = $1 AND action = 'SUBMITTED'`, [row.id])).rows[0].n) + 1;
  await client.query(`INSERT INTO tenant.quality_inspection_reviews (organization_id, inspection_id, action, submission_number, proposed_outcome, snapshot, note, actor_user_id)
    VALUES ($1, $2, 'SUBMITTED', $3, $4, $5::jsonb, $6, $7)`, [c.organizationId, row.id, number, evaluation.proposed, JSON.stringify(evaluation), textOrNull(input.note, 2000), c.userId ?? null]);
  await bump(client, row.id, `workflow_status = $2, submitted_at = clock_timestamp(), submitted_by = $3, inspected_by = $3, inspected_at = clock_timestamp()`, [review ? "AWAITING_REVIEW" : "EVALUATED", c.userId ?? null]);
  await EVENT(client, c, row.id, "submitted", { submission: number, proposed: evaluation.proposed, review });
  if (!review) await finalize(client, c, row.id, { by: c.userId, note: "No review needed: every check passed." });
  else {
    const { notifyPermissionHolders } = await import("../../../core/platform/notifications/index.js");
    await notifyPermissionHolders(client, c, P.review, { category: "quality_issue", title: `Inspection ${row.inspection_number} awaits review`,
      message: evaluation.criticalFail ? "A critical check failed." : evaluation.proposed === "FAIL" ? "The inspection failed." : "Results submitted for review.", href: `/quality/${routeOf(row.inspection_type)}/${row.id}`,
      entityType: "quality_inspection", entityId: row.id }).catch(() => null);
  }
  return { id: row.id, status: review ? "AWAITING_REVIEW" : "COMPLETED", evaluation };
}

// input: { decision: APPROVE | REQUEST_CHANGES, note, outcome?: PASS | FAIL (a manual-review rule or an inspector judgement) }
export async function reviewIncomingInspection(client, c, id, input = {}) {
  const decision = input.decision === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : input.decision === "APPROVE" ? "APPROVE" : null;
  if (!decision) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Approve the results, or send them back.");
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, decision === "APPROVE" ? P.review : P.requestChanges);
  expectVersion(row, input);
  if (row.workflow_status !== "AWAITING_REVIEW") throw inError(409, "QUALITY_INCOMING_STATE", "Only submitted results are reviewed.");
  const settings = await loadQualitySettings(client, c);
  if (settings.prohibit_self_release !== false && row.submitted_by === c.userId && !c.roleSlugs?.includes("organization_owner"))
    throw inError(403, "QUALITY_INCOMING_SELF_DECISION", "The inspector who submitted the results doesn't review them.");
  const note = textOrNull(input.note, 2000);
  const number = Number((await client.query(`SELECT count(*) AS n FROM tenant.quality_inspection_reviews WHERE inspection_id = $1 AND action = 'SUBMITTED'`, [row.id])).rows[0].n);
  if (decision === "REQUEST_CHANGES") {
    if (!note) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say what to correct.");
    await client.query(`INSERT INTO tenant.quality_inspection_reviews (organization_id, inspection_id, action, submission_number, note, actor_user_id) VALUES ($1, $2, 'CHANGES_REQUESTED', $3, $4, $5)`,
      [c.organizationId, row.id, number, note, c.userId ?? null]);
    await bump(client, row.id, `workflow_status = 'CHANGES_REQUESTED'`);
    await EVENT(client, c, row.id, "changes_requested", { note });
    return { id: row.id, status: "CHANGES_REQUESTED" };
  }
  const evaluation = row.evaluation ?? {};
  let proposed = evaluation.proposed;
  if (proposed === "REVIEW_REQUIRED") {
    if (!["PASS", "FAIL"].includes(input.outcome)) throw inError(400, "QUALITY_INCOMING_REVIEW_REQUIRED", "This inspection needs your judgement: pass or fail.");
    if (input.outcome === "PASS" && row.critical_failure) throw inError(409, "QUALITY_INCOMING_CRITICAL_FAILURE", "A critical check failed: it can't be judged a pass.");
    proposed = input.outcome;
  }
  await client.query(`INSERT INTO tenant.quality_inspection_reviews (organization_id, inspection_id, action, submission_number, proposed_outcome, note, actor_user_id) VALUES ($1, $2, 'APPROVED', $3, $4, $5, $6)`,
    [c.organizationId, row.id, number, proposed, note, c.userId ?? null]);
  await client.query(`UPDATE tenant.quality_inspections SET proposed_outcome = $2 WHERE id = $1`, [row.id, proposed]);
  await finalize(client, c, row.id, { by: c.userId, note });
  return { id: row.id, status: "COMPLETED" };
}

// Finalizes the evidence: nothing more is recorded (corrections go through amend). The stock stays held until a disposition.
async function finalize(client, c, id, { by, note }) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const overall = row.proposed_outcome === "PASS" ? "passed" : "failed";
  await bump(client, row.id, `workflow_status = 'COMPLETED', completed_at = clock_timestamp(), completed_by = $2, overall_result = $3`, [by ?? null, overall]);
  await client.query(`INSERT INTO tenant.quality_inspection_reviews (organization_id, inspection_id, action, submission_number, proposed_outcome, snapshot, note, actor_user_id)
    VALUES ($1, $2, 'COMPLETED', (SELECT count(*) FROM tenant.quality_inspection_reviews WHERE inspection_id = $2 AND action = 'SUBMITTED'), $3, $4::jsonb, $5, $6)`,
    [c.organizationId, row.id, row.proposed_outcome, JSON.stringify(row.evaluation ?? {}), note ?? null, by ?? null]);
  if (row.source_id && row.item_id) {
    const { noteInspectionOnHold } = await import("../../stock/quality-holds.js");
    await noteInspectionOnHold(client, c, { sourceDocumentId: row.source_id, itemId: row.item_id, result: overall === "passed" ? "pass" : "fail", inspectionNumber: row.inspection_number });
  }
  await EVENT(client, c, row.id, "completed", { proposed: row.proposed_outcome });
  const { notifyPermissionHolders } = await import("../../../core/platform/notifications/index.js");
  await notifyPermissionHolders(client, c, IN.dispose, { category: "quality_issue", title: `Inspection ${row.inspection_number} awaits a disposition`,
    message: `${row.proposed_outcome === "PASS" ? "Passed" : "Failed"}: decide what happens to ${Number(row.lot_quantity)} units on hold.`, href: `/quality/${routeOf(row.inspection_type)}/${row.id}`,
    entityType: "quality_inspection", entityId: row.id }).catch(() => null);
}

// ------------------------------------------------------------------ amend (after completion, before a disposition)
export async function amendIncomingResult(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.correct);
  expectVersion(row, input);
  if (row.workflow_status !== "COMPLETED") throw inError(409, "QUALITY_INCOMING_STATE", "Results are amended only after the inspection is completed (before that, record them again).");
  if (row.disposition_status !== "NONE") throw inError(409, "QUALITY_INCOMING_STATE", "A disposition was made on these results: reinspect instead.");
  const reason = text(input.amendmentReason ?? input.reason, 500);
  if (!reason) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say why the result is corrected.");
  await client.query(`UPDATE tenant.quality_inspections SET workflow_status = 'IN_PROGRESS' WHERE id = $1`, [row.id]);
  await recordIncomingResults(client, { ...c, permissions: [...(c.permissions ?? []), P.record] }, row.id, { results: (input.results ?? []).map((entry) => ({ ...entry, amendmentReason: reason })) });
  const evaluation = await evaluateIncomingInspection(client, c, row.id);
  if (evaluation.incomplete) throw inError(400, "QUALITY_INCOMING_RESULT_MISSING", "The correction leaves a required check without a result.");
  await bump(client, row.id, `workflow_status = 'COMPLETED', overall_result = $2, proposed_outcome = $3`, [evaluation.proposed === "PASS" ? "passed" : "failed",
    evaluation.proposed === "REVIEW_REQUIRED" ? row.proposed_outcome : evaluation.proposed]);
  await EVENT(client, c, row.id, "amended", { reason, proposed: evaluation.proposed });
  return { id: row.id, evaluation };
}

// ------------------------------------------------------------------ cancel and manual creation
export async function cancelIncomingInspection(client, c, id, input = {}) {
  const row = await loadIncoming(client, c, id, { lock: true });
  const P = permsOf(row);
  need(c, P.cancel);
  const reason = text(input.reason, 300);
  if (!reason) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say why the inspection is cancelled.");
  if (row.disposition_status !== "NONE" || ["COMPLETED", "CANCELLED"].includes(row.workflow_status))
    throw inError(409, "QUALITY_INCOMING_STATE", "A completed inspection, or one with a decision, is not cancelled.");
  if (row.obligation_id && !row.source_reversed && !has(c, P.review)) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED", "A required inspection is cancelled only by a reviewer.");
  await bump(client, row.id, `workflow_status = 'CANCELLED', status = 'cancelled', cancel_reason = $2`, [reason]);
  if (row.obligation_id) await client.query(`UPDATE tenant.quality_inspection_obligations SET inspection_id = NULL, updated_at = clock_timestamp(), row_version = row_version + 1
    WHERE id = $1 AND inspection_id = $2`, [row.obligation_id, row.id]);
  await EVENT(client, c, row.id, "cancelled", { reason });
  return { id: row.id, status: "CANCELLED" };
}

// An authorized manual inspection of a goods receipt line (when no control point created one), bound to the specification version in force.
export async function createManualIncomingInspection(client, c, input = {}) {
  need(c, IN.create);
  const lineId = uuid(input.goodsReceiptLineId, "Goods receipt line");
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_inspections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, `manual:${key}`])).rows[0];
    if (prior) return { id: prior.id, replayed: true };
  }
  const line = (await client.query(
    `SELECT line.*, receipt.receipt_number, receipt.receipt_date, receipt.warehouse_id AS receipt_warehouse_id, receipt.reversed_at, receipt.id AS receipt_id, receipt.supplier_id
       FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.id = line.goods_receipt_id
      WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, lineId])).rows[0];
  if (!line) throw inError(400, "QUALITY_INCOMING_RECEIPT_INVALID");
  if (line.reversed_at) throw inError(409, "QUALITY_INCOMING_SOURCE_CHANGED", "That goods receipt was reversed.");
  const { specificationForSource } = await import("../specifications/qs-resolver.js");
  const found = await specificationForSource(client, c, { stage: "INCOMING", itemId: line.product_id, supplierId: line.supplier_id, warehouseId: line.receipt_warehouse_id,
    date: line.receipt_date instanceof Date ? `${line.receipt_date.getFullYear()}-${String(line.receipt_date.getMonth() + 1).padStart(2, "0")}-${String(line.receipt_date.getDate()).padStart(2, "0")}` : String(line.receipt_date).slice(0, 10),
    quantity: String(line.base_quantity ?? line.accepted_quantity ?? 1), sourceType: "goods_receipt", sourceId: line.receipt_id, sourceLineId: line.id, sourceLabel: `${line.receipt_number} line ${line.line_number}` });
  if (found.status !== "RESOLVED") throw inError(409, "QUALITY_INCOMING_SPEC_MISSING");
  const quantity = Number(input.quantity ?? line.base_quantity ?? 0);
  if (!(quantity > 0)) throw inError(400, "QUALITY_INCOMING_QUANTITY_MISMATCH", "Enter the quantity to inspect.");
  const planId = found.planId ?? await ensureMirrorPlan(client, c, found.versionId);
  const created = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: "incoming", sourceType: "procurement_receipt", sourceId: line.receipt_id, itemId: line.product_id, supplierId: line.supplier_id, warehouseId: line.receipt_warehouse_id,
    batchId: line.batch_id, lotQuantity: String(quantity), specResolution: { ...found.resolution, manual: true, reason: text(input.reason, 500) || null }, goodsReceiptLineId: line.id,
    priority: input.priority, population: { controlled: String(quantity), manual: true },
  }, { boundVersionId: found.versionId, allowPendingSample: true });
  if (key) await client.query(`UPDATE tenant.quality_inspections SET idempotency_key = $2 WHERE id = $1`, [created.id, `manual:${key}`]);
  await EVENT(client, c, created.id, "created_manually", { line: lineId, reason: text(input.reason, 500) || null });
  return { id: created.id };
}

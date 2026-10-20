// Quality — Nonconformance (NCR): the commands. Each checks its permission, the NCR's state and the row version, records an event and
// never rewrites history: actions are cancelled with a reason, evidence stays, a reopened NCR keeps everything that happened before.
//
//   create               by hand or from an inspection's disposition (the failed observations stay linked); affected items and quantities.
//   update / assign      details while OPEN or UNDER_REVIEW; the accountable owner (an active member).
//   startReview          OPEN → UNDER_REVIEW (an owner is required).
//   recordContainment    what was done to the affected population now, and by when.
//   recordInvestigation  the root cause and the method used.
//   addAction / completeAction / cancelAction   containment, correction, corrective and preventive actions; completion needs a note.
//   requireAction        UNDER_REVIEW → ACTION_REQUIRED: containment, root cause and at least one corrective action.
//   submitForVerification ACTION_REQUIRED → VERIFICATION_PENDING: every action done or cancelled.
//   verify               VERIFICATION_PENDING → RESOLVED (effective, with the resolution) or back to ACTION_REQUIRED (not effective, with a
//                        new action). The verifier completed none of the actions.
//   close / reopen       RESOLVED → CLOSED (blocking dependencies done; a major or critical NCR not by its owner); RESOLVED / CLOSED →
//                        UNDER_REVIEW with a reason.
//   cancel               OPEN / UNDER_REVIEW with a reason.
//   addLink / completeLink  dependencies outside Quality (a supplier claim, a credit note …).
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { notifyRecordOwner } from "../../../core/platform/notifications/index.js";
import { recordEvent } from "../common.js";
import {
  ACTION_TYPES, LINK_TYPES, METHODS, NC, SEVERITY, SOURCES, dateOrNull, expectVersion, ncError, need, oneOf, quantity, text, textOrNull, uuid, uuidOrNull,
} from "./nc-rules.js";

const EVENT = (client, c, id, type, payload = {}) => recordEvent(client, c, "nonconformance", id, `quality.nonconformance.${type}`, payload);
export async function loadNonconformance(client, c, idValue, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.quality_nonconformances WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(idValue, "Nonconformance")])).rows[0];
  if (!row) throw ncError(404, "QUALITY_NC_NOT_FOUND");
  return row;
}
const bump = (client, id, sets, values = []) =>
  client.query(`UPDATE tenant.quality_nonconformances SET ${sets}, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [id, ...values]);
const isMember = async (client, c, userId) => Boolean((await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
  [c.organizationId, userId])).rows[0]);
async function member(client, c, value, label) {
  const id = uuidOrNull(value, label);
  if (id && !(await isMember(client, c, id))) throw ncError(400, "QUALITY_NC_INVALID", `${label}: choose an active member of the company.`);
  return id;
}
function inState(row, list, message) {
  if (!list.includes(row.status)) throw ncError(409, "QUALITY_NC_STATE", message);
}
async function actionsOf(client, ncId) {
  return (await client.query(`SELECT * FROM tenant.quality_nonconformance_actions WHERE nonconformance_id = $1 ORDER BY sequence`, [ncId])).rows;
}
async function notifyOwner(client, c, row, title, message) {
  if (!row.owner_user_id || row.owner_user_id === c.userId) return;
  await notifyRecordOwner(client, c, { userId: row.owner_user_id, category: "quality_issue", title, message: message.slice(0, 300),
    href: `/quality/nonconformances/${row.id}`, entityType: "quality_nonconformance", entityId: row.id });
}

// ------------------------------------------------------------------ raising
// input: { title?, description, severity, sourceType?, sourceLabel?, inspectionId?, sourceId?, itemId?, supplierId?, batchId?, serialId?, defectCode?, category?,
//          detectedQuantity?, affectedQuantity?, ownerUserId?, dueDate?, items?: [{ itemId, batchId?, serialId?, warehouseId?, quantity, description? }], idempotencyKey? }
export async function createNonconformance(client, c, input = {}) {
  need(c, NC.manage);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT * FROM tenant.quality_nonconformances WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { ...prior, replayed: true };
  }
  const description = text(input.description, 4000);
  if (!description) throw ncError(400, "QUALITY_NC_INVALID", "Describe the defect.");
  const severity = oneOf(String(input.severity ?? "minor").toLowerCase(), SEVERITY, "Severity");
  const sourceType = Object.prototype.hasOwnProperty.call(SOURCES, input.sourceType) ? input.sourceType : input.inspectionId ? "procurement_receipt" : "manual";
  const inspection = input.inspectionId ? (await client.query(`SELECT id, inspection_number, inspection_type, item_id, supplier_id, batch_id, warehouse_id, lot_quantity
      FROM tenant.quality_inspections WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.inspectionId, "Inspection")])).rows[0] : null;
  if (input.inspectionId && !inspection) throw ncError(400, "QUALITY_NC_INVALID", "That inspection was not found.");
  const owner = await member(client, c, input.ownerUserId, "Owner") ?? c.userId ?? null;
  const items = Array.isArray(input.items) && input.items.length ? input.items
    : (input.itemId ?? inspection?.item_id) ? [{ itemId: input.itemId ?? inspection.item_id, batchId: input.batchId ?? inspection?.batch_id, serialId: input.serialId,
      warehouseId: input.warehouseId ?? inspection?.warehouse_id, quantity: input.affectedQuantity ?? input.detectedQuantity ?? 0 }] : [];
  const affected = items.reduce((sum, i) => sum + quantity(i.quantity, "Affected quantity"), 0);
  const number = await nextDocumentNumber(client, c, { documentType: "quality_nonconformance", prefix: "NC" });
  const row = (await client.query(`INSERT INTO tenant.quality_nonconformances (organization_id, nonconformance_number, title, inspection_id, source_type, source_id, source_label, item_id,
      supplier_id, batch_id, serial_id, severity, category, defect_code, description, detected_quantity, affected_quantity, status, owner_user_id, due_date, detected_at, detected_by,
      idempotency_key, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'OPEN',$18,$19,clock_timestamp(),$20,$21,$20) RETURNING *`,
  [c.organizationId, number, text(input.title, 200) || description.slice(0, 120), inspection?.id ?? null, sourceType, uuidOrNull(input.sourceId, "Source"),
    textOrNull(input.sourceLabel, 200) ?? (inspection ? `Inspection ${inspection.inspection_number}` : null), uuidOrNull(input.itemId, "Item") ?? inspection?.item_id ?? null,
    uuidOrNull(input.supplierId, "Supplier") ?? inspection?.supplier_id ?? null, uuidOrNull(input.batchId, "Batch") ?? inspection?.batch_id ?? null, uuidOrNull(input.serialId, "Serial"),
    severity, text(input.category, 100) || (inspection ? `${inspection.inspection_type}_inspection` : "general"), textOrNull(input.defectCode, 60), description,
    String(quantity(input.detectedQuantity ?? affected, "Detected quantity")), String(affected), owner, dateOrNull(input.dueDate, "Due date"), c.userId ?? null, key])).rows[0];
  for (const i of items) {
    await client.query(`INSERT INTO tenant.quality_nonconformance_items (organization_id, nonconformance_id, item_id, batch_id, serial_id, warehouse_id, quantity, description, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [c.organizationId, row.id, uuidOrNull(i.itemId, "Item"), uuidOrNull(i.batchId, "Batch"), uuidOrNull(i.serialId, "Serial"),
      uuidOrNull(i.warehouseId, "Warehouse"), String(quantity(i.quantity, "Affected quantity")), textOrNull(i.description, 500), c.userId ?? null]);
  }
  await EVENT(client, c, row.id, "created", { severity, source: sourceType, inspection: inspection?.inspection_number ?? null });
  await notifyOwner(client, c, row, `Nonconformance ${number} (${severity}) is yours`, description);
  return row;
}

// input: { title?, description?, severity?, defectCode?, dueDate?, version? }
export async function updateNonconformance(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["OPEN", "UNDER_REVIEW"], "Details change only while the NCR is open or under review.");
  const severity = input.severity === undefined ? row.severity : oneOf(String(input.severity).toLowerCase(), SEVERITY, "Severity");
  const description = input.description === undefined ? row.description : text(input.description, 4000);
  if (!description) throw ncError(400, "QUALITY_NC_INVALID", "Describe the defect.");
  await bump(client, row.id, `title = $2, description = $3, severity = $4, defect_code = $5, due_date = $6`, [input.title === undefined ? row.title : text(input.title, 200) || row.title,
    description, severity, input.defectCode === undefined ? row.defect_code : textOrNull(input.defectCode, 60), input.dueDate === undefined ? row.due_date : dateOrNull(input.dueDate, "Due date")]);
  await EVENT(client, c, row.id, "updated", { severity, from: row.severity !== severity ? row.severity : undefined });
  return { id: row.id };
}
// input: { ownerUserId, version? }
export async function assignNonconformance(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["OPEN", "UNDER_REVIEW", "ACTION_REQUIRED", "VERIFICATION_PENDING", "RESOLVED"], "A closed or cancelled NCR keeps its owner.");
  const owner = await member(client, c, input.ownerUserId, "Owner");
  if (!owner) throw ncError(400, "QUALITY_NC_OWNER_REQUIRED");
  await bump(client, row.id, "owner_user_id = $2", [owner]);
  await EVENT(client, c, row.id, "assigned", { from: row.owner_user_id, to: owner });
  await notifyOwner(client, c, { ...row, owner_user_id: owner }, `Nonconformance ${row.nonconformance_number} is yours`, row.title ?? row.description);
  return { id: row.id };
}
export async function startNonconformanceReview(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["OPEN"], "Only an open NCR starts its review.");
  if (!row.owner_user_id) throw ncError(409, "QUALITY_NC_OWNER_REQUIRED");
  await bump(client, row.id, "status = 'UNDER_REVIEW'");
  await EVENT(client, c, row.id, "review_started", {});
  return { id: row.id, status: "UNDER_REVIEW" };
}
// input: { containmentAction, containmentDue?, version? }
export async function recordNonconformanceContainment(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["UNDER_REVIEW", "ACTION_REQUIRED"], "Containment is recorded during the review.");
  const containment = text(input.containmentAction, 2000);
  if (!containment) throw ncError(400, "QUALITY_NC_CONTAINMENT_REQUIRED", "Describe what was done to contain the affected population.");
  await bump(client, row.id, "containment_action = $2, containment_due = $3, contained_at = clock_timestamp(), contained_by = $4",
    [containment, dateOrNull(input.containmentDue, "Containment due"), c.userId ?? null]);
  await EVENT(client, c, row.id, "contained", { note: containment });
  return { id: row.id };
}
// input: { rootCause, method, summary?, version? }
export async function recordNonconformanceInvestigation(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["UNDER_REVIEW", "ACTION_REQUIRED"], "The investigation is recorded during the review.");
  const rootCause = text(input.rootCause, 4000);
  if (!rootCause) throw ncError(400, "QUALITY_NC_ROOT_CAUSE_REQUIRED", "State the root cause.");
  const method = oneOf(input.method ?? "OTHER", METHODS, "Method");
  await bump(client, row.id, "root_cause = $2, root_cause_method = $3, investigation_summary = $4, investigated_at = clock_timestamp(), investigated_by = $5",
    [rootCause, method, textOrNull(input.summary, 4000), c.userId ?? null]);
  await EVENT(client, c, row.id, "investigated", { method, note: rootCause });
  return { id: row.id };
}

// ------------------------------------------------------------------ actions
// input: { actionType, description, ownerUserId?, dueDate? }
export async function addNonconformanceAction(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  inState(row, ["UNDER_REVIEW", "ACTION_REQUIRED"], "Actions are planned during the review and while action is required.");
  const type = oneOf(input.actionType, ACTION_TYPES, "Action type");
  const description = text(input.description, 2000);
  if (!description) throw ncError(400, "QUALITY_NC_INVALID", "Describe the action.");
  const owner = await member(client, c, input.ownerUserId, "Action owner") ?? row.owner_user_id;
  const sequence = Number((await client.query(`SELECT COALESCE(max(sequence), 0) + 1 AS n FROM tenant.quality_nonconformance_actions WHERE nonconformance_id = $1`, [row.id])).rows[0].n);
  const action = (await client.query(`INSERT INTO tenant.quality_nonconformance_actions (organization_id, nonconformance_id, sequence, action_type, description, owner_user_id, due_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [c.organizationId, row.id, sequence, type, description, owner, dateOrNull(input.dueDate, "Due date"), c.userId ?? null])).rows[0];
  await bump(client, row.id, "title = title");
  await EVENT(client, c, row.id, "action_added", { sequence, type, note: description });
  if (owner && owner !== c.userId) await notifyRecordOwner(client, c, { userId: owner, category: "quality_issue", title: `Action ${row.nonconformance_number}-${sequence} is yours`,
    message: description.slice(0, 300), href: `/quality/nonconformances/${row.id}`, entityType: "quality_nonconformance", entityId: row.id });
  return { id: action.id, sequence };
}
async function loadAction(client, c, row, actionId) {
  const action = (await client.query(`SELECT * FROM tenant.quality_nonconformance_actions WHERE organization_id = $1 AND nonconformance_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, row.id, uuid(actionId, "Action")])).rows[0];
  if (!action) throw ncError(404, "QUALITY_NC_NOT_FOUND", "That action was not found.");
  return action;
}
// input: { actionId, note, evidenceFileIds? } — the action's owner, or anyone who manages NCRs.
export async function completeNonconformanceAction(client, c, id, input = {}) {
  const row = await loadNonconformance(client, c, id, { lock: true });
  const action = await loadAction(client, c, row, input.actionId);
  if (action.owner_user_id !== c.userId) need(c, NC.manage);
  inState(row, ["UNDER_REVIEW", "ACTION_REQUIRED"], "Actions are completed during the review and while action is required.");
  if (action.status !== "OPEN") throw ncError(409, "QUALITY_NC_STATE", "Only an open action is completed.");
  const note = text(input.note, 2000);
  if (!note) throw ncError(400, "QUALITY_NC_EVIDENCE_REQUIRED");
  const files = Array.isArray(input.evidenceFileIds) ? [...new Set(input.evidenceFileIds.map((f) => uuid(f, "Evidence")))] : [];
  if (files.length) {
    const known = Number((await client.query(`SELECT count(*) AS n FROM public.attachments WHERE organization_id = $1 AND entity_type = 'quality.nonconformance' AND entity_id = $2
        AND id = ANY($3::uuid[]) AND archived_at IS NULL`, [c.organizationId, row.id, files])).rows[0].n);
    if (known !== files.length) throw ncError(400, "QUALITY_NC_INVALID", "Attach the evidence to this NCR first.");
  }
  await client.query(`UPDATE tenant.quality_nonconformance_actions SET status = 'DONE', completed_by = $2, completed_at = clock_timestamp(), completion_note = $3, evidence_file_ids = $4,
      updated_at = clock_timestamp() WHERE id = $1`, [action.id, c.userId ?? null, note, files]);
  await bump(client, row.id, "title = title");
  await EVENT(client, c, row.id, "action_completed", { sequence: action.sequence, note });
  return { id: action.id };
}
// input: { actionId, reason }
export async function cancelNonconformanceAction(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  const action = await loadAction(client, c, row, input.actionId);
  inState(row, ["UNDER_REVIEW", "ACTION_REQUIRED"], "Actions are changed during the review and while action is required.");
  if (action.status !== "OPEN") throw ncError(409, "QUALITY_NC_STATE", "Only an open action is cancelled.");
  const reason = text(input.reason, 1000);
  if (!reason) throw ncError(400, "QUALITY_NC_REASON_REQUIRED");
  await client.query(`UPDATE tenant.quality_nonconformance_actions SET status = 'CANCELLED', cancel_reason = $2, updated_at = clock_timestamp() WHERE id = $1`, [action.id, reason]);
  await bump(client, row.id, "title = title");
  await EVENT(client, c, row.id, "action_cancelled", { sequence: action.sequence, reason });
  return { id: action.id };
}

// ------------------------------------------------------------------ the workflow
export async function requireNonconformanceAction(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["UNDER_REVIEW"], "Action is required after the review.");
  if (!row.containment_action) throw ncError(409, "QUALITY_NC_CONTAINMENT_REQUIRED");
  if (!row.root_cause) throw ncError(409, "QUALITY_NC_ROOT_CAUSE_REQUIRED");
  const actions = await actionsOf(client, row.id);
  if (!actions.some((a) => a.action_type === "CORRECTIVE" && a.status !== "CANCELLED")) throw ncError(409, "QUALITY_NC_ACTION_REQUIRED");
  await bump(client, row.id, "status = 'ACTION_REQUIRED'");
  await EVENT(client, c, row.id, "action_required", { actions: actions.filter((a) => a.status === "OPEN").length });
  return { id: row.id, status: "ACTION_REQUIRED" };
}
export async function submitNonconformanceForVerification(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["ACTION_REQUIRED"], "Submit for verification once the actions are carried out.");
  const actions = await actionsOf(client, row.id);
  const open = actions.filter((a) => a.status === "OPEN");
  if (open.length) throw ncError(409, "QUALITY_NC_ACTIONS_OPEN", `Complete or cancel action${open.length === 1 ? "" : "s"} ${open.map((a) => a.sequence).join(", ")} first.`);
  if (!actions.some((a) => a.action_type === "CORRECTIVE" && a.status === "DONE")) throw ncError(409, "QUALITY_NC_ACTION_REQUIRED", "At least one corrective action must be done.");
  await bump(client, row.id, "status = 'VERIFICATION_PENDING'");
  await EVENT(client, c, row.id, "submitted_for_verification", {});
  return { id: row.id, status: "VERIFICATION_PENDING" };
}
// input: { effective: boolean, summary, resolution? (effective), newAction?: { actionType, description, ownerUserId?, dueDate? } (not effective), version? }
export async function verifyNonconformance(client, c, id, input = {}) {
  need(c, NC.verify);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["VERIFICATION_PENDING"], "Only an NCR pending verification is verified.");
  const actions = (await actionsOf(client, row.id)).filter((a) => a.status === "DONE");
  if (actions.some((a) => a.completed_by === c.userId) && !c.roleSlugs?.includes("organization_owner")) throw ncError(403, "QUALITY_NC_SELF_VERIFICATION");
  const summary = text(input.summary, 4000);
  if (!summary) throw ncError(400, "QUALITY_NC_EVIDENCE_REQUIRED", "Say how the effectiveness was verified.");
  const effective = input.effective === true || input.effective === "true";
  await client.query(`UPDATE tenant.quality_nonconformance_actions SET effectiveness = $2, verified_by = $3, verified_at = clock_timestamp(), verification_note = $4, updated_at = clock_timestamp()
      WHERE nonconformance_id = $1 AND status = 'DONE' AND verified_at IS NULL`, [row.id, effective ? "EFFECTIVE" : "NOT_EFFECTIVE", c.userId ?? null, summary]);
  if (effective) {
    const resolution = text(input.resolution, 4000);
    if (!resolution) throw ncError(400, "QUALITY_NC_INVALID", "Record the resolution.");
    await bump(client, row.id, `status = 'RESOLVED', verification_summary = $2, verified_by = $3, verified_at = clock_timestamp(), resolution_summary = $4, resolved_by = $3,
      resolved_at = clock_timestamp()`, [summary, c.userId ?? null, resolution]);
    await EVENT(client, c, row.id, "resolved", { note: resolution });
    await notifyOwner(client, c, row, `Nonconformance ${row.nonconformance_number} is resolved`, resolution);
    return { id: row.id, status: "RESOLVED" };
  }
  if (!input.newAction || typeof input.newAction !== "object") throw ncError(400, "QUALITY_NC_ACTION_REQUIRED", "Plan the further action needed.");
  await bump(client, row.id, "status = 'ACTION_REQUIRED', verification_summary = $2", [summary]);
  await EVENT(client, c, row.id, "verification_failed", { note: summary });
  await addNonconformanceAction(client, { ...c, permissions: [...(c.permissions ?? []), NC.manage] }, row.id, input.newAction);
  await notifyOwner(client, c, row, `Nonconformance ${row.nonconformance_number}: the actions were not effective`, summary);
  return { id: row.id, status: "ACTION_REQUIRED" };
}
// input: { note, version? }
export async function closeNonconformance(client, c, id, input = {}) {
  need(c, NC.close);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["RESOLVED"], "Only a resolved NCR is closed.");
  if (["major", "critical"].includes(row.severity) && row.owner_user_id === c.userId && !c.roleSlugs?.includes("organization_owner")) throw ncError(403, "QUALITY_NC_SELF_CLOSURE");
  const blocking = (await client.query(`SELECT link_type, reference FROM tenant.quality_nonconformance_links WHERE nonconformance_id = $1 AND blocks_closure AND status = 'OPEN'`, [row.id])).rows;
  if (blocking.length) throw ncError(409, "QUALITY_NC_DEPENDENCY_OPEN", `Still open: ${blocking.map((l) => `${LINK_TYPES[l.link_type]} ${l.reference}`).join(", ")}.`);
  const note = text(input.note, 2000);
  if (!note) throw ncError(400, "QUALITY_NC_REASON_REQUIRED", "Add a closure note.");
  await bump(client, row.id, "status = 'CLOSED', closure_note = $2, closed_by = $3, closed_at = clock_timestamp()", [note, c.userId ?? null]);
  await EVENT(client, c, row.id, "closed", { note });
  return { id: row.id, status: "CLOSED" };
}
// input: { reason, version? }
export async function reopenNonconformance(client, c, id, input = {}) {
  need(c, NC.close);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["RESOLVED", "CLOSED"], "Only a resolved or closed NCR is reopened.");
  const reason = text(input.reason, 2000);
  if (!reason) throw ncError(400, "QUALITY_NC_REASON_REQUIRED");
  await bump(client, row.id, "status = 'UNDER_REVIEW', reopened_count = reopened_count + 1, closed_at = NULL, closed_by = NULL");
  await EVENT(client, c, row.id, "reopened", { reason, from: row.status });
  await notifyOwner(client, c, row, `Nonconformance ${row.nonconformance_number} was reopened`, reason);
  return { id: row.id, status: "UNDER_REVIEW" };
}
// input: { reason, version? }
export async function cancelNonconformance(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  expectVersion(row, input);
  inState(row, ["OPEN", "UNDER_REVIEW"], "Only an NCR still open or under review is cancelled.");
  const reason = text(typeof input === "string" ? input : input.reason, 1000);
  if (!reason) throw ncError(400, "QUALITY_NC_REASON_REQUIRED");
  if ((await client.query(`SELECT 1 FROM tenant.quality_nonconformance_actions WHERE nonconformance_id = $1 AND status = 'DONE' LIMIT 1`, [row.id])).rows[0])
    throw ncError(409, "QUALITY_NC_STATE", "Actions were already carried out: resolve the NCR instead.");
  await bump(client, row.id, "status = 'CANCELLED', cancel_reason = $2, closed_by = $3, closed_at = clock_timestamp()", [reason, c.userId ?? null]);
  await EVENT(client, c, row.id, "cancelled", { reason });
  return { id: row.id, status: "CANCELLED" };
}

// ------------------------------------------------------------------ dependencies outside Quality
// input: { linkType, reference, note?, blocksClosure? }
export async function addNonconformanceLink(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  inState(row, ["OPEN", "UNDER_REVIEW", "ACTION_REQUIRED", "VERIFICATION_PENDING", "RESOLVED"], "A closed or cancelled NCR takes no new dependency.");
  const type = oneOf(input.linkType, LINK_TYPES, "Dependency");
  const reference = text(input.reference, 200);
  if (!reference) throw ncError(400, "QUALITY_NC_INVALID", "Enter the reference (claim number, credit note …).");
  const link = (await client.query(`INSERT INTO tenant.quality_nonconformance_links (organization_id, nonconformance_id, link_type, reference, note, blocks_closure, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [c.organizationId, row.id, type, reference, textOrNull(input.note, 1000), input.blocksClosure === true || input.blocksClosure === "true",
    c.userId ?? null])).rows[0];
  await EVENT(client, c, row.id, "dependency_added", { type, reference });
  return { id: link.id };
}
// input: { linkId, note }
export async function completeNonconformanceLink(client, c, id, input = {}) {
  need(c, NC.manage);
  const row = await loadNonconformance(client, c, id, { lock: true });
  const link = (await client.query(`SELECT * FROM tenant.quality_nonconformance_links WHERE organization_id = $1 AND nonconformance_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, row.id, uuid(input.linkId, "Dependency")])).rows[0];
  if (!link) throw ncError(404, "QUALITY_NC_NOT_FOUND", "That dependency was not found.");
  if (link.status === "DONE") return { id: link.id, replayed: true };
  const note = text(input.note, 1000);
  if (!note) throw ncError(400, "QUALITY_NC_REASON_REQUIRED", "Say how it was settled.");
  await client.query(`UPDATE tenant.quality_nonconformance_links SET status = 'DONE', done_by = $2, done_at = clock_timestamp(), done_note = $3 WHERE id = $1`, [link.id, c.userId ?? null, note]);
  await EVENT(client, c, row.id, "dependency_done", { type: link.link_type, reference: link.reference, note });
  return { id: link.id };
}

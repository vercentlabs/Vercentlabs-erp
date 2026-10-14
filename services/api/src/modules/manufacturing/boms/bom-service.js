// Bill of Materials — the lifecycle. One BOM per finished item, its revisions moving DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE →
// SUPERSEDED / OBSOLETE (or REJECTED and edited again). Drafts are edited with version protection; submitting validates; approval binds to
// the exact content hash (by someone other than the submitter unless the company allows self-approval); activation sets a non-overlapping
// effective window; a change to an approved recipe is a new revision. Planning reads it (requirements, availability, estimated cost), a
// production order freezes it (snapshot), shortages go to Procurement as demand. Every step is recorded.
import { randomUUID } from "node:crypto";

import { mul, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { has, text, uuid } from "../common.js";
import {
  BOM_PERMISSIONS as P, D, availabilityOf, bomError, compareRevisions, effectiveWindowAt, estimateCost, explodeRevision, hashOf, loadItem, loadLines, loadRevision, needBom, out,
  resolveEffectiveBom, revisionContent, settleBomStatuses, validateRevisionContent,
} from "./bom-engine.js";

const STATUS_LABEL = { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", ACTIVE: "Active", SUPERSEDED: "Superseded", OBSOLETE: "Obsolete", REJECTED: "Rejected" };
const MODES = new Set(["PROPORTIONAL", "FIXED_PER_BATCH"]);

async function event(client, c, bomId, revisionId, action, fromStatus, toStatus, details = {}, reason = null, contentHash = null) {
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_events (organization_id, bom_id, revision_id, action, from_status, to_status, reason, content_hash, details, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [c.organizationId, bomId, revisionId, action, fromStatus, toStatus, reason, contentHash, JSON.stringify(details), c.userId ?? null]);
}

const timestamp = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw bomError(400, "MFG_BOM_DATES_INVALID", `${label} is not a valid date.`);
  return date.toISOString();
};
const quantityText = (value, code) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw bomError(400, code);
  return raw;
};

// Header and lines from input, checked for shape (meaning is checked by validation).
function header(input, existing = {}) {
  const outputQuantity = input.outputQuantity !== undefined ? quantityText(input.outputQuantity, "MFG_BOM_OUTPUT_INVALID") : existing.output_quantity;
  const yieldPct = input.expectedYieldPct !== undefined && input.expectedYieldPct !== null && input.expectedYieldPct !== "" ? Number(input.expectedYieldPct) : Number(existing.expected_yield_pct ?? 100);
  if (!(yieldPct > 0 && yieldPct <= 100)) throw bomError(400, "MFG_BOM_YIELD_INVALID");
  const batch = input.batchSize !== undefined ? (input.batchSize === null || input.batchSize === "" ? null : quantityText(input.batchSize, "MFG_BOM_BATCH_REQUIRED")) : existing.batch_size ?? null;
  return {
    outputQuantity, outputUomId: input.outputUomId !== undefined ? uuid(input.outputUomId, "Output unit") : existing.output_uom_id, expectedYieldPct: String(yieldPct), batchSize: batch,
    description: input.description !== undefined ? text(input.description, 4000) || null : existing.description ?? null,
    defaultWarehouseId: input.defaultWarehouseId !== undefined ? (input.defaultWarehouseId ? uuid(input.defaultWarehouseId, "Warehouse") : null) : existing.default_warehouse_id ?? null,
  };
}
function linesOf(input) {
  if (!Array.isArray(input)) return null;
  if (input.length > 500) throw bomError(400, "MFG_BOM_COMPONENT_INVALID", "A BOM revision holds at most 500 lines.");
  return input.map((line, index) => {
    const mode = MODES.has(line.consumptionMode) ? line.consumptionMode : "PROPORTIONAL";
    const scrap = line.scrapAllowancePct === undefined || line.scrapAllowancePct === null || line.scrapAllowancePct === "" ? 0 : Number(line.scrapAllowancePct);
    if (!(scrap >= 0 && scrap <= 500)) throw bomError(400, "MFG_BOM_SCRAP_INVALID", `Line ${index + 1}: the extra-material allowance must be between 0% and 500%.`);
    return { lineNumber: index + 1, componentItemId: uuid(line.componentItemId, `Line ${index + 1} material`), quantity: quantityText(line.quantity, "MFG_BOM_QTY_INVALID"),
      uomId: uuid(line.uomId, `Line ${index + 1} unit`), consumptionMode: mode, scrapAllowancePct: String(scrap),
      childBomRevisionId: line.childBomRevisionId ? uuid(line.childBomRevisionId, `Line ${index + 1} subassembly recipe`) : null, notes: text(line.notes, 1000) || null,
      lineageId: line.lineageId ? uuid(line.lineageId, `Line ${index + 1} lineage`) : null };
  });
}

// The lines replace the old ones. A line keeps its lineage when the editor sends it back (a second line claiming the same lineage gets a new one),
// so comparison and the change log follow each line across edits and revisions.
async function writeLines(client, c, revisionId, lines) {
  await client.query(`DELETE FROM tenant.manufacturing_bom_lines WHERE organization_id = $1 AND revision_id = $2`, [c.organizationId, revisionId]);
  const used = new Set();
  for (const line of lines) {
    const lineage = line.lineageId && !used.has(line.lineageId) ? line.lineageId : randomUUID();
    used.add(lineage);
    line.lineageId = lineage;
    await client.query(
      `INSERT INTO tenant.manufacturing_bom_lines (organization_id, revision_id, line_number, component_item_id, quantity, uom_id, consumption_mode, scrap_allowance_pct, child_bom_revision_id, notes, lineage_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.organizationId, revisionId, line.lineNumber, line.componentItemId, line.quantity, line.uomId, line.consumptionMode, line.scrapAllowancePct, line.childBomRevisionId, line.notes, lineage]);
  }
}

// The change log of a draft edit: each line added, removed or modified (by lineage) and each header value changed, with before and after.
const LINE_FIELDS = [["componentItemId", "component_item_id"], ["quantity", "quantity"], ["uomId", "uom_id"], ["consumptionMode", "consumption_mode"], ["scrapAllowancePct", "scrap_allowance_pct"],
  ["childBomRevisionId", "child_bom_revision_id"], ["notes", "notes"], ["lineNumber", "line_number"]];
const HEADER_FIELDS = [["outputQuantity", "output_quantity"], ["outputUomId", "output_uom_id"], ["expectedYieldPct", "expected_yield_pct"], ["batchSize", "batch_size"], ["description", "description"],
  ["defaultWarehouseId", "default_warehouse_id"]];
const NUMERIC = new Set(["quantity", "scrapAllowancePct", "outputQuantity", "expectedYieldPct", "batchSize"]);
const normal = (key, value) => (value === null || value === undefined || value === "" ? null : NUMERIC.has(key) ? out(D(value)) : key === "lineNumber" ? Number(value) : String(value));
const lineValue = (line) => Object.fromEntries(LINE_FIELDS.map(([key, column]) => [key, normal(key, line[column])]));

async function logChange(client, c, revision, eventType, { lineageId = null, itemId = null, oldValue = null, newValue = null, reason = null } = {}) {
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_revision_changes (organization_id, bom_id, revision_id, revision_number, event_type, lineage_id, item_id, old_value, new_value, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [c.organizationId, revision.bom_id, revision.id, revision.revision_number, eventType, lineageId, itemId, oldValue && JSON.stringify(oldValue), newValue && JSON.stringify(newValue), reason, c.userId ?? null]);
}

async function logDraftChanges(client, c, revision, beforeLines, afterRevision, afterLines, reason) {
  let count = 0;
  const headerBefore = {};
  const headerAfter = {};
  for (const [key, column] of HEADER_FIELDS) {
    const [a, b] = [normal(key, revision[column]), normal(key, afterRevision[column])];
    if (a !== b) { headerBefore[key] = a; headerAfter[key] = b; }
  }
  if (Object.keys(headerAfter).length) { await logChange(client, c, revision, "HEADER_MODIFIED", { oldValue: headerBefore, newValue: headerAfter, reason }); count += 1; }
  if (!afterLines) return count;
  const before = new Map(beforeLines.map((line) => [line.lineage_id, line]));
  for (const line of afterLines) {
    const old = before.get(line.lineage_id);
    const next = lineValue(line);
    if (!old) { await logChange(client, c, revision, "LINE_ADDED", { lineageId: line.lineage_id, itemId: line.component_item_id, newValue: next, reason }); count += 1; continue; }
    before.delete(line.lineage_id);
    const prior = lineValue(old);
    const changed = Object.keys(next).filter((key) => key !== "lineNumber" && prior[key] !== next[key]);
    if (changed.length) {
      await logChange(client, c, revision, "LINE_MODIFIED", { lineageId: line.lineage_id, itemId: line.component_item_id, reason,
        oldValue: Object.fromEntries(changed.map((key) => [key, prior[key]])), newValue: Object.fromEntries(changed.map((key) => [key, next[key]])) });
      count += 1;
    }
  }
  for (const old of before.values()) { await logChange(client, c, revision, "LINE_REMOVED", { lineageId: old.lineage_id, itemId: old.component_item_id, oldValue: lineValue(old), reason }); count += 1; }
  return count;
}

// The content hash of a revision as it stands (header + lines).
async function currentHash(client, c, revisionId) {
  const revision = await loadRevision(client, c.organizationId, revisionId);
  return hashOf(revisionContent(revision, await loadLines(client, c.organizationId, revisionId)));
}

function versionCheck(revision, expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(revision.version)) throw bomError(409, "MFG_BOM_REV_VERSION_CONFLICT");
}

// ------------------------------------------------------------------ create / edit
// input: { finishedItemId, name?, outputQuantity, outputUomId?, expectedYieldPct?, batchSize?, description?, defaultWarehouseId?, lines: [...] }
export async function createManufacturingBom(client, c, input = {}) {
  needBom(c, P.create);
  if (!input.finishedItemId) throw bomError(400, "MFG_BOM_PRODUCT_REQUIRED");
  const finished = await loadItem(client, c.organizationId, uuid(input.finishedItemId, "Product"));
  if (!finished) throw bomError(404, "MFG_BOM_PRODUCT_REQUIRED");
  const existing = (await client.query(`SELECT id, bom_number FROM tenant.manufacturing_bom_masters WHERE organization_id = $1 AND finished_item_id = $2 AND archived_at IS NULL`,
    [c.organizationId, finished.id])).rows[0];
  if (existing) throw bomError(409, "MFG_BOM_ALREADY_EXISTS", `${finished.code} already has ${existing.bom_number}. Create a new revision of it instead.`, { bomId: existing.id });
  const head = header({ outputUomId: finished.uom_id, ...input, outputQuantity: input.outputQuantity ?? "1" });
  const lines = linesOf(input.lines ?? []) ?? [];
  const number = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "manufacturing_bom" });
  const master = (await client.query(
    `INSERT INTO tenant.manufacturing_bom_masters (organization_id, bom_number, finished_item_id, name, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.organizationId, number, finished.id, text(input.name, 200) || null, c.userId ?? null])).rows[0];
  const revision = (await client.query(
    `INSERT INTO tenant.manufacturing_bom_revisions (organization_id, bom_id, revision_number, output_quantity, output_uom_id, expected_yield_pct, batch_size, description,
       default_warehouse_id, change_reason, created_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'First revision',$9) RETURNING id`,
    [c.organizationId, master.id, head.outputQuantity, head.outputUomId, head.expectedYieldPct, head.batchSize, head.description, head.defaultWarehouseId, c.userId ?? null])).rows[0];
  await writeLines(client, c, revision.id, lines);
  const hash = await currentHash(client, c, revision.id);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET content_hash = $2 WHERE id = $1`, [revision.id, hash]);
  await event(client, c, master.id, revision.id, "CREATED", null, "DRAFT", { lines: lines.length }, null, hash);
  return getManufacturingBom(client, c, master.id, { revisionId: revision.id });
}

// input: { expectedVersion, header fields?, lines? (the full list, replaces; each may carry its lineageId), editReason? }. A sent-back revision
// becomes a draft again when edited. Every change is logged line by line.
export async function updateBomDraft(client, c, revisionId, input = {}) {
  needBom(c, P.editDraft);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (!["DRAFT", "REJECTED"].includes(revision.status)) {
    throw bomError(409, "MFG_BOM_REV_NOT_EDITABLE", revision.status === "PENDING_APPROVAL" ? "This revision is waiting for approval; withdraw it to edit." : "Only Draft revisions can be edited. Create a new revision to change an approved recipe.");
  }
  versionCheck(revision, input.expectedVersion);
  const head = header(input, revision);
  const lines = linesOf(input.lines);
  const beforeLines = lines ? await loadLines(client, c.organizationId, revision.id) : null;
  await client.query(
    `UPDATE tenant.manufacturing_bom_revisions SET output_quantity = $3, output_uom_id = $4, expected_yield_pct = $5, batch_size = $6, description = $7, default_warehouse_id = $8,
            change_reason = COALESCE($9, change_reason), status = 'DRAFT', version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, revision.id, head.outputQuantity, head.outputUomId, head.expectedYieldPct, head.batchSize, head.description, head.defaultWarehouseId, text(input.changeReason, 500) || null]);
  if (input.name !== undefined) await client.query(`UPDATE tenant.manufacturing_bom_masters SET name = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.bom_id, text(input.name, 200) || null]);
  if (lines) await writeLines(client, c, revision.id, lines);
  const after = await loadRevision(client, c.organizationId, revision.id);
  const changes = await logDraftChanges(client, c, revision, beforeLines ?? [], after, lines ? await loadLines(client, c.organizationId, revision.id) : null, text(input.editReason, 500) || null);
  const hash = await currentHash(client, c, revision.id);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET content_hash = $2 WHERE id = $1`, [revision.id, hash]);
  await event(client, c, revision.bom_id, revision.id, "EDITED", revision.status, "DRAFT", { lines: lines?.length ?? null, changes }, null, hash);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

export async function validateBomRevision(client, c, revisionId) {
  needBom(c, P.view);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  return validateRevisionContent(client, c.organizationId, revision, await loadLines(client, c.organizationId, revision.id));
}

async function mustBeValid(client, c, revision) {
  const result = await validateRevisionContent(client, c.organizationId, revision, await loadLines(client, c.organizationId, revision.id));
  if (!result.valid) {
    const first = result.issues.find((issue) => issue.severity === "error");
    const code = first.code === "MFG_BOM_CIRCULAR_REFERENCE" ? "MFG_BOM_REV_CIRCULAR_DEPENDENCY" : first.code === "MFG_BOM_CHILD_NOT_APPROVED" ? "MFG_BOM_REV_CHILD_INVALID" : "MFG_BOM_VALIDATION_FAILED";
    throw bomError(409, code, first.message, { issues: result.issues });
  }
  return result;
}

// A subassembly line without a pinned recipe is pinned, at submission, to its BOM's revision effective now, so the approved parent always
// explodes the same child recipe; a later child revision changes the parent only through a new parent revision.
async function pinSubassemblies(client, c, revision) {
  const lines = await loadLines(client, c.organizationId, revision.id);
  let pinned = 0;
  for (const line of lines.filter((row) => !row.child_bom_revision_id)) {
    const child = await resolveEffectiveBom(client, c.organizationId, line.component_item_id);
    if (!child) continue;
    await client.query(`UPDATE tenant.manufacturing_bom_lines SET child_bom_revision_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.id, child]);
    await logChange(client, c, revision, "CHILD_PINNED", { lineageId: line.lineage_id, itemId: line.component_item_id, oldValue: { childBomRevisionId: null }, newValue: { childBomRevisionId: child },
      reason: "Pinned to the subassembly recipe effective at submission" });
    pinned += 1;
  }
  return pinned;
}

// ------------------------------------------------------------------ review
export async function submitBomRevision(client, c, revisionId, input = {}) {
  needBom(c, P.submit);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.status === "PENDING_APPROVAL") return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
  if (!["DRAFT", "REJECTED"].includes(revision.status)) throw bomError(409, "MFG_BOM_REV_NOT_EDITABLE", "Only a draft revision is submitted.");
  versionCheck(revision, input.expectedVersion);
  if (revision.revision_number > 1 && text(revision.change_reason, 500).length < 3) throw bomError(400, "MFG_BOM_REV_CHANGE_REASON_REQUIRED");
  await mustBeValid(client, c, revision);
  const pinned = await pinSubassemblies(client, c, revision);
  if (pinned) await mustBeValid(client, c, revision);
  const hash = await currentHash(client, c, revision.id);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET status = 'PENDING_APPROVAL', content_hash = $3, submitted_at = now(), submitted_by = $4, rejection_reason = NULL,
      rejected_at = NULL, rejected_by = NULL, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id, hash, c.userId ?? null]);
  await event(client, c, revision.bom_id, revision.id, "SUBMITTED", revision.status, "PENDING_APPROVAL", {}, text(input.note, 500) || null, hash);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// Back to draft by the person who submitted it (or anyone who may submit), before a decision.
export async function withdrawBomRevision(client, c, revisionId) {
  needBom(c, P.submit);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.status !== "PENDING_APPROVAL") throw bomError(409, "MFG_BOM_VERSION_STALE", "Only a revision waiting for approval is withdrawn.");
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET status = 'DRAFT', version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id]);
  await event(client, c, revision.bom_id, revision.id, "WITHDRAWN", "PENDING_APPROVAL", "DRAFT");
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// input: { expectedVersion?, contentHash? (the content the approver reviewed), note? }
export async function approveBomRevision(client, c, revisionId, input = {}) {
  needBom(c, P.approve);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.status === "APPROVED" || revision.status === "ACTIVE") return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
  if (revision.status !== "PENDING_APPROVAL") throw bomError(409, "MFG_BOM_VERSION_STALE", "Only a revision waiting for approval is approved.");
  versionCheck(revision, input.expectedVersion);
  if (revision.submitted_by && revision.submitted_by === c.userId) {
    const settings = (await client.query(`SELECT bom_self_approval_allowed FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
    if (!settings?.bom_self_approval_allowed) throw bomError(409, "MFG_BOM_APPROVAL_REQUIRED", "An authorized manager other than the person who submitted it must approve this recipe.");
  }
  const hash = await currentHash(client, c, revision.id);
  if (hash !== revision.content_hash || (input.contentHash && input.contentHash !== hash)) throw bomError(409, "MFG_BOM_REV_APPROVAL_STALE");
  await mustBeValid(client, c, revision);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET status = 'APPROVED', approved_at = now(), approved_by = $3, approval_note = $4, approved_content_hash = $5,
      version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id, c.userId ?? null, text(input.note, 1000) || null, hash]);
  await event(client, c, revision.bom_id, revision.id, "APPROVED", "PENDING_APPROVAL", "APPROVED", {}, text(input.note, 1000) || null, hash);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

export async function rejectBomRevision(client, c, revisionId, input = {}) {
  needBom(c, P.approve);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.status !== "PENDING_APPROVAL") throw bomError(409, "MFG_BOM_VERSION_STALE", "Only a revision waiting for approval is rejected.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw bomError(400, "MFG_BOM_REASON_REQUIRED", "Say why the recipe is rejected.");
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET status = 'REJECTED', rejected_at = now(), rejected_by = $3, rejection_reason = $4, version = version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id, c.userId ?? null, reason]);
  await event(client, c, revision.bom_id, revision.id, "REJECTED", "PENDING_APPROVAL", "REJECTED", {}, reason, revision.content_hash);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// ------------------------------------------------------------------ effectivity: schedule, activate, cancel, retire
// Approval and effectivity are separate: an approved recipe never changes, and its effectivity record says when it is used for new
// production. Windows are half-open [from, to); two live windows of one product never overlap (the database checks it under a lock, so
// concurrent activations cannot both pass). A future start leaves the revision Approved and Scheduled until that moment; the current
// revision stays effective until then, and is superseded when the new window starts. Production orders that froze an earlier revision keep it.
const lockItem = (client, itemId) => client.query(`SELECT pg_advisory_xact_lock(hashtextextended('manufacturing_bom_item:' || $1::text, 0))`, [itemId]);
const clockNow = async (client) => (await client.query(`SELECT clock_timestamp() AS at`)).rows[0].at;
const shortTime = (value) => new Date(value).toISOString().slice(0, 16).replace("T", " ");
const PAST_TOLERANCE_MS = 5 * 60_000;

async function liveWindowOf(client, c, revisionId) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_bom_effectivities WHERE organization_id = $1 AND revision_id = $2 AND status IN ('SCHEDULED', 'ACTIVE')`,
    [c.organizationId, revisionId])).rows[0] ?? null;
}

// input: { effectiveFrom? (default now; a future moment schedules it), effectiveTo?, expectedVersion?, idempotencyKey? }
export async function scheduleBomRevision(client, c, revisionId, input = {}) {
  needBom(c, P.activate);
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT bom_id, revision_id FROM tenant.manufacturing_bom_effectivities WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return getManufacturingBom(client, c, done.bom_id, { revisionId: done.revision_id });
  }
  let revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.archived_at) throw bomError(409, "MFG_BOM_VERSION_STALE", "This BOM is archived.");
  await lockItem(client, revision.finished_item_id);
  await settleBomStatuses(client, c.organizationId, revision.bom_id);
  revision = await loadRevision(client, c.organizationId, revision.id);
  const from = timestamp(input.effectiveFrom, "Effective from");
  const live = await liveWindowOf(client, c, revision.id);
  if (live) {
    if (!from || new Date(from).getTime() === new Date(live.effective_from).getTime()) return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
    throw bomError(409, "MFG_BOM_REV_EFFECTIVITY_OVERLAP", `Revision ${revision.revision_number} is already ${live.status === "ACTIVE" ? "effective" : "scheduled"} from ${shortTime(live.effective_from)}; cancel that schedule to change it.`);
  }
  if (["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(revision.status)) throw bomError(409, "MFG_BOM_REV_APPROVAL_REQUIRED");
  if (revision.status !== "APPROVED") throw bomError(409, "MFG_BOM_REV_NOT_ACTIVE", `Revision ${revision.revision_number} is ${STATUS_LABEL[revision.status].toLowerCase()}; start a new revision from it instead.`);
  versionCheck(revision, input.expectedVersion);
  if ((await currentHash(client, c, revision.id)) !== revision.approved_content_hash) throw bomError(409, "MFG_BOM_REV_APPROVAL_STALE");
  await mustBeValid(client, c, revision);
  const now = await clockNow(client);
  let start = from ? new Date(from) : now;
  if (start.getTime() < now.getTime() - PAST_TOLERANCE_MS) throw bomError(400, "MFG_BOM_DATES_INVALID", "Effective from cannot be in the past: production already made stays on the recipe it used.");
  if (start < now) start = now;
  const to = timestamp(input.effectiveTo, "Effective to");
  if (to && new Date(to) <= start) throw bomError(400, "MFG_BOM_DATES_INVALID", "Effective to must be after effective from.");
  const others = (await client.query(
    `SELECT effectivity.*, revision.revision_number FROM tenant.manufacturing_bom_effectivities effectivity JOIN tenant.manufacturing_bom_revisions revision ON revision.id = effectivity.revision_id
      WHERE effectivity.organization_id = $1 AND effectivity.finished_item_id = $2 AND effectivity.scope_key = 'DEFAULT' AND effectivity.status IN ('SCHEDULED', 'ACTIVE')
      ORDER BY effectivity.effective_from FOR UPDATE OF effectivity`, [c.organizationId, revision.finished_item_id])).rows;
  let replaced = null;
  for (const other of others) {
    const otherFrom = new Date(other.effective_from);
    const otherTo = other.effective_to ? new Date(other.effective_to) : null;
    if (otherFrom >= start) {
      if (to && new Date(to) <= otherFrom) continue;
      throw bomError(409, "MFG_BOM_REV_EFFECTIVITY_OVERLAP", `Revision ${other.revision_number} is scheduled from ${shortTime(otherFrom)}; end this one before then or cancel that schedule.`);
    }
    if (!otherTo || otherTo > start) {
      if (to && (!otherTo || otherTo > new Date(to))) {
        throw bomError(409, "MFG_BOM_REV_EFFECTIVITY_OVERLAP", `Revision ${other.revision_number} stays effective ${otherTo ? `until ${shortTime(otherTo)}` : "with no end"}; a window inside it is not supported — leave the end open.`);
      }
      replaced = other;
    }
  }
  try {
    await client.query("SAVEPOINT bom_schedule");
    if (replaced) {
      await client.query(`UPDATE tenant.manufacturing_bom_effectivities SET effective_to = $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, replaced.id, start]);
    }
    await client.query(
      `INSERT INTO tenant.manufacturing_bom_effectivities (organization_id, bom_id, revision_id, finished_item_id, effective_from, effective_to, replaced_effectivity_id, replaced_previous_to,
         idempotency_key, scheduled_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.organizationId, revision.bom_id, revision.id, revision.finished_item_id, start, to, replaced?.id ?? null, replaced?.effective_to ?? null, key || null, c.userId ?? null]);
    await client.query("RELEASE SAVEPOINT bom_schedule");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT bom_schedule");
    if (error.code === "23P01") throw bomError(409, "MFG_BOM_REV_EFFECTIVITY_OVERLAP");
    if (error.code === "23505" && key) {
      const done = (await client.query(`SELECT bom_id, revision_id FROM tenant.manufacturing_bom_effectivities WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
      if (done) return getManufacturingBom(client, c, done.bom_id, { revisionId: done.revision_id });
      throw bomError(409, "MFG_BOM_REV_OUTCOME_UNKNOWN");
    }
    throw error;
  }
  const scheduled = start > now;
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id]);
  await event(client, c, revision.bom_id, revision.id, scheduled ? "SCHEDULED" : "ACTIVATED", "APPROVED", scheduled ? "APPROVED" : "ACTIVE",
    { effectiveFrom: start.toISOString(), effectiveTo: to, replacesRevision: replaced?.revision_number ?? null }, null, revision.approved_content_hash);
  await settleBomStatuses(client, c.organizationId, revision.bom_id);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// Activation is scheduling from now (or from the date given).
export async function activateBomRevision(client, c, revisionId, input = {}) {
  return scheduleBomRevision(client, c, revisionId, input);
}

// A scheduled window is cancelled before it starts; the window it would have cut short gets its end back.
async function cancelWindow(client, c, window, reason) {
  await client.query(`UPDATE tenant.manufacturing_bom_effectivities SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by = $3, cancel_reason = $4, version = version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, window.id, c.userId ?? null, reason]);
  if (!window.replaced_effectivity_id) return;
  const later = (await client.query(
    `SELECT min(effective_from) AS at FROM tenant.manufacturing_bom_effectivities WHERE organization_id = $1 AND finished_item_id = $2 AND scope_key = $3 AND status IN ('SCHEDULED', 'ACTIVE')
        AND effective_from > $4`, [c.organizationId, window.finished_item_id, window.scope_key, window.effective_from])).rows[0].at;
  let restoreTo = window.replaced_previous_to;
  if (later && (!restoreTo || new Date(restoreTo) > new Date(later))) restoreTo = later;
  await client.query(`UPDATE tenant.manufacturing_bom_effectivities SET effective_to = $3, version = version + 1 WHERE organization_id = $1 AND id = $2 AND status IN ('SCHEDULED', 'ACTIVE') AND effective_to = $4`,
    [c.organizationId, window.replaced_effectivity_id, restoreTo, window.effective_from]);
}

// input: { reason }. Only a schedule that has not started is cancelled; an effective revision is retired instead.
export async function cancelBomSchedule(client, c, revisionId, input = {}) {
  needBom(c, P.activate);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  await lockItem(client, revision.finished_item_id);
  await settleBomStatuses(client, c.organizationId, revision.bom_id);
  const window = await liveWindowOf(client, c, revision.id);
  if (!window || window.status !== "SCHEDULED") throw bomError(409, "MFG_BOM_REV_NOT_ACTIVE", window ? "This revision is already effective; retire it instead." : "This revision is not scheduled.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw bomError(400, "MFG_BOM_REASON_REQUIRED", "Say why the schedule is cancelled.");
  await cancelWindow(client, c, window, reason);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id]);
  await event(client, c, revision.bom_id, revision.id, "SCHEDULE_CANCELLED", "APPROVED", "APPROVED", { effectiveFrom: window.effective_from }, reason);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// Retired from future production; it stays readable, and production orders that froze it keep their recipe. A scheduled window is
// cancelled and an effective one ends now. Refused while another approved or active recipe pins it as a subassembly.
export async function obsoleteBomRevision(client, c, revisionId, input = {}) {
  needBom(c, P.obsolete);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (revision.status === "OBSOLETE") return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
  if (!["APPROVED", "ACTIVE", "SUPERSEDED"].includes(revision.status)) throw bomError(409, "MFG_BOM_VERSION_STALE", "Only an approved, active or superseded revision is retired; a draft is discarded.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw bomError(400, "MFG_BOM_REASON_REQUIRED", "Say why the revision is retired.");
  const pinnedBy = (await client.query(
    `SELECT master.bom_number, parent.revision_number FROM tenant.manufacturing_bom_lines line
       JOIN tenant.manufacturing_bom_revisions parent ON parent.id = line.revision_id JOIN tenant.manufacturing_bom_masters master ON master.id = parent.bom_id
      WHERE line.organization_id = $1 AND line.child_bom_revision_id = $2 AND parent.status IN ('PENDING_APPROVAL', 'APPROVED', 'ACTIVE') LIMIT 1`, [c.organizationId, revision.id])).rows[0];
  if (pinnedBy) throw bomError(409, "MFG_BOM_IN_USE", `${pinnedBy.bom_number} revision ${pinnedBy.revision_number} uses this revision as its subassembly recipe; revise that BOM first.`);
  await lockItem(client, revision.finished_item_id);
  await settleBomStatuses(client, c.organizationId, revision.bom_id);
  const window = await liveWindowOf(client, c, revision.id);
  if (window?.status === "SCHEDULED") await cancelWindow(client, c, window, `Revision retired: ${reason}`);
  if (window?.status === "ACTIVE") {
    await client.query(`UPDATE tenant.manufacturing_bom_effectivities SET status = 'ENDED', effective_to = clock_timestamp(), ended_at = clock_timestamp(), version = version + 1
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, window.id]);
  }
  const current = await loadRevision(client, c.organizationId, revision.id);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET status = 'OBSOLETE', obsoleted_at = now(), obsoleted_by = $3, obsolete_reason = $4, version = version + 1
    WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id, c.userId ?? null, reason]);
  await event(client, c, revision.bom_id, revision.id, "OBSOLETED", current.status, "OBSOLETE", {}, reason);
  return getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
}

// A draft that was never approved and never used is thrown away (its BOM too, when it was the BOM's only revision).
export async function discardBomDraft(client, c, revisionId) {
  needBom(c, P.editDraft);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"), { lock: true });
  if (!["DRAFT", "REJECTED"].includes(revision.status)) throw bomError(409, "MFG_BOM_IN_USE", "Only an unapproved draft is discarded; an approved revision is retired.");
  await client.query(`DELETE FROM tenant.manufacturing_bom_lines WHERE organization_id = $1 AND revision_id = $2`, [c.organizationId, revision.id]);
  await event(client, c, revision.bom_id, null, "DRAFT_DISCARDED", revision.status, null, { revisionNumber: revision.revision_number });
  await client.query(`DELETE FROM tenant.manufacturing_bom_revisions WHERE organization_id = $1 AND id = $2`, [c.organizationId, revision.id]);
  const left = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1`, [revision.bom_id])).rows[0].n;
  if (!left) {
    await client.query(`UPDATE tenant.manufacturing_bom_masters SET archived_at = now(), archived_by = $3, archive_reason = 'Draft discarded before approval' WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, revision.bom_id, c.userId ?? null]);
    return { discarded: true, bomId: revision.bom_id, bomArchived: true };
  }
  return { discarded: true, bomId: revision.bom_id, bomArchived: false };
}

// The BOM retired as a whole (its product is no longer made this way). Every revision must be retired first; it stays readable.
export async function archiveManufacturingBom(client, c, bomId, input = {}) {
  needBom(c, P.obsolete);
  const master = (await client.query(`SELECT * FROM tenant.manufacturing_bom_masters WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(bomId, "BOM")])).rows[0];
  if (!master) throw bomError(404, "MFG_BOM_NOT_FOUND");
  if (master.archived_at) return getManufacturingBom(client, c, master.id);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw bomError(400, "MFG_BOM_REASON_REQUIRED", "Say why the BOM is archived.");
  const live = (await client.query(`SELECT revision_number, status FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED', 'ACTIVE')`, [master.id])).rows;
  if (live.length) throw bomError(409, "MFG_BOM_IN_USE", `Revision ${live[0].revision_number} is ${STATUS_LABEL[live[0].status].toLowerCase()}; retire it before archiving the BOM.`);
  await client.query(`UPDATE tenant.manufacturing_bom_masters SET archived_at = now(), archived_by = $3, archive_reason = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, master.id, c.userId ?? null, reason]);
  await event(client, c, master.id, null, "ARCHIVED", null, null, {}, reason);
  return getManufacturingBom(client, c, master.id);
}

// ------------------------------------------------------------------ revisions and copies
// A new draft revision copied from an approved one (default: the one effective now, else the latest approved): its header and every line,
// each line keeping its lineage. The source never changes. The revision number is the next one of this BOM, taken under a lock on the BOM;
// the same request key returns the draft it created. input: { basedOnRevisionId? (or fromRevisionId), changeReason, idempotencyKey? }
export async function createBomRevision(client, c, bomId, input = {}) {
  needBom(c, P.revise);
  const master = (await client.query(`SELECT * FROM tenant.manufacturing_bom_masters WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(bomId, "BOM")])).rows[0];
  if (!master) throw bomError(404, "MFG_BOM_NOT_FOUND");
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1 AND idempotency_key = $2`, [master.id, key])).rows[0];
    if (done) return getManufacturingBom(client, c, master.id, { revisionId: done.id });
  }
  if (master.archived_at) throw bomError(409, "MFG_BOM_VERSION_STALE", "This BOM is archived.");
  const reason = text(input.changeReason, 500);
  if (reason.length < 3) throw bomError(400, "MFG_BOM_REV_CHANGE_REASON_REQUIRED");
  const open = (await client.query(`SELECT revision_number FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED')`, [master.id])).rows[0];
  if (open) throw bomError(409, "MFG_BOM_DRAFT_EXISTS", `Revision ${open.revision_number} is already in progress; finish or discard it first.`);
  const sourceId = input.basedOnRevisionId ?? input.fromRevisionId;
  let source = null;
  if (sourceId) {
    source = (await client.query(`SELECT * FROM tenant.manufacturing_bom_revisions WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(sourceId, "Source revision")])).rows[0] ?? null;
  } else {
    const effective = await resolveEffectiveBom(client, c.organizationId, master.finished_item_id);
    source = (await client.query(`SELECT * FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1 AND approved_content_hash IS NOT NULL ORDER BY (id = $2) DESC, revision_number DESC LIMIT 1`,
      [master.id, effective])).rows[0] ?? null;
  }
  if (!source || source.bom_id !== master.id || !source.approved_content_hash) {
    throw bomError(400, "MFG_BOM_REV_SOURCE_INVALID", "Select a valid source revision: an approved, active, superseded or retired revision of this BOM.");
  }
  const number = (await client.query(`SELECT max(revision_number) + 1 AS n FROM tenant.manufacturing_bom_revisions WHERE bom_id = $1`, [master.id])).rows[0].n;
  let revision;
  try {
    await client.query("SAVEPOINT bom_revision");
    revision = (await client.query(
      `INSERT INTO tenant.manufacturing_bom_revisions (organization_id, bom_id, revision_number, output_quantity, output_uom_id, expected_yield_pct, batch_size, description, default_warehouse_id,
         change_reason, based_on_revision_id, idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [c.organizationId, master.id, number, source.output_quantity, source.output_uom_id, source.expected_yield_pct, source.batch_size, source.description, source.default_warehouse_id,
        reason, source.id, key || null, c.userId ?? null])).rows[0];
    await client.query("RELEASE SAVEPOINT bom_revision");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT bom_revision");
    if (error.code === "23505") throw bomError(409, error.constraint === "manufacturing_bom_revisions_number_uidx" ? "MFG_BOM_REV_DUPLICATE" : "MFG_BOM_DRAFT_EXISTS");
    throw error;
  }
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_lines (organization_id, revision_id, line_number, component_item_id, quantity, uom_id, consumption_mode, scrap_allowance_pct, child_bom_revision_id, notes, lineage_id)
     SELECT organization_id, $2, line_number, component_item_id, quantity, uom_id, consumption_mode, scrap_allowance_pct, child_bom_revision_id, notes, lineage_id
       FROM tenant.manufacturing_bom_lines WHERE organization_id = $1 AND revision_id = $3`, [c.organizationId, revision.id, source.id]);
  const hash = await currentHash(client, c, revision.id);
  await client.query(`UPDATE tenant.manufacturing_bom_revisions SET content_hash = $2 WHERE id = $1`, [revision.id, hash]);
  await event(client, c, master.id, revision.id, "REVISION_CREATED", null, "DRAFT", { from: source.revision_number }, reason, hash);
  return getManufacturingBom(client, c, master.id, { revisionId: revision.id });
}

// A copy of a revision as the first draft of another product's BOM. input: { finishedItemId, name? }
export async function duplicateManufacturingBom(client, c, revisionId, input = {}) {
  needBom(c, P.create);
  const source = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  const lines = await loadLines(client, c.organizationId, source.id);
  return createManufacturingBom(client, c, {
    finishedItemId: input.finishedItemId, name: input.name ?? null, outputQuantity: out(D(source.output_quantity)), outputUomId: input.outputUomId ?? undefined,
    expectedYieldPct: out(D(source.expected_yield_pct)), batchSize: source.batch_size === null ? null : out(D(source.batch_size)), description: source.description,
    lines: lines.map((line) => ({ componentItemId: line.component_item_id, quantity: out(D(line.quantity)), uomId: line.uom_id, consumptionMode: line.consumption_mode,
      scrapAllowancePct: out(D(line.scrap_allowance_pct)), childBomRevisionId: line.child_bom_revision_id, notes: line.notes })),
  });
}

// ------------------------------------------------------------------ reading
// filters: { search?, status? (the BOM's current state), itemId?, componentItemId?, includeArchived? }
export async function listManufacturingBoms(client, c, filters = {}) {
  needBom(c, P.view);
  await settleBomStatuses(client, c.organizationId);
  const values = [c.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (!filters.includeArchived || filters.includeArchived === "false") where.push("master.archived_at IS NULL");
  if (filters.search) where.push(`(master.bom_number ILIKE ${bind(`%${text(filters.search, 100)}%`)} OR item.code ILIKE $${values.length} OR item.name ILIKE $${values.length} OR master.name ILIKE $${values.length})`);
  if (filters.itemId) where.push(`master.finished_item_id = ${bind(uuid(filters.itemId, "Product"))}`);
  if (filters.componentItemId) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_bom_lines line JOIN tenant.manufacturing_bom_revisions any_revision ON any_revision.id = line.revision_id
      WHERE any_revision.bom_id = master.id AND line.component_item_id = ${bind(uuid(filters.componentItemId, "Material"))})`);
  const rows = (await client.query(
    `SELECT master.id, master.bom_number, master.name, master.archived_at, master.updated_at, item.id AS item_id, item.code AS item_code, item.name AS item_name,
            active.revision_number AS active_revision, active.effective_from AS active_from, latest.revision_number AS latest_revision, latest.status AS latest_status,
            latest.updated_at AS latest_updated_at, (SELECT count(*)::int FROM tenant.manufacturing_bom_lines line WHERE line.revision_id = COALESCE(active.id, latest.id)) AS line_count,
            uom.code AS output_uom, COALESCE(active.output_quantity, latest.output_quantity) AS output_quantity
       FROM tenant.manufacturing_bom_masters master
       JOIN tenant.items item ON item.id = master.finished_item_id
       LEFT JOIN LATERAL (SELECT * FROM tenant.manufacturing_bom_revisions revision WHERE revision.bom_id = master.id AND revision.status = 'ACTIVE' AND revision.effective_from <= clock_timestamp()
                           ORDER BY revision.effective_from DESC LIMIT 1) active ON true
       LEFT JOIN LATERAL (SELECT * FROM tenant.manufacturing_bom_revisions revision WHERE revision.bom_id = master.id ORDER BY revision.revision_number DESC LIMIT 1) latest ON true
       LEFT JOIN tenant.units_of_measure uom ON uom.id = COALESCE(active.output_uom_id, latest.output_uom_id)
      WHERE master.organization_id = $1${where.length ? ` AND ${where.join(" AND ")}` : ""}
      ORDER BY master.updated_at DESC LIMIT 500`, values)).rows;
  const state = (row) => (row.archived_at ? "ARCHIVED" : row.active_revision ? "ACTIVE" : row.latest_status ?? "DRAFT");
  const list = rows.map((row) => ({
    id: row.id, number: row.bom_number, name: row.name, finishedItem: { id: row.item_id, code: row.item_code, name: row.item_name }, state: state(row),
    activeRevision: row.active_revision, latestRevision: row.latest_revision, latestStatus: row.latest_status, output: `${out(D(row.output_quantity))} ${row.output_uom ?? ""}`.trim(),
    lines: row.line_count, updatedAt: row.latest_updated_at ?? row.updated_at,
  }));
  return filters.status && filters.status !== "all" ? list.filter((row) => row.state === filters.status || row.latestStatus === filters.status) : list;
}

// One BOM: its revisions, the chosen revision (default: the active one, else the most recent) with its lines and the problems to fix, where it
// is used, its history, and what the person may do.
export async function getManufacturingBom(client, c, bomId, { revisionId = null } = {}) {
  needBom(c, P.view);
  const id = uuid(bomId, "BOM");
  await settleBomStatuses(client, c.organizationId, id);
  const master = (await client.query(
    `SELECT master.*, item.code AS item_code, item.name AS item_name, item.uom_id AS item_uom_id, item.tracking_type, creator.full_name AS created_by_name
       FROM tenant.manufacturing_bom_masters master JOIN tenant.items item ON item.id = master.finished_item_id LEFT JOIN public.users creator ON creator.id = master.created_by
      WHERE master.organization_id = $1 AND master.id = $2`, [c.organizationId, id])).rows[0];
  if (!master) throw bomError(404, "MFG_BOM_NOT_FOUND");
  const revisions = (await client.query(
    `SELECT revision.*, uom.code AS output_uom, submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name, rejecter.full_name AS rejected_by_name,
            activator.full_name AS activated_by_name, creator.full_name AS created_by_name, warehouse.code AS warehouse_code
       FROM tenant.manufacturing_bom_revisions revision
       JOIN tenant.units_of_measure uom ON uom.id = revision.output_uom_id
       LEFT JOIN public.users submitter ON submitter.id = revision.submitted_by LEFT JOIN public.users approver ON approver.id = revision.approved_by
       LEFT JOIN public.users rejecter ON rejecter.id = revision.rejected_by LEFT JOIN public.users activator ON activator.id = revision.activated_by
       LEFT JOIN public.users creator ON creator.id = revision.created_by LEFT JOIN tenant.warehouses warehouse ON warehouse.id = revision.default_warehouse_id
      WHERE revision.organization_id = $1 AND revision.bom_id = $2 ORDER BY revision.revision_number DESC`, [c.organizationId, id])).rows;
  const windows = (await client.query(
    `SELECT effectivity.*, revision.revision_number, scheduler.full_name AS scheduled_by_name, canceller.full_name AS cancelled_by_name
       FROM tenant.manufacturing_bom_effectivities effectivity JOIN tenant.manufacturing_bom_revisions revision ON revision.id = effectivity.revision_id
       LEFT JOIN public.users scheduler ON scheduler.id = effectivity.scheduled_by LEFT JOIN public.users canceller ON canceller.id = effectivity.cancelled_by
      WHERE effectivity.organization_id = $1 AND effectivity.bom_id = $2 ORDER BY effectivity.effective_from DESC, effectivity.scheduled_at DESC`, [c.organizationId, id])).rows;
  const now = await clockNow(client);
  const liveWindow = (revision) => windows.find((row) => row.revision_id === revision.id && ["SCHEDULED", "ACTIVE"].includes(row.status));
  const effectiveWindow = master.archived_at ? null
    : windows.find((row) => ["SCHEDULED", "ACTIVE"].includes(row.status) && new Date(row.effective_from) <= now && (!row.effective_to || new Date(row.effective_to) > now));
  const effective = effectiveWindow ? revisions.find((row) => row.id === effectiveWindow.revision_id) : null;
  const selected = (revisionId && revisions.find((row) => row.id === revisionId)) || effective || revisions[0];
  const lines = selected ? await loadLines(client, c.organizationId, selected.id) : [];
  const subassemblies = new Set((await client.query(
    `SELECT DISTINCT master.finished_item_id FROM tenant.manufacturing_bom_masters master JOIN tenant.manufacturing_bom_revisions revision ON revision.bom_id = master.id
      WHERE master.organization_id = $1 AND master.archived_at IS NULL AND revision.status IN ('APPROVED', 'ACTIVE') AND master.finished_item_id = ANY($2::uuid[])`,
    [c.organizationId, lines.map((line) => line.component_item_id)])).rows.map((row) => row.finished_item_id));
  // A pinned subassembly recipe that is no longer its BOM's effective one: the parent keeps it until a new parent revision changes it.
  const childEffective = new Map();
  for (const line of lines.filter((row) => row.child_bom_revision_id)) {
    if (!childEffective.has(line.component_item_id)) childEffective.set(line.component_item_id, await effectiveWindowAt(client, c.organizationId, line.component_item_id).catch(() => null));
  }
  const validation = selected && ["DRAFT", "REJECTED", "PENDING_APPROVAL"].includes(selected.status)
    ? await validateRevisionContent(client, c.organizationId, { ...selected, finished_item_id: master.finished_item_id }, lines) : null;
  const history = (await client.query(
    `SELECT event.action, event.from_status, event.to_status, event.reason, event.details, event.occurred_at, event.content_hash, actor.full_name AS actor, revision.revision_number
       FROM tenant.manufacturing_bom_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
       LEFT JOIN tenant.manufacturing_bom_revisions revision ON revision.id = event.revision_id
      WHERE event.organization_id = $1 AND event.bom_id = $2 ORDER BY event.occurred_at DESC LIMIT 200`, [c.organizationId, id])).rows;
  const changes = selected ? (await client.query(
    `SELECT change.event_type, change.lineage_id, change.old_value, change.new_value, change.reason, change.changed_at, item.code AS item_code, item.name AS item_name, actor.full_name AS actor
       FROM tenant.manufacturing_bom_revision_changes change LEFT JOIN tenant.items item ON item.id = change.item_id LEFT JOIN public.users actor ON actor.id = change.changed_by
      WHERE change.organization_id = $1 AND change.revision_id = $2 ORDER BY change.changed_at DESC LIMIT 300`, [c.organizationId, selected.id])).rows : [];
  const whereUsed = await bomWhereUsed(client, c, master.finished_item_id, id);
  const selfApproval = (await client.query(`SELECT bom_self_approval_allowed FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.bom_self_approval_allowed ?? false;
  const s = selected?.status;
  const selectedWindow = selected ? liveWindow(selected) : null;
  const open = revisions.some((row) => ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(row.status));
  const label = (row) => (row.status === "APPROVED" && liveWindow(row)?.status === "SCHEDULED" ? "Scheduled" : STATUS_LABEL[row.status]);
  return {
    id: master.id, number: master.bom_number, name: master.name, bomType: master.bom_type, archivedAt: master.archived_at, archiveReason: master.archive_reason,
    finishedItem: { id: master.finished_item_id, code: master.item_code, name: master.item_name, baseUomId: master.item_uom_id, trackingType: master.tracking_type },
    createdBy: master.created_by_name, createdAt: master.created_at,
    effectiveRevisionId: effective?.id ?? null,
    revisions: revisions.map((row) => ({
      id: row.id, revisionNumber: row.revision_number, status: row.status, statusLabel: label(row), scheduled: liveWindow(row)?.status === "SCHEDULED",
      effectiveFrom: row.effective_from, effectiveTo: row.effective_to, changeReason: row.change_reason, basedOnRevisionId: row.based_on_revision_id, approvedBy: row.approved_by_name,
      approvedAt: row.approved_at, submittedBy: row.submitted_by_name, createdBy: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    effectivities: windows.map((row) => ({ id: row.id, revisionId: row.revision_id, revisionNumber: row.revision_number, status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
      scheduledBy: row.scheduled_by_name, scheduledAt: row.scheduled_at, cancelledBy: row.cancelled_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason })),
    revision: selected ? {
      id: selected.id, revisionNumber: selected.revision_number, status: selected.status, statusLabel: label(selected), version: selected.version,
      outputQuantity: out(D(selected.output_quantity)), outputUomId: selected.output_uom_id, outputUom: selected.output_uom, expectedYieldPct: out(D(selected.expected_yield_pct)),
      batchSize: selected.batch_size === null ? null : out(D(selected.batch_size)), description: selected.description, defaultWarehouseId: selected.default_warehouse_id, defaultWarehouse: selected.warehouse_code,
      effectiveFrom: selected.effective_from, effectiveTo: selected.effective_to, scheduled: selectedWindow?.status === "SCHEDULED", changeReason: selected.change_reason, contentHash: selected.content_hash,
      approvedContentHash: selected.approved_content_hash, basedOnRevisionId: selected.based_on_revision_id,
      basedOnRevisionNumber: revisions.find((row) => row.id === selected.based_on_revision_id)?.revision_number ?? null,
      createdBy: selected.created_by_name, createdAt: selected.created_at, submittedBy: selected.submitted_by_name, submittedAt: selected.submitted_at,
      approvedBy: selected.approved_by_name, approvedAt: selected.approved_at, approvalNote: selected.approval_note, rejectedBy: selected.rejected_by_name, rejectedAt: selected.rejected_at,
      rejectionReason: selected.rejection_reason, activatedBy: selected.activated_by_name, activatedAt: selected.activated_at, obsoleteReason: selected.obsolete_reason,
      lines: lines.map((line) => {
        const childNow = line.child_bom_revision_id ? childEffective.get(line.component_item_id) : null;
        return { id: line.id, lineageId: line.lineage_id, lineNumber: line.line_number, componentItemId: line.component_item_id, code: line.item_code, name: line.item_name, quantity: out(D(line.quantity)),
          uomId: line.uom_id, uom: line.uom_code, consumptionMode: line.consumption_mode, scrapAllowancePct: out(D(line.scrap_allowance_pct)), childBomRevisionId: line.child_bom_revision_id,
          childBom: line.child_bom_number ? `${line.child_bom_number} rev ${line.child_revision_number}` : null,
          childNewer: childNow && childNow.revision_id !== line.child_bom_revision_id ? `Rev ${childNow.revision_number} is now effective` : null,
          kind: line.child_bom_revision_id || subassemblies.has(line.component_item_id) ? "subassembly" : "material", trackingType: line.tracking_type, notes: line.notes };
      }),
      changes: changes.map((row) => ({ type: row.event_type, lineageId: row.lineage_id, item: row.item_code ? `${row.item_code} · ${row.item_name}` : null, from: row.old_value, to: row.new_value,
        reason: row.reason, at: row.changed_at, actor: row.actor })),
      validation,
    } : null,
    whereUsed, history: history.map((row) => ({ action: row.action, fromStatus: row.from_status, toStatus: row.to_status, reason: row.reason, details: row.details, at: row.occurred_at,
      actor: row.actor ?? (["BECAME_EFFECTIVE", "SUPERSEDED"].includes(row.action) ? "System" : null), revisionNumber: row.revision_number, contentHash: row.content_hash })),
    can: {
      edit: ["DRAFT", "REJECTED"].includes(s) && has(c, P.editDraft) && !master.archived_at, submit: ["DRAFT", "REJECTED"].includes(s) && has(c, P.submit),
      withdraw: s === "PENDING_APPROVAL" && has(c, P.submit),
      approve: s === "PENDING_APPROVAL" && has(c, P.approve) && (selected.submitted_by !== c.userId || selfApproval),
      activate: s === "APPROVED" && !selectedWindow && has(c, P.activate) && !master.archived_at, cancelSchedule: selectedWindow?.status === "SCHEDULED" && has(c, P.activate),
      obsolete: ["APPROVED", "ACTIVE", "SUPERSEDED"].includes(s) && has(c, P.obsolete), revise: !open && !master.archived_at && has(c, P.revise) && revisions.some((row) => row.approved_content_hash),
      discard: ["DRAFT", "REJECTED"].includes(s) && has(c, P.editDraft), archive: !master.archived_at && has(c, P.obsolete), duplicate: has(c, P.create),
      viewCost: has(c, P.costView), export: has(c, P.export), useForProduction: has(c, P.moUse),
    },
  };
}

// Where a product's BOM is used: the recipes that list it as a material, the production recipes frozen from its revisions, and open demand.
async function bomWhereUsed(client, c, finishedItemId, bomId) {
  const parents = (await client.query(
    `SELECT DISTINCT master.id, master.bom_number, item.code, item.name, revision.revision_number, revision.status
       FROM tenant.manufacturing_bom_lines line JOIN tenant.manufacturing_bom_revisions revision ON revision.id = line.revision_id
       JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id JOIN tenant.items item ON item.id = master.finished_item_id
      WHERE line.organization_id = $1 AND line.component_item_id = $2 AND revision.status NOT IN ('OBSOLETE')
      ORDER BY master.bom_number, revision.revision_number`, [c.organizationId, finishedItemId])).rows;
  const usage = (await client.query(`SELECT count(*)::int AS snapshots FROM tenant.manufacturing_bom_snapshots WHERE organization_id = $1 AND bom_id = $2`, [c.organizationId, bomId])).rows[0];
  const demands = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND bom_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    [c.organizationId, bomId])).rows[0];
  return { parents: parents.map((row) => ({ bomId: row.id, bomNumber: row.bom_number, product: `${row.code} · ${row.name}`, revisionNumber: row.revision_number, status: row.status })),
    productionSnapshots: usage.snapshots, openDemands: demands.n };
}

export async function getBomWhereUsed(client, c, bomId) {
  needBom(c, P.view);
  const master = (await client.query(`SELECT id, finished_item_id FROM tenant.manufacturing_bom_masters WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(bomId, "BOM")])).rows[0];
  if (!master) throw bomError(404, "MFG_BOM_NOT_FOUND");
  return bomWhereUsed(client, c, master.finished_item_id, master.id);
}

// Two revisions of one BOM side by side: the recipe difference (by line lineage), and — given a quantity — what each needs and costs.
// input: { plannedQuantity?, uomId?, warehouseId?, policy?, choices? }
export async function compareBomRevisions(client, c, bomId, fromRevisionId, toRevisionId, input = {}) {
  needBom(c, P.view);
  const id = uuid(bomId, "BOM");
  const [from, to] = [await loadRevision(client, c.organizationId, uuid(fromRevisionId, "Revision")), await loadRevision(client, c.organizationId, uuid(toRevisionId, "Revision"))];
  if (from.bom_id !== id || to.bom_id !== id) throw bomError(404, "MFG_BOM_REV_NOT_FOUND");
  const result = await compareRevisions(client, c.organizationId, from.id, to.id);
  if (input.plannedQuantity === undefined || input.plannedQuantity === null || input.plannedQuantity === "") return result;
  return { ...result, requirements: await requirementsComparison(client, c, from, to, input) };
}

// What two revisions need for the same quantity, material by material in base units, the free stock against the second, and the estimated
// material cost of each priced with the same unit costs at the same moment — so a difference is the recipe change, never a price change.
// Nothing is reserved, ordered or posted.
async function requirementsComparison(client, c, from, to, input) {
  const plan = { plannedQuantity: input.plannedQuantity, uomId: input.uomId || undefined, policy: input.policy, choices: input.choices };
  const [a, b] = [await explodeRevision(client, c.organizationId, from.id, plan), await explodeRevision(client, c.organizationId, to.id, plan)];
  const warehouseId = input.warehouseId ? uuid(input.warehouseId, "Warehouse") : to.default_warehouse_id ?? from.default_warehouse_id ?? null;
  const materials = new Map();
  const row = (entry) => materials.get(entry.itemId) ?? { itemId: entry.itemId, code: entry.code, name: entry.name, baseUom: entry.baseUom, kind: entry.kind, from: 0n, to: 0n };
  for (const entry of a.consumed) { const r = row(entry); r.from += D(entry.required); materials.set(entry.itemId, r); }
  for (const entry of b.consumed) { const r = row(entry); r.to += D(entry.required); materials.set(entry.itemId, r); }
  let cost = null;
  if (has(c, P.costView)) {
    const rates = new Map();
    const [costA, costB] = [await estimateCost(client, c, a, warehouseId, rates), await estimateCost(client, c, b, warehouseId, rates)];
    const unit = new Map([...costA.lines, ...costB.lines].map((line) => [line.itemId, line]));
    const amount = (required, line) => (line?.unitCost ? mul(required, D(line.unitCost)) : null);
    cost = {
      basis: { calculatedAt: costB.calculatedAt, warehouseId, sameRates: true,
        note: "Both revisions are priced with the same unit costs, taken once at this moment, so the difference shows the recipe change only. Labour and overhead are not included." },
      from: { total: costA.totalMaterialCost, complete: costA.complete }, to: { total: costB.totalMaterialCost, complete: costB.complete },
      difference: formatMoney(sub(D(costB.totalMaterialCost), D(costA.totalMaterialCost))), complete: costA.complete && costB.complete,
      missing: [...new Set([...costA.missing, ...costB.missing])], warnings: [...new Set([...costA.warnings, ...costB.warnings])],
      lines: [...materials.values()].map((m) => {
        const line = unit.get(m.itemId);
        const [x, y] = [amount(m.from, line), amount(m.to, line)];
        return { itemId: m.itemId, code: m.code, unitCost: line?.unitCost ?? null, basis: line?.basis ?? null, costAsOf: line?.costAsOf ?? null, stale: line?.stale ?? false,
          from: x === null ? null : formatMoney(x), to: y === null ? null : formatMoney(y), difference: x === null || y === null ? null : formatMoney(sub(y, x)) };
      }),
    };
  }
  const order = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  const rows = [...materials.values()].map((m) => ({ itemId: m.itemId, code: m.code, name: m.name, baseUom: m.baseUom, kind: m.kind, from: out(m.from), to: out(m.to), difference: out(sub(m.to, m.from)),
    change: m.from === 0n ? "added" : m.to === 0n ? "removed" : m.from === m.to ? "unchanged" : "changed" })).sort((x, y) => order[x.change] - order[y.change] || x.code.localeCompare(y.code));
  const side = (explosion) => ({ revisionId: explosion.revisionId, revisionNumber: explosion.revisionNumber, nominalQuantity: explosion.nominalQuantity, batches: explosion.batches,
    expectedYieldPct: explosion.expectedYieldPct, batchSize: explosion.batchSize, assumptions: explosion.assumptions, issues: explosion.issues, childRevisions: explosion.childRevisions });
  return { plannedQuantity: b.plannedQuantity, plannedUom: b.plannedUom, policy: b.policy, from: side(a), to: side(b), materials: rows,
    availability: await availabilityOf(client, c, b, warehouseId), cost, previewOnly: true };
}
const formatMoney = (value) => {
  const negative = value < 0n;
  const text = out(negative ? -value : value, 2);
  const [whole, fraction = ""] = text.split(".");
  return `${negative ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`;
};

// ------------------------------------------------------------------ revision impact (read-only)
// What a revision would change before it is activated: the product, the revision effective now and any scheduled, the recipe difference
// and the material and cost effect for a sample quantity, parent recipes that use this product (and which revision they pin), the
// subassembly revisions it pins (and whether newer ones exist), and production: recipes frozen from each revision (they never change) and
// manufacturing orders of the product (drafts and orders awaiting approval may need a review; released ones keep their frozen recipe).
export async function getBomRevisionImpact(client, c, revisionId, input = {}) {
  needBom(c, P.view);
  let revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  await settleBomStatuses(client, c.organizationId, revision.bom_id);
  revision = await loadRevision(client, c.organizationId, revision.id);
  const item = await loadItem(client, c.organizationId, revision.finished_item_id);
  const current = await effectiveWindowAt(client, c.organizationId, revision.finished_item_id).catch(() => null);
  const currentRevision = current ? await loadRevision(client, c.organizationId, current.revision_id) : null;
  const scheduled = (await client.query(
    `SELECT effectivity.effective_from, effectivity.effective_to, revision.revision_number, revision.id FROM tenant.manufacturing_bom_effectivities effectivity
       JOIN tenant.manufacturing_bom_revisions revision ON revision.id = effectivity.revision_id
      WHERE effectivity.organization_id = $1 AND effectivity.finished_item_id = $2 AND effectivity.status = 'SCHEDULED' ORDER BY effectivity.effective_from`,
    [c.organizationId, revision.finished_item_id])).rows;
  const differs = currentRevision && currentRevision.id !== revision.id;
  const sample = input.plannedQuantity ?? out(D(revision.output_quantity));
  let comparison = null;
  let requirements = null;
  if (differs) {
    comparison = await compareRevisions(client, c.organizationId, currentRevision.id, revision.id);
    try { requirements = await requirementsComparison(client, c, currentRevision, revision, { ...input, plannedQuantity: sample }); }
    catch (error) { requirements = { error: error.message }; }
  }
  const parents = (await client.query(
    `SELECT master.id AS bom_id, master.bom_number, item.code, item.name, parent.revision_number, parent.status, line.child_bom_revision_id, pinned.revision_number AS pinned_revision
       FROM tenant.manufacturing_bom_lines line JOIN tenant.manufacturing_bom_revisions parent ON parent.id = line.revision_id
       JOIN tenant.manufacturing_bom_masters master ON master.id = parent.bom_id JOIN tenant.items item ON item.id = master.finished_item_id
       LEFT JOIN tenant.manufacturing_bom_revisions pinned ON pinned.id = line.child_bom_revision_id
      WHERE line.organization_id = $1 AND line.component_item_id = $2 AND parent.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE') AND master.archived_at IS NULL
      ORDER BY master.bom_number, parent.revision_number`, [c.organizationId, revision.finished_item_id])).rows;
  const lines = await loadLines(client, c.organizationId, revision.id);
  const children = [];
  for (const line of lines.filter((row) => row.child_bom_revision_id)) {
    const childNow = await effectiveWindowAt(client, c.organizationId, line.component_item_id).catch(() => null);
    children.push({ itemId: line.component_item_id, code: line.item_code, name: line.item_name, pinned: `${line.child_bom_number} rev ${line.child_revision_number}`, pinnedStatus: line.child_status,
      effectiveNow: childNow ? `${line.child_bom_number} rev ${childNow.revision_number}` : null, newerAvailable: Boolean(childNow && childNow.revision_id !== line.child_bom_revision_id) });
  }
  const snapshots = (await client.query(
    `SELECT revision.revision_number, count(*)::int AS frozen, max(snapshot.created_at) AS latest,
            (array_agg(snapshot.source_reference ORDER BY snapshot.created_at DESC) FILTER (WHERE snapshot.source_reference IS NOT NULL))[1:5] AS references
       FROM tenant.manufacturing_bom_snapshots snapshot JOIN tenant.manufacturing_bom_revisions revision ON revision.id = snapshot.revision_id
      WHERE snapshot.organization_id = $1 AND snapshot.bom_id = $2 GROUP BY revision.revision_number ORDER BY revision.revision_number`, [c.organizationId, revision.bom_id])).rows;
  const orders = (await client.query(
    `SELECT status, count(*)::int AS n FROM tenant.manufacturing_orders WHERE organization_id = $1 AND finished_item_id = $2 AND status NOT IN ('COMPLETED', 'CANCELLED') GROUP BY status`,
    [c.organizationId, revision.finished_item_id])).rows;
  const ordersBy = (statuses) => orders.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.n, 0);
  const demands = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND bom_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    [c.organizationId, revision.bom_id])).rows[0].n;
  return {
    bomId: revision.bom_id, bomNumber: revision.bom_number, finishedItem: { id: item.id, code: item.code, name: item.name },
    revision: { id: revision.id, revisionNumber: revision.revision_number, status: revision.status, effectiveFrom: revision.effective_from, effectiveTo: revision.effective_to, changeReason: revision.change_reason },
    current: currentRevision ? { id: currentRevision.id, revisionNumber: currentRevision.revision_number, effectiveFrom: current.effective_from, effectiveTo: current.effective_to } : null,
    scheduled: scheduled.map((row) => ({ revisionId: row.id, revisionNumber: row.revision_number, effectiveFrom: row.effective_from, effectiveTo: row.effective_to })),
    comparison, requirements, samplePlannedQuantity: sample,
    parents: parents.map((row) => ({ bomId: row.bom_id, bomNumber: row.bom_number, product: `${row.code} · ${row.name}`, revisionNumber: row.revision_number, status: row.status,
      pinnedRevision: row.pinned_revision, pinsThisRevision: row.child_bom_revision_id === revision.id,
      effect: row.child_bom_revision_id ? (row.child_bom_revision_id === revision.id ? "Uses this revision" : `Keeps rev ${row.pinned_revision} until it is revised`) : "Not pinned: pinned when it is submitted" })),
    children,
    production: {
      frozenRecipes: snapshots.map((row) => ({ revisionNumber: row.revision_number, count: row.frozen, latest: row.latest, references: row.references ?? [] })),
      orders: { mayNeedReview: ordersBy(["DRAFT", "AWAITING_APPROVAL"]), unchanged: ordersBy(["RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING", "RECOVERY_REQUIRED"]) },
      openDemands: demands,
      note: "Activating a revision changes only which recipe new production uses. Recipes already frozen for production keep their revision and quantities; production orders are never replanned automatically.",
    },
    previewOnly: true,
  };
}

// Revisions waiting for approval, across BOMs, with who submitted them and whether the person may approve each.
export async function listPendingBomApprovals(client, c) {
  needBom(c, P.view);
  const selfApproval = (await client.query(`SELECT bom_self_approval_allowed FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.bom_self_approval_allowed ?? false;
  const rows = (await client.query(
    `SELECT revision.id, revision.bom_id, revision.revision_number, revision.change_reason, revision.submitted_at, revision.submitted_by, revision.content_hash, master.bom_number,
            item.code AS item_code, item.name AS item_name, submitter.full_name AS submitted_by_name, based.revision_number AS based_on,
            (SELECT count(*)::int FROM tenant.manufacturing_bom_lines line WHERE line.revision_id = revision.id) AS line_count
       FROM tenant.manufacturing_bom_revisions revision JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id JOIN tenant.items item ON item.id = master.finished_item_id
       LEFT JOIN public.users submitter ON submitter.id = revision.submitted_by LEFT JOIN tenant.manufacturing_bom_revisions based ON based.id = revision.based_on_revision_id
      WHERE revision.organization_id = $1 AND revision.status = 'PENDING_APPROVAL' AND master.archived_at IS NULL ORDER BY revision.submitted_at`, [c.organizationId])).rows;
  return rows.map((row) => ({
    revisionId: row.id, bomId: row.bom_id, bomNumber: row.bom_number, product: `${row.item_code} · ${row.item_name}`, revisionNumber: row.revision_number, basedOn: row.based_on,
    changeReason: row.change_reason, lines: row.line_count, submittedBy: row.submitted_by_name, submittedAt: row.submitted_at, contentHash: row.content_hash,
    selfSubmitted: row.submitted_by === c.userId, canApprove: has(c, P.approve) && (row.submitted_by !== c.userId || selfApproval),
  }));
}

// The revision that production of an item on a date would use (default now): the one whose effectivity window contains that moment.
export async function resolveEffectiveBomRevision(client, c, input = {}) {
  needBom(c, P.view);
  const itemId = uuid(input.itemId, "Product");
  const at = timestamp(input.productionDate, "Production date");
  await settleBomStatuses(client, c.organizationId);
  const window = await effectiveWindowAt(client, c.organizationId, itemId, at);
  if (!window) return { itemId, productionDate: at, revision: null };
  return { itemId, productionDate: at, revision: { id: window.revision_id, bomId: window.bom_id, revisionNumber: window.revision_number, effectiveFrom: window.effective_from,
    effectiveTo: window.effective_to, scheduled: window.status === "SCHEDULED" } };
}

// ------------------------------------------------------------------ planning: requirements, availability, cost (read-only)
// input: { plannedQuantity, uomId?, warehouseId?, policy?, choices? }. Nothing is reserved, ordered or posted.
export async function previewBomRequirements(client, c, revisionId, input = {}) {
  needBom(c, P.view);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  const explosion = await explodeRevision(client, c.organizationId, revision.id, input);
  const warehouseId = input.warehouseId ? uuid(input.warehouseId, "Warehouse") : revision.default_warehouse_id;
  const availability = await availabilityOf(client, c, explosion, warehouseId);
  const cost = has(c, P.costView) ? await estimateCost(client, c, explosion, warehouseId) : null;
  return { ...explosion, availability, cost, previewOnly: true };
}

export async function estimateBomCost(client, c, revisionId, input = {}) {
  needBom(c, P.costView);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  const explosion = await explodeRevision(client, c.organizationId, revision.id, input);
  return { ...(await estimateCost(client, c, explosion, input.warehouseId ? uuid(input.warehouseId, "Warehouse") : revision.default_warehouse_id)), plannedQuantity: explosion.plannedQuantity,
    plannedUom: explosion.plannedUom, revisionNumber: explosion.revisionNumber, previewOnly: true };
}

// ------------------------------------------------------------------ production: the frozen recipe and shortage demand
// The recipe a production order keeps: the revision effective on its production date (normally the planned start; default now) — or a
// named revision, only if it is the one effective on that date — exploded for the planned quantity with the pinned child revisions, units,
// yield, batches and allowances, and the estimated cost; frozen, so later revisions never change it. input: { itemId? or revisionId?,
// productionDate?, plannedQuantity, uomId?, warehouseId?, policy?, choices?, sourceType?, sourceId?, sourceReference?, idempotencyKey }
export async function snapshotBomForProduction(client, c, input = {}) {
  needBom(c, P.moUse);
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const existing = (await client.query(`SELECT * FROM tenant.manufacturing_bom_snapshots WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return snapshotView(existing, true);
  }
  await settleBomStatuses(client, c.organizationId);
  const productionDate = timestamp(input.productionDate, "Production date") ?? (await clockNow(client)).toISOString();
  let revision;
  if (input.revisionId) {
    revision = await loadRevision(client, c.organizationId, uuid(input.revisionId, "Revision"));
    const window = await effectiveWindowAt(client, c.organizationId, revision.finished_item_id, productionDate);
    if (window?.revision_id !== revision.id) {
      throw bomError(409, "MFG_BOM_REV_NOT_ACTIVE", `${revision.bom_number} revision ${revision.revision_number} is ${STATUS_LABEL[revision.status].toLowerCase()} and not the revision effective on ${productionDate.slice(0, 10)}${window ? ` (revision ${window.revision_number} is)` : ""}.`);
    }
  } else {
    const revisionId = input.itemId ? await resolveEffectiveBom(client, c.organizationId, uuid(input.itemId, "Product"), productionDate) : null;
    if (!revisionId) throw bomError(409, "MFG_BOM_NOT_APPROVED", "This product has no BOM revision effective on that date. Approve and activate a revision first.");
    revision = await loadRevision(client, c.organizationId, revisionId);
  }
  let explosion;
  try { explosion = await explodeRevision(client, c.organizationId, revision.id, { ...input, at: productionDate }); }
  catch (error) { if (error.code?.startsWith("MFG_BOM_")) throw error; throw bomError(500, "MFG_BOM_SNAPSHOT_FAILED"); }
  const blocking = explosion.issues.filter((issue) => issue.severity === "error");
  if (blocking.length) throw bomError(409, blocking[0].code, blocking[0].message, { issues: explosion.issues });
  const warehouseId = input.warehouseId ? uuid(input.warehouseId, "Warehouse") : revision.default_warehouse_id;
  const cost = await estimateCost(client, c, explosion, warehouseId);
  const policy = { explosionPolicy: explosion.policy, choices: explosion.choices, expectedYieldPct: explosion.expectedYieldPct, batchSize: explosion.batchSize, batches: explosion.batches,
    nominalQuantity: explosion.nominalQuantity, allowance: "added once to each line", rounding: "up to each material's unit precision", warehouseId, productionDate };
  const snapshot = { finishedItem: explosion.finishedItem, plannedQuantity: explosion.plannedQuantity, plannedUom: explosion.plannedUom, lines: explosion.lines, consumed: explosion.consumed,
    manufactured: explosion.manufactured, childRevisions: explosion.childRevisions, approvedContentHash: revision.approved_content_hash,
    revision: { id: revision.id, number: revision.revision_number, effectiveFrom: revision.effective_from, effectiveTo: revision.effective_to } };

  const hash = hashOf({ snapshot, policy });
  const row = (await client.query(
    `INSERT INTO tenant.manufacturing_bom_snapshots (organization_id, bom_id, revision_id, finished_item_id, planned_quantity, planned_uom_id, as_of, policy, snapshot, cost_estimate, content_hash,
       source_type, source_id, source_reference, idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6,now(),$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [c.organizationId, revision.bom_id, revision.id, revision.finished_item_id, explosion.plannedQuantity, explosion.plannedUomId, JSON.stringify(policy), JSON.stringify(snapshot), JSON.stringify(cost), hash,
      text(input.sourceType, 50) || null, input.sourceId ? uuid(input.sourceId, "Source") : null, text(input.sourceReference, 200) || null, key || null, c.userId ?? null])).rows[0];
  await event(client, c, revision.bom_id, revision.id, "SNAPSHOT_TAKEN", null, null, { snapshotId: row.id, plannedQuantity: explosion.plannedQuantity, source: input.sourceReference ?? null }, null, hash);
  return snapshotView(row, false);
}

const snapshotView = (row, replayed) => ({ id: row.id, bomId: row.bom_id, revisionId: row.revision_id, plannedQuantity: out(D(row.planned_quantity)), asOf: row.as_of, policy: row.policy,
  snapshot: row.snapshot, costEstimate: row.cost_estimate, contentHash: row.content_hash, sourceType: row.source_type, sourceReference: row.source_reference, createdAt: row.created_at, replayed });

export async function getBomSnapshot(client, c, snapshotId) {
  needBom(c, P.view);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_bom_snapshots WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(snapshotId, "Snapshot")])).rows[0];
  if (!row) throw bomError(404, "MFG_BOM_NOT_FOUND", "The production recipe was not found.");
  return snapshotView(row, false);
}

// Shortages handed to Procurement as demand (never a purchase order): one demand per material per request key, so a retry or a double click
// adds nothing. input: { plannedQuantity, uomId?, warehouseId?, policy?, choices?, requiredBy?, requestKey, itemIds? (a subset), notes? }
export async function handOffBomShortages(client, c, revisionId, input = {}) {
  needBom(c, P.moUse);
  const requestKey = text(input.requestKey, 200);
  if (!requestKey) throw bomError(400, "MFG_BOM_REQUEST_KEY_REQUIRED", "Retry the hand-off from the BOM screen (a request key is needed).");
  const preview = await previewBomRequirements(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), P.view])] }, revisionId, input);
  if (preview.availability.unknown) throw bomError(503, "MFG_BOM_STOCK_UNAVAILABLE");
  const wanted = Array.isArray(input.itemIds) && input.itemIds.length ? new Set(input.itemIds) : null;
  const shortages = preview.availability.lines.filter((line) => line.status === "short" && (!wanted || wanted.has(line.itemId)));
  const created = [];
  const existing = [];
  for (const line of shortages) {
    const item = await loadItem(client, c.organizationId, line.itemId);
    const already = (await client.query(`SELECT id, demand_number FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND request_key = $2 AND item_id = $3`,
      [c.organizationId, requestKey, line.itemId])).rows[0];
    if (already) { existing.push({ id: already.id, number: already.demand_number, code: line.code }); continue; }
    const number = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "manufacturing_material_demand" });
    const row = (await client.query(
      `INSERT INTO tenant.manufacturing_material_demands (organization_id, demand_number, item_id, quantity, uom_id, warehouse_id, required_by, bom_id, revision_id, finished_item_id, planned_quantity,
         request_key, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [c.organizationId, number, line.itemId, line.shortage, item.uom_id, preview.availability.warehouseId, input.requiredBy ? String(input.requiredBy).slice(0, 10) : null, preview.bomId, preview.revisionId,
        preview.finishedItem.id, preview.plannedQuantity, requestKey, text(input.notes, 500) || null, c.userId ?? null])).rows[0];
    created.push({ id: row.id, number, code: line.code, quantity: line.shortage, uom: line.baseUom });
  }
  if (created.length) await event(client, c, preview.bomId, preview.revisionId, "SHORTAGES_HANDED_OFF", null, null, { demands: created.map((row) => row.number), plannedQuantity: preview.plannedQuantity });
  return { created, existing, shortages: shortages.length };
}

const DEMAND_VIEW = ["procurement.view", "procurement.requisition.manage", "procurement.po.create", P.view];
export async function listMaterialDemands(client, c, filters = {}) {
  if (!DEMAND_VIEW.some((permission) => has(c, permission))) throw bomError(403, "MFG_BOM_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 20).toUpperCase()); where = ` AND demand.status = $${values.length}`; }
  const rows = (await client.query(
    `SELECT demand.*, item.code, item.name, uom.code AS uom, warehouse.code AS warehouse, master.bom_number, revision.revision_number, finished.code AS finished_code, creator.full_name AS created_by_name
       FROM tenant.manufacturing_material_demands demand JOIN tenant.items item ON item.id = demand.item_id JOIN tenant.units_of_measure uom ON uom.id = demand.uom_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.id = demand.warehouse_id LEFT JOIN tenant.manufacturing_bom_masters master ON master.id = demand.bom_id
       LEFT JOIN tenant.manufacturing_bom_revisions revision ON revision.id = demand.revision_id LEFT JOIN tenant.items finished ON finished.id = demand.finished_item_id
       LEFT JOIN public.users creator ON creator.id = demand.created_by
      WHERE demand.organization_id = $1${where} ORDER BY demand.created_at DESC LIMIT 500`, values)).rows;
  return rows.map((row) => ({ id: row.id, number: row.demand_number, item: `${row.code} · ${row.name}`, itemId: row.item_id, quantity: out(D(row.quantity)), uom: row.uom, warehouse: row.warehouse,
    requiredBy: row.required_by, status: row.status, source: row.bom_number ? `${row.bom_number} rev ${row.revision_number} · ${out(D(row.planned_quantity ?? 0))} × ${row.finished_code}` : null,
    bomId: row.bom_id, createdBy: row.created_by_name, createdAt: row.created_at, closeNote: row.close_note }));
}

// Procurement's side: acknowledge (being bought), fulfilled (covered by a requisition or purchase order) or cancelled, with a note.
export async function updateMaterialDemand(client, c, demandId, input = {}) {
  if (!["procurement.requisition.manage", "procurement.po.create", "procurement.po.manage"].some((permission) => has(c, permission))) throw bomError(403, "MFG_BOM_PERMISSION_DENIED");
  const action = String(input.action ?? "");
  const next = { acknowledge: "ACKNOWLEDGED", fulfil: "FULFILLED", cancel: "CANCELLED" }[action];
  if (!next) throw bomError(400, "MFG_BOM_DEMAND_ACTION_INVALID", "Choose acknowledge, fulfil or cancel.");
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(demandId, "Demand")])).rows[0];
  if (!row) throw bomError(404, "MFG_BOM_NOT_FOUND", "The material demand was not found.");
  if (["FULFILLED", "CANCELLED"].includes(row.status)) throw bomError(409, "MFG_BOM_VERSION_STALE", "This demand is closed.");
  if (next !== "ACKNOWLEDGED" && text(input.note, 500).length < 3) throw bomError(400, "MFG_BOM_REASON_REQUIRED", "Add a note (the requisition or purchase order, or why it is cancelled).");
  await client.query(`UPDATE tenant.manufacturing_material_demands SET status = $3, acknowledged_at = CASE WHEN $3 = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
      acknowledged_by = CASE WHEN $3 = 'ACKNOWLEDGED' THEN $4 ELSE acknowledged_by END, closed_at = CASE WHEN $3 IN ('FULFILLED', 'CANCELLED') THEN now() END,
      closed_by = CASE WHEN $3 IN ('FULFILLED', 'CANCELLED') THEN $4 END, close_note = COALESCE($5, close_note), updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, next, c.userId ?? null, text(input.note, 500) || null]);
  return (await listMaterialDemands(client, c, {})).find((demand) => demand.id === row.id);
}

// ------------------------------------------------------------------ export
const cell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
// A revision as CSV: its identity (number, revision, status, content hash), header and every line with quantities and units.
export async function exportBomRevision(client, c, revisionId) {
  needBom(c, P.export);
  const revision = await loadRevision(client, c.organizationId, uuid(revisionId, "Revision"));
  const bom = await getManufacturingBom(client, c, revision.bom_id, { revisionId: revision.id });
  const r = bom.revision;
  const rows = [
    ["BOM", bom.number], ["Product", `${bom.finishedItem.code} · ${bom.finishedItem.name}`], ["Revision", r.revisionNumber], ["Status", r.statusLabel],
    ["Output", `${r.outputQuantity} ${r.outputUom}`], ["Expected yield %", r.expectedYieldPct], ["Batch size", r.batchSize ?? ""], ["Effective from", r.effectiveFrom ?? ""],
    ["Effective to", r.effectiveTo ?? ""], ["Content hash", r.contentHash ?? ""], [],
    ["Line", "Material code", "Material", "Quantity", "Unit", "Consumption", "Extra material %", "Subassembly recipe", "Notes"],
    ...r.lines.map((line) => [line.lineNumber, line.code, line.name, line.quantity, line.uom, line.consumptionMode === "FIXED_PER_BATCH" ? "Fixed per batch" : "Proportional",
      line.scrapAllowancePct, line.childBom ?? "", line.notes ?? ""]),
  ];
  await event(client, c, revision.bom_id, revision.id, "EXPORTED", null, null, {});
  return { fileName: `${bom.number}-rev${r.revisionNumber}.csv`, csv: rows.map((row) => row.map(cell).join(",")).join("\n") };
}


// ------------------------------------------------------------------ editor pickers
// The products a BOM can make (stocked products), the materials it can use (products and consumables), the warehouses, and which items
// already have a recipe (so a line can show it is a subassembly).
export async function getBomOptions(client, c) {
  needBom(c, P.view);
  const items = (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.tracking_type, item.uom_id, uom.code AS uom_code,
            EXISTS (SELECT 1 FROM tenant.manufacturing_bom_masters master WHERE master.finished_item_id = item.id AND master.archived_at IS NULL) AS has_bom
       FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
      WHERE item.organization_id = $1 AND item.status = 'active' AND COALESCE(item.lifecycle_status, 'active') <> 'inactive' AND NOT item.is_variant_template
        AND item.item_type IN ('product', 'consumable') ORDER BY item.code LIMIT 2000`, [c.organizationId])).rows;
  const warehouses = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' ORDER BY code`, [c.organizationId])).rows;
  return {
    products: items.filter((item) => item.item_type === "product" && item.track_inventory).map((item) => ({ id: item.id, code: item.code, name: item.name, uomId: item.uom_id, uom: item.uom_code, hasBom: item.has_bom })),
    materials: items.map((item) => ({ id: item.id, code: item.code, name: item.name, uomId: item.uom_id, uom: item.uom_code, trackingType: item.tracking_type, hasBom: item.has_bom })),
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name })),
  };
}

// The units an item can be counted in (its base unit and its conversions), and its approved recipes (to pin a subassembly revision).
export async function getBomItemUnits(client, c, itemIdValue) {
  needBom(c, P.view);
  const itemId = uuid(itemIdValue, "Item");
  const { itemUnits } = await import("../../products/uom.js");
  const units = await itemUnits(client, c.organizationId, itemId);
  const recipes = (await client.query(
    `SELECT revision.id, revision.revision_number, revision.status, master.bom_number FROM tenant.manufacturing_bom_revisions revision
       JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id
      WHERE revision.organization_id = $1 AND master.finished_item_id = $2 AND master.archived_at IS NULL AND revision.status IN ('APPROVED', 'ACTIVE', 'SUPERSEDED')
      ORDER BY revision.revision_number DESC`, [c.organizationId, itemId])).rows;
  return { units: units.filter((unit) => unit.isActive).map((unit) => ({ uomId: unit.uomId, code: unit.code, factor: unit.factor, decimals: unit.decimals, isBase: unit.isBase, text: unit.text })),
    recipes: recipes.map((row) => ({ id: row.id, label: `${row.bom_number} rev ${row.revision_number} (${STATUS_LABEL[row.status].toLowerCase()})` })) };
}

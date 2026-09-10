// Prompt 6 (CRM-CAP-004, F017 — Notes & Files). Re-audit confirmed Notes
// had no dedicated domain module at all: a single Lead-only POST route
// with its own inline raw SQL (apps/web/src/app/api/crm/leads/[id]/notes/
// route.ts), no GET/PATCH/DELETE anywhere, no versioning, no optimistic
// concurrency, and no Account/Contact/Opportunity support. This module is
// the ONE canonical Notes domain — list/create/read/update/archive,
// history/versioning, parent-record authorization, private-visibility
// enforcement — that every entity type's routes call into, mirroring
// task-operations.js/follow-up-operations.js's established structure.
//
// Authorization reuses resolveCrmEntityAccess from timeline.js verbatim —
// the SAME per-entity-type sensitive-content gate and company/branch scope
// check the canonical Timeline already uses, not a re-derived equivalent
// (the dossier's explicit "object-specific wrapper functions are
// acceptable, separate security implementations are not").
import { CrmError, queueOutboxEvent } from "../../index.js";
import { resolveCrmEntityAccess } from "../timeline/timeline.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);

const text = (value) => String(value ?? "").trim();
function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function uuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_NOTE_REFERENCE_INVALID");
  return String(value);
}
function canViewAllCrmRecords(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
}

async function assertParentAccess(client, context, entityType, entityId) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported Note parent record type.", "CRM_NOTE_RELATION_INVALID");
  uuid(entityId, "Related record");
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_NOTE_RELATION_INVALID");
}

function normalizeBody(value) {
  const body = text(value);
  if (!body) throw new CrmError(400, "Note text is required.", "CRM_NOTE_BODY_REQUIRED");
  if (body.length > 20_000) throw new CrmError(400, "Note text must be at most 20,000 characters.", "CRM_NOTE_BODY_INVALID");
  return body;
}
function normalizeVisibility(value, fallback = "shared") {
  const visibility = text(value) || fallback;
  if (!["shared", "private"].includes(visibility)) throw new CrmError(400, "Note visibility must be 'shared' or 'private'.", "CRM_NOTE_VISIBILITY_INVALID");
  return visibility;
}

// F017 private-Note rule, reused verbatim from timeline.js's own note
// branch: visible to everyone unless private, in which case only its
// author or a view-all/org-owner override can see it — never leaked via a
// list row even to an otherwise-authorized parent-record viewer.
function visibilityPredicate(values, context, alias = "note") {
  const userIdParam = values.push(context.userId), userIdPlaceholder = `$${userIdParam}`;
  const viewAllParam = values.push(canViewAllCrmRecords(context)), viewAllPlaceholder = `$${viewAllParam}`;
  return ` AND (${alias}.visibility<>'private' OR ${alias}.created_by=${userIdPlaceholder} OR ${viewAllPlaceholder})`;
}

export async function listCrmNotes(client, context, entityType, entityId, { includeArchived = false, limit = 50 } = {}) {
  const allowed = ENTITY_TYPES.has(entityType) && UUID.test(String(entityId || "")) && (await resolveCrmEntityAccess(client, context, entityType, entityId));
  if (!allowed) return [];
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
  const values = [context.organizationId, entityType, entityId];
  let where = `note.organization_id=$1 AND note.entity_type=$2 AND note.entity_id=$3`;
  if (!includeArchived) where += ` AND note.archived_at IS NULL`;
  where += visibilityPredicate(values, context);
  const result = await client.query(
    `SELECT note.*,u.full_name AS created_by_name FROM tenant.crm_notes note LEFT JOIN public.users u ON u.id=note.created_by
      WHERE ${where} ORDER BY note.is_pinned DESC,note.created_at DESC LIMIT ${boundedLimit}`,
    values,
  );
  return result.rows.map(dto);
}

export async function getCrmNote(client, context, id) {
  uuid(id, "Note");
  const values = [context.organizationId, id];
  let where = `note.organization_id=$1 AND note.id=$2`;
  where += visibilityPredicate(values, context);
  const result = await client.query(
    `SELECT note.*,u.full_name AS created_by_name FROM tenant.crm_notes note LEFT JOIN public.users u ON u.id=note.created_by WHERE ${where} LIMIT 1`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Note not found.", "CRM_NOTE_NOT_FOUND");
  const note = dto(result.rows[0]);
  await assertParentAccess(client, context, note.entityType, note.entityId);
  return note;
}

export async function createCrmNote(client, context, entityType, entityId, input = {}) {
  await assertParentAccess(client, context, entityType, entityId);
  const body = normalizeBody(input.body);
  const visibility = normalizeVisibility(input.visibility);
  const result = await client.query(
    `INSERT INTO tenant.crm_notes(organization_id,entity_type,entity_id,body,is_pinned,visibility,version,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,1,$7,$7) RETURNING *`,
    [context.organizationId, entityType, entityId, body, Boolean(input.isPinned), visibility, context.userId],
  );
  const note = dto(result.rows[0]);
  await queueOutboxEvent(client, context, "crm.note.created", "note", note.id, { entityType, entityId, visibility });
  return note;
}

// Edit rights: the Note's own author, or a view-all/org-owner override —
// deliberately NOT "anyone who can see it," since ordinary shared-note
// visibility (any authorized parent-record viewer) is a read grant, not an
// edit grant. Append-only versioning: the row about to be replaced is
// archived into crm_note_versions BEFORE the UPDATE, so historical content
// is never silently overwritten. expectedVersion is optimistic-concurrency:
// "A opens note -> B edits note -> A submits stale edit" must 409, not
// silently apply over B's change.
export async function updateCrmNote(client, context, id, input = {}) {
  uuid(id, "Note");
  const before = await client.query(
    `SELECT * FROM tenant.crm_notes WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!before.rows[0]) throw new CrmError(404, "Note not found.", "CRM_NOTE_NOT_FOUND");
  const existing = dto(before.rows[0]);
  await assertParentAccess(client, context, existing.entityType, existing.entityId);
  if (existing.archivedAt) throw new CrmError(409, "An archived Note cannot be edited.", "CRM_NOTE_ARCHIVED");
  const canViewAll = canViewAllCrmRecords(context);
  if (existing.createdBy !== context.userId && !canViewAll)
    throw new CrmError(403, "Only the Note's author (or an organization-wide override) can edit it.", "CRM_NOTE_EDIT_FORBIDDEN");
  if (existing.visibility === "private" && existing.createdBy !== context.userId && !canViewAll)
    throw new CrmError(404, "Note not found.", "CRM_NOTE_NOT_FOUND");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== existing.version)
    throw new CrmError(409, "This Note changed since you opened it. Refresh it before continuing.", "CRM_NOTE_STALE_WRITE");

  const body = input.body !== undefined ? normalizeBody(input.body) : existing.body;
  const isPinned = input.isPinned !== undefined ? Boolean(input.isPinned) : existing.isPinned;
  const visibility = input.visibility !== undefined ? normalizeVisibility(input.visibility) : existing.visibility;

  await client.query(
    `INSERT INTO tenant.crm_note_versions(organization_id,note_id,version,body,is_pinned,actor_user_id)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [context.organizationId, id, existing.version, existing.body, existing.isPinned, context.userId],
  );
  const result = await client.query(
    `UPDATE tenant.crm_notes SET body=$3,is_pinned=$4,visibility=$5,version=version+1,updated_by=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, id, body, isPinned, visibility, context.userId],
  );
  const note = dto(result.rows[0]);
  await queueOutboxEvent(client, context, "crm.note.updated", "note", note.id, { entityType: note.entityType, entityId: note.entityId, version: note.version });
  return note;
}

export async function listCrmNoteVersions(client, context, id) {
  const note = await getCrmNote(client, context, id);
  const result = await client.query(
    `SELECT nv.*,u.full_name AS actor_name FROM tenant.crm_note_versions nv LEFT JOIN public.users u ON u.id=nv.actor_user_id
      WHERE nv.organization_id=$1 AND nv.note_id=$2 ORDER BY nv.version DESC`,
    [context.organizationId, note.id],
  );
  return result.rows.map(dto);
}

// Archive, not hard delete — a Note's version ledger is an audit trail;
// deleting the parent row would cascade-delete crm_note_versions too
// (FK ON DELETE CASCADE) and destroy that history. Same author-or-
// view-all authorization as edit.
export async function archiveCrmNote(client, context, id, input = {}) {
  uuid(id, "Note");
  const before = await client.query(`SELECT * FROM tenant.crm_notes WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  if (!before.rows[0]) throw new CrmError(404, "Note not found.", "CRM_NOTE_NOT_FOUND");
  const existing = dto(before.rows[0]);
  await assertParentAccess(client, context, existing.entityType, existing.entityId);
  const canViewAll = canViewAllCrmRecords(context);
  if (existing.createdBy !== context.userId && !canViewAll)
    throw new CrmError(403, "Only the Note's author (or an organization-wide override) can archive it.", "CRM_NOTE_EDIT_FORBIDDEN");
  if (existing.archivedAt) return existing;
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== existing.version)
    throw new CrmError(409, "This Note changed since you opened it. Refresh it before continuing.", "CRM_NOTE_STALE_WRITE");
  const result = await client.query(
    `UPDATE tenant.crm_notes SET archived_at=now(),archived_by=$3,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, id, context.userId],
  );
  const note = dto(result.rows[0]);
  await queueOutboxEvent(client, context, "crm.note.archived", "note", note.id, { entityType: note.entityType, entityId: note.entityId });
  return note;
}

// Notes: what the team knows about a lead, account, contact or opportunity.
// A note belongs to one record; it is formatted text, optionally titled and
// pinned, and every edit keeps the previous text (crm_note_versions) so a
// business-critical note can never be rewritten silently. Deleting a note
// archives it: it leaves the record's notes but stays in the history.
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import {
  NOTE_PERMISSIONS, canSeePrivateNotes, contentCan, convertedFromLead, recordContentHistory, recordVisible, requireContentPermission, requireRecordVisible,
} from "./access.js";
import { noteHtmlToText, sanitizeNoteHtml } from "./sanitize.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (message, field) => new CrmError(400, message, "CRM_NOTE_VALIDATION", { issues: [{ field, message }] });
const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NOTE_SELECT = `
  SELECT note.*, author.full_name AS created_by_name, editor.full_name AS updated_by_name,
         (SELECT count(*) FROM tenant.crm_attachment_details detail JOIN public.attachments file ON file.id = detail.attachment_id
           WHERE detail.organization_id = note.organization_id AND detail.note_id = note.id AND file.is_current AND file.archived_at IS NULL)::int AS attachment_count
    FROM tenant.crm_notes note
    LEFT JOIN public.users author ON author.id = note.created_by
    LEFT JOIN public.users editor ON editor.id = note.updated_by`;

// A note written before formatting existed is plain text: shown as paragraphs.
const asHtml = (row) => (row.body_format === "html" ? row.body : escapeHtml(row.body ?? "").split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`).join(""));

export function toNote(row, context, { fromLead = null } = {}) {
  const mine = row.created_by === context.userId;
  const readOnly = Boolean(fromLead) || Boolean(row.archived_at);
  return {
    id: row.id,
    relatedType: row.entity_type,
    relatedId: row.entity_id,
    title: row.title ?? null,
    bodyHtml: asHtml(row),
    bodyText: row.body_text ?? row.body ?? "",
    isPinned: row.is_pinned,
    visibility: row.visibility,
    version: row.version,
    attachmentCount: Number(row.attachment_count ?? 0),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
    edited: row.version > 1,
    // a note from the lead this opportunity was converted from
    fromLead,
    canEdit: !readOnly && contentCan(context, mine ? NOTE_PERMISSIONS.editOwn : NOTE_PERMISSIONS.editAll),
    canDelete: !readOnly && contentCan(context, mine ? NOTE_PERMISSIONS.deleteOwn : NOTE_PERMISSIONS.deleteAll),
    canPin: !readOnly && contentCan(context, NOTE_PERMISSIONS.pin),
  };
}

// Private notes are kept from everyone but their author and administrators.
function visible(context, values, alias = "note") {
  if (canSeePrivateNotes(context)) return "";
  values.push(context.userId);
  return ` AND (${alias}.visibility <> 'private' OR ${alias}.created_by = $${values.length})`;
}

function validBody(input) {
  const html = sanitizeNoteHtml(input.body ?? input.bodyHtml);
  const plain = noteHtmlToText(html);
  if (!plain) throw invalid("Write the note.", "body");
  if (html.length > 50_000) throw invalid("The note is too long.", "body");
  return { html, plain };
}
function validTitle(value) {
  const title = text(value);
  if (title.length > 200) throw invalid("Use 200 characters or fewer.", "title");
  return title || null;
}
function validVisibility(value, fallback = "shared") {
  const visibility = text(value) || fallback;
  if (!["shared", "private"].includes(visibility)) throw invalid("Choose who can see the note.", "visibility");
  return visibility;
}

// ------------------------------------------------------------------ read

// The notes of a record: pinned first, then newest. An opportunity converted
// from a lead also shows the lead's notes, read-only and marked as such.
// filters.search narrows by title or text.
export async function listNotes(client, context, relatedType, relatedId, { search = "" } = {}) {
  requireContentPermission(context, NOTE_PERMISSIONS.view, "You do not have permission to view notes.");
  await requireRecordVisible(client, context, relatedType, relatedId);
  const lead = await convertedFromLead(client, context, relatedType, relatedId);
  const values = [context.organizationId, relatedType, relatedId];
  let where = `note.organization_id = $1 AND note.archived_at IS NULL AND ((note.entity_type = $2 AND note.entity_id = $3)`;
  if (lead) { values.push(lead.id); where += ` OR (note.entity_type = 'lead' AND note.entity_id = $${values.length})`; }
  where += ")";
  const term = text(search).toLowerCase();
  if (term) { values.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`); where += ` AND lower(COALESCE(note.title, '') || ' ' || COALESCE(note.body_text, note.body)) LIKE $${values.length}`; }
  where += visible(context, values);
  const { rows } = await client.query(`${NOTE_SELECT} WHERE ${where} ORDER BY note.is_pinned DESC, note.created_at DESC LIMIT 200`, values);
  return rows.map((row) => toNote(row, context, { fromLead: row.entity_type === "lead" && lead && relatedType !== "lead" ? lead : null }));
}

async function loadNote(client, context, noteId, { lock = false } = {}) {
  if (!UUID.test(String(noteId ?? ""))) throw new CrmError(400, "Note is invalid.", "CRM_NOTE_VALIDATION");
  const values = [context.organizationId, noteId];
  const where = `note.organization_id = $1 AND note.id = $2${visible(context, values)}`;
  const { rows } = await client.query(`${NOTE_SELECT} WHERE ${where}${lock ? " FOR UPDATE OF note" : ""}`, values);
  const row = rows[0];
  if (!row || !(await recordVisible(client, context, row.entity_type, row.entity_id))) throw new CrmError(404, "Note not found.", "CRM_NOTE_NOT_FOUND");
  return row;
}

export async function getNote(client, context, noteId) {
  requireContentPermission(context, NOTE_PERMISSIONS.view, "You do not have permission to view notes.");
  return toNote(await loadNote(client, context, noteId), context);
}

function assertCurrent(row, expectedVersion) {
  if (row.archived_at) throw new CrmError(409, "This note was deleted.", "CRM_NOTE_DELETED");
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== row.version)
    throw new CrmError(409, "Someone changed this note since you opened it. Reload it and try again.", "CRM_NOTE_STALE_WRITE");
}

// ------------------------------------------------------------------ write

// input: { body (HTML from the editor, or plain text), title?, isPinned?, visibility?, idempotencyKey? }
export async function createNote(client, context, relatedType, relatedId, input = {}) {
  requireContentPermission(context, NOTE_PERMISSIONS.create, "You do not have permission to add notes.");
  await requireRecordVisible(client, context, relatedType, relatedId);
  const { html, plain } = validBody(input);
  const title = validTitle(input.title);
  const visibility = validVisibility(input.visibility);
  const pinned = Boolean(input.isPinned);
  if (pinned) requireContentPermission(context, NOTE_PERMISSIONS.pin, "You do not have permission to pin notes.");
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_notes (organization_id, entity_type, entity_id, title, body, body_format, body_text, is_pinned, visibility, version, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'html', $6, $7, $8, 1, $9, $9, clock_timestamp(), clock_timestamp()) RETURNING id`,
    [context.organizationId, relatedType, relatedId, title, html, plain, pinned, visibility, context.userId ?? null],
  );
  const id = rows[0].id;
  await recordContentHistory(client, context, { entityType: relatedType, entityId: relatedId, subjectType: "note", subjectId: id, eventType: "note_created",
    summary: `Note added${title ? `: ${title}` : ""}`, changes: { visibility, pinned } });
  await queueOutboxEvent(client, context, "crm.note.created", "note", id, { entityType: relatedType, entityId: relatedId, visibility });
  return getNote(client, context, id);
}

// input: any of { body, title, visibility }, plus expectedVersion. The previous text is kept.
export async function updateNote(client, context, noteId, input = {}) {
  const row = await loadNote(client, context, noteId, { lock: true });
  requireContentPermission(context, row.created_by === context.userId ? NOTE_PERMISSIONS.editOwn : NOTE_PERMISSIONS.editAll,
    row.created_by === context.userId ? "You do not have permission to edit your notes." : "Only the author or a manager can edit this note.");
  assertCurrent(row, input.expectedVersion);
  const next = {
    title: has(input, "title") ? validTitle(input.title) : row.title,
    body: has(input, "body") || has(input, "bodyHtml") ? validBody(input) : null,
    visibility: has(input, "visibility") ? validVisibility(input.visibility, row.visibility) : row.visibility,
  };
  const html = next.body?.html ?? row.body;
  const format = next.body ? "html" : row.body_format;
  if (html === row.body && format === row.body_format && next.title === row.title && next.visibility === row.visibility) return toNote(row, context);
  await client.query(
    `INSERT INTO tenant.crm_note_versions (organization_id, note_id, version, body, is_pinned, visibility, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, row.id, row.version, row.body, row.is_pinned, row.visibility, context.userId ?? null],
  );
  await client.query(
    `UPDATE tenant.crm_notes SET title = $3, body = $4, body_format = $5, body_text = $6, visibility = $7, version = version + 1, updated_by = $8, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, next.title, html, format, next.body?.plain ?? row.body_text, next.visibility, context.userId ?? null],
  );
  await recordContentHistory(client, context, { entityType: row.entity_type, entityId: row.entity_id, subjectType: "note", subjectId: row.id, eventType: "note_edited",
    summary: `Note edited${next.title ? `: ${next.title}` : ""}`, changes: { previousVersion: row.version, visibility: next.visibility !== row.visibility ? next.visibility : undefined } });
  return getNote(client, context, row.id);
}

// Pinned notes stay at the top of the record's notes.
export async function setNotePinned(client, context, noteId, pinned, { expectedVersion } = {}) {
  requireContentPermission(context, NOTE_PERMISSIONS.pin, "You do not have permission to pin notes.");
  const row = await loadNote(client, context, noteId, { lock: true });
  assertCurrent(row, expectedVersion);
  if (row.is_pinned === Boolean(pinned)) return toNote(row, context);
  await client.query(`UPDATE tenant.crm_notes SET is_pinned = $3, updated_at = now(), updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, Boolean(pinned), context.userId ?? null]);
  await recordContentHistory(client, context, { entityType: row.entity_type, entityId: row.entity_id, subjectType: "note", subjectId: row.id,
    eventType: pinned ? "note_pinned" : "note_unpinned", summary: pinned ? "Note pinned" : "Note unpinned" });
  return getNote(client, context, row.id);
}
export const pinNote = (client, context, noteId, options) => setNotePinned(client, context, noteId, true, options);
export const unpinNote = (client, context, noteId, options) => setNotePinned(client, context, noteId, false, options);

// Archived, never erased: the note leaves the record but its text and history stay.
export async function deleteNote(client, context, noteId, { expectedVersion } = {}) {
  const row = await loadNote(client, context, noteId, { lock: true });
  requireContentPermission(context, row.created_by === context.userId ? NOTE_PERMISSIONS.deleteOwn : NOTE_PERMISSIONS.deleteAll,
    row.created_by === context.userId ? "You do not have permission to delete your notes." : "Only the author or a manager can delete this note.");
  if (row.archived_at) return { deleted: true };
  assertCurrent(row, expectedVersion);
  await client.query(`UPDATE tenant.crm_notes SET archived_at = now(), archived_by = $3, updated_at = now(), updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  await recordContentHistory(client, context, { entityType: row.entity_type, entityId: row.entity_id, subjectType: "note", subjectId: row.id, eventType: "note_deleted",
    summary: `Note deleted${row.title ? `: ${row.title}` : ""}`, changes: { excerpt: String(row.body_text ?? row.body).slice(0, 200) } });
  await queueOutboxEvent(client, context, "crm.note.archived", "note", row.id, { entityType: row.entity_type, entityId: row.entity_id });
  return { deleted: true };
}

// The earlier texts of a note, newest first.
export async function listNoteVersions(client, context, noteId) {
  const note = await getNote(client, context, noteId);
  const { rows } = await client.query(
    `SELECT version.version, version.body, version.created_at, actor.full_name AS actor_name FROM tenant.crm_note_versions version
       LEFT JOIN public.users actor ON actor.id = version.actor_user_id
      WHERE version.organization_id = $1 AND version.note_id = $2 ORDER BY version.version DESC`,
    [context.organizationId, note.id],
  );
  return rows.map((row) => ({ version: row.version, bodyText: noteHtmlToText(row.body), replacedAt: row.created_at, replacedByName: row.actor_name ?? null }));
}

// What happened to a record's notes and files: added, edited, pinned, uploaded, deleted.
export async function listContentHistory(client, context, relatedType, relatedId) {
  requireContentPermission(context, NOTE_PERMISSIONS.view, "You do not have permission to view notes.");
  await requireRecordVisible(client, context, relatedType, relatedId);
  const { rows } = await client.query(
    `SELECT history.id, history.subject_type, history.subject_id, history.event_type, history.summary, history.created_at, actor.full_name AS actor_name
       FROM tenant.crm_content_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.entity_type = $2 AND history.entity_id = $3
      ORDER BY history.created_at DESC LIMIT 200`,
    [context.organizationId, relatedType, relatedId],
  );
  return rows.map((row) => ({ id: row.id, subjectType: row.subject_type, subjectId: row.subject_id, eventType: row.event_type, summary: row.summary, createdAt: row.created_at, actorName: row.actor_name ?? null }));
}

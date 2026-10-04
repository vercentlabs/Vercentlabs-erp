// Attachments: the files on a lead, account, contact or opportunity, or on
// one of its notes. The bytes and their metadata live in the Shared Platform
// file service (object storage + public.attachments); CRM keeps which record
// and note a file belongs to, its display name and description, and who may
// see it. A file belongs to one record and is never copied: an account's
// files are not repeated on its opportunities.
//
// Uploading the same name twice adds a second file; nothing is overwritten.
// Each file is stored under its own id, never its name. Deleting archives it.
import { archiveFile, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { ATTACHMENT_PERMISSIONS, contentCan, convertedFromLead, recordContentHistory, recordVisible, requireContentPermission, requireRecordVisible } from "../notes/access.js";
import { CRM_ALLOWED_EXTENSIONS, CRM_ALLOWED_MIME_TYPES, crmAttachmentMaxBytes, fileTypeOf, kindOfMime, previewOfMime } from "./file-types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const storageType = (relatedType) => `crm.${relatedType}`;
const invalid = (message, field) => new CrmError(400, message, "CRM_ATTACHMENT_VALIDATION", { issues: [{ field, message }] });

const SORTS = Object.freeze({ uploadedAt: "file.created_at DESC", name: "lower(COALESCE(detail.display_name, file.file_name))", type: "file.mime_type, lower(file.file_name)", uploadedBy: "lower(uploader.full_name), file.created_at DESC" });

function toAttachment(row, context, { fromLead = null } = {}) {
  const mine = row.uploaded_by === context.userId;
  return {
    id: row.id,
    relatedType: row.entity_type,
    relatedId: row.entity_id,
    noteId: row.note_id ?? null,
    noteTitle: row.note_id ? (row.note_title ?? "a note") : null,
    fileName: row.display_name ?? row.file_name,
    originalFileName: row.file_name,
    description: row.description ?? null,
    mimeType: row.mime_type,
    kind: kindOfMime(row.mime_type),
    preview: previewOfMime(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name ?? null,
    uploadedAt: row.created_at,
    fromLead,
    canDownload: contentCan(context, ATTACHMENT_PERMISSIONS.download),
    canEdit: !fromLead && (mine ? contentCan(context, ATTACHMENT_PERMISSIONS.upload) : contentCan(context, ATTACHMENT_PERMISSIONS.delete)),
    canDelete: !fromLead && (mine ? contentCan(context, ATTACHMENT_PERMISSIONS.upload) : contentCan(context, ATTACHMENT_PERMISSIONS.delete)),
  };
}

const FILE_SELECT = `
  SELECT file.id, file.file_name, file.mime_type, file.size_bytes, file.uploaded_by, file.created_at,
         detail.entity_type, detail.entity_id, detail.note_id, detail.display_name, detail.description, note.title AS note_title,
         uploader.full_name AS uploaded_by_name
    FROM tenant.crm_attachment_details detail
    JOIN public.attachments file ON file.organization_id = detail.organization_id AND file.id = detail.attachment_id
    LEFT JOIN tenant.crm_notes note ON note.organization_id = detail.organization_id AND note.id = detail.note_id
    LEFT JOIN public.users uploader ON uploader.id = file.uploaded_by`;
const ACTIVE = "file.is_current AND file.archived_at IS NULL AND file.lifecycle_status <> 'archived'";

// The files of a record, and of its notes. An opportunity converted from a
// lead also lists the lead's files, read-only. kind: image | document | spreadsheet | presentation | other.
export async function listAttachments(client, context, relatedType, relatedId, { kind = null, sortBy = "uploadedAt", search = "", noteId = null } = {}) {
  requireContentPermission(context, ATTACHMENT_PERMISSIONS.view, "You do not have permission to view attachments.");
  await requireRecordVisible(client, context, relatedType, relatedId);
  const lead = await convertedFromLead(client, context, relatedType, relatedId);
  const values = [context.organizationId, relatedType, relatedId];
  let where = `detail.organization_id = $1 AND ${ACTIVE} AND ((detail.entity_type = $2 AND detail.entity_id = $3)`;
  if (lead) { values.push(lead.id); where += ` OR (detail.entity_type = 'lead' AND detail.entity_id = $${values.length})`; }
  where += ")";
  if (UUID.test(String(noteId ?? ""))) { values.push(noteId); where += ` AND detail.note_id = $${values.length}`; }
  const term = text(search).toLowerCase();
  if (term) { values.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`); where += ` AND lower(COALESCE(detail.display_name, file.file_name) || ' ' || COALESCE(detail.description, '')) LIKE $${values.length}`; }
  const { rows } = await client.query(`${FILE_SELECT} WHERE ${where} ORDER BY ${SORTS[sortBy] ?? SORTS.uploadedAt}, file.id LIMIT 500`, values);
  const list = rows.map((row) => toAttachment(row, context, { fromLead: row.entity_type === "lead" && lead && relatedType !== "lead" ? lead : null }));
  return kind ? list.filter((entry) => entry.kind === kind) : list;
}

// ------------------------------------------------------------------ upload

// Checks the file before anything is stored, outside the transaction: an
// allowed extension, the type that extension means (not what the browser
// claims), the size limit, the bytes really being that type, the malware scan.
export async function prepareAttachmentUpload({ fileName, bytes }, env = process.env) {
  const type = fileTypeOf(fileName);
  if (!type) throw new CrmError(400, `This kind of file cannot be attached. Allowed: ${CRM_ALLOWED_EXTENSIONS.map((entry) => entry.toUpperCase()).join(", ")}.`, "CRM_ATTACHMENT_TYPE_BLOCKED");
  const maximumBytes = crmAttachmentMaxBytes(env);
  if (bytes?.length > maximumBytes) throw new CrmError(413, `Files can be at most ${Math.round(maximumBytes / 1048576)} MB.`, "CRM_ATTACHMENT_TOO_LARGE");
  try {
    return await prepareFileUpload({ fileName, mimeType: type.mimeType, bytes, maximumBytes, allowedTypes: CRM_ALLOWED_MIME_TYPES }, env);
  } catch (error) {
    if (error?.code === "ATTACHMENT_CONTENT_TYPE_MISMATCH") throw new CrmError(400, `This file is not a real .${type.extension} file.`, "CRM_ATTACHMENT_CONTENT_MISMATCH");
    if (error?.status && error.status < 500) throw new CrmError(error.status, error.message, error.code ?? "CRM_ATTACHMENT_VALIDATION");
    throw error;
  }
}

// input: { prepared (from prepareAttachmentUpload), description?, noteId?, idempotencyKey? }
// A retried upload with the same idempotencyKey returns the first file instead of storing a second.
export async function uploadAttachment(client, context, relatedType, relatedId, input = {}, options = {}) {
  requireContentPermission(context, ATTACHMENT_PERMISSIONS.upload, "You do not have permission to upload attachments.");
  await requireRecordVisible(client, context, relatedType, relatedId);
  const key = text(input.idempotencyKey).slice(0, 120) || null;
  if (key) {
    const { rows } = await client.query(`SELECT attachment_id FROM tenant.crm_attachment_details WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key]);
    if (rows[0]) return getAttachment(client, context, rows[0].attachment_id);
  }
  const description = text(input.description);
  if (description.length > 500) throw invalid("Use 500 characters or fewer.", "description");
  let noteId = null;
  if (input.noteId) {
    if (!UUID.test(String(input.noteId))) throw invalid("Note is invalid.", "noteId");
    const { rows } = await client.query(`SELECT id FROM tenant.crm_notes WHERE organization_id = $1 AND id = $2 AND entity_type = $3 AND entity_id = $4 AND archived_at IS NULL`,
      [context.organizationId, input.noteId, relatedType, relatedId]);
    if (!rows[0]) throw invalid("The note is not on this record.", "noteId");
    noteId = rows[0].id;
  }
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: storageType(relatedType), entityId: relatedId, prepared: input.prepared, uploadedBy: context.userId ?? null,
  }, options);
  await client.query(
    `INSERT INTO tenant.crm_attachment_details (attachment_id, organization_id, entity_type, entity_id, note_id, description, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [file.id, context.organizationId, relatedType, relatedId, noteId, description || null, key],
  );
  await recordContentHistory(client, context, { entityType: relatedType, entityId: relatedId, subjectType: "attachment", subjectId: file.id, eventType: "attachment_uploaded",
    summary: `Uploaded ${file.fileName}${noteId ? " to a note" : ""}`, changes: { sizeBytes: file.sizeBytes, mimeType: file.mimeType, noteId } });
  await queueOutboxEvent(client, context, "crm.attachment.uploaded", "attachment", file.id, { entityType: relatedType, entityId: relatedId, mimeType: file.mimeType });
  return getAttachment(client, context, file.id);
}

// ------------------------------------------------------------------ read one, download

async function loadAttachment(client, context, attachmentId) {
  if (!UUID.test(String(attachmentId ?? ""))) throw new CrmError(400, "Attachment is invalid.", "CRM_ATTACHMENT_VALIDATION");
  const { rows } = await client.query(`${FILE_SELECT} WHERE detail.organization_id = $1 AND detail.attachment_id = $2 AND ${ACTIVE}`, [context.organizationId, attachmentId]);
  const row = rows[0];
  // the file's own record decides who may see it; a guessed id opens nothing
  if (!row || !(await recordVisible(client, context, row.entity_type, row.entity_id))) throw new CrmError(404, "Attachment not found.", "CRM_ATTACHMENT_NOT_FOUND");
  return row;
}

export async function getAttachment(client, context, attachmentId) {
  requireContentPermission(context, ATTACHMENT_PERMISSIONS.view, "You do not have permission to view attachments.");
  return toAttachment(await loadAttachment(client, context, attachmentId), context);
}

// The bytes, behind the same checks. inline: true only for a type the browser
// shows safely (PDF, image, plain text); the caller forces a download otherwise.
export async function downloadAttachment(client, context, attachmentId, { inline = false } = {}, options = {}) {
  requireContentPermission(context, ATTACHMENT_PERMISSIONS.download, "You do not have permission to download attachments.");
  const row = await loadAttachment(client, context, attachmentId);
  let content;
  try {
    content = await readFileContent(client, { organizationId: context.organizationId, entityType: storageType(row.entity_type), entityId: row.entity_id, fileId: row.id }, options);
  } catch (error) {
    if (error?.code === "FILE_NOT_FOUND") throw new CrmError(404, "Attachment not found.", "CRM_ATTACHMENT_NOT_FOUND");
    throw error;
  }
  const preview = previewOfMime(row.mime_type);
  return { fileName: row.display_name ?? row.file_name, mimeType: row.mime_type, body: content.body, inline: Boolean(inline && preview), preview };
}
export const getAttachmentPreview = (client, context, attachmentId, options = {}) => downloadAttachment(client, context, attachmentId, { inline: true }, options);

// ------------------------------------------------------------------ change, delete

// input: any of { displayName, description }. The uploader, or someone who may delete anyone's files.
// A new name keeps the uploaded file's extension, so a rename never changes how the file opens.
function keepExtension(name, originalName) {
  if (!name) return null;
  const extension = (originalName.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();
  if (!extension || name.toLowerCase().endsWith(extension)) return name;
  return `${name}${extension}`;
}

export async function updateAttachment(client, context, attachmentId, input = {}) {
  const row = await loadAttachment(client, context, attachmentId);
  const attachment = toAttachment(row, context);
  if (!attachment.canEdit) throw new CrmError(403, "Only the uploader or a manager can change this file's details.", "PERMISSION_DENIED");
  const displayName = has(input, "displayName") ? keepExtension(text(input.displayName).replace(/[\\/\0-\x1f\x7f]/g, "-").slice(0, 180), row.file_name) : row.display_name;
  const description = has(input, "description") ? text(input.description) || null : row.description;
  if (description && description.length > 500) throw invalid("Use 500 characters or fewer.", "description");
  if (displayName === row.display_name && description === row.description) return attachment;
  await client.query(`UPDATE tenant.crm_attachment_details SET display_name = $3, description = $4, updated_at = now() WHERE organization_id = $1 AND attachment_id = $2`,
    [context.organizationId, row.id, displayName, description]);
  if (displayName !== row.display_name)
    await recordContentHistory(client, context, { entityType: row.entity_type, entityId: row.entity_id, subjectType: "attachment", subjectId: row.id, eventType: "attachment_renamed",
      summary: `Renamed ${row.display_name ?? row.file_name} → ${displayName ?? row.file_name}`, changes: { from: row.display_name, to: displayName } });
  return getAttachment(client, context, row.id);
}

// Archived, not erased: the file leaves the record, its metadata and history stay.
export async function deleteAttachment(client, context, attachmentId) {
  const row = await loadAttachment(client, context, attachmentId);
  if (!toAttachment(row, context).canDelete) throw new CrmError(403, "Only the uploader or a manager can delete this file.", "PERMISSION_DENIED");
  await archiveFile(client, { organizationId: context.organizationId, entityType: storageType(row.entity_type), entityId: row.entity_id, fileId: row.id, actorUserId: context.userId ?? null });
  await recordContentHistory(client, context, { entityType: row.entity_type, entityId: row.entity_id, subjectType: "attachment", subjectId: row.id, eventType: "attachment_deleted",
    summary: `Deleted ${row.display_name ?? row.file_name}` });
  await queueOutboxEvent(client, context, "crm.attachment.deleted", "attachment", row.id, { entityType: row.entity_type, entityId: row.entity_id });
  return { deleted: true };
}

export { CRM_ALLOWED_EXTENSIONS, crmAttachmentMaxBytes };

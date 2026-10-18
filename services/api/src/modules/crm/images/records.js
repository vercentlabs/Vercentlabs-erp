// A company's logo and a contact's photo (CRM plan 5.5): one current image per record (JPEG, PNG or WebP, up to 2 MB), kept in the
// shared file store as crm.party_logo / crm.contact_photo — apart from the record's own files. Anyone who can see the record sees it;
// changing or removing it needs edit access to the record. A replaced image is archived, never shown again.
import { archiveFile, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { CrmError } from "../data-management/errors.js";
import { recordVisible } from "../notes/access.js";

const KINDS = Object.freeze({
  party: { entityType: "crm.party_logo", permission: "crm.accounts.edit", label: "logo" },
  contact: { entityType: "crm.contact_photo", permission: "crm.contacts.edit", label: "photo" },
});
const TYPES = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });
const MAX_BYTES = 2 * 1024 * 1024;

function kindOf(type) {
  const kind = KINDS[type];
  if (!kind) throw new CrmError(400, "Only companies and contacts have a picture.", "CRM_IMAGE_INVALID");
  return kind;
}
async function requireVisible(client, context, type, id) {
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_IMAGE_RECORD");
}
function requireEdit(context, kind) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(kind.permission)) return;
  throw new CrmError(403, `You do not have permission to change this ${kind.label}.`, "PERMISSION_DENIED");
}

// Checks the image from its name and bytes; run before the transaction.
export async function prepareRecordImage({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,5})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new CrmError(400, "Use a JPEG, PNG or WebP image.", "CRM_IMAGE_TYPE");
  if (bytes?.length > MAX_BYTES) throw new CrmError(413, "Images can be at most 2 MB.", "CRM_IMAGE_TOO_LARGE");
  try {
    return await prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
  } catch (error) {
    if (error?.status && error.status < 500) throw new CrmError(error.status, "This file is not a real image of that type.", "CRM_IMAGE_CONTENT");
    throw error;
  }
}

async function currentImage(client, organizationId, entityType, id) {
  return (await client.query(
    `SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND is_current AND lifecycle_status <> 'archived'
      ORDER BY created_at DESC LIMIT 1`, [organizationId, entityType, String(id)])).rows[0] ?? null;
}

// Replaces the record's picture. input: { prepared } (from prepareRecordImage)
export async function setRecordImage(client, context, type, id, input = {}, options = {}) {
  const kind = kindOf(type);
  requireEdit(context, kind);
  await requireVisible(client, context, type, id);
  const previous = await currentImage(client, context.organizationId, kind.entityType, id);
  if (previous) await archiveFile(client, { organizationId: context.organizationId, entityType: kind.entityType, entityId: id, fileId: previous.id, actorUserId: context.userId ?? null });
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: kind.entityType, entityId: id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  return { fileId: file.id, fileName: file.fileName };
}

export async function removeRecordImage(client, context, type, id) {
  const kind = kindOf(type);
  requireEdit(context, kind);
  await requireVisible(client, context, type, id);
  const previous = await currentImage(client, context.organizationId, kind.entityType, id);
  if (previous) await archiveFile(client, { organizationId: context.organizationId, entityType: kind.entityType, entityId: id, fileId: previous.id, actorUserId: context.userId ?? null });
  return { removed: Boolean(previous) };
}

// The picture's bytes, or null when the record has none.
export async function readRecordImage(client, context, type, id, options = {}) {
  const kind = kindOf(type);
  await requireVisible(client, context, type, id);
  const image = await currentImage(client, context.organizationId, kind.entityType, id);
  if (!image) return null;
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: kind.entityType, entityId: id, fileId: image.id }, options);
  return { fileName: image.file_name, mimeType: image.mime_type, body: content.body };
}

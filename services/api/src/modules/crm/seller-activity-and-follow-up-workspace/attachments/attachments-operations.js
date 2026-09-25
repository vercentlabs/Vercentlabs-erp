// Prompt 6 (CRM-CAP-004, F017 — Notes & Files). Re-audit confirmed governed
// attachments used the SAME real shared table (public.attachments, already
// generic: entity_type/entity_id) but only Lead had routes that wrote to
// it — Account/Contact/Opportunity had no attachment support at all, and
// the parent-record authorization + entity_type convention ('crm.lead')
// lived inline inside that one route rather than in a reusable service.
// This module is the ONE canonical attachment domain service every entity
// type's routes call into — parent-record authorization (reusing
// resolveCrmEntityAccess, the SAME function Notes/Timeline already use),
// the 'crm.<entityType>' storage convention, and deletion/audit — so a
// future authorization change only has one place to make it.
//
// Upload-time concerns that are already real, shared, framework-level
// utilities — file validation (@vercentlabs/document-engine's
// validateAttachment), malware-scan adapter boundary (core/attachment-
// security.ts's scanAttachmentForUpload), and storage-key derivation —
// deliberately stay in the calling route, not duplicated here: they are
// not CRM-specific business logic, and document-engine is already the one
// shared implementation every attachment route (including this one) calls.
//
// F017 §CRM-VNEXT-053 closeout (attachment versioning): platform migration
// 038 adds logical_id/version/is_current. Every attachment already
// uploaded became its own one-version logical file (logical_id=id) with
// zero data loss. A genuine "replace this file" upload reuses the
// ORIGINAL logical_id, increments version, and the new row becomes
// current — the superseded row is never deleted or overwritten, so every
// prior version's filename/MIME/size/uploader/timestamp/storage
// reference/scan-quarantine state stays exactly as it was.
import { CrmError } from "../../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../../crm-data-operations-and-customization/outbox.js";
import { resolveCrmEntityAccess } from "../timeline/timeline.js";
import { assertCanWriteCrmRecordContent } from "../../crm-data-operations-and-customization/crm-access-scope.js";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function uuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_ATTACHMENT_REFERENCE_INVALID");
  return String(value);
}

// The one place the 'crm.<entityType>' storage-table convention is
// spelled out — every route and query below goes through this rather than
// re-deriving the string.
export function crmAttachmentStorageEntityType(entityType) {
  return `crm.${entityType}`;
}

async function assertParentAccess(client, context, entityType, entityId) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported attachment parent record type.", "CRM_ATTACHMENT_RELATION_INVALID");
  uuid(entityId, "Related record");
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_ATTACHMENT_RELATION_INVALID");
}

// Metadata only (no `content` column) — a list view must never pull large
// file bytes across the wire just to render a file name/size. Current
// versions only — a logical file with 3 versions shows as ONE row, not 3,
// matching "uploading a replacement must not silently create an unrelated
// attachment" (it also must not clutter the list with superseded copies).
export async function listCrmAttachments(client, context, entityType, entityId) {
  const allowed = ENTITY_TYPES.has(entityType) && UUID.test(String(entityId || "")) && (await resolveCrmEntityAccess(client, context, entityType, entityId));
  if (!allowed) return [];
  const result = await client.query(
    `SELECT id,logical_id,version,file_name,mime_type,size_bytes,lifecycle_status,scan_status,uploaded_by,created_at
       FROM public.attachments WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND is_current
      ORDER BY created_at DESC LIMIT 200`,
    [context.organizationId, crmAttachmentStorageEntityType(entityType), entityId],
  );
  return result.rows.map(dto);
}

// Full version history for one logical file, newest first — filename/
// MIME/size/uploader/timestamp/scan-quarantine state per version, never
// content bytes (same metadata-only contract as listCrmAttachments).
export async function listCrmAttachmentVersions(client, context, entityType, entityId, logicalId) {
  await assertParentAccess(client, context, entityType, entityId);
  const id = uuid(logicalId, "Attachment");
  const result = await client.query(
    `SELECT id,logical_id,version,is_current,file_name,mime_type,size_bytes,lifecycle_status,scan_status,uploaded_by,created_at
       FROM public.attachments WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND logical_id=$4
      ORDER BY version DESC`,
    [context.organizationId, crmAttachmentStorageEntityType(entityType), entityId, id],
  );
  return result.rows.map(dto);
}

export async function createCrmAttachment(client, context, entityType, entityId, input) {
  assertCanWriteCrmRecordContent(context, entityType);
  await assertParentAccess(client, context, entityType, entityId);
  const storageEntityType = crmAttachmentStorageEntityType(entityType);
  let logicalId = input.id;
  let version = 1;
  if (input.replacesLogicalId) {
    const currentVersion = await client.query(
      `SELECT logical_id,version FROM public.attachments
        WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND logical_id=$4 AND is_current
        LIMIT 1 FOR UPDATE`,
      [context.organizationId, storageEntityType, entityId, uuid(input.replacesLogicalId, "Attachment")],
    );
    if (!currentVersion.rows[0])
      throw new CrmError(404, "The file being replaced could not be found.", "CRM_ATTACHMENT_NOT_FOUND");
    logicalId = currentVersion.rows[0].logical_id;
    version = Number(currentVersion.rows[0].version) + 1;
    await client.query(
      `UPDATE public.attachments SET is_current=false WHERE organization_id=$1 AND logical_id=$2 AND is_current`,
      [context.organizationId, logicalId],
    );
  }
  const result = await client.query(
    `INSERT INTO public.attachments(
       id,organization_id,entity_type,entity_id,file_name,storage_key,mime_type,size_bytes,
       uploaded_by,content,content_sha256,lifecycle_status,scan_status,logical_id,version,is_current
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'clean',$12,$13,$14,true)
     RETURNING id,logical_id,version,file_name,mime_type,size_bytes,created_at`,
    [
      input.id, context.organizationId, storageEntityType, entityId,
      input.fileName, input.storageKey, input.mimeType, input.sizeBytes,
      context.userId, input.content, input.contentSha256, input.scanStatus, logicalId, version,
    ],
  );
  const attachment = dto(result.rows[0]);
  await queueOutboxEvent(client, context, "crm.attachment.uploaded", "attachment", attachment.id, { entityType, entityId, mimeType: attachment.mimeType, logicalId, version });
  return attachment;
}

// Governed download — only ever returns bytes for a scan-clean attachment;
// a quarantined/rejected/still-pending file 404s exactly like a missing
// one (no separate "exists but blocked" signal that would let a caller
// distinguish quarantine from absence). Works for any specific version's
// row id, current or historical — the same gate protects both, per §9's
// "old versions must remain protected by parent scope/visibility/
// sensitive permission/quarantine policy" requirement.
export async function getCrmAttachmentContent(client, context, entityType, entityId, attachmentId) {
  await assertParentAccess(client, context, entityType, entityId);
  uuid(attachmentId, "Attachment");
  const result = await client.query(
    `SELECT file_name,mime_type,size_bytes,content FROM public.attachments
      WHERE organization_id=$1 AND id=$2 AND entity_type=$3 AND entity_id=$4
        AND lifecycle_status='clean' AND scan_status IN ('clean','not_applicable')
      LIMIT 1`,
    [context.organizationId, attachmentId, crmAttachmentStorageEntityType(entityType), entityId],
  );
  if (!result.rows[0]?.content) throw new CrmError(404, "Attachment not found.", "CRM_ATTACHMENT_NOT_FOUND");
  return result.rows[0];
}

// Deletes exactly the specified version row (never a hard delete of the
// whole logical file's history in one call). If the deleted row was the
// current version, the next-most-recent surviving version (if any) is
// promoted to current — "revert to the previous version" rather than
// leaving the logical file with no current version while older ones
// still exist.
export async function deleteCrmAttachment(client, context, entityType, entityId, attachmentId) {
  assertCanWriteCrmRecordContent(context, entityType);
  await assertParentAccess(client, context, entityType, entityId);
  uuid(attachmentId, "Attachment");
  const result = await client.query(
    `DELETE FROM public.attachments WHERE organization_id=$1 AND id=$2 AND entity_type=$3 AND entity_id=$4
     RETURNING id,logical_id,version,is_current,file_name,mime_type,size_bytes`,
    [context.organizationId, attachmentId, crmAttachmentStorageEntityType(entityType), entityId],
  );
  if (!result.rows[0]) throw new CrmError(404, "Attachment not found.", "CRM_ATTACHMENT_NOT_FOUND");
  const attachment = dto(result.rows[0]);
  if (attachment.isCurrent) {
    await client.query(
      `UPDATE public.attachments SET is_current=true
        WHERE organization_id=$1 AND logical_id=$2 AND id = (
          SELECT id FROM public.attachments WHERE organization_id=$1 AND logical_id=$2 ORDER BY version DESC LIMIT 1
        )`,
      [context.organizationId, attachment.logicalId],
    );
  }
  await queueOutboxEvent(client, context, "crm.attachment.deleted", "attachment", attachment.id, { entityType, entityId, logicalId: attachment.logicalId });
  return attachment;
}

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
// Storage, versioning, scanning, hashing and the quarantine download gate
// belong to the Shared Platform file service (core/platform/files, Prompt 5):
// bytes live in object storage, not PostgreSQL. This module keeps what is
// CRM's: which records may carry files, parent-record authorization, the
// write rule, and CRM outbox events. The route prepares (validates + scans)
// the upload outside the transaction; createCrmAttachment stores it.
//
// F017 §CRM-VNEXT-053 closeout (attachment versioning): platform migration
// 038 adds logical_id/version/is_current. Every attachment already
// uploaded became its own one-version logical file (logical_id=id) with
// zero data loss. A genuine "replace this file" upload reuses the
// ORIGINAL logical_id, increments version, and the new row becomes
// current — the superseded row is never deleted or overwritten, so every
// prior version's filename/MIME/size/uploader/timestamp/storage
// reference/scan-quarantine state stays exactly as it was.
import { archiveFile, listFiles, listFileVersions, readFileContent, storeFile } from "../../../../core/platform/files/index.js";
import { CrmError } from "../../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../../crm-data-operations-and-customization/outbox.js";
import { resolveCrmEntityAccess } from "../timeline/timeline.js";
import { assertCanWriteCrmRecordContent } from "../../crm-data-operations-and-customization/crm-access-scope.js";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_ATTACHMENT_REFERENCE_INVALID");
  return String(value);
}

// The one place the 'crm.<entityType>' convention is spelled out.
export function crmAttachmentStorageEntityType(entityType) {
  return `crm.${entityType}`;
}

function dto(file) {
  return {
    id: file.id,
    logicalId: file.logicalId,
    version: file.version,
    isCurrent: file.isCurrent,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    lifecycleStatus: file.lifecycleStatus,
    scanStatus: file.scanStatus,
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt,
  };
}

async function assertParentAccess(client, context, entityType, entityId) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported attachment parent record type.", "CRM_ATTACHMENT_RELATION_INVALID");
  uuid(entityId, "Related record");
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_ATTACHMENT_RELATION_INVALID");
}

const fileNotFound = (error) => {
  if (error?.code === "FILE_NOT_FOUND") return new CrmError(404, "Attachment not found.", "CRM_ATTACHMENT_NOT_FOUND");
  return error;
};

// Current versions only, metadata only (bytes never cross the wire for a list).
export async function listCrmAttachments(client, context, entityType, entityId) {
  const allowed = ENTITY_TYPES.has(entityType) && UUID.test(String(entityId || "")) && (await resolveCrmEntityAccess(client, context, entityType, entityId));
  if (!allowed) return [];
  return (await listFiles(client, { organizationId: context.organizationId, entityType: crmAttachmentStorageEntityType(entityType), entityId })).map(dto);
}

// Full version history for one logical file, newest first, metadata only.
export async function listCrmAttachmentVersions(client, context, entityType, entityId, logicalId) {
  await assertParentAccess(client, context, entityType, entityId);
  return (await listFileVersions(client, { organizationId: context.organizationId, entityType: crmAttachmentStorageEntityType(entityType), entityId, logicalId: uuid(logicalId, "Attachment") })).map(dto);
}

// `input.prepared` comes from prepareFileUpload() (validated + scanned).
// With replacesLogicalId the upload becomes the next version of that file.
export async function createCrmAttachment(client, context, entityType, entityId, input, options = {}) {
  assertCanWriteCrmRecordContent(context, entityType);
  await assertParentAccess(client, context, entityType, entityId);
  let file;
  try {
    file = await storeFile(
      client,
      {
        organizationId: context.organizationId,
        entityType: crmAttachmentStorageEntityType(entityType),
        entityId,
        prepared: input.prepared,
        uploadedBy: context.userId,
        replacesLogicalId: input.replacesLogicalId ? uuid(input.replacesLogicalId, "Attachment") : null,
      },
      options,
    );
  } catch (error) {
    if (error?.code === "FILE_NOT_FOUND") throw new CrmError(404, "The file being replaced could not be found.", "CRM_ATTACHMENT_NOT_FOUND");
    throw error;
  }
  const attachment = dto(file);
  await queueOutboxEvent(client, context, "crm.attachment.uploaded", "attachment", attachment.id, { entityType, entityId, mimeType: attachment.mimeType, logicalId: attachment.logicalId, version: attachment.version });
  return attachment;
}

// Governed download: parent access first, then the platform gate (only a
// scan-clean, non-archived version; quarantined answers exactly like
// missing). Any version's own id works, current or historical.
export async function getCrmAttachmentContent(client, context, entityType, entityId, attachmentId, options = {}) {
  await assertParentAccess(client, context, entityType, entityId);
  try {
    return await readFileContent(client, { organizationId: context.organizationId, entityType: crmAttachmentStorageEntityType(entityType), entityId, fileId: uuid(attachmentId, "Attachment") }, options);
  } catch (error) {
    throw fileNotFound(error);
  }
}

// Removes exactly one version from use (the row is archived, never
// hard-deleted). If it was current, the newest remaining version is current.
export async function deleteCrmAttachment(client, context, entityType, entityId, attachmentId) {
  assertCanWriteCrmRecordContent(context, entityType);
  await assertParentAccess(client, context, entityType, entityId);
  let file;
  try {
    file = await archiveFile(client, { organizationId: context.organizationId, entityType: crmAttachmentStorageEntityType(entityType), entityId, fileId: uuid(attachmentId, "Attachment"), actorUserId: context.userId });
  } catch (error) {
    throw fileNotFound(error);
  }
  await queueOutboxEvent(client, context, "crm.attachment.deleted", "attachment", file.id, { entityType, entityId, logicalId: file.logicalId });
  return { ...dto(file), isCurrent: file.wasCurrent };
}

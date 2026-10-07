// Evidence on a receiving rejection: photos, inspection records, supplier correspondence. Files are added while the case is open and never
// removed once it is resolved: finalized evidence stays.
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { poCan, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, requireUuid } from "./constants.js";
import { preparePurchaseOrderFileUpload } from "./files.js";
import { loadRejection, recordRejectionEvent } from "./rejection-core.js";

export const REJECTION_FILE_ENTITY = "procurement.receiving_rejection";
export const prepareRejectionFileUpload = preparePurchaseOrderFileUpload;
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

function requireAttach(context) {
  if (!poCan(context, PO_PERMISSIONS.rejectionsRecord) && !poCan(context, PO_PERMISSIONS.rejectionsQuality))
    throw new PurchaseOrderError(403, "You do not have permission to add evidence to rejections.", "PERMISSION_DENIED");
}

export async function listRejectionFiles(client, context, rejectionId) {
  const rejection = await loadRejection(client, context, rejectionId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: REJECTION_FILE_ENTITY, entityId: rejection.id })).map(toFile);
}

export async function uploadRejectionFile(client, context, rejectionId, input = {}, options = {}) {
  requireAttach(context);
  const rejection = await loadRejection(client, context, rejectionId);
  if (rejection.status !== "open") throw new PurchaseOrderError(409, `Evidence is added while the rejection is open; ${rejection.rejection_number} is ${rejection.status}.`, "REJECTION_LOCKED");
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: REJECTION_FILE_ENTITY, entityId: rejection.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordRejectionEvent(client, context, rejection.id, "rejection.file_added", `Evidence added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}

export async function removeRejectionFile(client, context, rejectionId, fileId) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsEdit, "You do not have permission to remove evidence.");
  const rejection = await loadRejection(client, context, rejectionId);
  if (rejection.status !== "open") throw new PurchaseOrderError(409, "The evidence of a resolved or cancelled rejection is kept.", "REJECTION_LOCKED");
  await archiveFile(client, { organizationId: context.organizationId, entityType: REJECTION_FILE_ENTITY, entityId: rejection.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordRejectionEvent(client, context, rejection.id, "rejection.file_removed", "Evidence removed", { fileId });
  return { removed: true };
}

// Reads a file of the case, or a receipt file cited as its evidence.
export async function readRejectionFile(client, context, rejectionId, fileId, options = {}) {
  const rejection = await loadRejection(client, context, rejectionId);
  const id = requireUuid(fileId, "File");
  const { rows } = await client.query(
    `SELECT id, file_name, mime_type, entity_type, entity_id FROM public.attachments WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
        AND ((entity_type = $3 AND entity_id = $4::text) OR id = ANY($5::uuid[]))`, [context.organizationId, id, REJECTION_FILE_ENTITY, rejection.id, rejection.evidence_file_ids]);
  if (!rows[0]) throw new PurchaseOrderError(404, "File not found.", "REJECTION_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: rows[0].entity_type, entityId: rows[0].entity_id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

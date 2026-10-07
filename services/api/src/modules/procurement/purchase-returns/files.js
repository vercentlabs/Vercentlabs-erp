// Files on a purchase return: inspection reports, photographs, the supplier's correspondence and RMA, dispatch documents.
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { preparePurchaseOrderFileUpload } from "../purchase-orders/files.js";
import { PurchaseReturnError, RETURN_PERMISSIONS, requireUuid } from "./constants.js";
import { loadReturn, recordReturnEvent, requirePermission } from "./returns.js";

export const PURCHASE_RETURN_FILE_ENTITY = "procurement.purchase_return";
export const preparePurchaseReturnFileUpload = preparePurchaseOrderFileUpload;
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

export async function listPurchaseReturnFiles(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: PURCHASE_RETURN_FILE_ENTITY, entityId: row.id })).map(toFile);
}

export async function uploadPurchaseReturnFile(client, context, returnId, input = {}, options = {}) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to add files to purchase returns.");
  const row = await loadReturn(client, context, returnId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: PURCHASE_RETURN_FILE_ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordReturnEvent(client, context, row.id, "purchase_return.file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}

export async function removePurchaseReturnFile(client, context, returnId, fileId) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to remove files from purchase returns.");
  const row = await loadReturn(client, context, returnId);
  await archiveFile(client, { organizationId: context.organizationId, entityType: PURCHASE_RETURN_FILE_ENTITY, entityId: row.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordReturnEvent(client, context, row.id, "purchase_return.file_removed", "File removed", { fileId });
  return { removed: true };
}

export async function readPurchaseReturnFile(client, context, returnId, fileId, options = {}) {
  const row = await loadReturn(client, context, returnId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, PURCHASE_RETURN_FILE_ENTITY, row.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new PurchaseReturnError(404, "File not found.", "PURCHASE_RETURN_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: PURCHASE_RETURN_FILE_ENTITY, entityId: row.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

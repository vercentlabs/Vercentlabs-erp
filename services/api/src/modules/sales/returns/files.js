// Files on a return: the customer's return request, photos of the goods, the
// signed return receipt. They are internal: the Return Note never includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requireUuid, text } from "../orders/constants.js";
import { loadReturn, recordReturnEvent, returnCan } from "./access.js";
import { RETURN_PERMISSIONS, ReturnError } from "./constants.js";

export const RETURN_FILE_ENTITY = "sales.return";
const TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" });
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareReturnFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new ReturnError(400, "Upload a PDF, an image, a Word or a text file.", "SALES_RETURN_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}
function requireFileWriter(context) {
  if (!returnCan(context, RETURN_PERMISSIONS.edit) && !returnCan(context, RETURN_PERMISSIONS.receive))
    throw new ReturnError(403, "You do not have permission to add files to returns.", "PERMISSION_DENIED");
}
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

export async function listReturnFiles(client, context, returnId) {
  const salesReturn = await loadReturn(client, context, returnId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: RETURN_FILE_ENTITY, entityId: salesReturn.id })).map(toFile);
}
export async function uploadReturnFile(client, context, returnId, input = {}, options = {}) {
  requireFileWriter(context);
  const salesReturn = await loadReturn(client, context, returnId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: RETURN_FILE_ENTITY, entityId: salesReturn.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.file_added", null, null, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}
export async function removeReturnFile(client, context, returnId, fileId) {
  requireFileWriter(context);
  const salesReturn = await loadReturn(client, context, returnId);
  const id = requireUuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, RETURN_FILE_ENTITY, salesReturn.id, id])).rows[0]?.file_name;
  if (!name) throw new ReturnError(404, "File not found.", "SALES_RETURN_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: RETURN_FILE_ENTITY, entityId: salesReturn.id, fileId: id, actorUserId: context.userId ?? null });
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.file_removed", null, null, { fileId: id, fileName: name });
  return { removed: true };
}
export async function readReturnFile(client, context, returnId, fileId, options = {}) {
  const salesReturn = await loadReturn(client, context, returnId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, RETURN_FILE_ENTITY, salesReturn.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new ReturnError(404, "File not found.", "SALES_RETURN_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: RETURN_FILE_ENTITY, entityId: salesReturn.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

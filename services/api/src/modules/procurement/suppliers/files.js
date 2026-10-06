// Files on a supplier: the contract, rate card, tax and quality certificates,
// company profile, correspondence. Kept by the Shared Platform file service;
// seen by whoever may see the supplier, added and removed by whoever may edit it.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { SUPPLIER_FILE_ENTITY, SUPPLIER_PERMISSIONS, SupplierError, requireUuid, text } from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission } from "./access.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareSupplierFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new SupplierError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "SUPPLIER_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt,
});

export async function listSupplierFiles(client, context, supplierId) {
  const supplier = await loadSupplier(client, context, supplierId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: SUPPLIER_FILE_ENTITY, entityId: supplier.id })).map(toFile);
}

export async function uploadSupplierFile(client, context, supplierId, input = {}, options = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.edit, "You do not have permission to add files to suppliers.");
  const supplier = await loadSupplier(client, context, supplierId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: SUPPLIER_FILE_ENTITY, entityId: supplier.id, prepared: input.prepared,
    uploadedBy: context.userId ?? null }, options);
  await recordSupplierEvent(client, context, supplier.id, "supplier.file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}

export async function removeSupplierFile(client, context, supplierId, fileId) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.edit, "You do not have permission to remove files from suppliers.");
  const supplier = await loadSupplier(client, context, supplierId);
  const id = requireUuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, SUPPLIER_FILE_ENTITY, supplier.id, id])).rows[0]?.file_name;
  if (!name) throw new SupplierError(404, "File not found.", "SUPPLIER_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: SUPPLIER_FILE_ENTITY, entityId: supplier.id, fileId: id, actorUserId: context.userId ?? null });
  await recordSupplierEvent(client, context, supplier.id, "supplier.file_removed", `File removed: ${name}`, { fileId: id });
  return { removed: true };
}

export async function readSupplierFile(client, context, supplierId, fileId, options = {}) {
  const supplier = await loadSupplier(client, context, supplierId);
  return readFileContent(client, { organizationId: context.organizationId, entityType: SUPPLIER_FILE_ENTITY, entityId: supplier.id, fileId: requireUuid(fileId, "File") }, options);
}

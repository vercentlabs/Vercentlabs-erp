// Files on a quotation (the customer's enquiry, drawings, a signed copy),
// stored through the Shared Platform file service. They are internal: the
// quotation PDF never includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requireQuotationAccess, requireQuotationPermission } from "./access.js";
import { QUOTATION_PERMISSIONS, QuotationError, requireUuid, text } from "./constants.js";
import { assertQuotationVisible } from "./records.js";
import { lockQuotation, recordQuotationEvent } from "./versions.js";

export const QUOTATION_FILE_ENTITY = "sales.quotation";
const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

// Checks the type from the name and the bytes; run before the transaction.
export async function prepareQuotationFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new QuotationError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "SALES_QUOTATION_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listQuotationFiles(client, context, quotationId) {
  requireQuotationAccess(context);
  const id = requireUuid(quotationId);
  await assertQuotationVisible(client, context, id);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: QUOTATION_FILE_ENTITY, entityId: id })).map(toFile);
}

// input: { prepared }. Anyone who may edit quotations can attach a file at any stage.
export async function uploadQuotationFile(client, context, quotationId, input = {}, options = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to add files to quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  await assertQuotationVisible(client, context, quote.id);
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: QUOTATION_FILE_ENTITY, entityId: quote.id, prepared: input.prepared, uploadedBy: context.userId ?? null,
  }, options);
  await recordQuotationEvent(client, context, quote.id, "quotation.file_added", quote.lifecycle_status, quote.lifecycle_status, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeQuotationFile(client, context, quotationId, fileId) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to remove files from quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  await assertQuotationVisible(client, context, quote.id);
  await archiveFile(client, { organizationId: context.organizationId, entityType: QUOTATION_FILE_ENTITY, entityId: quote.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordQuotationEvent(client, context, quote.id, "quotation.file_removed", quote.lifecycle_status, quote.lifecycle_status, { fileId });
  return { removed: true };
}

export async function readQuotationFile(client, context, quotationId, fileId, options = {}) {
  requireQuotationAccess(context);
  const id = requireUuid(quotationId);
  await assertQuotationVisible(client, context, id);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, QUOTATION_FILE_ENTITY, id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new QuotationError(404, "File not found.", "SALES_QUOTATION_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: QUOTATION_FILE_ENTITY, entityId: id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

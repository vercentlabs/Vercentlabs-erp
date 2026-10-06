// Files on a refund: the bank advice, the customer's request, an approval;
// and the vouchers that were emailed. They are internal: the voucher never
// includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { text, uuid } from "../core.js";
import { REFUND_FILE_ENTITY } from "./communication.js";
import { REFUND_PERMISSIONS, RefundError, refundCan } from "./constants.js";
import { loadRefund, recordRefundEvent } from "./records.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareRefundFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName))?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new RefundError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "ACCOUNTING_REFUND_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

function requireFileWriter(context) {
  if (![REFUND_PERMISSIONS.edit, REFUND_PERMISSIONS.post, REFUND_PERMISSIONS.send].some((permission) => refundCan(context, permission)))
    throw new RefundError(403, "You do not have permission to add files to refunds.", "PERMISSION_DENIED");
}
const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listRefundFiles(client, context, refundId) {
  const refund = await loadRefund(client, context, refundId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: REFUND_FILE_ENTITY, entityId: refund.id })).map(toFile);
}

export async function uploadRefundFile(client, context, refundId, input = {}, options = {}) {
  requireFileWriter(context);
  const refund = await loadRefund(client, context, refundId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: REFUND_FILE_ENTITY, entityId: refund.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.file_added", null, null, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeRefundFile(client, context, refundId, fileId) {
  requireFileWriter(context);
  const refund = await loadRefund(client, context, refundId);
  const id = uuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, REFUND_FILE_ENTITY, refund.id, id])).rows[0]?.file_name;
  if (!name) throw new RefundError(404, "File not found.", "ACCOUNTING_REFUND_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: REFUND_FILE_ENTITY, entityId: refund.id, fileId: id, actorUserId: context.userId ?? null });
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.file_removed", null, null, { fileId: id, fileName: name });
  return { removed: true };
}

export async function readRefundFile(client, context, refundId, fileId, options = {}) {
  const refund = await loadRefund(client, context, refundId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, REFUND_FILE_ENTITY, refund.id, uuid(fileId, "File")]);
  if (!rows[0]) throw new RefundError(404, "File not found.", "ACCOUNTING_REFUND_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: REFUND_FILE_ENTITY, entityId: refund.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

// Files on a sales order (the customer's purchase order, an agreement, a
// drawing, an order specification), stored through the Shared Platform file
// service. They are internal: the order PDF never includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { assertOrderVisible, requireOrderAccess, requireOrderPermission } from "./access.js";
import { ORDER_PERMISSIONS, OrderError, requireUuid, text } from "./constants.js";
import { lockOrder, recordOrderEvent } from "./versions.js";

export const ORDER_FILE_ENTITY = "sales.order";
const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

// Checks the type from the name and the bytes; run before the transaction.
export async function prepareSalesOrderFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new OrderError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "SALES_ORDER_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listSalesOrderFiles(client, context, orderId) {
  requireOrderAccess(context);
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: ORDER_FILE_ENTITY, entityId: id })).map(toFile);
}

// input: { prepared }. A file can be attached at any stage of the order.
export async function uploadSalesOrderFile(client, context, orderId, input = {}, options = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to add files to sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: ORDER_FILE_ENTITY, entityId: order.id, prepared: input.prepared, uploadedBy: context.userId ?? null,
  }, options);
  await recordOrderEvent(client, context, order.id, "sales_order.file_added", order.lifecycle_status, order.lifecycle_status, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeSalesOrderFile(client, context, orderId, fileId) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to remove files from sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  await archiveFile(client, { organizationId: context.organizationId, entityType: ORDER_FILE_ENTITY, entityId: order.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordOrderEvent(client, context, order.id, "sales_order.file_removed", order.lifecycle_status, order.lifecycle_status, { fileId });
  return { removed: true };
}

export async function readSalesOrderFile(client, context, orderId, fileId, options = {}) {
  requireOrderAccess(context);
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, ORDER_FILE_ENTITY, id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new OrderError(404, "File not found.", "SALES_ORDER_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: ORDER_FILE_ENTITY, entityId: id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

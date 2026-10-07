// Files on a purchase order (the supplier's quotation, specifications,
// drawings, contracts, correspondence), stored through the Shared Platform
// file service. They are internal: the order PDF never includes them. The
// exact PDFs emailed to the supplier are kept here too.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { loadPurchaseOrder, poCan, requirePoAccess } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, requireUuid, text } from "./constants.js";
import { PO_FILE_ENTITY } from "./communication.js";
import { recordPoEvent } from "./persist.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", dwg: "application/acad",
});

export async function preparePurchaseOrderFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new PurchaseOrderError(400, "Upload a PDF, Word, Excel, CSV, text, image or drawing file.", "PURCHASE_ORDER_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

function requireAttach(context) {
  if (!poCan(context, PO_PERMISSIONS.create) && !poCan(context, PO_PERMISSIONS.confirm))
    throw new PurchaseOrderError(403, "You do not have permission to change files on purchase orders.", "PERMISSION_DENIED");
}

export async function listPurchaseOrderFiles(client, context, orderId) {
  requirePoAccess(context);
  const order = await loadPurchaseOrder(client, context, orderId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: PO_FILE_ENTITY, entityId: order.id })).map(toFile);
}

export async function uploadPurchaseOrderFile(client, context, orderId, input = {}, options = {}) {
  requireAttach(context);
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: PO_FILE_ENTITY, entityId: order.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordPoEvent(client, context, order.id, "purchase_order.file_added", `File added: ${file.fileName}`, { details: { fileId: file.id } });
  return toFile(file);
}

export async function removePurchaseOrderFile(client, context, orderId, fileId) {
  requireAttach(context);
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  await archiveFile(client, { organizationId: context.organizationId, entityType: PO_FILE_ENTITY, entityId: order.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordPoEvent(client, context, order.id, "purchase_order.file_removed", "File removed", { details: { fileId } });
  return { removed: true };
}

export async function readPurchaseOrderFile(client, context, orderId, fileId, options = {}) {
  requirePoAccess(context);
  const order = await loadPurchaseOrder(client, context, orderId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, PO_FILE_ENTITY, order.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new PurchaseOrderError(404, "File not found.", "PURCHASE_ORDER_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: PO_FILE_ENTITY, entityId: order.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

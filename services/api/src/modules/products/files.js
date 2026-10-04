// Files on a product (specification sheets, documentation, service scope)
// and its one primary image, stored through the Shared Platform file service.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { productCan, requireProductPermission } from "./access.js";
import { PRODUCT_FILE_ENTITY, PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { recordProductHistory } from "./history.js";
import { loadProductRow } from "./records.js";
import { requireUuid, text } from "./validation.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

// Checks the type from the name and the bytes; run before the transaction.
export async function prepareProductFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName))?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new ProductError(400, "Upload a PDF, Word, Excel, text or image file.", "PRODUCT_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row, imageId) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt, isImage: String(row.mime_type ?? row.mimeType ?? "").startsWith("image/"), isPrimaryImage: (row.id) === imageId,
});

export async function listProductFiles(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const product = await loadProductRow(client, context, productId);
  const files = await listFiles(client, { organizationId: context.organizationId, entityType: PRODUCT_FILE_ENTITY, entityId: product.id });
  return files.map((file) => toFile(file, product.image_attachment_id));
}

// input: { prepared, makePrimaryImage }. The first image becomes the primary image.
export async function uploadProductFile(client, context, productId, input = {}, options = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit products.");
  const product = await loadProductRow(client, context, productId, { lock: true });
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: PRODUCT_FILE_ENTITY, entityId: product.id, prepared: input.prepared, uploadedBy: context.userId ?? null,
  }, options);
  const image = String(file.mimeType ?? input.prepared?.mimeType ?? "").startsWith("image/");
  if (image && (input.makePrimaryImage === true || !product.image_attachment_id)) await setImage(client, context, product, file.id, file.fileName);
  else await recordProductHistory(client, context, product.id, "updated", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file, image && (input.makePrimaryImage === true || !product.image_attachment_id) ? file.id : product.image_attachment_id);
}

async function setImage(client, context, product, fileId, fileName) {
  await client.query(`UPDATE tenant.items SET image_attachment_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, product.id, fileId, context.userId ?? null]);
  await recordProductHistory(client, context, product.id, "updated", fileId ? `Image set: ${fileName}` : "Image removed", { imageAttachmentId: { label: "Image", from: product.image_attachment_id, to: fileId } });
}

export async function setProductImage(client, context, productId, fileId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit products.");
  const product = await loadProductRow(client, context, productId, { lock: true });
  if (!fileId) { await setImage(client, context, product, null, null); return { imageAttachmentId: null }; }
  const { rows } = await client.query(`SELECT id, file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND is_current AND archived_at IS NULL AND mime_type LIKE 'image/%'`,
    [context.organizationId, PRODUCT_FILE_ENTITY, product.id, requireUuid(fileId, "Image")]);
  if (!rows[0]) throw new ProductError(404, "Choose an image uploaded to this product.", "PRODUCT_FILE_NOT_FOUND");
  await setImage(client, context, product, rows[0].id, rows[0].file_name);
  return { imageAttachmentId: rows[0].id };
}

export async function removeProductFile(client, context, productId, fileId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit products.");
  const product = await loadProductRow(client, context, productId, { lock: true });
  await archiveFile(client, { organizationId: context.organizationId, entityType: PRODUCT_FILE_ENTITY, entityId: product.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  if (product.image_attachment_id === fileId) await setImage(client, context, product, null, null);
  else await recordProductHistory(client, context, product.id, "updated", "File removed", { fileId });
  return { removed: true };
}

// The file's bytes, for download or for showing the image.
export async function readProductFile(client, context, productId, fileId, options = {}) {
  if (!productCan(context, PRODUCT_PERMISSIONS.view)) throw new ProductError(403, "You do not have permission to view products.", "PERMISSION_DENIED");
  const product = await loadProductRow(client, context, productId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, PRODUCT_FILE_ENTITY, product.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new ProductError(404, "File not found.", "PRODUCT_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: PRODUCT_FILE_ENTITY, entityId: product.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

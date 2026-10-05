// Files on a delivery: proof of delivery (the signed delivery note, a photo
// of the goods received, the customer's acknowledgement) and any other
// document for the shipment. They are internal: the Delivery Note PDF never
// includes them. Proof is added once the goods have left.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requireUuid, text } from "../orders/constants.js";
import { deliveryCan, loadDelivery } from "./access.js";
import { DELIVERY_PERMISSIONS, DeliveryError, SHIPPED } from "./constants.js";
import { recordDeliveryEvent } from "./records.js";

export const DELIVERY_FILE_ENTITY = "sales.delivery";
const TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });
const MAX_BYTES = 10 * 1024 * 1024;

// Checks the type from the name and the bytes; run before the transaction.
export async function prepareDeliveryFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new DeliveryError(400, "Upload a PDF or an image (JPG, PNG, WebP).", "SALES_DELIVERY_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

function requireFileWriter(context) {
  if (!deliveryCan(context, DELIVERY_PERMISSIONS.deliver) && !deliveryCan(context, DELIVERY_PERMISSIONS.edit))
    throw new DeliveryError(403, "You do not have permission to add proof of delivery.", "PERMISSION_DENIED");
}

const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listDeliveryFiles(client, context, deliveryId) {
  const delivery = await loadDelivery(client, context, deliveryId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: DELIVERY_FILE_ENTITY, entityId: delivery.id })).map(toFile);
}

// input: { prepared }
export async function uploadDeliveryFile(client, context, deliveryId, input = {}, options = {}) {
  requireFileWriter(context);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (!SHIPPED.includes(delivery.delivery_status))
    throw new DeliveryError(409, "Proof of delivery is added once the delivery has been dispatched.", "SALES_DELIVERY_NOT_DISPATCHED");
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: DELIVERY_FILE_ENTITY, entityId: delivery.id, prepared: input.prepared, uploadedBy: context.userId ?? null,
  }, options);
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.file_added", delivery.delivery_status, delivery.delivery_status, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeDeliveryFile(client, context, deliveryId, fileId) {
  requireFileWriter(context);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  const id = requireUuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, DELIVERY_FILE_ENTITY, delivery.id, id])).rows[0]?.file_name;
  if (!name) throw new DeliveryError(404, "File not found.", "SALES_DELIVERY_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: DELIVERY_FILE_ENTITY, entityId: delivery.id, fileId: id, actorUserId: context.userId ?? null });
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.file_removed", delivery.delivery_status, delivery.delivery_status, { fileId: id, fileName: name });
  return { removed: true };
}

export async function readDeliveryFile(client, context, deliveryId, fileId, options = {}) {
  const delivery = await loadDelivery(client, context, deliveryId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, DELIVERY_FILE_ENTITY, delivery.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new DeliveryError(404, "File not found.", "SALES_DELIVERY_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: DELIVERY_FILE_ENTITY, entityId: delivery.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

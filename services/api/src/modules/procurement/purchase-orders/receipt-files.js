// Files on a goods receipt: the supplier's challan, packing slips, photos of damaged goods, receiving notes.
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requirePoAccess, requirePoPermission, loadPurchaseOrder } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, requireUuid } from "./constants.js";
import { preparePurchaseOrderFileUpload } from "./files.js";
import { recordReceiptEvent } from "./receipts.js";

export const GOODS_RECEIPT_FILE_ENTITY = "procurement.goods_receipt";
export const prepareGoodsReceiptFileUpload = preparePurchaseOrderFileUpload;
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

async function receiptOf(client, context, receiptId) {
  requirePoAccess(context);
  const receipt = (await client.query(`SELECT id, purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(receiptId, "Goods receipt")])).rows[0];
  if (!receipt) throw new PurchaseOrderError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
  await loadPurchaseOrder(client, context, receipt.purchase_order_id);
  return receipt;
}

export async function listGoodsReceiptFiles(client, context, receiptId) {
  const receipt = await receiptOf(client, context, receiptId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: GOODS_RECEIPT_FILE_ENTITY, entityId: receipt.id })).map(toFile);
}

export async function uploadGoodsReceiptFile(client, context, receiptId, input = {}, options = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to add files to goods receipts.");
  const receipt = await receiptOf(client, context, receiptId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: GOODS_RECEIPT_FILE_ENTITY, entityId: receipt.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}

export async function removeGoodsReceiptFile(client, context, receiptId, fileId) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to remove files from goods receipts.");
  const receipt = await receiptOf(client, context, receiptId);
  await archiveFile(client, { organizationId: context.organizationId, entityType: GOODS_RECEIPT_FILE_ENTITY, entityId: receipt.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.file_removed", "File removed", { fileId });
  return { removed: true };
}

export async function readGoodsReceiptFile(client, context, receiptId, fileId, options = {}) {
  const receipt = await receiptOf(client, context, receiptId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, GOODS_RECEIPT_FILE_ENTITY, receipt.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new PurchaseOrderError(404, "File not found.", "GOODS_RECEIPT_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: GOODS_RECEIPT_FILE_ENTITY, entityId: receipt.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

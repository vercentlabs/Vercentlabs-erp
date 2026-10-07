// Files on a supplier bill or vendor credit: the supplier's original tax invoice (PDF or image) — the evidence the bill was entered from — and
// supporting documents. They stay with the bill; a posted bill's files are kept.
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { preparePurchaseOrderFileUpload } from "../purchase-orders/files.js";
import { requirePoPermission } from "../purchase-orders/access.js";
import { loadBill } from "./bills.js";
import { BILL_PERMISSIONS, SupplierBillError, requireUuid } from "./constants.js";

export const SUPPLIER_BILL_FILE_ENTITY = "procurement.supplier_bill";
export const prepareSupplierBillFileUpload = preparePurchaseOrderFileUpload;
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });

export async function listSupplierBillFiles(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: SUPPLIER_BILL_FILE_ENTITY, entityId: bill.id })).map(toFile);
}

export async function uploadSupplierBillFile(client, context, billId, input = {}, options = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.manage, "You do not have permission to add files to supplier bills.");
  const bill = await loadBill(client, context, billId);
  return toFile(await storeFile(client, { organizationId: context.organizationId, entityType: SUPPLIER_BILL_FILE_ENTITY, entityId: bill.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options));
}

export async function removeSupplierBillFile(client, context, billId, fileId) {
  requirePoPermission(context, BILL_PERMISSIONS.manage, "You do not have permission to remove files from supplier bills.");
  const bill = await loadBill(client, context, billId);
  if (bill.status !== "draft") throw new SupplierBillError(409, "The files of a bill that left draft are kept as its evidence.", "SUPPLIER_BILL_LOCKED");
  await archiveFile(client, { organizationId: context.organizationId, entityType: SUPPLIER_BILL_FILE_ENTITY, entityId: bill.id, fileId: requireUuid(fileId, "File"), actorUserId: context.userId ?? null });
  return { removed: true };
}

export async function readSupplierBillFile(client, context, billId, fileId, options = {}) {
  const bill = await loadBill(client, context, billId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, SUPPLIER_BILL_FILE_ENTITY, bill.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new SupplierBillError(404, "File not found.", "SUPPLIER_BILL_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: SUPPLIER_BILL_FILE_ENTITY, entityId: bill.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

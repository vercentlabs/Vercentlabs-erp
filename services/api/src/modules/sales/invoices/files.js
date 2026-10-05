// Files on an invoice: the customer's acknowledgement, a signed copy, anything
// that supports it; and the PDFs that were emailed. They are internal: the
// invoice PDF never includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requireUuid, text } from "../orders/constants.js";
import { invoiceCan, loadInvoice } from "./access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";
import { INVOICE_FILE_ENTITY } from "./communication.js";
import { recordInvoiceEvent } from "./records.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareInvoiceFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new InvoiceError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "SALES_INVOICE_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

function requireFileWriter(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.edit) && !invoiceCan(context, INVOICE_PERMISSIONS.send))
    throw new InvoiceError(403, "You do not have permission to add files to invoices.", "PERMISSION_DENIED");
}
const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listInvoiceFiles(client, context, invoiceId) {
  const invoice = await loadInvoice(client, context, invoiceId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: INVOICE_FILE_ENTITY, entityId: invoice.id })).map(toFile);
}

export async function uploadInvoiceFile(client, context, invoiceId, input = {}, options = {}) {
  requireFileWriter(context);
  const invoice = await loadInvoice(client, context, invoiceId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: INVOICE_FILE_ENTITY, entityId: invoice.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.file_added", null, null, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeInvoiceFile(client, context, invoiceId, fileId) {
  requireFileWriter(context);
  const invoice = await loadInvoice(client, context, invoiceId);
  const id = requireUuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, INVOICE_FILE_ENTITY, invoice.id, id])).rows[0]?.file_name;
  if (!name) throw new InvoiceError(404, "File not found.", "SALES_INVOICE_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: INVOICE_FILE_ENTITY, entityId: invoice.id, fileId: id, actorUserId: context.userId ?? null });
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.file_removed", null, null, { fileId: id, fileName: name });
  return { removed: true };
}

export async function readInvoiceFile(client, context, invoiceId, fileId, options = {}) {
  const invoice = await loadInvoice(client, context, invoiceId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, INVOICE_FILE_ENTITY, invoice.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new InvoiceError(404, "File not found.", "SALES_INVOICE_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: INVOICE_FILE_ENTITY, entityId: invoice.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

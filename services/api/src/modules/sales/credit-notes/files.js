// Files on a credit note: the customer's claim, photos, the approval, a signed
// copy; and the PDFs that were emailed. They are internal: the credit note
// PDF never includes them.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requireUuid, text } from "../orders/constants.js";
import { creditNoteCan, loadCreditNote, recordCreditNoteEvent } from "./access.js";
import { CREDIT_NOTE_FILE_ENTITY } from "./communication.js";
import { CREDIT_NOTE_PERMISSIONS, CreditNoteError } from "./constants.js";

const TYPES = Object.freeze({
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareCreditNoteFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName) ?? "")?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) throw new CreditNoteError(400, "Upload a PDF, Word, Excel, CSV, text or image file.", "SALES_CREDIT_NOTE_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

function requireFileWriter(context) {
  if (!creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.edit) && !creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.send))
    throw new CreditNoteError(403, "You do not have permission to add files to credit notes.", "PERMISSION_DENIED");
}
const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

export async function listCreditNoteFiles(client, context, creditNoteId) {
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  return (await listFiles(client, { organizationId: context.organizationId, entityType: CREDIT_NOTE_FILE_ENTITY, entityId: creditNote.id })).map(toFile);
}

export async function uploadCreditNoteFile(client, context, creditNoteId, input = {}, options = {}) {
  requireFileWriter(context);
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: CREDIT_NOTE_FILE_ENTITY, entityId: creditNote.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.file_added", null, null, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeCreditNoteFile(client, context, creditNoteId, fileId) {
  requireFileWriter(context);
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  const id = requireUuid(fileId, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, CREDIT_NOTE_FILE_ENTITY, creditNote.id, id])).rows[0]?.file_name;
  if (!name) throw new CreditNoteError(404, "File not found.", "SALES_CREDIT_NOTE_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: CREDIT_NOTE_FILE_ENTITY, entityId: creditNote.id, fileId: id, actorUserId: context.userId ?? null });
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.file_removed", null, null, { fileId: id, fileName: name });
  return { removed: true };
}

export async function readCreditNoteFile(client, context, creditNoteId, fileId, options = {}) {
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, CREDIT_NOTE_FILE_ENTITY, creditNote.id, requireUuid(fileId, "File")]);
  if (!rows[0]) throw new CreditNoteError(404, "File not found.", "SALES_CREDIT_NOTE_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: CREDIT_NOTE_FILE_ENTITY, entityId: creditNote.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

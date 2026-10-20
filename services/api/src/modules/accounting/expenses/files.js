// An expense's evidence: the receipt, the supplier's bill, a boarding pass — a photo or a PDF. Files are added while the expense is being
// prepared (and may still be added after it posts, when the original arrives later); they are removed only before it is submitted, so what
// the approver approved stays with the expense.
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, event, hasPermission, requirePermission, text, uuid } from "../core.js";

export const EXPENSE_FILE_ENTITY = "accounting.expense";
const TYPES = Object.freeze({
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const MAX_BYTES = 10 * 1024 * 1024;
const fail = (status, message, code) => { throw new AccountingError(status, message, code); };

export async function prepareAccountingExpenseFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName, 240))?.[1] ?? "").toLowerCase();
  const mimeType = TYPES[extension];
  if (!mimeType) fail(400, "Upload a photo (JPG, PNG, WEBP, HEIC), a PDF, or a Word or Excel file.", "ACCOUNTING_EXPENSE_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: MAX_BYTES, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}

const toFile = (row) => ({
  id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt,
});

async function loadExpense(client, context, idValue) {
  const row = (await client.query("SELECT id, expense_number, status FROM tenant.accounting_expenses WHERE organization_id = $1 AND id = $2", [context.organizationId, uuid(idValue, "Expense")])).rows[0];
  if (!row) fail(404, "Expense not found.", "ACCOUNTING_EXPENSE_NOT_FOUND");
  return row;
}

export async function evidenceFiles(client, context, expenseId) {
  return (await listFiles(client, { organizationId: context.organizationId, entityType: EXPENSE_FILE_ENTITY, entityId: expenseId })).map(toFile);
}

export async function listAccountingExpenseFiles(client, context, expenseIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const expense = await loadExpense(client, context, expenseIdValue);
  return evidenceFiles(client, context, expense.id);
}

export async function uploadAccountingExpenseFile(client, context, expenseIdValue, input = {}, options = {}) {
  if (!hasPermission(context, ACCOUNTING_PERMISSIONS.payablesManage) && !hasPermission(context, ACCOUNTING_PERMISSIONS.payablesApprove))
    fail(403, "You don't have permission to add files to expenses.", "PERMISSION_DENIED");
  const expense = await loadExpense(client, context, expenseIdValue);
  if (["CANCELLED", "REVERSED"].includes(expense.status)) fail(409, `A ${expense.status.toLowerCase()} expense takes no new files.`, "ACCOUNTING_EXPENSE_STATE_INVALID");
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: EXPENSE_FILE_ENTITY, entityId: expense.id, prepared: input.prepared, uploadedBy: context.userId ?? null }, options);
  await event(client, context, "expense", expense.id, "accounting.expense.file_added", null, null, { fileId: file.id, fileName: file.fileName });
  return toFile(file);
}

export async function removeAccountingExpenseFile(client, context, expenseIdValue, fileIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const expense = await loadExpense(client, context, expenseIdValue);
  if (!["DRAFT", "REJECTED"].includes(expense.status)) fail(409, "Files are removed only before the expense is submitted; what the approver saw stays with it.", "ACCOUNTING_EXPENSE_STATE_INVALID");
  const id = uuid(fileIdValue, "File");
  const name = (await client.query(`SELECT file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, EXPENSE_FILE_ENTITY, expense.id, id])).rows[0]?.file_name;
  if (!name) fail(404, "File not found.", "ACCOUNTING_EXPENSE_FILE_NOT_FOUND");
  await archiveFile(client, { organizationId: context.organizationId, entityType: EXPENSE_FILE_ENTITY, entityId: expense.id, fileId: id, actorUserId: context.userId ?? null });
  await event(client, context, "expense", expense.id, "accounting.expense.file_removed", null, null, { fileId: id, fileName: name });
  return { removed: true };
}

export async function readAccountingExpenseFile(client, context, expenseIdValue, fileIdValue, options = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const expense = await loadExpense(client, context, expenseIdValue);
  const { rows } = await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [context.organizationId, EXPENSE_FILE_ENTITY, expense.id, uuid(fileIdValue, "File")]);
  if (!rows[0]) fail(404, "File not found.", "ACCOUNTING_EXPENSE_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType: EXPENSE_FILE_ENTITY, entityId: expense.id, fileId: rows[0].id }, options);
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, body: content.body };
}

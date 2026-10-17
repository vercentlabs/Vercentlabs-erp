// Projects — Project Expenses, the commands. An expense moves through approval (draft → submitted → approved, or returned, rejected,
// withdrawn); Finance then verifies its documents and tax and recognizes its cost once, against its one source; an employee-paid claim is
// handed to Finance for reimbursement and the payments are recorded there (a payment settles the claim — it is never a second cost); a
// rechargeable amount is handed to Sales and linked to the invoice line it became. Supplier bill lines and goods issues are linked, never
// re-entered. Approved expenses change only through a correction. Nothing here posts to the ledger, pays, moves stock or invoices.
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, isOwner, isoDay, projectEvent, text, userNames, uuid } from "../project-core.js";
import { projectBillingPolicy } from "../billable/billable-rules.js";
import {
  EXPENSE, SOURCE_LABEL, addMoney, categoryOf, cmpMoney, expenseCode, expenseError, expensePolicy, expenseProject, expenseRights, keyOf, money, moneyOut, onTeamOn, projectAcceptsDate,
  subMoney,
} from "./expense-rules.js";

export const EXPENSE_ENTITY = "projects.expense";
const BILL_RECOGNIZED = ["approved", "posted", "partially_paid", "paid", "overdue", "disputed"];
const companyDay = async (client, c) => (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`,
  [c.organizationId])).rows[0].d;

// ------------------------------------------------------------------ loading and history
export async function expenseScope(client, c, expenseId, { lock = false } = {}) {
  let id;
  try { id = uuid(expenseId, "Expense"); } catch { throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND"); }
  const expense = (await client.query(`SELECT * FROM tenant.project_expenses WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!expense) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND");
  let scope;
  try { scope = await expenseProject(client, c, expense.project_id); } catch {
    // Finance reviews across the company, and a claimant always sees their own claim.
    if (!has(c, EXPENSE.finance) && expense.claimant_user_id !== c.userId) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND");
    const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, expense.project_id])).rows[0];
    scope = { project, access: { visible: false, all: false, manager: false, can: {} } };
  }
  const can = expenseRights(c, scope.access, expense);
  if (!can.view) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND");
  return { expense, project: scope.project, access: scope.access, can };
}
async function write(client, c, expense, sets) {
  const columns = ["row_version = row_version + 1", "updated_by = $3", "updated_at = now()"];
  const values = [c.organizationId, expense.id, c.userId ?? null];
  for (const [column, value] of Object.entries(sets)) { values.push(value); columns.push(`${column} = $${values.length}`); }
  return (await client.query(`UPDATE tenant.project_expenses SET ${columns.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`, values)).rows[0];
}
export async function expenseEvent(client, c, expense, action, { from = null, to = null, reason = null, details = {}, key = null } = {}) {
  await client.query(`INSERT INTO tenant.project_expense_events (organization_id, expense_id, project_id, action, from_status, to_status, expense_version, reason, details, actor_user_id, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
  [c.organizationId, expense.id, expense.project_id, action, from, to, expense.row_version, reason, JSON.stringify(details), c.userId ?? null, key]);
}
async function replay(client, c, key) {
  if (!key) return null;
  const row = (await client.query(`SELECT expense_id, to_status, details FROM tenant.project_expense_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  return row ? { expenseId: row.expense_id, status: row.to_status ?? undefined, replayed: true, ...(row.details?.result ?? {}) } : null;
}
async function tell(client, c, userIds, expense, title, message) {
  for (const userId of new Set(userIds.filter(Boolean))) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "project_expense", title, message, href: `/projects/expenses/${expense.id}`, entityType: EXPENSE_ENTITY, entityId: expense.id });
  }
}
const versionCheck = (expense, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(expense.row_version)) throw expenseError(409, "PROJECT_EXPENSE_VERSION_CONFLICT");
};
const periodOpen = async (client, c, day) => {
  const period = (await client.query(`SELECT status, locked_at FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0];
  if (period && (period.locked_at || !["open", "active"].includes(String(period.status).toLowerCase()))) throw expenseError(409, "PROJECT_EXPENSE_PERIOD_CLOSED");
};

// ------------------------------------------------------------------ the fields of a claim
// input: { projectId, taskId?, claimantUserId?, expenseDate, categoryId (or code), description, amount, currency?, exchangeRate?, paymentSource, paymentReference?,
//   supplierInvoiceNumber?, supplierInvoiceDate?, supplierGstin?, taxableAmount?, cgstAmount?, sgstAmount?, igstAmount? }
async function fieldsOf(client, c, input, current = null) {
  const policy = await expensePolicy(client, c);
  const { project, access } = await expenseProject(client, c, input.projectId ?? current?.project_id);
  const can = expenseRights(c, access);
  const claimant = input.claimantUserId ? uuid(input.claimantUserId, "Claimant") : current?.claimant_user_id ?? c.userId;
  if (claimant !== c.userId && !can.createFor) throw expenseError(403, "PROJECT_EXPENSE_CLAIMANT_INVALID");
  const today = await companyDay(client, c);
  let day;
  try { day = isoDay(input.expenseDate ?? current?.expense_date); } catch { throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Enter the date the money was spent.", { field: "expenseDate" }); }
  if (!day) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Enter the date the money was spent.", { field: "expenseDate" });
  if (day > today) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "An expense cannot be dated in the future.", { field: "expenseDate" });
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - policy.deadlineDays * 864e5).toISOString().slice(0, 10);
  if (day < oldest) throw expenseError(409, "PROJECT_EXPENSE_POLICY_EXCEEDED", `Expenses older than ${policy.deadlineDays} days need a correction through Finance.`, { field: "expenseDate" });
  await projectAcceptsDate(client, c, project, day);
  if (!(await onTeamOn(client, c, project, claimant, day))) throw expenseError(403, "PROJECT_EXPENSE_CLAIMANT_INVALID", "The claimant was not on this project's team on that date.", { field: "claimantUserId" });
  let taskId = input.taskId === undefined ? current?.task_id ?? null : input.taskId || null;
  if (taskId) {
    taskId = uuid(taskId, "Task");
    const task = (await client.query(`SELECT project_id FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`, [c.organizationId, taskId])).rows[0];
    if (!task || task.project_id !== project.id) throw expenseError(400, "PROJECT_EXPENSE_TASK_MISMATCH", undefined, { field: "taskId" });
  }
  const category = await categoryOf(client, c, input.categoryId ?? input.categoryCode ?? current?.category_id);
  const description = text(input.description ?? current?.description, 2000);
  if (description.length < (category.description_required ? 10 : 3)) {
    throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", category.description_required ? "Describe what was bought and why (at least 10 characters)." : "Give the business purpose.", { field: "description" });
  }
  const amount = money(input.amount ?? current?.amount, "amount");
  const currency = String(input.currency ?? current?.currency ?? policy.currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose a currency.", { field: "currency" });
  let rate = "1";
  if (currency !== policy.currency) {
    rate = String(input.exchangeRate ?? current?.exchange_rate ?? "").trim();
    if (!/^\d{1,10}(\.\d{1,10})?$/.test(rate) || Number(rate) <= 0) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", `Give the rate to ${policy.currency}.`, { field: "exchangeRate" });
  }
  const source = String(input.paymentSource ?? current?.payment_source ?? "").toUpperCase();
  if (!SOURCE_LABEL[source]) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Say who paid.", { field: "paymentSource" });
  const optionalMoney = (key, field) => {
    const value = input[key] === undefined ? current?.[field] ?? null : input[key];
    return value === null || value === "" ? null : money(value, key, { allowZero: true });
  };
  return {
    project, access, policy, today,
    fields: {
      project_id: project.id, task_id: taskId, claimant_user_id: claimant, expense_date: day, category_id: category.id, description, amount, currency, exchange_rate: rate, base_currency: policy.currency,
      payment_source: source, payment_reference: text(input.paymentReference ?? current?.payment_reference, 200) || null,
      supplier_invoice_number: text(input.supplierInvoiceNumber ?? current?.supplier_invoice_number, 100) || null,
      supplier_invoice_date: input.supplierInvoiceDate === undefined ? current?.supplier_invoice_date ?? null : (input.supplierInvoiceDate ? isoDay(input.supplierInvoiceDate) : null),
      supplier_gstin: text(input.supplierGstin ?? current?.supplier_gstin, 20).toUpperCase() || null,
      taxable_amount: optionalMoney("taxableAmount", "taxable_amount"), cgst_amount: optionalMoney("cgstAmount", "cgst_amount"), sgst_amount: optionalMoney("sgstAmount", "sgst_amount"),
      igst_amount: optionalMoney("igstAmount", "igst_amount"), reimbursable: source === "EMPLOYEE",
    },
    category,
  };
}
// The commercial default: an internal or non-billable project's expense is not billable; a fixed-price one is included in the fee; on
// time-and-materials it waits for an authorized recharge decision.
async function defaultBilling(client, c, project) {
  if (project.classification === "INTERNAL") return "NON_BILLABLE";
  const policy = await projectBillingPolicy(client, c, project);
  if (policy.method === "FIXED_PRICE") return "INCLUDED_IN_FIXED_FEE";
  if (policy.method === "TIME_AND_MATERIALS" || policy.method === "HYBRID") return "ELIGIBILITY_PENDING";
  return "NON_BILLABLE";
}
const billingStatusOf = (classification) => ({ NON_BILLABLE: "NON_BILLABLE", INCLUDED_IN_FIXED_FEE: "INCLUDED_IN_FIXED_FEE", ELIGIBILITY_PENDING: "ELIGIBILITY_PENDING", RECHARGE_ELIGIBLE: "ELIGIBLE_UNBILLED" })[classification];

// ------------------------------------------------------------------ create and edit a draft
export async function createProjectExpense(client, c, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, status, expense_number FROM tenant.project_expenses WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { expenseId: existing.id, code: expenseCode(existing), status: existing.status, replayed: true };
  }
  if (!has(c, EXPENSE.create)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const { project, fields, category, policy } = await fieldsOf(client, c, input);
  const classification = await defaultBilling(client, c, project);
  const row = (await client.query(`INSERT INTO tenant.project_expenses (organization_id, project_id, task_id, claimant_user_id, entered_by, expense_date, category_id, description, amount, currency, exchange_rate,
      base_amount, base_currency, payment_source, payment_reference, supplier_invoice_number, supplier_invoice_date, supplier_gstin, taxable_amount, cgst_amount, sgst_amount, igst_amount, reimbursable,
      reimbursement_status, receipt_required, billing_classification, billing_status, idempotency_key, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::numeric, round($9::numeric * $11::numeric, 2), $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, $23,
       $24 AND round($9::numeric * $11::numeric, 2) > $25::numeric, $26, $27, $28, $5) RETURNING *`,
  [c.organizationId, project.id, fields.task_id, fields.claimant_user_id, c.userId ?? null, fields.expense_date, fields.category_id, fields.description, fields.amount, fields.currency, fields.exchange_rate,
    fields.base_currency, fields.payment_source, fields.payment_reference, fields.supplier_invoice_number, fields.supplier_invoice_date, fields.supplier_gstin, fields.taxable_amount, fields.cgst_amount,
    fields.sgst_amount, fields.igst_amount, fields.reimbursable, fields.reimbursable ? "NOT_REQUESTED" : "NOT_APPLICABLE", category.receipt_required, policy.receiptThreshold, classification,
    billingStatusOf(classification), key])).rows[0];
  await expenseEvent(client, c, row, "CREATED", { to: "DRAFT", details: { amount: row.amount, currency: row.currency } });
  return { expenseId: row.id, code: expenseCode(row), status: row.status, version: row.row_version };
}
export async function updateProjectExpense(client, c, expenseId, input = {}) {
  const { expense } = await expenseScope(client, c, expenseId, { lock: true });
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(expense.status)) throw expenseError(409, expense.status === "APPROVED" ? "PROJECT_EXPENSE_ALREADY_APPROVED" : "PROJECT_EXPENSE_STATUS_INVALID");
  if (!(has(c, EXPENSE.editDraft) && (expense.claimant_user_id === c.userId || expense.entered_by === c.userId))) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  versionCheck(expense, input.expectedVersion);
  const { project, fields, category, policy } = await fieldsOf(client, c, input, expense);
  const changed = Object.keys(fields).filter((column) => String(fields[column] ?? "") !== String(expense[column] instanceof Date ? isoDay(expense[column]) : expense[column] ?? ""));
  if (!changed.length) return { expenseId: expense.id, version: expense.row_version, changed: [] };
  const sets = Object.fromEntries(changed.map((column) => [column, fields[column]]));
  let row = await write(client, c, expense, sets);
  row = (await client.query(`UPDATE tenant.project_expenses SET base_amount = round(amount * exchange_rate, 2), receipt_required = $3 AND round(amount * exchange_rate, 2) > $4::numeric,
      billing_classification = CASE WHEN project_id <> $5 THEN $6 ELSE billing_classification END, billing_status = CASE WHEN project_id <> $5 THEN $7 ELSE billing_status END
     WHERE organization_id = $1 AND id = $2 RETURNING *`,
  [c.organizationId, row.id, category.receipt_required, policy.receiptThreshold, expense.project_id, await defaultBilling(client, c, project), billingStatusOf(await defaultBilling(client, c, project))])).rows[0];
  await expenseEvent(client, c, row, "UPDATED", { details: { changed } });
  return { expenseId: row.id, version: row.row_version, changed };
}

// ------------------------------------------------------------------ receipts
export async function uploadExpenseReceipt(client, c, expenseId, input = {}, options = {}) {
  const { expense, can } = await expenseScope(client, c, expenseId);
  const owner = expense.claimant_user_id === c.userId || expense.entered_by === c.userId;
  if (!((owner && ["DRAFT", "CHANGES_REQUESTED"].includes(expense.status)) || (can.finance && expense.finance_status !== "VERIFIED"))) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: EXPENSE_ENTITY, entityId: expense.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await expenseEvent(client, c, expense, "RECEIPT_ADDED", { details: { fileId: file.id, fileName: file.fileName ?? file.file_name } });
  return { expenseId: expense.id, id: file.id, fileName: file.fileName ?? file.file_name };
}
export async function listExpenseFiles(client, c, expenseId) {
  const { expense } = await expenseScope(client, c, expenseId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: EXPENSE_ENTITY, entityId: expense.id });
  const names = await userNames(client, rows.map((row) => row.uploadedBy));
  return rows.map((row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes ?? 0), uploadedAt: row.createdAt, uploadedBy: names.get(row.uploadedBy) ?? null }));
}
export async function readExpenseFile(client, c, expenseId, fileId, options = {}) {
  const { expense } = await expenseScope(client, c, expenseId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4`,
    [c.organizationId, EXPENSE_ENTITY, String(expense.id), uuid(fileId, "File")])).rows[0];
  if (!row) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: EXPENSE_ENTITY, entityId: expense.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}
// A receipt on a submitted or approved claim is evidence: it stays.
export async function removeExpenseFile(client, c, expenseId, fileId) {
  const { expense } = await expenseScope(client, c, expenseId);
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(expense.status) || !(expense.claimant_user_id === c.userId || expense.entered_by === c.userId)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED", "A receipt on a submitted claim stays with it.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: EXPENSE_ENTITY, entityId: expense.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await expenseEvent(client, c, expense, "RECEIPT_REMOVED", { details: { fileId } });
  return { removed: true };
}
const receiptsOf = async (client, c, expenseId) => (await client.query(`SELECT id, content_sha256 FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND is_current AND lifecycle_status <> 'archived'`,
  [c.organizationId, EXPENSE_ENTITY, String(expenseId)])).rows;
// Similar claims: the same person, day and amount (or the same receipt file) on a claim still alive. A warning to review, never a merge.
export async function duplicatesOf(client, c, expense) {
  const hashes = (await receiptsOf(client, c, expense.id)).map((row) => row.content_sha256).filter(Boolean);
  return (await client.query(`SELECT expense.id, expense.expense_number, expense.amount, expense.currency, to_char(expense.expense_date, 'YYYY-MM-DD') AS expense_date, expense.status, expense.description,
      (expense.claimant_user_id = $3 AND expense.expense_date = $4::date AND expense.amount = $5::numeric) AS same_claim,
      EXISTS (SELECT 1 FROM public.attachments file WHERE file.entity_type = $7 AND file.entity_id = expense.id::text AND file.is_current AND file.content_sha256 = ANY($6::text[])) AS same_receipt
     FROM tenant.project_expenses expense WHERE expense.organization_id = $1 AND expense.id <> $2 AND expense.status NOT IN ('WITHDRAWN', 'REJECTED')
       AND ((expense.claimant_user_id = $3 AND expense.expense_date = $4::date AND expense.amount = $5::numeric)
         OR EXISTS (SELECT 1 FROM public.attachments file WHERE file.entity_type = $7 AND file.entity_id = expense.id::text AND file.is_current AND file.content_sha256 = ANY($6::text[])))
     ORDER BY expense.created_at LIMIT 10`, [c.organizationId, expense.id, expense.claimant_user_id, isoDay(expense.expense_date), expense.amount, hashes, EXPENSE_ENTITY])).rows
    .map((row) => ({ id: row.id, code: expenseCode(row), amount: moneyOut(row.amount), currency: row.currency, expenseDate: row.expense_date, status: row.status, description: row.description,
      reason: row.same_receipt ? "Same receipt file" : "Same person, date and amount" }));
}

// ------------------------------------------------------------------ submit, withdraw
// input: { expectedVersion?, duplicateReviewed?, receiptExceptionReason?, idempotencyKey? }
export async function submitProjectExpense(client, c, expenseId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { expense, project, access } = await expenseScope(client, c, expenseId, { lock: true });
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(expense.status)) throw expenseError(409, expense.status === "APPROVED" ? "PROJECT_EXPENSE_ALREADY_APPROVED" : "PROJECT_EXPENSE_STATUS_INVALID");
  if (!(has(c, EXPENSE.submit) && (expense.claimant_user_id === c.userId || expense.entered_by === c.userId))) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  versionCheck(expense, input.expectedVersion);
  await projectAcceptsDate(client, c, project, isoDay(expense.expense_date));
  const policy = await expensePolicy(client, c);
  const receipts = await receiptsOf(client, c, expense.id);
  const exception = text(input.receiptExceptionReason ?? expense.receipt_exception_reason, 1000) || null;
  if (expense.receipt_required && !receipts.length && !(exception && exception.length >= 5)) throw expenseError(400, "PROJECT_EXPENSE_RECEIPT_REQUIRED", undefined, { field: "receipt" });
  if (expense.payment_source === "COMPANY" && !expense.payment_reference) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Give the card or bank reference of the company payment.", { field: "paymentReference" });
  const duplicates = await duplicatesOf(client, c, expense);
  if (duplicates.length && !input.duplicateReviewed && !expense.duplicate_reviewed) throw expenseError(409, "PROJECT_EXPENSE_DUPLICATE_SUSPECTED", undefined, { duplicates });
  const overLimit = Boolean(policy.managerLimit) && cmpMoney(expense.base_amount, policy.managerLimit) > 0;
  const row = await write(client, c, expense, { status: "SUBMITTED", submitted_at: new Date(), submitted_by: c.userId ?? null, over_limit: overLimit,
    duplicate_reviewed: Boolean(input.duplicateReviewed || expense.duplicate_reviewed), receipt_exception_reason: receipts.length ? null : exception,
    receipt_exception_by: null, receipt_exception_at: null, finance_status: expense.finance_status === "RETURNED" ? "NOT_REVIEWED" : expense.finance_status });
  const final = (await client.query(`UPDATE tenant.project_expenses SET submitted_version = row_version WHERE id = $1 RETURNING *`, [row.id])).rows[0];
  await expenseEvent(client, c, final, expense.status === "CHANGES_REQUESTED" ? "RESUBMITTED" : "SUBMITTED", { from: expense.status, to: "SUBMITTED", key: keyOf(input),
    details: { duplicates: duplicates.map((x) => x.id), overLimit, receiptException: Boolean(exception && !receipts.length) } });
  const who = (await userNames(client, [expense.claimant_user_id])).get(expense.claimant_user_id) ?? "Someone";
  await tell(client, c, [project.manager_user_id === expense.claimant_user_id ? null : project.manager_user_id], final, `${expenseCode(final)} waits for your approval`,
    `${who}: ${final.description} — ${final.currency} ${moneyOut(final.amount)} on ${project.project_code}${overLimit ? " (above the manager's limit)" : ""}.`);
  void access;
  return { expenseId: final.id, status: "SUBMITTED", version: final.row_version, overLimit, duplicates };
}
export async function withdrawProjectExpense(client, c, expenseId, input = {}) {
  const { expense } = await expenseScope(client, c, expenseId, { lock: true });
  if (expense.status === "WITHDRAWN") return { expenseId: expense.id, status: "WITHDRAWN", replayed: true };
  if (!["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"].includes(expense.status)) throw expenseError(409, expense.status === "APPROVED" ? "PROJECT_EXPENSE_ALREADY_APPROVED" : "PROJECT_EXPENSE_STATUS_INVALID");
  if (!(expense.claimant_user_id === c.userId || expense.entered_by === c.userId)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const reason = text(input.reason, 500) || null;
  const row = await write(client, c, expense, { status: "WITHDRAWN", withdrawn_reason: reason });
  await expenseEvent(client, c, row, "WITHDRAWN", { from: expense.status, to: "WITHDRAWN", reason });
  return { expenseId: row.id, status: "WITHDRAWN" };
}

// ------------------------------------------------------------------ approval
// input: { expectedVersion, acceptMissingReceipt?, note?, billing?: { classification, rechargeAmount, salesOrderLineId }, idempotencyKey? }
export async function approveProjectExpense(client, c, expenseId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { expense, project, access, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (expense.status !== "SUBMITTED") throw expenseError(409, expense.status === "APPROVED" ? "PROJECT_EXPENSE_ALREADY_APPROVED" : "PROJECT_EXPENSE_STATUS_INVALID");
  if (can.mine) throw expenseError(403, "PROJECT_EXPENSE_SELF_APPROVAL");
  if (!can.approve) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  versionCheck(expense, input.expectedVersion);
  // Above the manager's limit, the approval is the business owner's (or a system administrator's), not the project's.
  if (expense.over_limit && !isOwner(c)) throw expenseError(403, "PROJECT_EXPENSE_POLICY_EXCEEDED");
  const missingReceipt = expense.receipt_required && !(await receiptsOf(client, c, expense.id)).length;
  if (missingReceipt && !input.acceptMissingReceipt) throw expenseError(400, "PROJECT_EXPENSE_RECEIPT_REQUIRED", "The receipt is missing: accept the stated exception explicitly, or return the claim.", { exception: expense.receipt_exception_reason });
  const policy = await expensePolicy(client, c);
  let row = await write(client, c, expense, { status: "APPROVED", approved_at: new Date(), approved_by: c.userId ?? null, approved_version: expense.row_version,
    ...(missingReceipt ? { receipt_exception_by: c.userId ?? null, receipt_exception_at: new Date() } : {}) });
  if (input.billing) row = await applyBilling(client, c, row, project, input.billing);
  await expenseEvent(client, c, row, "APPROVED", { from: "SUBMITTED", to: "APPROVED", reason: text(input.note, 1000) || null, key: keyOf(input),
    details: { missingReceiptAccepted: missingReceipt, approvedVersion: expense.row_version } });
  // Without a Finance review, approval recognizes the claimed amount as the cost basis.
  if (!policy.financeReviewRequired && expense.payment_source !== "SUPPLIER") row = await recognize(client, c, row, { taxTreatment: "PENDING", costBasis: row.base_amount, day: await companyDay(client, c) });
  await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)} approved`, policy.financeReviewRequired ? "Finance verifies it next." : "It is recorded as project cost.");
  void access;
  return { expenseId: row.id, status: "APPROVED", version: row.row_version, financeReview: policy.financeReviewRequired };
}
export async function requestExpenseChanges(client, c, expenseId, input = {}) {
  return decide(client, c, expenseId, input, "CHANGES_REQUESTED", "CHANGES_REQUESTED", "returned for changes");
}
export async function rejectProjectExpense(client, c, expenseId, input = {}) {
  return decide(client, c, expenseId, input, "REJECTED", "REJECTED", "rejected");
}
async function decide(client, c, expenseId, input, to, action, words) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { expense, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (expense.status !== "SUBMITTED") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID");
  if (can.mine) throw expenseError(403, "PROJECT_EXPENSE_SELF_APPROVAL");
  if (!can.approve) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  versionCheck(expense, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Say why.", { field: "reason" });
  const row = await write(client, c, expense, { status: to });
  await expenseEvent(client, c, row, action, { from: "SUBMITTED", to, reason, key: keyOf(input) });
  await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)} ${words}`, reason);
  return { expenseId: row.id, status: to, version: row.row_version };
}

// ------------------------------------------------------------------ the recharge decision
// input: { classification: NON_BILLABLE | INCLUDED_IN_FIXED_FEE | RECHARGE_ELIGIBLE | ELIGIBILITY_PENDING, rechargeAmount?, salesOrderLineId?, reason? }
// A recharge rests on an authorized sales order line of the project's customer; an internal project never recharges; a fixed-price
// project's expense is included in the fee unless a line explicitly authorizes the recharge. The internal cost never changes.
async function applyBilling(client, c, expense, project, input) {
  const classification = String(input.classification ?? "").toUpperCase();
  if (!billingStatusOf(classification)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose how this expense is billed.", { field: "classification" });
  const live = (await client.query(`SELECT 1 FROM tenant.project_expense_billing_allocations WHERE expense_id = $1 AND status <> 'RELEASED'`, [expense.id])).rows[0];
  if (live) throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED");
  let recharge = null;
  let line = null;
  if (classification === "RECHARGE_ELIGIBLE") {
    if (project.classification === "INTERNAL") throw expenseError(409, "PROJECT_EXPENSE_INPUT_INVALID", "An internal project's expenses are not charged to a customer.", { field: "classification" });
    recharge = input.rechargeAmount === undefined || input.rechargeAmount === null || input.rechargeAmount === "" ? moneyOut(expense.base_amount) : money(input.rechargeAmount, "rechargeAmount");
    if (cmpMoney(recharge, expense.base_amount) > 0) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "The recharge cannot exceed the expense.", { field: "rechargeAmount" });
    if (!input.salesOrderLineId) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose the sales order line that authorizes the recharge.", { field: "salesOrderLineId" });
    line = (await client.query(`SELECT line.id FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
        JOIN tenant.sales_orders sales_order ON sales_order.id = version.sales_order_id AND sales_order.current_version_id = version.id
       WHERE line.organization_id = $1 AND line.id = $2 AND sales_order.party_id = $3 AND sales_order.lifecycle_status NOT IN ('draft', 'cancelled')
         AND EXISTS (SELECT 1 FROM tenant.project_links link WHERE link.project_id = $4 AND link.source_type = 'SALES_ORDER' AND link.source_id = sales_order.id AND link.removed_at IS NULL)`,
    [c.organizationId, uuid(input.salesOrderLineId, "Sales order line"), project.customer_id, project.id])).rows[0];
    if (!line) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "The recharge needs a confirmed sales order line of this project's customer, linked to the project.", { field: "salesOrderLineId" });
  }
  if (classification === "INCLUDED_IN_FIXED_FEE" && project.classification === "INTERNAL") throw expenseError(409, "PROJECT_EXPENSE_INPUT_INVALID", "An internal project has no customer fee.");
  const row = await write(client, c, expense, { billing_classification: classification, billing_status: billingStatusOf(classification), recharge_amount: recharge, recharge_sales_order_line_id: line?.id ?? null,
    billing_decided_by: c.userId ?? null, billing_decided_at: new Date() });
  await expenseEvent(client, c, row, "BILLING_DECIDED", { reason: text(input.reason, 500) || null, details: { classification, recharge } });
  return row;
}
export async function setExpenseBilling(client, c, expenseId, input = {}) {
  const { expense, project, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (!(can.lead && has(c, EXPENSE.approve)) && !can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (["REJECTED", "WITHDRAWN"].includes(expense.status)) throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID");
  if (expense.billing_status === "INVOICED") throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED", "This expense was invoiced: change it through a correction with Sales.");
  versionCheck(expense, input.expectedVersion);
  const row = await applyBilling(client, c, expense, project, input);
  return { expenseId: row.id, classification: row.billing_classification, billingStatus: row.billing_status, rechargeAmount: moneyOut(row.recharge_amount), version: row.row_version };
}

// ------------------------------------------------------------------ Finance
// The cost is recognized once, against its one source, at the cost basis Finance decided.
async function recognize(client, c, expense, { taxTreatment, costBasis, day, note = null, billLine = null }) {
  await periodOpen(client, c, day);
  const source = billLine ? { module: "SUPPLIER_BILL", id: billLine.vendor_bill_id, line: billLine.id } : { module: "EXPENSE_CLAIM", id: expense.id, line: null };
  try {
    await client.query("SAVEPOINT expense_allocation");
    await client.query(`INSERT INTO tenant.project_expense_cost_allocations (organization_id, project_id, task_id, expense_id, category_id, source_module, source_id, source_line_id, amount, currency, recognition_date,
        source_version, status, command_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::date,$12,$13,$14,$15)`,
    [c.organizationId, expense.project_id, expense.task_id, expense.id, expense.category_id, source.module, source.id, source.line, costBasis, expense.base_currency, day, String(expense.row_version),
      billLine && !BILL_RECOGNIZED.includes(billLine.bill_status) ? "PENDING" : "RECOGNIZED", `expense:${expense.id}:v${expense.row_version}`, c.userId ?? null]);
    await client.query("RELEASE SAVEPOINT expense_allocation");
  } catch (failure) {
    await client.query("ROLLBACK TO SAVEPOINT expense_allocation");
    if (failure?.code === "23505") throw expenseError(409, "PROJECT_EXPENSE_SOURCE_ALREADY_ALLOCATED");
    throw failure;
  }
  const reimburse = expense.reimbursable && expense.payment_source === "EMPLOYEE";
  if (reimburse) {
    await client.query(`INSERT INTO tenant.project_expense_reimbursements (organization_id, expense_id, claimant_user_id, amount, currency, requested_by) VALUES ($1,$2,$3,$4::numeric,$5,$6)
        ON CONFLICT DO NOTHING`, [c.organizationId, expense.id, expense.claimant_user_id, expense.base_amount, expense.base_currency, c.userId ?? null]);
  }
  const row = await write(client, c, expense, { finance_status: "VERIFIED", tax_treatment: taxTreatment, cost_basis: costBasis, finance_note: note, finance_reviewed_by: c.userId ?? null,
    finance_reviewed_at: new Date(), recognition_date: day, ...(reimburse ? { reimbursement_status: "PENDING_PAYMENT" } : {}),
    ...(expense.billing_classification === "RECHARGE_ELIGIBLE" && expense.billing_status === "ELIGIBILITY_PENDING" ? { billing_status: "ELIGIBLE_UNBILLED" } : {}) });
  await expenseEvent(client, c, row, "COST_RECOGNIZED", { details: { amount: costBasis, source: source.module, taxTreatment, reimbursement: reimburse } });
  return row;
}
const loadBillLine = async (client, c, lineId) => (await client.query(`SELECT line.id, line.vendor_bill_id, line.net_amount, line.tax_amount, line.withholding_amount, line.description, bill.status AS bill_status,
    bill.party_id, bill.bill_number, bill.currency_code, bill.supplier_invoice_number, bill.bill_date
   FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE line.organization_id = $1 AND line.id = $2`,
[c.organizationId, uuid(lineId, "Supplier bill line")])).rows[0];
// What is left of a bill line to allocate (to any project).
const lineRemaining = async (client, c, line, exceptExpenseId = null) => {
  const used = (await client.query(`SELECT COALESCE(sum(amount), 0) AS used FROM tenant.project_expense_cost_allocations WHERE organization_id = $1 AND source_module = 'SUPPLIER_BILL' AND source_line_id = $2
      AND status <> 'REVERSED' AND ($3::uuid IS NULL OR expense_id IS DISTINCT FROM $3)`, [c.organizationId, line.id, exceptExpenseId])).rows[0].used;
  return subMoney(line.net_amount, used);
};
// input: { decision: VERIFY | RETURN, taxTreatment?, costBasis?, recognitionDate?, note?, vendorBillLineId? (a supplier-billed expense), expectedVersion?, idempotencyKey? }
// Finance decides the tax treatment (recoverable GST is not project cost; TDS never reduces it) and recognizes the cost.
export async function reviewExpenseForFinance(client, c, expenseId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { expense, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (!can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (expense.status !== "APPROVED" || expense.finance_status === "VERIFIED") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID", expense.finance_status === "VERIFIED" ? "Finance already verified this expense." : "Finance reviews approved expenses.");
  if (expense.claimant_user_id === c.userId) throw expenseError(403, "PROJECT_EXPENSE_SELF_APPROVAL", "Someone else in Finance must verify your own expense.");
  versionCheck(expense, input.expectedVersion);
  const decision = String(input.decision ?? "VERIFY").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "RETURN") {
    if (!note || note.length < 3) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Say what Finance needs.", { field: "note" });
    const row = await write(client, c, expense, { status: "CHANGES_REQUESTED", finance_status: "RETURNED", finance_note: note });
    await expenseEvent(client, c, row, "FINANCE_RETURNED", { from: "APPROVED", to: "CHANGES_REQUESTED", reason: note, key: keyOf(input) });
    await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)} returned by Finance`, note);
    return { expenseId: row.id, status: row.status, financeStatus: row.finance_status };
  }
  const treatment = String(input.taxTreatment ?? "").toUpperCase();
  if (!["NO_TAX", "RECOVERABLE", "NON_RECOVERABLE"].includes(treatment)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Decide the GST treatment.", { field: "taxTreatment" });
  let billLine = null;
  if (expense.payment_source === "SUPPLIER") {
    if (!input.vendorBillLineId && !expense.vendor_bill_line_id) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Link the supplier bill line this expense rests on.", { field: "vendorBillLineId" });
    billLine = await loadBillLine(client, c, input.vendorBillLineId ?? expense.vendor_bill_line_id);
    if (!billLine || ["cancelled", "reversed"].includes(billLine.bill_status)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "That supplier bill line is not available.", { field: "vendorBillLineId" });
    await client.query(`UPDATE tenant.project_expenses SET vendor_bill_id = $2, vendor_bill_line_id = $3, supplier_id = $4 WHERE id = $1`, [expense.id, billLine.vendor_bill_id, billLine.id, billLine.party_id]);
  }
  // Recoverable GST stays out of the cost: the taxable value is the basis. Otherwise the whole amount, unless Finance gives the basis.
  let basis;
  if (input.costBasis !== undefined && input.costBasis !== null && input.costBasis !== "") basis = money(input.costBasis, "costBasis");
  else if (treatment === "RECOVERABLE") {
    if (!expense.taxable_amount) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Give the taxable value: recoverable GST is not project cost.", { field: "costBasis" });
    basis = moneyOut(expense.taxable_amount);
  } else basis = moneyOut(expense.base_amount);
  if (cmpMoney(basis, expense.base_amount) > 0) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "The cost basis cannot exceed the expense.", { field: "costBasis" });
  if (billLine && cmpMoney(basis, await lineRemaining(client, c, billLine, expense.id)) > 0) throw expenseError(409, "PROJECT_EXPENSE_SOURCE_ALREADY_ALLOCATED");
  const day = input.recognitionDate ? isoDay(input.recognitionDate) : await companyDay(client, c);
  const fresh = (await client.query(`SELECT * FROM tenant.project_expenses WHERE id = $1`, [expense.id])).rows[0];
  const row = await recognize(client, c, fresh, { taxTreatment: treatment, costBasis: basis, day, note, billLine });
  await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)} verified by Finance`, row.reimbursable ? "It waits for reimbursement." : "It is recorded as project cost.");
  return { expenseId: row.id, financeStatus: row.finance_status, costBasis: moneyOut(row.cost_basis), reimbursementStatus: row.reimbursement_status };
}

// A supplier bill line already in Finance, allocated to a project (never re-entered as a claim). input: { vendorBillLineId, amount, categoryId, taskId?, description?, idempotencyKey? }
export async function linkSupplierBillToProject(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, status, expense_number FROM tenant.project_expenses WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { expenseId: existing.id, code: expenseCode(existing), replayed: true };
  }
  const { project, access } = await expenseProject(client, c, projectId);
  const can = expenseRights(c, access);
  if (!can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (project.status === "DRAFT") throw expenseError(409, "PROJECT_EXPENSE_PROJECT_CLOSED");
  const line = await loadBillLine(client, c, input.vendorBillLineId);
  if (!line || ["cancelled", "reversed", "draft"].includes(line.bill_status)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose a line of a submitted supplier bill.", { field: "vendorBillLineId" });
  await client.query(`SELECT id FROM tenant.accounting_vendor_bill_lines WHERE id = $1 FOR UPDATE`, [line.id]);
  if (line.currency_code && line.currency_code.trim().toUpperCase() !== (await expensePolicy(client, c)).currency) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "A foreign-currency supplier bill is allocated by Finance in the company currency.", { field: "vendorBillLineId" });
  const amount = input.amount ? money(input.amount, "amount") : moneyOut(line.net_amount);
  if (cmpMoney(amount, await lineRemaining(client, c, line)) > 0) throw expenseError(409, "PROJECT_EXPENSE_SOURCE_ALREADY_ALLOCATED", "This bill line is already allocated (in full or in part).");
  const category = await categoryOf(client, c, input.categoryId ?? "SUBCONTRACTOR");
  const policy = await expensePolicy(client, c);
  const taskId = input.taskId ? uuid(input.taskId, "Task") : null;
  if (taskId && !(await client.query(`SELECT 1 FROM tenant.project_tasks WHERE id = $1 AND project_id = $2`, [taskId, project.id])).rows[0]) throw expenseError(400, "PROJECT_EXPENSE_TASK_MISMATCH");
  const day = await companyDay(client, c);
  const description = text(input.description, 2000) || `${line.bill_number}${line.supplier_invoice_number ? ` (${line.supplier_invoice_number})` : ""}: ${line.description ?? "supplier bill line"}`;
  const row = (await client.query(`INSERT INTO tenant.project_expenses (organization_id, project_id, task_id, claimant_user_id, entered_by, expense_date, category_id, description, amount, currency, exchange_rate,
      base_amount, base_currency, payment_source, vendor_bill_id, vendor_bill_line_id, supplier_id, supplier_invoice_number, supplier_invoice_date, taxable_amount, reimbursable, reimbursement_status,
      receipt_required, status, submitted_at, submitted_by, approved_at, approved_by, billing_classification, billing_status, idempotency_key, updated_by)
     VALUES ($1,$2,$3,$4,$4,$5::date,$6,$7,$8::numeric,$9,1,$8::numeric,$10,'SUPPLIER',$11,$12,$13,$14,$15,$8::numeric,false,'NOT_APPLICABLE',false,'APPROVED',now(),$4,now(),$4,$16,$17,$18,$4) RETURNING *`,
  [c.organizationId, project.id, taskId, c.userId, line.bill_date ? isoDay(line.bill_date) : day, category.id, description, amount, policy.currency, policy.currency, line.vendor_bill_id, line.id,
    line.party_id, line.supplier_invoice_number, line.bill_date ? isoDay(line.bill_date) : null, await defaultBilling(client, c, project), billingStatusOf(await defaultBilling(client, c, project)), key])).rows[0];
  await expenseEvent(client, c, row, "SUPPLIER_BILL_LINKED", { to: "APPROVED", details: { vendorBillId: line.vendor_bill_id, lineId: line.id, amount } });
  // The supplier bill's GST and TDS are Finance's: the project carries the line's net value.
  const recognized = await recognize(client, c, row, { taxTreatment: "PENDING", costBasis: amount, day, billLine: line });
  return { expenseId: recognized.id, code: expenseCode(recognized), amount, recognized: BILL_RECOGNIZED.includes(line.bill_status) };
}
// A posted goods issue to the project: its inventory value becomes project cost (Inventory owns the quantity and the valuation).
// input: { goodsIssueId, categoryId?, taskId?, idempotencyKey? }
export async function linkGoodsIssueToProject(client, c, projectId, input = {}) {
  const { project, access } = await expenseProject(client, c, projectId);
  const can = expenseRights(c, access);
  if (!can.finance && !(can.lead && has(c, EXPENSE.approve))) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const issue = (await client.query(`SELECT * FROM tenant.goods_issues WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.goodsIssueId, "Goods issue")])).rows[0];
  if (!issue || issue.status !== "posted") throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose a posted goods issue.", { field: "goodsIssueId" });
  if (issue.issue_to_type !== "project" || issue.project_id !== project.id) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "That goods issue was not issued to this project.", { field: "goodsIssueId" });
  // Inventory's own figure for the issue (its valuation), never a value typed in here.
  const value = issue.issued_value !== null && issue.issued_value !== undefined ? { value: moneyOut(Number(issue.issued_value).toFixed(2)), currency: null }
    : (await client.query(`SELECT COALESCE(-sum(entry.value_delta), 0)::numeric(18,2) AS value, max(entry.base_currency) AS currency FROM tenant.goods_issue_lines line
      JOIN tenant.inventory_valuation_entries entry ON entry.movement_id = ANY(line.movement_ids) AND entry.reversal_of_id IS NULL
     WHERE line.organization_id = $1 AND line.goods_issue_id = $2`, [c.organizationId, issue.id])).rows[0];
  if (!value || cmpMoney(value.value, "0") <= 0) throw expenseError(409, "PROJECT_EXPENSE_INPUT_INVALID", "This goods issue has no inventory value recorded yet.");
  const category = await categoryOf(client, c, input.categoryId ?? "PROJECT_SUPPLIES");
  const policy = await expensePolicy(client, c);
  try {
    await client.query("SAVEPOINT goods_issue_allocation");
    await client.query(`INSERT INTO tenant.project_expense_cost_allocations (organization_id, project_id, task_id, category_id, source_module, source_id, amount, currency, recognition_date, status, command_id, created_by)
        VALUES ($1,$2,$3,$4,'GOODS_ISSUE',$5,$6::numeric,$7,$8::date,'RECOGNIZED',$9,$10)`,
    [c.organizationId, project.id, input.taskId ? uuid(input.taskId, "Task") : null, category.id, issue.id, value.value, value.currency ?? policy.currency, isoDay(issue.issue_date ?? issue.posted_at ?? new Date()),
      keyOf(input), c.userId ?? null]);
    await client.query("RELEASE SAVEPOINT goods_issue_allocation");
  } catch (failure) {
    await client.query("ROLLBACK TO SAVEPOINT goods_issue_allocation");
    if (failure?.code === "23505") throw expenseError(409, "PROJECT_EXPENSE_SOURCE_ALREADY_ALLOCATED");
    throw failure;
  }
  await projectEvent(client, c, project.id, "MATERIAL_COST_LINKED", `Material cost ${value.value} from goods issue ${issue.document_number ?? issue.id}`);
  return { projectId: project.id, amount: moneyOut(value.value) };
}

// ------------------------------------------------------------------ reimbursement (Finance records what it paid)
// input: { amount, paidOn, reference, commandId? }. The payment settles the claim; it is never another cost.
export async function recordExpenseReimbursement(client, c, expenseId, input = {}) {
  const { expense, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (!can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const command = text(input.commandId, 200) || null;
  if (command && (await client.query(`SELECT 1 FROM tenant.project_expense_reimbursement_payments WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, command])).rows[0]) {
    return { expenseId: expense.id, reimbursementStatus: expense.reimbursement_status, replayed: true };
  }
  const claim = (await client.query(`SELECT * FROM tenant.project_expense_reimbursements WHERE expense_id = $1 AND status <> 'CANCELLED' FOR UPDATE`, [expense.id])).rows[0];
  if (!claim || !["PENDING_PAYMENT", "PARTIALLY_PAID"].includes(claim.status)) throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID", "There is no reimbursement waiting for payment.");
  const amount = money(input.amount, "amount");
  const left = subMoney(claim.amount, claim.paid_amount);
  if (cmpMoney(amount, left) > 0) throw expenseError(400, "PROJECT_EXPENSE_AMOUNT_INVALID", `At most ${left} is still owed.`, { field: "amount" });
  const reference = text(input.reference, 200);
  if (reference.length < 2) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Give the payment reference.", { field: "reference" });
  const paidOn = input.paidOn ? isoDay(input.paidOn) : await companyDay(client, c);
  await client.query(`INSERT INTO tenant.project_expense_reimbursement_payments (organization_id, reimbursement_id, amount, paid_on, reference, recorded_by, command_id) VALUES ($1,$2,$3::numeric,$4::date,$5,$6,$7)`,
    [c.organizationId, claim.id, amount, paidOn, reference, c.userId ?? null, command]);
  const paid = addMoney(claim.paid_amount, amount);
  const status = cmpMoney(paid, claim.amount) >= 0 ? "PAID" : "PARTIALLY_PAID";
  await client.query(`UPDATE tenant.project_expense_reimbursements SET paid_amount = $2::numeric, status = $3 WHERE id = $1`, [claim.id, paid, status]);
  const row = await write(client, c, expense, { reimbursement_status: status });
  await expenseEvent(client, c, row, "REIMBURSEMENT_PAID", { details: { amount, paid, reference, paidOn } });
  await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)}: ${status === "PAID" ? "reimbursed" : "partly reimbursed"}`, `${row.base_currency} ${amount} paid on ${paidOn} (${reference}).`);
  return { expenseId: row.id, reimbursementStatus: status, paidAmount: paid };
}

// ------------------------------------------------------------------ recharge to Sales
// input: { expenseIds, note?, idempotencyKey? } — approved, cost-recognized, rechargeable expenses of one project, not yet in a recharge.
export async function createExpenseRechargeRequest(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, request_number FROM tenant.project_expense_billing_requests WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { requestId: existing.id, replayed: true };
  }
  const { project, access } = await expenseProject(client, c, projectId);
  const can = expenseRights(c, access);
  if (!(can.lead && has(c, EXPENSE.viewBilling)) && !can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const ids = [...new Set((Array.isArray(input.expenseIds) ? input.expenseIds : []).map((id) => uuid(id, "Expense")))];
  if (!ids.length) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose the expenses to recharge.", { field: "expenseIds" });
  const rows = (await client.query(`SELECT * FROM tenant.project_expenses WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`, [c.organizationId, ids])).rows;
  if (rows.length !== ids.length) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND");
  for (const row of rows) {
    if (row.project_id !== project.id) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Every expense must be of this project.");
    if (row.status !== "APPROVED" || row.finance_status !== "VERIFIED") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID", `${expenseCode(row)} is not an approved, recognized expense yet.`);
    if (row.billing_classification !== "RECHARGE_ELIGIBLE" || row.billing_status !== "ELIGIBLE_UNBILLED" || !row.recharge_amount) throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED", `${expenseCode(row)} is not open for a recharge.`);
  }
  const currency = rows[0].base_currency;
  const total = addMoney(...rows.map((row) => row.recharge_amount));
  const request = (await client.query(`INSERT INTO tenant.project_expense_billing_requests (organization_id, project_id, customer_id, total_amount, currency, note, created_by, idempotency_key)
      VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8) RETURNING *`, [c.organizationId, project.id, project.customer_id, total, currency, text(input.note, 1000) || null, c.userId ?? null, key])).rows[0];
  for (const row of rows) {
    try {
      await client.query("SAVEPOINT recharge_allocation");
      await client.query(`INSERT INTO tenant.project_expense_billing_allocations (organization_id, request_id, expense_id, amount) VALUES ($1,$2,$3,$4::numeric)`, [c.organizationId, request.id, row.id, row.recharge_amount]);
      await client.query("RELEASE SAVEPOINT recharge_allocation");
    } catch (failure) {
      await client.query("ROLLBACK TO SAVEPOINT recharge_allocation");
      if (failure?.code === "23505") throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED");
      throw failure;
    }
    const updated = await write(client, c, row, { billing_status: "RESERVED_FOR_BILLING" });
    await expenseEvent(client, c, updated, "RECHARGE_REQUESTED", { details: { requestId: request.id, amount: row.recharge_amount } });
  }
  await projectEvent(client, c, project.id, "EXPENSE_RECHARGE_REQUESTED", `Expense recharge ER-${request.request_number}: ${currency} ${total} for ${rows.length} expense(s)`);
  return { requestId: request.id, number: `ER-${request.request_number}`, total, currency };
}
async function loadRequest(client, c, requestId) {
  const request = (await client.query(`SELECT * FROM tenant.project_expense_billing_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(requestId, "Recharge request")])).rows[0];
  if (!request) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND", "Recharge request not found.");
  return request;
}
export async function cancelExpenseRechargeRequest(client, c, requestId, input = {}) {
  const request = await loadRequest(client, c, requestId);
  const { access } = await expenseProject(client, c, request.project_id);
  const can = expenseRights(c, access);
  if (!(can.lead && has(c, EXPENSE.viewBilling)) && !can.finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (request.status === "CANCELLED") return { requestId: request.id, status: "CANCELLED", replayed: true };
  if (request.status !== "SUBMITTED") throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED", "An invoiced recharge is changed through a credit with Sales.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Say why.", { field: "reason" });
  await client.query(`UPDATE tenant.project_expense_billing_requests SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = clock_timestamp(), cancel_reason = $3, row_version = row_version + 1 WHERE id = $1`,
    [request.id, c.userId ?? null, reason]);
  const released = (await client.query(`UPDATE tenant.project_expense_billing_allocations SET status = 'RELEASED', released_at = clock_timestamp(), release_reason = $2 WHERE request_id = $1 AND status = 'RESERVED' RETURNING expense_id`,
    [request.id, reason])).rows;
  for (const { expense_id: id } of released) {
    const row = (await client.query(`SELECT * FROM tenant.project_expenses WHERE id = $1`, [id])).rows[0];
    const updated = await write(client, c, row, { billing_status: "ELIGIBLE_UNBILLED" });
    await expenseEvent(client, c, updated, "RECHARGE_RELEASED", { reason, details: { requestId: request.id } });
  }
  return { requestId: request.id, status: "CANCELLED" };
}
// Sales records the customer invoice line the recharge became. input: { customerInvoiceLineId }
export async function recordExpenseRechargeInvoiced(client, c, requestId, input = {}) {
  const request = await loadRequest(client, c, requestId);
  if (!has(c, "sales.invoice.create")) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (request.status === "INVOICED") return { requestId: request.id, status: "INVOICED", replayed: true };
  if (request.status !== "SUBMITTED") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID");
  const line = (await client.query(`SELECT line.id, line.customer_invoice_id FROM tenant.accounting_customer_invoice_lines line JOIN tenant.accounting_customer_invoices invoice ON invoice.id = line.customer_invoice_id
     WHERE line.organization_id = $1 AND line.id = $2 AND invoice.party_id = $3 AND invoice.status NOT IN ('draft', 'pending_approval', 'cancelled', 'reversed')`,
  [c.organizationId, uuid(input.customerInvoiceLineId, "Invoice line"), request.customer_id])).rows[0];
  if (!line) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose an issued invoice line of this project's customer.", { field: "customerInvoiceLineId" });
  const used = (await client.query(`SELECT 1 FROM tenant.project_expense_billing_requests WHERE customer_invoice_line_id = $1 AND status = 'INVOICED' AND id <> $2`, [line.id, request.id])).rows[0];
  if (used) throw expenseError(409, "PROJECT_EXPENSE_BILLING_ALLOCATED", "That invoice line already carries another recharge.");
  await client.query(`UPDATE tenant.project_expense_billing_requests SET status = 'INVOICED', customer_invoice_id = $2, customer_invoice_line_id = $3, invoiced_by = $4, invoiced_at = clock_timestamp(),
      row_version = row_version + 1 WHERE id = $1`, [request.id, line.customer_invoice_id, line.id, c.userId ?? null]);
  const invoiced = (await client.query(`UPDATE tenant.project_expense_billing_allocations SET status = 'INVOICED' WHERE request_id = $1 AND status = 'RESERVED' RETURNING expense_id`, [request.id])).rows;
  for (const { expense_id: id } of invoiced) {
    const row = (await client.query(`SELECT * FROM tenant.project_expenses WHERE id = $1`, [id])).rows[0];
    const updated = await write(client, c, row, { billing_status: "INVOICED" });
    await expenseEvent(client, c, updated, "RECHARGE_INVOICED", { details: { requestId: request.id, invoiceLineId: line.id } });
  }
  return { requestId: request.id, status: "INVOICED" };
}

// ------------------------------------------------------------------ corrections
const CORRECTION_KINDS = ["AMOUNT", "CATEGORY", "PROJECT", "TASK", "DUPLICATE", "REFUND", "TAX", "OTHER"];
// input: { kind, reason, changes: { amount?, categoryId?, projectId?, taskId?, costBasis?, taxTreatment? }, idempotencyKey? } — on an approved expense.
export async function requestExpenseCorrection(client, c, expenseId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, status FROM tenant.project_expense_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { correctionId: existing.id, status: existing.status, replayed: true };
  }
  const { expense, can } = await expenseScope(client, c, expenseId, { lock: true });
  if (expense.status !== "APPROVED") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID", "Corrections are for approved expenses; edit a draft directly.");
  if (!(can.mine || can.correct)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const kind = String(input.kind ?? "").toUpperCase();
  if (!CORRECTION_KINDS.includes(kind)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Say what is wrong.", { field: "kind" });
  const reason = text(input.reason, 1000);
  if (reason.length < 5) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Explain the correction.", { field: "reason" });
  const changes = {};
  const given = input.changes ?? {};
  if (given.amount !== undefined) changes.amount = money(given.amount, "amount");
  if (given.categoryId) changes.categoryId = (await categoryOf(client, c, given.categoryId)).id;
  if (given.projectId) changes.projectId = uuid(given.projectId, "Project");
  if (given.taskId !== undefined) changes.taskId = given.taskId ? uuid(given.taskId, "Task") : null;
  if (given.costBasis !== undefined) changes.costBasis = money(given.costBasis, "costBasis", { allowZero: true });
  if (given.taxTreatment) changes.taxTreatment = String(given.taxTreatment).toUpperCase();
  if (["AMOUNT", "REFUND"].includes(kind) && !changes.amount) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Give the corrected amount.", { field: "amount" });
  // What it touches downstream, for its owners to settle.
  const reimbursement = (await client.query(`SELECT status, paid_amount FROM tenant.project_expense_reimbursements WHERE expense_id = $1 AND status <> 'CANCELLED'`, [expense.id])).rows[0];
  const impact = { reimbursementPaid: reimbursement ? moneyOut(reimbursement.paid_amount) : null, invoiced: expense.billing_status === "INVOICED", rechargeReserved: expense.billing_status === "RESERVED_FOR_BILLING",
    costRecognized: expense.finance_status === "VERIFIED" };
  let row;
  try {
    row = (await client.query(`INSERT INTO tenant.project_expense_corrections (organization_id, expense_id, project_id, kind, reason, changes, original, impact, requested_by, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) RETURNING *`,
    [c.organizationId, expense.id, expense.project_id, kind, reason, JSON.stringify(changes), JSON.stringify({ amount: moneyOut(expense.amount), categoryId: expense.category_id, projectId: expense.project_id,
      taskId: expense.task_id, costBasis: moneyOut(expense.cost_basis), taxTreatment: expense.tax_treatment }), JSON.stringify(impact), c.userId ?? null, key])).rows[0];
  } catch (failure) {
    if (failure?.code === "23505") throw expenseError(409, "PROJECT_EXPENSE_STATUS_INVALID", "A correction of this expense is already waiting.");
    throw failure;
  }
  const updated = await write(client, c, expense, { status: "CORRECTION_REQUIRED" });
  await expenseEvent(client, c, updated, "CORRECTION_REQUESTED", { from: "APPROVED", to: "CORRECTION_REQUIRED", reason, details: { correctionId: row.id, kind, impact } });
  return { correctionId: row.id, status: "REQUESTED", impact };
}
// input: { decision: APPLY | REJECT, note? }. Applying reverses the recognized cost and recognizes the corrected one (dated today, in an open
// period); a paid reimbursement or an invoiced recharge that no longer fits is marked for its owner (Finance, Sales) to settle — never rewritten.
export async function decideExpenseCorrection(client, c, correctionId, input = {}) {
  const correction = (await client.query(`SELECT * FROM tenant.project_expense_corrections WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(correctionId, "Correction")])).rows[0];
  if (!correction) throw expenseError(404, "PROJECT_EXPENSE_NOT_FOUND", "Correction not found.");
  if (correction.status !== "REQUESTED") return { correctionId: correction.id, status: correction.status, replayed: true };
  const { expense, can } = await expenseScope(client, c, correction.expense_id, { lock: true });
  if (!can.correct) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (correction.requested_by === c.userId || expense.claimant_user_id === c.userId) throw expenseError(403, "PROJECT_EXPENSE_SELF_APPROVAL", "Someone else decides this correction.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    await client.query(`UPDATE tenant.project_expense_corrections SET status = 'REJECTED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [correction.id, c.userId ?? null, note]);
    const row = await write(client, c, expense, { status: "APPROVED" });
    await expenseEvent(client, c, row, "CORRECTION_REJECTED", { from: "CORRECTION_REQUIRED", to: "APPROVED", reason: note, details: { correctionId: correction.id } });
    return { correctionId: correction.id, status: "REJECTED" };
  }
  if (decision !== "APPLY") throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Apply or reject the correction.", { field: "decision" });
  const changes = correction.changes ?? {};
  const day = await companyDay(client, c);
  await periodOpen(client, c, day);
  // The recognized cost is reversed (never deleted) …
  await client.query(`UPDATE tenant.project_expense_cost_allocations SET status = 'REVERSED', reversed_at = clock_timestamp(), reversed_by = $2, reversal_reason = $3 WHERE expense_id = $1 AND status <> 'REVERSED'`,
    [expense.id, c.userId ?? null, `Correction: ${correction.reason}`]);
  const sets = {};
  if (changes.amount) { sets.amount = changes.amount; }
  if (changes.categoryId) sets.category_id = changes.categoryId;
  if (changes.projectId) {
    const target = await expenseProject(client, c, changes.projectId);
    sets.project_id = target.project.id;
    sets.task_id = null;
  }
  if (changes.taskId !== undefined) sets.task_id = changes.taskId;
  if (changes.taxTreatment) sets.tax_treatment = changes.taxTreatment;
  const duplicate = correction.kind === "DUPLICATE";
  let row = await write(client, c, expense, { ...sets, status: duplicate ? "WITHDRAWN" : "APPROVED", ...(duplicate ? { withdrawn_reason: `Duplicate: ${correction.reason}` } : {}) });
  // The recharge never exceeds the corrected expense (what was already invoiced is Sales' to adjust).
  if (sets.amount) row = (await client.query(`UPDATE tenant.project_expenses SET base_amount = round(amount * exchange_rate, 2), recharge_amount = LEAST(recharge_amount, round(amount * exchange_rate, 2))
     WHERE id = $1 RETURNING *`, [row.id])).rows[0];
  // … and the corrected cost recognized once more (a duplicate leaves none).
  if (!duplicate && expense.finance_status === "VERIFIED") {
    const basis = changes.costBasis ?? (sets.amount ? moneyOut(row.base_amount) : moneyOut(expense.cost_basis));
    if (cmpMoney(basis, "0") > 0) {
      const billLine = expense.vendor_bill_line_id ? await loadBillLine(client, c, expense.vendor_bill_line_id) : null;
      await client.query(`INSERT INTO tenant.project_expense_cost_allocations (organization_id, project_id, task_id, expense_id, category_id, source_module, source_id, source_line_id, amount, currency, recognition_date,
          source_version, status, command_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::date,$12,'RECOGNIZED',$13,$14)`,
      [c.organizationId, row.project_id, row.task_id, row.id, row.category_id, billLine ? "SUPPLIER_BILL" : "EXPENSE_CLAIM", billLine ? billLine.vendor_bill_id : row.id, billLine?.id ?? null, basis, row.base_currency,
        day, String(row.row_version), `correction:${correction.id}`, c.userId ?? null]);
    }
    row = await write(client, c, row, { cost_basis: basis, recognition_date: day });
  }
  // Downstream: a reimbursement that no longer matches, a recharge already reserved or invoiced.
  const reimbursement = (await client.query(`SELECT * FROM tenant.project_expense_reimbursements WHERE expense_id = $1 AND status <> 'CANCELLED' FOR UPDATE`, [expense.id])).rows[0];
  const flags = [];
  if (reimbursement) {
    const owed = duplicate ? "0.00" : moneyOut(row.base_amount);
    if (cmpMoney(reimbursement.paid_amount, owed) > 0) {
      await client.query(`UPDATE tenant.project_expense_reimbursements SET status = 'ADJUSTMENT_REQUIRED' WHERE id = $1`, [reimbursement.id]);
      row = await write(client, c, row, { reimbursement_status: "ADJUSTMENT_REQUIRED" });
      flags.push("REIMBURSEMENT_RECOVERY");
    } else if (cmpMoney(reimbursement.paid_amount, "0") === 0 && duplicate) {
      await client.query(`UPDATE tenant.project_expense_reimbursements SET status = 'CANCELLED', cancelled_reason = $2 WHERE id = $1`, [reimbursement.id, correction.reason]);
      row = await write(client, c, row, { reimbursement_status: "NOT_APPLICABLE" });
    } else {
      await client.query(`UPDATE tenant.project_expense_reimbursements SET amount = $2::numeric, status = CASE WHEN paid_amount >= $2::numeric THEN 'PAID' WHEN paid_amount > 0 THEN 'PARTIALLY_PAID' ELSE 'PENDING_PAYMENT' END WHERE id = $1`,
        [reimbursement.id, owed]);
      const status = (await client.query(`SELECT status FROM tenant.project_expense_reimbursements WHERE id = $1`, [reimbursement.id])).rows[0].status;
      row = await write(client, c, row, { reimbursement_status: status });
    }
  }
  if (["INVOICED", "RESERVED_FOR_BILLING"].includes(expense.billing_status)) {
    row = await write(client, c, row, { billing_status: "ADJUSTMENT_REQUIRED" });
    flags.push(expense.billing_status === "INVOICED" ? "INVOICE_ADJUSTMENT" : "RECHARGE_REVIEW");
  } else if (expense.recharge_amount && cmpMoney(expense.recharge_amount, row.base_amount) > 0) {
    row = await write(client, c, row, { recharge_amount: moneyOut(row.base_amount) });
  }
  await client.query(`UPDATE tenant.project_expense_corrections SET status = 'APPLIED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3, impact = impact || $4::jsonb WHERE id = $1`,
    [correction.id, c.userId ?? null, note, JSON.stringify({ flags })]);
  await expenseEvent(client, c, row, "CORRECTION_APPLIED", { from: "CORRECTION_REQUIRED", to: row.status, reason: note, details: { correctionId: correction.id, kind: correction.kind, changes, flags } });
  await tell(client, c, [expense.claimant_user_id], row, `${expenseCode(row)} corrected`, correction.reason);
  return { correctionId: correction.id, status: "APPLIED", flags };
}

// ------------------------------------------------------------------ settings
// input: { financeReviewRequired?, receiptThreshold?, managerLimit? (null for none), deadlineDays? }
export async function saveExpenseSettings(client, c, input = {}) {
  if (!has(c, "projects.settings.manage")) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const current = await expensePolicy(client, c);
  const review = input.financeReviewRequired === undefined ? current.financeReviewRequired : Boolean(input.financeReviewRequired);
  const threshold = input.receiptThreshold === undefined ? current.receiptThreshold : money(input.receiptThreshold, "receiptThreshold", { allowZero: true });
  const limit = input.managerLimit === undefined ? current.managerLimit : input.managerLimit === null || input.managerLimit === "" ? null : money(input.managerLimit, "managerLimit");
  const days = input.deadlineDays === undefined ? current.deadlineDays : Number(input.deadlineDays);
  if (!Number.isInteger(days) || days < 1 || days > 730) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "The claim deadline is between 1 and 730 days.", { field: "deadlineDays" });
  await client.query(`INSERT INTO tenant.project_settings (organization_id, expense_finance_review_required, expense_receipt_threshold, expense_manager_limit, expense_claim_deadline_days) VALUES ($1,$2,$3::numeric,$4::numeric,$5)
      ON CONFLICT (organization_id) DO UPDATE SET expense_finance_review_required = EXCLUDED.expense_finance_review_required, expense_receipt_threshold = EXCLUDED.expense_receipt_threshold,
        expense_manager_limit = EXCLUDED.expense_manager_limit, expense_claim_deadline_days = EXCLUDED.expense_claim_deadline_days`, [c.organizationId, review, threshold, limit, days]);
  return { financeReviewRequired: review, receiptThreshold: threshold, managerLimit: limit, deadlineDays: days };
}

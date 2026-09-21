// Time, expenses, materials and procurement (F210-F213): weekly timesheets with rate provenance and a
// governed approval, project expenses with a receipt trail, stock issued to a project (through Stock's own
// movement so on-hand, holds and costing all apply), and links to procurement commitments and actuals.
import { postStockMovement } from "../stock/index.js";
import {
  addDays, dateOrNull, dateRequired, fromCents, has, isBroad, loadProject, loadSettings, mondayOf, need, nonNegative, oneOf, positive, ProjectError, qx, recordEvent, requiredText, text, textOrNull,
  toCents, today, uuid, uuidOrNull, assertOpen, canSeeFinance, isMember,
} from "./common.js";

const approverOf = (c) => has(c, "projects.time.approve");
const seesAllTime = (c) => has(c, "projects.time.approve") || has(c, "projects.manage") || canSeeFinance(c);

// ------------------------------------------------------------------ time entries and timesheets (F210)
export async function listTimeEntries(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (!seesAllTime(c) || filters.mine === true || filters.mine === "true") add("e.user_id=?", c.userId);
  if (filters.projectId) add("e.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.userId && seesAllTime(c)) add("e.user_id=?", uuid(filters.userId, "User"));
  if (filters.status && filters.status !== "all") add("e.status=?", oneOf(filters.status, ["draft", "submitted", "approved", "rejected"], "Status"));
  const from = dateOrNull(filters.from, "From"); const to = dateOrNull(filters.to, "To");
  if (from) add("e.work_date>=?", from);
  if (to) add("e.work_date<=?", to);
  const showRates = canSeeFinance(c) || has(c, "projects.resources.manage");
  const res = await qx(client,
    `SELECT e.*,p.project_number,p.name AS project_name,t.task_number,t.name AS task_name,u.full_name AS user_name FROM tenant.project_time_entries e
     JOIN tenant.projects p ON p.id=e.project_id LEFT JOIN tenant.project_tasks t ON t.id=e.task_id LEFT JOIN public.users u ON u.id=e.user_id
     WHERE e.organization_id=$1 AND e.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY e.work_date DESC,e.created_at DESC LIMIT 500`, values);
  return res.rows.map((r) => (showRates || r.user_id === c.userId ? r : { ...r, cost_rate: null, bill_rate: null }));
}

async function lockEntry(client, c, id) {
  const e = (await qx(client, `SELECT * FROM tenant.project_time_entries WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Time entry")])).rows[0];
  if (!e) throw new ProjectError(404, "Time entry was not found.", "PROJECT_NOT_FOUND");
  if (e.user_id !== c.userId && !seesAllTime(c)) throw new ProjectError(404, "Time entry was not found.", "PROJECT_NOT_FOUND");
  return e;
}

export async function logProjectTime(client, c, input) {
  need(c, "projects.time.enter");
  const p = await loadProject(client, c, input.projectId, { lock: true });
  const userId = input.userId && input.userId !== c.userId ? (has(c, "projects.manage") ? uuid(input.userId, "User") : (() => { throw new ProjectError(403, "You can only log your own time.", "PROJECT_FORBIDDEN"); })()) : c.userId;
  if (p.status !== "active") throw new ProjectError(409, "Time can only be logged against an active project.", "PROJECT_NOT_ACTIVE");
  const settings = await loadSettings(client, c);
  const member = (await client.query(`SELECT cost_rate,bill_rate FROM tenant.project_members WHERE project_id=$1 AND user_id=$2 AND active=true`, [p.id, userId])).rows[0];
  if (!member && settings.require_membership_for_time) throw new ProjectError(409, "Time can only be logged by someone on the project team.", "PROJECT_NOT_MEMBER");
  const workDate = dateRequired(input.workDate, "Work date");
  if (workDate > today()) throw new ProjectError(400, "Time cannot be logged for a future date.", "PROJECT_DATE_INVALID");
  const hours = positive(input.hours, "Hours");
  if (hours > 24) throw new ProjectError(400, "A day has at most 24 hours.", "PROJECT_NUMBER_INVALID");
  let task = null;
  if (input.taskId) {
    task = (await client.query(`SELECT id,status,billable,(SELECT count(*)::int FROM tenant.project_tasks ch WHERE ch.parent_task_id=t.id) AS kids FROM tenant.project_tasks t WHERE id=$1 AND project_id=$2`, [uuid(input.taskId, "Task"), p.id])).rows[0];
    if (!task) throw new ProjectError(409, "The task is not in this project.", "PROJECT_REFERENCE_INVALID");
    if (task.kids > 0) throw new ProjectError(409, "Time is logged against a leaf task, not a summary task.", "PROJECT_TASK_SUMMARY");
    if (["done", "cancelled"].includes(task.status)) throw new ProjectError(409, `The task is ${task.status}; reopen it before logging time.`, "PROJECT_STATE_INVALID");
  }
  const day = await client.query(`SELECT COALESCE(sum(hours),0)::float AS h FROM tenant.project_time_entries WHERE organization_id=$1 AND user_id=$2 AND work_date=$3 AND status<>'rejected'`, [c.organizationId, userId, workDate]);
  if (Number(day.rows[0].h) + hours > 24 + 1e-9) throw new ProjectError(409, `That would put ${Math.round((Number(day.rows[0].h) + hours) * 100) / 100} hours on ${workDate} across projects.`, "PROJECT_DAY_EXCEEDED");
  const week = mondayOf(workDate);
  let sheet = (await qx(client, `SELECT * FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND user_id=$3 AND week_start=$4 FOR UPDATE`, [c.organizationId, c.companyId, userId, week])).rows[0];
  if (sheet && ["submitted", "approved"].includes(sheet.status)) throw new ProjectError(409, `That week's timesheet is ${sheet.status}; recall or reopen it before adding time.`, "PROJECT_TIMESHEET_LOCKED");
  if (!sheet) sheet = (await qx(client, `INSERT INTO tenant.project_timesheets(organization_id,company_id,user_id,week_start) VALUES($1,$2,$3,$4) RETURNING *`, [c.organizationId, c.companyId, userId, week])).rows[0];
  const billable = p.billable && p.project_type !== "internal" && input.billable !== false && (task ? task.billable || input.billable === true : input.billable === true);
  const res = await qx(client,
    `INSERT INTO tenant.project_time_entries(organization_id,company_id,project_id,task_id,user_id,work_date,hours,description,billable,cost_rate,bill_rate,status,timesheet_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, p.id, task?.id ?? null, userId, workDate, String(hours), textOrNull(input.description, 1000), billable, member?.cost_rate ?? "0", member?.bill_rate ?? "0", sheet.id, c.userId]);
  await client.query(`UPDATE tenant.project_timesheets SET total_hours=(SELECT COALESCE(sum(hours),0) FROM tenant.project_time_entries WHERE timesheet_id=$1) WHERE id=$1`, [sheet.id]);
  await recordEvent(client, c, "time_entry", res.rows[0].id, "project.time.created", { hours, workDate });
  return res.rows[0];
}

export async function updateTimeEntryRecord(client, c, entryId, input) {
  need(c, "projects.time.enter");
  const e = await lockEntry(client, c, entryId);
  if (e.user_id !== c.userId && !has(c, "projects.manage")) throw new ProjectError(403, "You can only edit your own time.", "PROJECT_FORBIDDEN");
  if (!["draft", "rejected"].includes(e.status)) throw new ProjectError(409, `A ${e.status} time entry is locked; ${e.status === "approved" ? "the approver must reopen it" : "recall the timesheet"} first.`, "PROJECT_LOCKED");
  const hours = input.hours === undefined ? Number(e.hours) : positive(input.hours, "Hours");
  if (hours > 24) throw new ProjectError(400, "A day has at most 24 hours.", "PROJECT_NUMBER_INVALID");
  const day = await client.query(`SELECT COALESCE(sum(hours),0)::float AS h FROM tenant.project_time_entries WHERE organization_id=$1 AND user_id=$2 AND work_date=$3 AND status<>'rejected' AND id<>$4`, [c.organizationId, e.user_id, e.work_date, e.id]);
  if (Number(day.rows[0].h) + hours > 24 + 1e-9) throw new ProjectError(409, "That would exceed 24 hours on the day across projects.", "PROJECT_DAY_EXCEEDED");
  const res = await qx(client, `UPDATE tenant.project_time_entries SET hours=$2,description=COALESCE($3,description),billable=COALESCE($4,billable),status='draft',rejection_reason=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [e.id, String(hours), input.description === undefined ? null : textOrNull(input.description, 1000), input.billable === undefined ? null : Boolean(input.billable)]);
  if (e.timesheet_id) await client.query(`UPDATE tenant.project_timesheets SET total_hours=(SELECT COALESCE(sum(hours),0) FROM tenant.project_time_entries WHERE timesheet_id=$1),status='draft' WHERE id=$1`, [e.timesheet_id]);
  return res.rows[0];
}

export async function deleteTimeEntryRecord(client, c, entryId) {
  need(c, "projects.time.enter");
  const e = await lockEntry(client, c, entryId);
  if (e.user_id !== c.userId && !has(c, "projects.manage")) throw new ProjectError(403, "You can only delete your own time.", "PROJECT_FORBIDDEN");
  if (e.status !== "draft") throw new ProjectError(409, "Only a draft time entry can be deleted.", "PROJECT_LOCKED");
  await client.query(`DELETE FROM tenant.project_time_entries WHERE id=$1`, [e.id]);
  if (e.timesheet_id) await client.query(`UPDATE tenant.project_timesheets SET total_hours=(SELECT COALESCE(sum(hours),0) FROM tenant.project_time_entries WHERE timesheet_id=$1) WHERE id=$1`, [e.timesheet_id]);
  return { ok: true };
}

export async function listTimesheets(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (!seesAllTime(c)) { values.push(c.userId); where += ` AND s.user_id=$${values.length}`; }
  if (filters.status) { values.push(String(filters.status)); where += ` AND s.status=$${values.length}`; }
  const res = await qx(client, `SELECT s.*,u.full_name AS user_name,(SELECT count(*)::int FROM tenant.project_time_entries e WHERE e.timesheet_id=s.id) AS entry_count FROM tenant.project_timesheets s LEFT JOIN public.users u ON u.id=s.user_id WHERE s.organization_id=$1 AND s.company_id=$2${where} ORDER BY s.week_start DESC,u.full_name LIMIT 300`, values);
  return res.rows;
}

export async function submitTimesheet(client, c, input) {
  need(c, "projects.time.enter");
  const week = mondayOf(dateRequired(input.weekStart, "Week"));
  const sheet = (await qx(client, `SELECT * FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND user_id=$3 AND week_start=$4 FOR UPDATE`, [c.organizationId, c.companyId, c.userId, week])).rows[0];
  if (!sheet) throw new ProjectError(404, "There is no time logged for that week.", "PROJECT_NOT_FOUND");
  if (!["draft", "rejected"].includes(sheet.status)) throw new ProjectError(409, `That timesheet is already ${sheet.status}.`, "PROJECT_STATE_INVALID");
  const entries = await client.query(`SELECT id FROM tenant.project_time_entries WHERE timesheet_id=$1 AND status IN ('draft','rejected')`, [sheet.id]);
  if (!entries.rows.length) throw new ProjectError(409, "Nothing to submit; the week has no draft time.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  const auto = !settings.require_time_approval;
  await client.query(`UPDATE tenant.project_time_entries SET status=$2,submitted_at=now(),approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,approved_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,rejection_reason=NULL,updated_at=now() WHERE timesheet_id=$1 AND status IN ('draft','rejected')`, [sheet.id, auto ? "approved" : "submitted", c.userId]);
  const total = (await client.query(`SELECT COALESCE(sum(hours),0) AS h FROM tenant.project_time_entries WHERE timesheet_id=$1`, [sheet.id])).rows[0].h;
  const res = await qx(client, `UPDATE tenant.project_timesheets SET status=$2,total_hours=$3,submitted_at=now(),approved_by=CASE WHEN $2='approved' THEN $4::uuid ELSE NULL END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,rejection_reason=NULL WHERE id=$1 RETURNING *`, [sheet.id, auto ? "approved" : "submitted", total, c.userId]);
  await recordEvent(client, c, "timesheet", sheet.id, "project.timesheet.submitted", { week, hours: total });
  return res.rows[0];
}

export async function recallTimesheet(client, c, input) {
  need(c, "projects.time.enter");
  const week = mondayOf(dateRequired(input.weekStart, "Week"));
  const sheet = (await qx(client, `SELECT * FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND user_id=$3 AND week_start=$4 FOR UPDATE`, [c.organizationId, c.companyId, c.userId, week])).rows[0];
  if (!sheet || sheet.status !== "submitted") throw new ProjectError(409, "Only a submitted timesheet can be recalled.", "PROJECT_STATE_INVALID");
  await client.query(`UPDATE tenant.project_time_entries SET status='draft',submitted_at=NULL WHERE timesheet_id=$1 AND status='submitted'`, [sheet.id]);
  return (await qx(client, `UPDATE tenant.project_timesheets SET status='draft',submitted_at=NULL WHERE id=$1 RETURNING *`, [sheet.id])).rows[0];
}

// Reviewing is per timesheet: approve or reject the whole week, never one's own.
export async function reviewTimesheet(client, c, timesheetId, approve, reason) {
  need(c, "projects.time.approve");
  const sheet = (await qx(client, `SELECT * FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(timesheetId, "Timesheet")])).rows[0];
  if (!sheet) throw new ProjectError(404, "Timesheet was not found.", "PROJECT_NOT_FOUND");
  if (sheet.status !== "submitted") throw new ProjectError(409, "Only a submitted timesheet can be reviewed.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && sheet.user_id === c.userId) throw new ProjectError(409, "You cannot approve your own timesheet.", "SELF_APPROVAL_BLOCKED");
  if (!approve) requiredText(reason, "Reason", 500);
  await client.query(`UPDATE tenant.project_time_entries SET status=$2,approved_by=$3,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,rejection_reason=$4,updated_at=now() WHERE timesheet_id=$1 AND status='submitted'`, [sheet.id, approve ? "approved" : "rejected", c.userId, approve ? null : textOrNull(reason, 500)]);
  const res = await qx(client, `UPDATE tenant.project_timesheets SET status=$2,approved_by=$3,approved_at=now(),rejection_reason=$4 WHERE id=$1 RETURNING *`, [sheet.id, approve ? "approved" : "rejected", c.userId, approve ? null : textOrNull(reason, 500)]);
  await recordEvent(client, c, "timesheet", sheet.id, approve ? "project.timesheet.approved" : "project.timesheet.rejected", { week: sheet.week_start });
  return res.rows[0];
}

// Approved time is locked. Reopening needs a reason and is refused once billed.
export async function reopenApprovedTime(client, c, entryId, reason) {
  need(c, "projects.time.approve");
  const e = await lockEntry(client, c, entryId);
  if (e.status !== "approved") throw new ProjectError(409, "Only approved time can be reopened.", "PROJECT_STATE_INVALID");
  if (e.billed_billing_id) throw new ProjectError(409, "This time has been billed; cancel the billing line first.", "PROJECT_LOCKED");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && e.user_id === c.userId) throw new ProjectError(409, "You cannot reopen your own time.", "SELF_APPROVAL_BLOCKED");
  await client.query(`UPDATE tenant.project_time_entries SET status='rejected',rejection_reason=$2,approved_at=NULL,updated_at=now() WHERE id=$1`, [e.id, `Reopened: ${requiredText(reason, "Reason", 500)}`]);
  if (e.timesheet_id) await client.query(`UPDATE tenant.project_timesheets SET status='rejected',rejection_reason='Reopened for correction' WHERE id=$1`, [e.timesheet_id]);
  await recordEvent(client, c, "time_entry", e.id, "project.time.reopened", { reason });
  return { ok: true };
}

// ------------------------------------------------------------------ expenses (F211)
export async function listProjectExpenses(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  const all = has(c, "projects.expense.approve") || has(c, "projects.manage") || canSeeFinance(c);
  if (!all || filters.mine === true || filters.mine === "true") add("x.incurred_by=?", c.userId);
  if (filters.projectId) add("x.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.status && filters.status !== "all") add("x.status=?", oneOf(filters.status, ["draft", "submitted", "approved", "rejected", "reimbursed"], "Status"));
  const res = await qx(client, `SELECT x.*,p.project_number,p.name AS project_name,u.full_name AS incurred_by_name FROM tenant.project_expenses x JOIN tenant.projects p ON p.id=x.project_id LEFT JOIN public.users u ON u.id=x.incurred_by WHERE x.organization_id=$1 AND x.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY x.expense_date DESC,x.created_at DESC LIMIT 500`, values);
  return res.rows;
}

async function lockExpense(client, c, id) {
  const x = (await qx(client, `SELECT * FROM tenant.project_expenses WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Expense")])).rows[0];
  if (!x) throw new ProjectError(404, "Expense was not found.", "PROJECT_NOT_FOUND");
  const all = has(c, "projects.expense.approve") || has(c, "projects.manage") || canSeeFinance(c);
  if (x.incurred_by !== c.userId && !all) throw new ProjectError(404, "Expense was not found.", "PROJECT_NOT_FOUND");
  return x;
}

export async function createProjectExpense(client, c, input) {
  need(c, "projects.expense.enter");
  const p = await loadProject(client, c, input.projectId, { lock: true });
  assertOpen(p, "add expenses");
  if (["draft", "planned"].includes(p.status) && p.status !== "active" && p.status !== "on_hold") throw new ProjectError(409, "Expenses can be raised once the project is active.", "PROJECT_NOT_ACTIVE");
  const settings = await loadSettings(client, c);
  if (settings.require_membership_for_time && !(await isMember(client, c, p.id)) && !has(c, "projects.manage")) throw new ProjectError(409, "Only the project team can raise expenses.", "PROJECT_NOT_MEMBER");
  const date = dateRequired(input.expenseDate, "Expense date");
  if (date > today()) throw new ProjectError(400, "An expense cannot be dated in the future.", "PROJECT_DATE_INVALID");
  const amount = positive(input.amount, "Amount");
  const rate = input.exchangeRate === undefined || input.exchangeRate === "" ? 1 : positive(input.exchangeRate, "Exchange rate");
  const currency = (textOrNull(input.currencyCode, 3) || p.currency_code).toUpperCase();
  if (currency !== p.currency_code && input.exchangeRate === undefined) throw new ProjectError(400, "An expense in another currency needs its exchange rate.", "PROJECT_FIELD_REQUIRED");
  const base = fromCents((toCents(String(amount)) * BigInt(Math.round(rate * 1e8))) / 100000000n);
  if (toCents(base) <= 0n) throw new ProjectError(400, "The converted amount must be greater than zero.", "PROJECT_NUMBER_INVALID");
  const taskId = uuidOrNull(input.taskId, "Task");
  if (taskId) { const t = await client.query(`SELECT 1 FROM tenant.project_tasks WHERE id=$1 AND project_id=$2`, [taskId, p.id]); if (!t.rows[0]) throw new ProjectError(409, "The task is not in this project.", "PROJECT_REFERENCE_INVALID"); }
  const res = await qx(client,
    `INSERT INTO tenant.project_expenses(organization_id,company_id,project_id,task_id,incurred_by,expense_date,category,description,currency_code,amount,base_amount,exchange_rate,billable,supplier_id,receipt_reference,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft') RETURNING *`,
    [c.organizationId, c.companyId, p.id, taskId, c.userId, date, requiredText(input.category, "Category", 100), textOrNull(input.description, 1000), currency, String(amount), base, String(rate), p.billable && p.project_type !== "internal" && input.billable === true, uuidOrNull(input.supplierId, "Supplier"), textOrNull(input.receiptReference, 300)]);
  await recordEvent(client, c, "expense", res.rows[0].id, "project.expense.created", { amount: base });
  return res.rows[0];
}

export async function updateProjectExpense(client, c, expenseId, input) {
  need(c, "projects.expense.enter");
  const x = await lockExpense(client, c, expenseId);
  if (x.incurred_by !== c.userId) throw new ProjectError(403, "You can only edit your own expenses.", "PROJECT_FORBIDDEN");
  if (!["draft", "rejected"].includes(x.status)) throw new ProjectError(409, `A ${x.status} expense is locked.`, "PROJECT_LOCKED");
  const amount = input.amount === undefined ? Number(x.amount) : positive(input.amount, "Amount");
  const rate = input.exchangeRate === undefined ? Number(x.exchange_rate) : positive(input.exchangeRate, "Exchange rate");
  const base = fromCents((toCents(String(amount)) * BigInt(Math.round(rate * 1e8))) / 100000000n);
  const res = await qx(client, `UPDATE tenant.project_expenses SET amount=$2,exchange_rate=$3,base_amount=$4,category=COALESCE($5,category),description=COALESCE($6,description),receipt_reference=COALESCE($7,receipt_reference),status='draft',rejection_reason=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
    [x.id, String(amount), String(rate), base, input.category === undefined ? null : requiredText(input.category, "Category", 100), input.description === undefined ? null : textOrNull(input.description, 1000), input.receiptReference === undefined ? null : textOrNull(input.receiptReference, 300)]);
  return res.rows[0];
}

export async function submitProjectExpense(client, c, expenseId) {
  need(c, "projects.expense.enter");
  const x = await lockExpense(client, c, expenseId);
  if (x.incurred_by !== c.userId) throw new ProjectError(403, "You can only submit your own expenses.", "PROJECT_FORBIDDEN");
  if (!["draft", "rejected"].includes(x.status)) throw new ProjectError(409, `A ${x.status} expense cannot be submitted.`, "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  const auto = !settings.require_expense_approval;
  return (await qx(client, `UPDATE tenant.project_expenses SET status=$2,submitted_at=now(),approved_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,rejection_reason=NULL WHERE id=$1 RETURNING *`, [x.id, auto ? "approved" : "submitted", c.userId])).rows[0];
}

export async function reviewProjectExpense(client, c, expenseId, approve, reason) {
  need(c, "projects.expense.approve");
  const x = await lockExpense(client, c, expenseId);
  if (x.status !== "submitted") throw new ProjectError(409, "Only a submitted expense can be reviewed.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && x.incurred_by === c.userId) throw new ProjectError(409, "You cannot approve your own expense.", "SELF_APPROVAL_BLOCKED");
  if (!approve) requiredText(reason, "Reason", 500);
  return (await qx(client, `UPDATE tenant.project_expenses SET status=$2,approved_by=$3,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,rejection_reason=$4 WHERE id=$1 RETURNING *`, [x.id, approve ? "approved" : "rejected", c.userId, approve ? null : textOrNull(reason, 500)])).rows[0];
}

export async function reimburseProjectExpense(client, c, expenseId) {
  need(c, "projects.expense.approve");
  const x = await lockExpense(client, c, expenseId);
  if (x.status !== "approved") throw new ProjectError(409, "Only an approved expense can be reimbursed.", "PROJECT_STATE_INVALID");
  return (await qx(client, `UPDATE tenant.project_expenses SET status='reimbursed',reimbursed_at=now(),reimbursed_by=$2 WHERE id=$1 RETURNING *`, [x.id, c.userId])).rows[0];
}

export async function deleteProjectExpense(client, c, expenseId) {
  need(c, "projects.expense.enter");
  const x = await lockExpense(client, c, expenseId);
  if (x.incurred_by !== c.userId) throw new ProjectError(403, "You can only delete your own expenses.", "PROJECT_FORBIDDEN");
  if (x.status !== "draft") throw new ProjectError(409, "Only a draft expense can be deleted.", "PROJECT_LOCKED");
  await client.query(`DELETE FROM tenant.project_expenses WHERE id=$1`, [x.id]);
  return { ok: true };
}

// ------------------------------------------------------------------ materials (F212)
export async function listProjectMaterials(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); where += ` AND m.project_id=$${values.length}`; }
  const res = await qx(client, `SELECT m.*,p.project_number,i.name AS item_name,i.code AS item_code,w.name AS warehouse_name FROM tenant.project_materials m JOIN tenant.projects p ON p.id=m.project_id LEFT JOIN tenant.items i ON i.id=m.item_id LEFT JOIN tenant.warehouses w ON w.id=m.warehouse_id WHERE m.organization_id=$1 AND m.company_id=$2${where} ORDER BY m.consumed_on DESC,m.created_at DESC LIMIT 500`, values);
  const finance = canSeeFinance(c);
  return res.rows.map((r) => (finance ? r : { ...r, unit_cost: null, total_cost: null }));
}

function stockContext(c) {
  return { organizationId: c.organizationId, companyId: c.companyId, userId: c.userId, permissions: ["stock.issue", "stock.receive", "stock.view"], roleSlugs: [] };
}

export async function issueProjectMaterial(client, c, projectId, input) {
  need(c, "projects.expense.enter");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (p.status !== "active") throw new ProjectError(409, "Materials can only be consumed by an active project.", "PROJECT_NOT_ACTIVE");
  const qty = positive(input.quantity, "Quantity");
  const taskId = uuidOrNull(input.taskId, "Task");
  if (taskId) { const t = await client.query(`SELECT 1 FROM tenant.project_tasks WHERE id=$1 AND project_id=$2`, [taskId, p.id]); if (!t.rows[0]) throw new ProjectError(409, "The task is not in this project.", "PROJECT_REFERENCE_INVALID"); }
  const key = textOrNull(input.idempotencyKey, 120);
  let movement;
  try {
    movement = await postStockMovement(client, stockContext(c), { movementType: "issue", itemId: uuid(input.itemId, "Item"), warehouseId: uuid(input.warehouseId, "Warehouse"), warehouseLocationId: uuidOrNull(input.warehouseLocationId, "Location"), batchId: uuidOrNull(input.batchId, "Batch"), quantity: qty, referenceType: "project", referenceId: p.id, idempotencyKey: key ? `project-material:${p.id}:${key}` : undefined, note: `Issued to project ${p.project_number}` });
  } catch (error) {
    if (error?.status && error.code?.startsWith("STOCK")) throw new ProjectError(error.status, error.message, error.code);
    if (error?.status) throw new ProjectError(error.status, error.message, error.code || "PROJECT_STOCK_REJECTED");
    throw error;
  }
  const existing = (await qx(client, `SELECT * FROM tenant.project_materials WHERE stock_movement_id=$1`, [movement.id])).rows[0];
  if (existing) return { ...existing, replayed: true };
  const unit = Number(movement.unit_cost ?? 0);
  const total = fromCents((toCents(String(unit)) * BigInt(Math.round(qty * 1e6))) / 1000000n);
  const res = await qx(client, `INSERT INTO tenant.project_materials(organization_id,company_id,project_id,task_id,item_id,warehouse_id,quantity,unit_cost,total_cost,status,stock_movement_id,consumed_on,billable,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'issued',$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, c.companyId, p.id, taskId, input.itemId, input.warehouseId, String(qty), String(unit), total, movement.id, dateOrNull(input.consumedOn, "Consumed on") || today(), p.billable && p.project_type !== "internal" && input.billable === true, textOrNull(input.note, 500), c.userId]);
  await recordEvent(client, c, "material", res.rows[0].id, "project.material.issued", { itemId: input.itemId, quantity: qty, movement: movement.movement_number });
  return res.rows[0];
}

export async function returnProjectMaterial(client, c, materialId, input = {}) {
  need(c, "projects.expense.enter");
  const m = (await qx(client, `SELECT * FROM tenant.project_materials WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(materialId, "Material")])).rows[0];
  if (!m) throw new ProjectError(404, "Material was not found.", "PROJECT_NOT_FOUND");
  if (m.status !== "issued") throw new ProjectError(409, "That material has already been returned.", "PROJECT_STATE_INVALID");
  if (m.billed_billing_id) throw new ProjectError(409, "That material has been billed; cancel the billing line first.", "PROJECT_LOCKED");
  await loadProject(client, c, m.project_id, { lock: true });
  const movement = await postStockMovement(client, stockContext(c), { movementType: "receipt", itemId: m.item_id, warehouseId: m.warehouse_id, quantity: Number(m.quantity), unitCost: Number(m.unit_cost), referenceType: "project", referenceId: m.project_id, idempotencyKey: `project-material-return:${m.id}`, note: textOrNull(input.reason, 300) || "Returned from project" }).catch((error) => { throw error?.status ? new ProjectError(error.status, error.message, error.code || "PROJECT_STOCK_REJECTED") : error; });
  const res = await qx(client, `UPDATE tenant.project_materials SET status='returned',return_movement_id=$2 WHERE id=$1 RETURNING *`, [m.id, movement.id]);
  await recordEvent(client, c, "material", m.id, "project.material.returned", { quantity: m.quantity });
  return res.rows[0];
}

// ------------------------------------------------------------------ procurement links (F213)
const COMMITMENT = ["requisition", "sourcing_event", "purchase_order"];
const ACTUAL = ["receipt", "vendor_bill"];
const DOC_TABLE = { requisition: "procurement_requisitions", sourcing_event: "procurement_sourcing_events", purchase_order: "procurement_purchase_orders", receipt: "procurement_receipts" };

export async function listProcurementLinks(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); where += ` AND l.project_id=$${values.length}`; }
  const res = await qx(client, `SELECT l.*,p.project_number,p.name AS project_name FROM tenant.project_procurement_links l JOIN tenant.projects p ON p.id=l.project_id WHERE l.organization_id=$1 AND l.company_id=$2${where} ORDER BY l.created_at DESC LIMIT 500`, values);
  if (!canSeeFinance(c) && !has(c, "projects.procurement.link")) return res.rows.map((r) => ({ ...r, committed_amount: null, actual_amount: null }));
  return res.rows;
}

export async function linkProcurementDocument(client, c, projectId, input) {
  need(c, "projects.procurement.link");
  const p = await loadProject(client, c, projectId, { lock: true });
  assertOpen(p, "link procurement");
  const type = oneOf(input.documentType, [...COMMITMENT, ...ACTUAL], "Document type");
  const docId = uuid(input.documentId, "Document");
  let committed = nonNegative(input.committedAmount, "Committed amount");
  let actual = nonNegative(input.actualAmount, "Actual amount");
  if (COMMITMENT.includes(type) && actual > 0) throw new ProjectError(400, `A ${type.replace("_", " ")} carries a commitment, not an actual cost; link the receipt or vendor bill for actuals.`, "PROJECT_LINK_INVALID");
  if (ACTUAL.includes(type) && committed > 0) throw new ProjectError(400, `A ${type.replace("_", " ")} carries an actual cost, not a commitment.`, "PROJECT_LINK_INVALID");
  let currency = p.currency_code;
  if (type === "vendor_bill") {
    const bill = (await qx(client, `SELECT status,base_currency_total,functional_currency_code FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, docId])).rows[0];
    if (!bill) throw new ProjectError(404, "The vendor bill was not found in this company.", "PROJECT_LINK_INVALID");
    if (!["posted", "partially_paid", "paid", "overdue", "disputed"].includes(bill.status)) throw new ProjectError(409, "A vendor bill counts as project cost once it is posted.", "PROJECT_LINK_INVALID");
    if (bill.functional_currency_code !== p.currency_code) throw new ProjectError(409, "The bill's base currency differs from the project's currency.", "PROJECT_CURRENCY_MISMATCH");
    actual = Number(bill.base_currency_total);
    currency = bill.functional_currency_code;
  } else {
    const found = await client.query(`SELECT 1 FROM tenant.${DOC_TABLE[type]} WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, docId]);
    if (!found.rows[0]) throw new ProjectError(404, `The ${type.replace("_", " ")} was not found in this company.`, "PROJECT_LINK_INVALID");
    if (COMMITMENT.includes(type) && committed <= 0) throw new ProjectError(400, "Enter the committed amount.", "PROJECT_NUMBER_INVALID");
    if (ACTUAL.includes(type) && actual <= 0) throw new ProjectError(400, "Enter the actual cost.", "PROJECT_NUMBER_INVALID");
  }
  const taskId = uuidOrNull(input.taskId, "Task");
  if (taskId) { const t = await client.query(`SELECT 1 FROM tenant.project_tasks WHERE id=$1 AND project_id=$2`, [taskId, p.id]); if (!t.rows[0]) throw new ProjectError(409, "The task is not in this project.", "PROJECT_REFERENCE_INVALID"); }
  const existing = (await client.query(`SELECT id FROM tenant.project_procurement_links WHERE organization_id=$1 AND project_id=$2 AND document_type=$3 AND document_id=$4`, [c.organizationId, p.id, type, docId])).rows[0];
  const res = existing
    ? await qx(client, `UPDATE tenant.project_procurement_links SET committed_amount=$2,actual_amount=$3,task_id=COALESCE($4,task_id),note=COALESCE($5,note),updated_at=now() WHERE id=$1 RETURNING *`, [existing.id, String(committed), String(actual), taskId, textOrNull(input.note, 500)])
    : await qx(client, `INSERT INTO tenant.project_procurement_links(organization_id,company_id,project_id,task_id,document_type,document_id,committed_amount,actual_amount,currency_code,created_by,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [c.organizationId, c.companyId, p.id, taskId, type, docId, String(committed), String(actual), currency, c.userId, textOrNull(input.note, 500)]);
  await recordEvent(client, c, "project", p.id, existing ? "project.procurement.updated" : "project.procurement.linked", { type, docId });
  return res.rows[0];
}

export async function unlinkProcurementDocument(client, c, linkId) {
  need(c, "projects.procurement.link");
  const l = (await qx(client, `SELECT * FROM tenant.project_procurement_links WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(linkId, "Link")])).rows[0];
  if (!l) throw new ProjectError(404, "Link was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, l.project_id, { lock: true });
  assertOpen(p, "unlink procurement");
  await client.query(`DELETE FROM tenant.project_procurement_links WHERE id=$1`, [l.id]);
  await recordEvent(client, c, "project", p.id, "project.procurement.unlinked", { type: l.document_type });
  return { ok: true };
}

void isBroad; void approverOf; void addDays; void text;

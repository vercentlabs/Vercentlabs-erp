// Time (F209-F210): time entries collected into weekly timesheets with a governed approval.
import {
  dateOrNull, dateRequired, has, loadProject, loadSettings, mondayOf, need, oneOf, positive, ProjectError, qx, recordEvent, requiredText, textOrNull, today, uuid, canSeeFinance,
} from "./common.js";

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

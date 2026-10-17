// Projects — Timesheets, what people see: their own week (by day and by project, with its submissions), their entries, the review queue,
// one submission with the exact versions it carried and the checks behind the decision, a manager's team week (missing time shown as
// missing, never as zero hours), corrections, a project's time, the reports and the export. Cost is shown only to those who may see cost,
// billing only to those who may see billing; a person outside the project's team sees only their own time.
import { has, seesAll, text, userNames, uuid } from "../project-core.js";
import { mayDecide } from "./time-submissions.js";
import {
  ENTRY_STATUS_LABEL, FLAG_LABEL, SUBMISSION_STATUS_LABEL, TIME, addDays, canTeam, companyToday, deadlineOf, hoursLabel, loadProjectRow,
  timeError, timePolicy, viewsBilling, viewsCost, weekOf, workDay,
} from "./time-rules.js";
import {
  BILLING_METHODS, CLASSIFICATIONS, NON_BILLABLE_REASONS, billingSettings, mayManagePolicy, projectBillingPolicy,
} from "../billable/billable-rules.js";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayName = (day) => WEEKDAY[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
const project$ = (row) => `${row.project_code}${row.project_name ? ` · ${row.project_name}` : ""}`;

// Which entries this person may see: their own, and — with team access — those on the projects they lead (or every project).
const scopeSql = (c, me = "$2") => `((entry.employee_user_id = ${me} AND ${has(c, TIME.viewOwn) ? "TRUE" : "FALSE"})
  OR (${has(c, TIME.viewTeam) ? "TRUE" : "FALSE"} AND (${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = ${me})))`;
const teamSql = (c, me = "$2") => `(${has(c, TIME.viewTeam) ? "TRUE" : "FALSE"} AND (${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = ${me}))`;

const ENTRY_SELECT = `SELECT entry.*, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date_text,
    to_char(entry.start_at AT TIME ZONE COALESCE(org.timezone, 'UTC'), 'HH24:MI') AS start_time, to_char(entry.end_at AT TIME ZONE COALESCE(org.timezone, 'UTC'), 'HH24:MI') AS end_time,
    project.project_code, project.name AS project_name, project.manager_user_id, project.status AS project_status, task.task_code, task.title AS task_title, line.label AS contract_line_label,
    COALESCE(alloc.requested, 0)::int AS requested_minutes, COALESCE(alloc.invoiced, 0)::int AS invoiced_minutes
  FROM tenant.project_time_entries entry
  JOIN public.organizations org ON org.id = entry.organization_id
  JOIN tenant.projects project ON project.id = entry.project_id
  LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id
  LEFT JOIN tenant.project_time_contract_lines line ON line.id = entry.contract_line_id
  LEFT JOIN LATERAL (SELECT sum(allocated_minutes) FILTER (WHERE status = 'REQUESTED') AS requested, sum(allocated_minutes) FILTER (WHERE status = 'INVOICED') AS invoiced
      FROM tenant.project_time_billing_allocations allocation WHERE allocation.entry_id = entry.id) alloc ON TRUE`;

// Classified billable is not approved, and approved is not invoiced: where the time stands commercially (the approval state stays separate).
const commercialState = (row) => {
  if (row.billing_classification === "NON_BILLABLE" || row.billing_classification === "INCLUDED_IN_FIXED_FEE") return { state: row.billing_classification, label: CLASSIFICATIONS[row.billing_classification] };
  if (row.entry_status === "VOIDED") return { state: "VOIDED", label: "Voided" };
  if (row.billing_classification === "ELIGIBILITY_PENDING") return { state: "ELIGIBILITY_PENDING", label: "Billable — waiting for a contract line" };
  if (row.entry_status !== "APPROVED") return { state: "BILLABLE_PENDING", label: "Billable once approved" };
  if (row.invoiced_minutes >= row.duration_minutes) return { state: "INVOICED", label: "Allocated to invoice" };
  if (row.invoiced_minutes > 0) return { state: "PARTIALLY_INVOICED", label: `${hoursLabel(row.invoiced_minutes)} invoiced` };
  if (row.requested_minutes > 0) return { state: "BILLING_REQUESTED", label: "Billing requested" };
  return { state: "BILLABLE_ELIGIBLE", label: "Billable, not yet billed" };
};

function entryView(c, row, names) {
  const mine = row.employee_user_id === c.userId || row.entered_by === c.userId;
  const editable = ["DRAFT", "CHANGES_REQUESTED"].includes(row.entry_status) && mine && has(c, TIME.editDraft);
  return {
    id: row.id, number: `TE-${row.entry_number}`, employeeUserId: row.employee_user_id, employee: names.get(row.employee_user_id) ?? null,
    enteredBy: row.entered_by && row.entered_by !== row.employee_user_id ? names.get(row.entered_by) ?? null : null,
    projectId: row.project_id, project: project$(row), projectCode: row.project_code, taskId: row.task_id, task: row.task_code ? `${row.task_code} · ${row.task_title}` : null,
    workDate: row.work_date_text, weekday: dayName(row.work_date_text), startTime: row.start_time, endTime: row.end_time, durationMinutes: row.duration_minutes, duration: hoursLabel(row.duration_minutes),
    description: row.description, billable: row.billable, status: row.entry_status, statusLabel: ENTRY_STATUS_LABEL[row.entry_status], submissionId: row.submission_id,
    flags: (row.review_flags ?? []).map((code) => ({ code, label: FLAG_LABEL[code] ?? code })), version: row.row_version, correctsEntryId: row.corrects_entry_id, voidReason: row.void_reason,
    approvedBy: names.get(row.approved_by) ?? null, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(viewsCost(c) ? { cost: { rate: row.cost_rate === null ? null : String(row.cost_rate), amount: row.cost_amount === null ? null : String(row.cost_amount), currency: row.cost_currency, recorded: Boolean(row.cost_recorded_at) } } : {}),
    classification: row.billing_classification, classificationLabel: CLASSIFICATIONS[row.billing_classification], reasonCode: row.billing_reason_code,
    reason: row.billing_reason_code ? NON_BILLABLE_REASONS[row.billing_reason_code] : null, reasonNote: row.billing_reason_note, contractLineId: row.contract_line_id, contractLine: row.contract_line_label,
    ...(viewsBilling(c) ? { billing: { ...commercialState(row), requestedMinutes: row.requested_minutes, invoicedMinutes: row.invoiced_minutes } }
      : { billing: { state: row.billing_classification, label: CLASSIFICATIONS[row.billing_classification] } }),
    can: { edit: editable, remove: editable, correct: row.entry_status === "APPROVED" && ((row.employee_user_id === c.userId && has(c, TIME.create)) || (has(c, TIME.correct) && (seesAll(c) || row.manager_user_id === c.userId))) },
  };
}
const namesFor = (client, rows) => userNames(client, rows.flatMap((row) => [row.employee_user_id, row.entered_by, row.approved_by]));

// Duration summaries of a set of entries (voided time never counts).
export function calculateTimesheetTotals(entries) {
  const live = entries.filter((entry) => (entry.status ?? entry.entry_status) !== "VOIDED");
  const minutes = (list) => list.reduce((sum, entry) => sum + Number(entry.durationMinutes ?? entry.duration_minutes ?? 0), 0);
  const byStatus = {};
  for (const entry of live) { const status = entry.status ?? entry.entry_status; byStatus[status] = (byStatus[status] ?? 0) + Number(entry.durationMinutes ?? entry.duration_minutes); }
  const billable = minutes(live.filter((entry) => entry.billable));
  const total = minutes(live);
  return { totalMinutes: total, billableMinutes: billable, nonBillableMinutes: total - billable, byStatus, unsubmittedMinutes: (byStatus.DRAFT ?? 0) + (byStatus.CHANGES_REQUESTED ?? 0),
    total: hoursLabel(total), billable: hoursLabel(billable), nonBillable: hoursLabel(total - billable), entries: live.length };
}

const submissionRow = (row, names) => ({
  id: row.id, number: `TS-${row.submission_number}`, employeeUserId: row.employee_user_id, employee: names.get(row.employee_user_id) ?? null, projectId: row.project_id,
  project: row.project_code ? project$(row) : null, weekStart: row.period_start_text, weekEnd: row.period_end_text, version: row.submission_version, status: row.status, statusLabel: SUBMISSION_STATUS_LABEL[row.status],
  approver: row.approver_user_id ? names.get(row.approver_user_id) ?? null : null, totalMinutes: row.total_minutes, total: hoursLabel(row.total_minutes), billableMinutes: row.billable_minutes,
  entries: row.entry_count, late: row.late, lateReason: row.late_reason, flags: (row.flags ?? []).map((code) => ({ code, label: FLAG_LABEL[code] ?? code })), submittedAt: row.submitted_at,
  decidedBy: row.decided_by ? names.get(row.decided_by) ?? null : null, decidedAt: row.decided_at, comment: row.decision_comment, returnedEntryIds: row.returned_entry_ids ?? [], rowVersion: row.row_version,
});
const SUBMISSION_SELECT = `SELECT submission.*, to_char(submission.period_start, 'YYYY-MM-DD') AS period_start_text, to_char(submission.period_end, 'YYYY-MM-DD') AS period_end_text,
    project.project_code, project.name AS project_name, project.manager_user_id
  FROM tenant.project_timesheet_submissions submission JOIN tenant.projects project ON project.id = submission.project_id`;
const submissionNames = (client, rows) => userNames(client, rows.flatMap((row) => [row.employee_user_id, row.approver_user_id, row.decided_by]));

// ------------------------------------------------------------------ my week
// input: { week? (any day of it; this week by default), employeeUserId? (someone on a project one leads) }
export async function getEmployeeWeeklyTimesheet(client, c, input = {}) {
  const policy = await timePolicy(client, c);
  const today = await companyToday(client, c);
  const week = weekOf(workDay(input.week ?? today, "week"), policy.weekStart);
  const end = addDays(week, 6);
  const employee = input.employeeUserId ? uuid(input.employeeUserId, "Employee") : c.userId;
  if (!employee) throw timeError(403, "TIME_PERMISSION_DENIED");
  if (employee === c.userId && !has(c, TIME.viewOwn)) throw timeError(403, "TIME_PERMISSION_DENIED");
  if (employee !== c.userId && !has(c, TIME.viewTeam)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const rows = (await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND entry.employee_user_id = $3 AND entry.work_date BETWEEN $4 AND $5 AND ${scopeSql(c)}
      ORDER BY entry.work_date, entry.start_at NULLS LAST, entry.created_at`, [c.organizationId, c.userId, employee, week, end])).rows;
  const submissions = (await client.query(`${SUBMISSION_SELECT} WHERE submission.organization_id = $1 AND submission.employee_user_id = $2 AND submission.period_start = $3 ORDER BY submission.project_id, submission.submission_version DESC`,
    [c.organizationId, employee, week])).rows;
  const names = await userNames(client, [...rows.flatMap((row) => [row.employee_user_id, row.entered_by, row.approved_by]), ...submissions.flatMap((row) => [row.approver_user_id, row.decided_by]), employee]);
  const entries = rows.map((row) => entryView(c, row, names));
  const live = entries.filter((entry) => entry.status !== "VOIDED");
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(week, index);
    const list = live.filter((entry) => entry.workDate === day);
    const total = list.reduce((sum, entry) => sum + entry.durationMinutes, 0);
    return { date: day, weekday: dayName(day), minutes: total, total: hoursLabel(total), billableMinutes: list.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.durationMinutes, 0),
      entries: list.length, overReview: total > policy.dailyReviewMinutes, today: day === today, future: day > today };
  });
  const latest = new Map();
  for (const row of submissions) if (!latest.has(row.project_id)) latest.set(row.project_id, row);
  const projects = [...new Set(live.map((entry) => entry.projectId))].map((projectId) => {
    const list = live.filter((entry) => entry.projectId === projectId);
    const sub = latest.get(projectId);
    return { projectId, project: list[0].project, ...calculateTimesheetTotals(list), submission: sub ? submissionRow(sub, names) : null };
  });
  const totals = calculateTimesheetTotals(entries);
  const deadline = deadlineOf(week, policy);
  return {
    weekStart: week, weekEnd: end, previousWeek: addDays(week, -7), nextWeek: addDays(week, 7), today, deadline, late: today > deadline && totals.unsubmittedMinutes > 0,
    employee: { userId: employee, name: names.get(employee) ?? null, me: employee === c.userId }, days, entries, totals, projects,
    submissions: submissions.map((row) => submissionRow(row, names)),
    status: totals.unsubmittedMinutes ? "DRAFT" : live.length && live.every((entry) => entry.status === "APPROVED") ? "APPROVED" : live.some((entry) => entry.status === "SUBMITTED") ? "SUBMITTED" : live.length ? "MIXED" : "EMPTY",
    summary: totals.unsubmittedMinutes ? `${hoursLabel(totals.unsubmittedMinutes)} recorded — submission pending.` : live.length ? `${totals.total} recorded.` : "No time recorded this week.",
    policy: { weekStart: policy.weekStart, dailyReviewMinutes: policy.dailyReviewMinutes, dailyLimitMinutes: policy.dailyLimitMinutes, incrementMinutes: policy.incrementMinutes, deadlineDays: policy.deadlineDays,
      lateAllowed: policy.lateAllowed, boundaryDayPolicy: policy.boundaryDayPolicy },
    can: { record: has(c, TIME.create) && employee === c.userId, submit: has(c, TIME.submit) && employee === c.userId && totals.unsubmittedMinutes > 0, export: has(c, TIME.export) },
  };
}

// ------------------------------------------------------------------ the form's choices
// The projects this person records time on (the teams they are on, or were on), with each project's billing policy.
export async function getTimeEntryOptions(client, c) {
  const rows = (await client.query(`SELECT DISTINCT project.* FROM tenant.projects project
      WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.status <> 'DRAFT'
        AND (project.manager_user_id = $2 OR EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = project.id AND member.user_id = $2 AND member.role IN ('MANAGER', 'MEMBER')))
      ORDER BY project.project_code`, [c.organizationId, c.userId ?? null])).rows;
  const policy = await timePolicy(client, c);
  const settings = await billingSettings(client, c);
  const today = await companyToday(client, c);
  const projects = [];
  for (const row of rows) {
    const billing = await projectBillingPolicy(client, c, row);
    const lines = ["TIME_AND_MATERIALS", "HYBRID"].includes(billing.method) ? (await client.query(`SELECT id, label FROM tenant.project_time_contract_lines WHERE organization_id = $1 AND project_id = $2
        AND status = 'ACTIVE' AND (effective_to IS NULL OR effective_to >= $3::date - 90) ORDER BY created_at`, [c.organizationId, row.id, today])).rows : [];
    const note = { INTERNAL: "Internal project: time is non-billable and counts in labor cost.", NON_BILLABLE: "This project's time is not billed to the customer.",
      FIXED_PRICE: "Fixed price: work is included in the agreed amount — recorded for effort and cost, not billed by the hour.",
      TIME_AND_MATERIALS: lines.length ? "Billable hours are billed through Sales once approved." : "Billable hours wait for an authorized contract line before they can be billed.",
      HYBRID: "Included in the fixed price, except work on an authorized extra-service line." }[billing.method] ?? "The project's billing is not set up yet: time is recorded as non-billable.";
    projects.push({ id: row.id, code: row.project_code, name: row.name, label: `${row.project_code}${row.name ? ` · ${row.name}` : ""}`, status: row.status, billingMethod: billing.method,
      billingMethodLabel: billing.method ? BILLING_METHODS[billing.method] : "Billing not set up", billableAllowed: ["TIME_AND_MATERIALS", "HYBRID"].includes(billing.method),
      defaultBillable: billing.method === "TIME_AND_MATERIALS", billableNote: note, contractLines: lines.map((line) => ({ id: line.id, label: line.label })), teamLead: canTeam(c, row) });
  }
  return { projects, today, incrementMinutes: policy.incrementMinutes, dailyLimitMinutes: policy.dailyLimitMinutes, reasonRequired: settings.reasonRequired,
    reasons: Object.entries(NON_BILLABLE_REASONS).map(([code, label]) => ({ code, label })), can: { record: has(c, TIME.create) } };
}
// A project's tasks time can be recorded on (open ones, and ones closed recently), searchable; and — for a project one leads — its team.
export async function getProjectTimeTasks(client, c, projectId, filters = {}) {
  const project = await loadProjectRow(client, c, projectId);
  const search = text(filters.search, 100);
  const tasks = (await client.query(`SELECT id, task_code, title, status, assignee_user_id FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND archived_at IS NULL
      AND (status NOT IN ('DONE', 'CANCELLED') OR COALESCE(completed_at, cancelled_at) > now() - interval '60 days') AND ($3 = '' OR task_code ILIKE '%' || $3 || '%' OR title ILIKE '%' || $3 || '%')
      ORDER BY (status IN ('DONE', 'CANCELLED')), task_code LIMIT 200`, [c.organizationId, project.id, search])).rows;
  const team = canTeam(c, project) ? (await client.query(`SELECT DISTINCT member.user_id FROM tenant.project_members member WHERE member.project_id = $1 AND member.role IN ('MANAGER', 'MEMBER') AND member.left_at IS NULL`,
    [project.id])).rows.map((row) => row.user_id) : [];
  const names = await userNames(client, [...team, ...tasks.map((row) => row.assignee_user_id)]);
  return { tasks: tasks.map((row) => ({ id: row.id, code: row.task_code, title: row.title, label: `${row.task_code} · ${row.title}`, status: row.status, assignee: names.get(row.assignee_user_id) ?? null, mine: row.assignee_user_id === c.userId })),
    team: team.map((userId) => ({ userId, name: names.get(userId) ?? null })) };
}

// ------------------------------------------------------------------ entries
const LIST_ORDER = { work_date: "entry.work_date", duration: "entry.duration_minutes", project: "project.project_code", status: "entry.entry_status" };
// filters: { view: mine | team, from, to, projectId, taskId, employeeId, status, billable, search, page, pageSize }
export async function listTimeEntries(client, c, filters = {}) {
  const values = [c.organizationId, c.userId ?? null];
  const where = ["entry.organization_id = $1", filters.view === "team" ? teamSql(c) : filters.view === "all" ? scopeSql(c) : "entry.employee_user_id = $2"];
  if (filters.view !== "team" && filters.view !== "all" && !has(c, TIME.viewOwn)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
  if (filters.from) add("entry.work_date >= ?", workDay(filters.from, "start date"));
  if (filters.to) add("entry.work_date <= ?", workDay(filters.to, "end date"));
  if (filters.projectId) add("entry.project_id = ?", uuid(filters.projectId, "Project"));
  if (filters.taskId) add("entry.task_id = ?", uuid(filters.taskId, "Task"));
  if (filters.employeeId) add("entry.employee_user_id = ?", uuid(filters.employeeId, "Employee"));
  if (filters.status && ENTRY_STATUS_LABEL[filters.status]) add("entry.entry_status = ?", filters.status);
  else where.push("entry.entry_status <> 'VOIDED'");
  if (filters.billable === "true" || filters.billable === "false") add("entry.billable = ?", filters.billable === "true");
  if (filters.flagged === "true") where.push("jsonb_array_length(entry.review_flags) > 0");
  if (filters.search) add("(entry.description ILIKE '%' || ? || '%' OR project.project_code ILIKE '%' || $$$ || '%' OR task.task_code ILIKE '%' || $$$ || '%')".replace(/\$\$\$/g, `$${values.length + 1}`), text(filters.search, 100));
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 50, 1), 200);
  const page = Math.max(Number(filters.page) || 1, 1);
  const order = LIST_ORDER[filters.sort] ?? "entry.work_date";
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const sql = where.join(" AND ");
  const total = Number((await client.query(`SELECT count(*)::int AS n, COALESCE(sum(entry.duration_minutes), 0)::int AS minutes FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id
      LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id WHERE ${sql}`, values)).rows[0].n);
  const sums = (await client.query(`SELECT COALESCE(sum(entry.duration_minutes), 0)::int AS minutes, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billable), 0)::int AS billable
      FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id WHERE ${sql}`, values)).rows[0];
  const rows = (await client.query(`${ENTRY_SELECT} WHERE ${sql} ORDER BY ${order} ${direction}, entry.entry_number DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  const names = await namesFor(client, rows);
  return { rows: rows.map((row) => entryView(c, row, names)), total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1),
    totals: { minutes: sums.minutes, billableMinutes: sums.billable, total: hoursLabel(sums.minutes), billable: hoursLabel(sums.billable) },
    can: { team: has(c, TIME.viewTeam), export: has(c, TIME.export) } };
}

export async function getTimeEntry(client, c, entryId) {
  const row = (await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND entry.id = $3 AND ${scopeSql(c)}`, [c.organizationId, c.userId ?? null, uuid(entryId, "Time entry")])).rows[0];
  if (!row) throw timeError(404, "TIME_NOT_FOUND");
  const events = (await client.query(`SELECT * FROM tenant.project_time_events WHERE organization_id = $1 AND entry_id = $2 ORDER BY occurred_at`, [c.organizationId, row.id])).rows;
  const corrections = (await client.query(`SELECT * FROM tenant.project_time_corrections WHERE organization_id = $1 AND (entry_id = $2 OR replacement_entry_id = $2) ORDER BY requested_at`, [c.organizationId, row.id])).rows;
  const allocations = viewsBilling(c) ? (await client.query(`SELECT allocation.*, invoice.invoice_number FROM tenant.project_time_billing_allocations allocation
      LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id WHERE allocation.organization_id = $1 AND allocation.entry_id = $2 ORDER BY allocation.requested_at`,
  [c.organizationId, row.id])).rows : [];
  const names = await userNames(client, [row.employee_user_id, row.entered_by, row.approved_by, ...events.map((event) => event.actor_user_id), ...corrections.flatMap((item) => [item.requested_by, item.decided_by])]);
  return {
    ...entryView(c, row, names),
    history: events.map((event) => ({ id: event.id, action: event.action, from: event.from_status, to: event.to_status, summary: event.summary, actor: names.get(event.actor_user_id) ?? "System", at: event.occurred_at })),
    corrections: corrections.map((item) => correctionView(item, names)),
    allocations: allocations.map((item) => ({ id: item.id, billingRequestId: item.billing_request_id, minutes: item.allocated_minutes, status: item.status, invoiceNumber: item.invoice_number,
      requestedAt: item.requested_at, invoicedAt: item.invoiced_at, reversedAt: item.reversed_at, reversalReason: item.reversal_reason, reversalReference: item.reversal_reference })),
  };
}

// ------------------------------------------------------------------ review
// The submissions waiting for this person's decision (the projects they lead or, with the permission for every project, all).
export async function getTimesheetApprovalQueue(client, c, filters = {}) {
  if (!has(c, TIME.approve) && !has(c, TIME.requestChanges)) throw timeError(403, "TIME_APPROVAL_PERMISSION_DENIED");
  const status = SUBMISSION_STATUS_LABEL[filters.status] ? filters.status : "SUBMITTED";
  const rows = (await client.query(`${SUBMISSION_SELECT} WHERE submission.organization_id = $1 AND submission.status = $3 AND submission.employee_user_id <> $2
        AND (${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = $2) AND ($4::uuid IS NULL OR submission.project_id = $4) AND ($5::uuid IS NULL OR submission.employee_user_id = $5)
      ORDER BY submission.submitted_at ${status === "SUBMITTED" ? "ASC" : "DESC"} LIMIT 300`,
  [c.organizationId, c.userId ?? null, status, filters.projectId ? uuid(filters.projectId, "Project") : null, filters.employeeId ? uuid(filters.employeeId, "Employee") : null])).rows;
  const names = await submissionNames(client, rows);
  const today = await companyToday(client, c);
  return { rows: rows.map((row) => ({ ...submissionRow(row, names), waitingDays: Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - new Date(row.submitted_at).setUTCHours(0, 0, 0, 0)) / 864e5)) })),
    pendingMinutes: rows.filter((row) => row.status === "SUBMITTED").reduce((sum, row) => sum + row.total_minutes, 0) };
}

export async function getTimesheetSubmission(client, c, submissionId) {
  const row = (await client.query(`${SUBMISSION_SELECT} WHERE submission.organization_id = $1 AND submission.id = $2`, [c.organizationId, uuid(submissionId, "Timesheet")])).rows[0];
  if (!row) throw timeError(404, "TIME_NOT_FOUND");
  const project = await loadProjectRow(client, c, row.project_id);
  const own = row.employee_user_id === c.userId && has(c, TIME.viewOwn);
  if (!own && !canTeam(c, project) && !(has(c, TIME.approve) && (seesAll(c) || project.manager_user_id === c.userId))) throw timeError(404, "TIME_NOT_FOUND");
  const links = (await client.query(`SELECT link.entry_version, link.snapshot, entry.id AS entry_id FROM tenant.project_timesheet_submission_entries link JOIN tenant.project_time_entries entry ON entry.id = link.entry_id
      WHERE link.organization_id = $1 AND link.submission_id = $2`, [c.organizationId, row.id])).rows;
  const current = links.length ? (await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND entry.id = ANY($2::uuid[]) ORDER BY entry.work_date, entry.start_at NULLS LAST`,
    [c.organizationId, links.map((link) => link.entry_id)])).rows : [];
  const versions = (await client.query(`${SUBMISSION_SELECT} WHERE submission.organization_id = $1 AND submission.employee_user_id = $2 AND submission.project_id = $3 AND submission.period_start = $4
      ORDER BY submission.submission_version`, [c.organizationId, row.employee_user_id, row.project_id, row.period_start_text])).rows;
  const events = (await client.query(`SELECT * FROM tenant.project_time_events WHERE organization_id = $1 AND submission_id = ANY($2::uuid[]) AND entry_id IS NULL ORDER BY occurred_at`,
    [c.organizationId, versions.map((version) => version.id)])).rows;
  const names = await userNames(client, [...current.flatMap((entry) => [entry.employee_user_id, entry.entered_by, entry.approved_by]), ...versions.flatMap((v) => [v.employee_user_id, v.approver_user_id, v.decided_by]),
    ...events.map((event) => event.actor_user_id)]);
  const byId = new Map(links.map((link) => [link.entry_id, link]));
  const entries = current.map((entry) => {
    const link = byId.get(entry.id);
    return { ...entryView(c, entry, names), submitted: link.snapshot, submittedVersion: link.entry_version,
      changedSinceSubmitted: Number(entry.row_version) !== Number(link.entry_version) && row.status === "SUBMITTED", returned: (row.returned_entry_ids ?? []).includes(entry.id) };
  });
  const canApprove = row.status === "SUBMITTED" && await mayDecide(client, c, row, project, TIME.approve);
  const canReturn = row.status === "SUBMITTED" && await mayDecide(client, c, row, project, TIME.requestChanges);
  const closed = links.length ? (await client.query(`SELECT DISTINCT period.name FROM tenant.fiscal_periods period WHERE period.organization_id = $1 AND period.status IN ('closed', 'locked')
      AND period.start_date <= $3::date AND period.end_date >= $2::date`, [c.organizationId, row.period_start_text, row.period_end_text])).rows.map((p) => p.name) : [];
  const flagged = entries.filter((entry) => entry.flags.length);
  const checks = [
    { key: "versions", label: "Submitted versions unchanged", state: entries.some((entry) => entry.changedSinceSubmitted) ? "FAIL" : "PASS" },
    { key: "description", label: "Every entry describes the work", state: "PASS" },
    { key: "billable", label: "Billable time has its commercial authority", state: entries.some((entry) => entry.classification === "ELIGIBILITY_PENDING") ? "WARN" : "PASS",
      message: entries.some((entry) => entry.classification === "ELIGIBILITY_PENDING") ? "Some billable time waits for a contract line: it can be approved, but not billed until one applies." : null },
    { key: "period", label: "Accounting period open", state: closed.length ? "FAIL" : "PASS", message: closed.length ? `${closed.join(", ")} closed` : null },
    { key: "flags", label: "Items needing review", state: flagged.length ? "WARN" : "PASS", message: flagged.length ? `${flagged.length} entr${flagged.length === 1 ? "y" : "ies"} flagged` : null },
    { key: "reviewer", label: "You may decide this timesheet", state: canApprove || row.status !== "SUBMITTED" ? "PASS" : "FAIL",
      message: row.employee_user_id === c.userId ? "Your own time is approved by someone else." : canApprove || row.status !== "SUBMITTED" ? null : "Only the project's manager, or an approver for every project, decides it." },
  ];
  return {
    ...submissionRow(row, names), entries, totals: calculateTimesheetTotals(entries.map((entry) => ({ ...entry, status: "SUBMITTED" }))), checks,
    versions: versions.map((version) => submissionRow(version, names)),
    history: events.map((event) => ({ id: event.id, action: event.action, summary: event.summary, actor: names.get(event.actor_user_id) ?? "System", at: event.occurred_at })),
    can: { approve: canApprove, requestChanges: canReturn, mine: row.employee_user_id === c.userId },
  };
}

// ------------------------------------------------------------------ team
// A manager's week: each team member of each project they lead — recorded, unsubmitted, submitted and approved time, the latest submission,
// and "no time recorded" when there is none (never zero hours worked).
export async function getTeamTimesheets(client, c, input = {}) {
  if (!has(c, TIME.viewTeam)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const policy = await timePolicy(client, c);
  const today = await companyToday(client, c);
  const week = weekOf(workDay(input.week ?? today, "week"), policy.weekStart);
  const end = addDays(week, 6);
  const projectId = input.projectId ? uuid(input.projectId, "Project") : null;
  const people = (await client.query(`SELECT DISTINCT project.id AS project_id, project.project_code, project.name AS project_name, project.status, team.user_id
      FROM tenant.projects project JOIN LATERAL (
        SELECT member.user_id FROM tenant.project_members member WHERE member.project_id = project.id AND member.role IN ('MANAGER', 'MEMBER')
          AND member.joined_at::date <= $4::date AND (member.left_at IS NULL OR member.left_at::date >= $3::date)
        UNION SELECT project.manager_user_id WHERE project.manager_user_id IS NOT NULL) team ON TRUE
      WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED') AND ${teamSql(c)}
        AND ($5::uuid IS NULL OR project.id = $5) AND (project.status IN ('IN_PROGRESS', 'ON_HOLD') OR EXISTS (SELECT 1 FROM tenant.project_time_entries entry WHERE entry.project_id = project.id AND entry.work_date BETWEEN $3 AND $4))
      ORDER BY project.project_code`, [c.organizationId, c.userId ?? null, week, end, projectId])).rows;
  const sums = (await client.query(`SELECT entry.project_id, entry.employee_user_id, entry.entry_status, sum(entry.duration_minutes)::int AS minutes, count(*)::int AS n
      FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id
      WHERE entry.organization_id = $1 AND entry.work_date BETWEEN $3 AND $4 AND entry.entry_status <> 'VOIDED' AND ${teamSql(c)} GROUP BY 1, 2, 3`, [c.organizationId, c.userId ?? null, week, end])).rows;
  const subs = (await client.query(`SELECT DISTINCT ON (submission.project_id, submission.employee_user_id) submission.*, to_char(submission.period_start, 'YYYY-MM-DD') AS period_start_text,
        to_char(submission.period_end, 'YYYY-MM-DD') AS period_end_text, project.project_code, project.name AS project_name
      FROM tenant.project_timesheet_submissions submission JOIN tenant.projects project ON project.id = submission.project_id
      WHERE submission.organization_id = $1 AND submission.period_start = $3 AND ${teamSql(c)} ORDER BY submission.project_id, submission.employee_user_id, submission.submission_version DESC`,
  [c.organizationId, c.userId ?? null, week])).rows;
  const names = await userNames(client, [...people.map((row) => row.user_id), ...subs.flatMap((row) => [row.decided_by, row.approver_user_id])]);
  const deadline = deadlineOf(week, policy);
  const rows = people.map((person) => {
    const mine = sums.filter((row) => row.project_id === person.project_id && row.employee_user_id === person.user_id);
    const by = (status) => mine.filter((row) => row.entry_status === status).reduce((sum, row) => sum + row.minutes, 0);
    const recorded = mine.reduce((sum, row) => sum + row.minutes, 0);
    const sub = subs.find((row) => row.project_id === person.project_id && row.employee_user_id === person.user_id);
    const unsubmitted = by("DRAFT") + by("CHANGES_REQUESTED");
    return { projectId: person.project_id, project: project$(person), employeeUserId: person.user_id, employee: names.get(person.user_id) ?? null, recordedMinutes: recorded, recorded: recorded ? hoursLabel(recorded) : null,
      unsubmittedMinutes: unsubmitted, submittedMinutes: by("SUBMITTED"), approvedMinutes: by("APPROVED"),
      state: !recorded ? "NO_TIME" : unsubmitted ? (today > deadline ? "LATE" : "PENDING_SUBMISSION") : by("SUBMITTED") ? "AWAITING_REVIEW" : "APPROVED",
      summary: !recorded ? "No time recorded" : unsubmitted ? `${hoursLabel(unsubmitted)} recorded — submission pending` : by("SUBMITTED") ? `${hoursLabel(by("SUBMITTED"))} awaiting review` : `${hoursLabel(recorded)} approved`,
      submission: sub ? submissionRow(sub, names) : null };
  });
  return { weekStart: week, weekEnd: end, previousWeek: addDays(week, -7), nextWeek: addDays(week, 7), deadline, rows,
    totals: { recordedMinutes: rows.reduce((s, r) => s + r.recordedMinutes, 0), unsubmittedMinutes: rows.reduce((s, r) => s + r.unsubmittedMinutes, 0), submittedMinutes: rows.reduce((s, r) => s + r.submittedMinutes, 0),
      approvedMinutes: rows.reduce((s, r) => s + r.approvedMinutes, 0), withoutTime: rows.filter((r) => r.state === "NO_TIME").length } };
}

// ------------------------------------------------------------------ corrections
function correctionView(row, names) {
  return { id: row.id, number: `TC-${row.correction_number}`, entryId: row.entry_id, kind: row.kind, original: row.original, proposed: row.proposed, reason: row.reason, status: row.status,
    requestedBy: names.get(row.requested_by) ?? null, requestedAt: row.requested_at, decidedBy: row.decided_by ? names.get(row.decided_by) ?? null : null, decidedAt: row.decided_at, decisionNote: row.decision_note,
    replacementEntryId: row.replacement_entry_id, costAdjustment: row.cost_adjustment, billingAdjustmentRequired: row.billing_adjustment_required, billingAdjustmentReference: row.billing_adjustment_reference, version: row.row_version };
}
export async function listTimeCorrections(client, c, filters = {}) {
  const status = ["REQUESTED", "APPLIED", "REJECTED"].includes(filters.status) ? filters.status : null;
  const rows = (await client.query(`SELECT correction.*, project.project_code, project.name AS project_name, project.manager_user_id, entry.entry_number
      FROM tenant.project_time_corrections correction JOIN tenant.projects project ON project.id = correction.project_id JOIN tenant.project_time_entries entry ON entry.id = correction.entry_id
      WHERE correction.organization_id = $1 AND ($3::text IS NULL OR correction.status = $3)
        AND (correction.employee_user_id = $2 OR correction.requested_by = $2 OR ${teamSql(c)} OR (${has(c, TIME.correct) ? "TRUE" : "FALSE"} AND (${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = $2)))
      ORDER BY (correction.status = 'REQUESTED') DESC, correction.requested_at DESC LIMIT 300`, [c.organizationId, c.userId ?? null, status])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.requested_by, row.decided_by, row.employee_user_id]));
  return { rows: rows.map((row) => ({ ...correctionView(row, names), entryNumber: `TE-${row.entry_number}`, project: project$(row), projectId: row.project_id, employee: names.get(row.employee_user_id) ?? null,
    can: { decide: row.status === "REQUESTED" && has(c, TIME.correct) && (seesAll(c) || row.manager_user_id === c.userId) && row.requested_by !== c.userId && row.employee_user_id !== c.userId } })) };
}

// ------------------------------------------------------------------ a project's time
export async function getProjectTimeSummary(client, c, projectId) {
  const project = await loadProjectRow(client, c, projectId);
  const team = canTeam(c, project);
  const scope = team ? "($3::uuid IS NULL OR TRUE)" : "entry.employee_user_id = $3";
  const totals = (await client.query(`SELECT entry.entry_status, sum(entry.duration_minutes)::int AS minutes, sum(entry.duration_minutes) FILTER (WHERE entry.billable)::int AS billable, count(*)::int AS n
      FROM tenant.project_time_entries entry WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status <> 'VOIDED' AND ${scope} GROUP BY 1`, [c.organizationId, project.id, c.userId ?? null])).rows;
  if (!team && !has(c, TIME.viewOwn)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const minutes = (status) => totals.filter((row) => !status || row.entry_status === status).reduce((sum, row) => sum + row.minutes, 0);
  const byTask = team ? (await client.query(`SELECT task.id, task.task_code, task.title, task.estimate_minutes, sum(entry.duration_minutes)::int AS minutes, sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED')::int AS approved
      FROM tenant.project_time_entries entry LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status <> 'VOIDED'
      GROUP BY 1, 2, 3, 4 ORDER BY minutes DESC LIMIT 50`, [c.organizationId, project.id])).rows : [];
  const byEmployee = team ? (await client.query(`SELECT entry.employee_user_id, sum(entry.duration_minutes)::int AS minutes, sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED')::int AS approved,
        sum(entry.duration_minutes) FILTER (WHERE entry.billable)::int AS billable, sum(entry.cost_amount) AS cost, min(entry.cost_currency) AS currency
      FROM tenant.project_time_entries entry WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status <> 'VOIDED' GROUP BY 1 ORDER BY minutes DESC`, [c.organizationId, project.id])).rows : [];
  const approvedBillable = totals.filter((row) => row.entry_status === "APPROVED").reduce((sum, row) => sum + (row.billable ?? 0), 0);
  const names = await userNames(client, byEmployee.map((row) => row.employee_user_id));
  const policy = await projectBillingPolicy(client, c, project);
  const cost = viewsCost(c);
  return {
    projectId: project.id, code: project.project_code, team,
    policy: { billingMethod: policy.method, billingMethodLabel: policy.method ? BILLING_METHODS[policy.method] : "Not set", reference: policy.reference, version: policy.version },
    totals: { recordedMinutes: minutes(), draftMinutes: minutes("DRAFT") + minutes("CHANGES_REQUESTED"), submittedMinutes: minutes("SUBMITTED"), approvedMinutes: minutes("APPROVED"),
      billableMinutes: totals.reduce((sum, row) => sum + (row.billable ?? 0), 0), approvedBillableMinutes: approvedBillable },
    byTask: byTask.map((row) => ({ taskId: row.id, task: row.task_code ? `${row.task_code} · ${row.title}` : "Project-level work", estimateMinutes: row.estimate_minutes, recordedMinutes: row.minutes, approvedMinutes: row.approved ?? 0 })),
    byEmployee: byEmployee.map((row) => ({ employeeUserId: row.employee_user_id, employee: names.get(row.employee_user_id) ?? null, recordedMinutes: row.minutes, approvedMinutes: row.approved ?? 0, billableMinutes: row.billable ?? 0,
      ...(cost ? { cost: row.cost === null ? null : String(row.cost), currency: row.currency } : {}) })),
    ...(cost ? { cost: { total: String(byEmployee.reduce((sum, row) => sum + Number(row.cost ?? 0), 0)), currency: byEmployee.find((row) => row.currency)?.currency ?? null } } : {}),
    can: { team, setBilling: mayManagePolicy(c, project), record: has(c, TIME.create), export: has(c, TIME.export) },
  };
}

// ------------------------------------------------------------------ reports
export const TIME_REPORTS = Object.freeze(["my-summary", "employee-hours", "project-hours", "task-hours", "approval-status", "unsubmitted", "exceptions", "late",
  "labor-cost", "corrections", "by-manager"]);
// filters: { from?, to?, projectId? }. Every report except "my-summary" reads the projects the person leads (or all, with the permission).
export async function getProjectTimeReport(client, c, kind = "project-hours", filters = {}) {
  if (!TIME_REPORTS.includes(kind)) throw timeError(400, "TIME_PERMISSION_DENIED", "Unknown report.");
  const today = await companyToday(client, c);
  const from = filters.from ? workDay(filters.from, "start date") : addDays(today, -90);
  const to = filters.to ? workDay(filters.to, "end date") : today;
  const projectId = filters.projectId ? uuid(filters.projectId, "Project") : null;
  const values = [c.organizationId, c.userId ?? null, from, to, projectId];
  const base = `entry.organization_id = $1 AND entry.work_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR entry.project_id = $5) AND entry.entry_status <> 'VOIDED'`;
  const query = async (sql, params = values) => (await client.query(sql, params)).rows;
  if (kind === "my-summary") {
    if (!has(c, TIME.viewOwn)) throw timeError(403, "TIME_PERMISSION_DENIED");
    const policy = await timePolicy(client, c);
    const rows = await query(`SELECT to_char(entry.work_date - (((extract(isodow FROM entry.work_date)::int - $6 + 7) % 7) * interval '1 day'), 'YYYY-MM-DD') AS week,
        sum(entry.duration_minutes)::int AS total, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billable), 0)::int AS billable,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'SUBMITTED'), 0)::int AS pending,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status IN ('DRAFT', 'CHANGES_REQUESTED')), 0)::int AS unsubmitted
      FROM tenant.project_time_entries entry WHERE ${base} AND entry.employee_user_id = $2 GROUP BY 1 ORDER BY 1 DESC`, [...values, policy.weekStart]);
    return rows;
  }
  if (!has(c, TIME.viewTeam) && !(kind === "labor-cost" && viewsCost(c))) throw timeError(403, "TIME_PERMISSION_DENIED");
  if (kind === "labor-cost" && !viewsCost(c)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const scope = `(${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = $2)`;
  const FROM = `FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id`;
  const named = async (rows, fields) => { const names = await userNames(client, rows.flatMap((row) => fields.map((field) => row[field]))); return rows.map((row) => ({ ...row, ...Object.fromEntries(fields.map((field) => [`${field}_name`, names.get(row[field]) ?? null])) })); };
  switch (kind) {
    case "employee-hours": return named(await query(`SELECT entry.employee_user_id, sum(entry.duration_minutes)::int AS total, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'SUBMITTED'), 0)::int AS pending, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status IN ('DRAFT', 'CHANGES_REQUESTED')), 0)::int AS unsubmitted,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billable), 0)::int AS billable, count(DISTINCT entry.project_id)::int AS projects ${FROM} WHERE ${base} AND ${scope} GROUP BY 1 ORDER BY total DESC`), ["employee_user_id"]);
    case "project-hours": return query(`SELECT project.id AS project_id, project.project_code, project.name AS project_name, sum(entry.duration_minutes)::int AS total,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billable), 0)::int AS billable,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE NOT entry.billable), 0)::int AS non_billable, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billable AND entry.entry_status = 'APPROVED'), 0)::int AS approved_billable,
        count(DISTINCT entry.employee_user_id)::int AS people ${FROM} WHERE ${base} AND ${scope} GROUP BY 1, 2, 3 ORDER BY total DESC`);
    case "task-hours": return query(`SELECT project.project_code, task.task_code, COALESCE(task.title, 'Project-level work') AS task_title, task.estimate_minutes, sum(entry.duration_minutes)::int AS total,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved ${FROM} LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id
        WHERE ${base} AND ${scope} GROUP BY 1, 2, 3, 4 ORDER BY 1, total DESC`);
    case "approval-status": return query(`SELECT entry.entry_status AS status, sum(entry.duration_minutes)::int AS total, count(*)::int AS entries ${FROM} WHERE ${base} AND ${scope} GROUP BY 1 ORDER BY 1`);
    case "unsubmitted": {
      const policy = await timePolicy(client, c);
      const recorded = await named(await query(`SELECT entry.employee_user_id, project.project_code, project.name AS project_name,
          to_char(entry.work_date - (((extract(isodow FROM entry.work_date)::int - $6 + 7) % 7) * interval '1 day'), 'YYYY-MM-DD') AS week, sum(entry.duration_minutes)::int AS unsubmitted, min(entry.created_at) AS oldest
        ${FROM} WHERE ${base} AND ${scope} AND entry.entry_status IN ('DRAFT', 'CHANGES_REQUESTED') GROUP BY 1, 2, 3, 4 ORDER BY 4, 2`, [...values, policy.weekStart]), ["employee_user_id"]);
      // Team members of running projects with no time at all in the last full week: shown as missing, never as zero hours worked.
      const lastWeek = addDays(weekOf(today, policy.weekStart), -7);
      const missing = await named(await query(`SELECT member.user_id AS employee_user_id, project.project_code, project.name AS project_name FROM tenant.projects project
          JOIN tenant.project_members member ON member.project_id = project.id AND member.role IN ('MANAGER', 'MEMBER') AND member.left_at IS NULL AND member.joined_at::date <= $3::date
        WHERE project.organization_id = $1 AND project.status = 'IN_PROGRESS' AND project.deleted_at IS NULL AND ${scope} AND ($5::uuid IS NULL OR project.id = $5)
          AND NOT EXISTS (SELECT 1 FROM tenant.project_time_entries entry WHERE entry.project_id = project.id AND entry.employee_user_id = member.user_id AND entry.work_date BETWEEN $3 AND $4)
        ORDER BY 2`, [c.organizationId, c.userId ?? null, lastWeek, addDays(lastWeek, 6), projectId]), ["employee_user_id"]);
      return [...recorded.map((row) => ({ ...row, state: "PENDING_SUBMISSION", stale: (Date.now() - new Date(row.oldest).getTime()) > 14 * 864e5 })),
        ...missing.map((row) => ({ ...row, week: lastWeek, unsubmitted: null, state: "NO_TIME" }))];
    }
    case "exceptions": return named(await query(`SELECT entry.id, entry.entry_number, entry.employee_user_id, project.project_code, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.duration_minutes,
        entry.entry_status, entry.review_flags, entry.start_at IS NOT NULL AS timed ${FROM} WHERE ${base} AND ${scope} AND jsonb_array_length(entry.review_flags - 'DELEGATED') > 0 ORDER BY entry.work_date DESC LIMIT 500`), ["employee_user_id"]);
    case "late": return named(await query(`SELECT submission.id, submission.employee_user_id, project.project_code, to_char(submission.period_start, 'YYYY-MM-DD') AS week, submission.total_minutes, submission.late_reason,
        submission.submitted_at, submission.status FROM tenant.project_timesheet_submissions submission JOIN tenant.projects project ON project.id = submission.project_id
        WHERE submission.organization_id = $1 AND submission.late AND submission.period_start BETWEEN $3::date - 6 AND $4 AND ($5::uuid IS NULL OR submission.project_id = $5) AND ${scope} ORDER BY submission.submitted_at DESC`), ["employee_user_id"]);
    case "labor-cost": return named(await query(`SELECT project.project_code, project.name AS project_name, entry.employee_user_id, sum(entry.duration_minutes)::int AS approved, sum(entry.cost_amount) AS cost,
        min(entry.cost_currency) AS currency, count(*) FILTER (WHERE entry.cost_recorded_at IS NULL)::int AS without_rate ${FROM}
        WHERE ${base} AND entry.entry_status = 'APPROVED' AND (${seesAll(c) ? "TRUE" : "FALSE"} OR project.manager_user_id = $2) GROUP BY 1, 2, 3 ORDER BY 1, cost DESC NULLS LAST`), ["employee_user_id"]);
    case "corrections": return named(await query(`SELECT correction.id, correction.correction_number, correction.kind, correction.status, correction.reason, correction.employee_user_id, correction.requested_by, correction.decided_by,
        correction.requested_at, correction.decided_at, correction.billing_adjustment_required, correction.billing_adjustment_reference, correction.original, correction.proposed, project.project_code
        FROM tenant.project_time_corrections correction JOIN tenant.projects project ON project.id = correction.project_id
        WHERE correction.organization_id = $1 AND correction.requested_at::date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR correction.project_id = $5) AND ${scope} ORDER BY correction.requested_at DESC`),
    ["employee_user_id", "requested_by", "decided_by"]);
    case "by-manager": return named(await query(`SELECT project.manager_user_id, count(DISTINCT project.id)::int AS projects, sum(entry.duration_minutes)::int AS total,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved, COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'SUBMITTED'), 0)::int AS pending
        ${FROM} WHERE ${base} AND ${scope} GROUP BY 1 ORDER BY total DESC`), ["manager_user_id"]);
    default: return [];
  }
}

// ------------------------------------------------------------------ export
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
// Approved time (or another status) as CSV: the person's own, or the projects they lead with team access.
export async function exportProjectTime(client, c, filters = {}) {
  if (!has(c, TIME.export)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const status = ENTRY_STATUS_LABEL[filters.status] ? filters.status : filters.status === "ALL" ? null : "APPROVED";
  const today = await companyToday(client, c);
  const from = filters.from ? workDay(filters.from, "start date") : addDays(today, -90);
  const to = filters.to ? workDay(filters.to, "end date") : today;
  const rows = (await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND ${scopeSql(c)} AND entry.work_date BETWEEN $3 AND $4 AND ($5::text IS NULL OR entry.entry_status = $5)
      AND ($6::uuid IS NULL OR entry.project_id = $6) ORDER BY entry.work_date, entry.entry_number LIMIT 20000`,
  [c.organizationId, c.userId ?? null, from, to, status, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
  const names = await namesFor(client, rows);
  const cost = viewsCost(c);
  const billing = viewsBilling(c);
  const header = ["Entry", "Employee", "Project", "Task", "Work date", "Start", "End", "Minutes", "Hours", "Billable", "Status", "Approved by", "Approved at", "Description",
    ...(cost ? ["Rate", "Cost", "Currency"] : []), ...(billing ? ["Billing", "Invoiced minutes"] : [])];
  const lines = rows.map((row) => [`TE-${row.entry_number}`, names.get(row.employee_user_id) ?? "", project$(row), row.task_code ? `${row.task_code} ${row.task_title}` : "", row.work_date_text, row.start_time ?? "", row.end_time ?? "",
    row.duration_minutes, (row.duration_minutes / 60).toFixed(2), row.billable ? "Yes" : "No", ENTRY_STATUS_LABEL[row.entry_status], names.get(row.approved_by) ?? "", row.approved_at ? new Date(row.approved_at).toISOString() : "",
    row.description, ...(cost ? [row.cost_rate ?? "", row.cost_amount ?? "", row.cost_currency ?? ""] : []), ...(billing ? [commercialState(row).label, row.invoiced_minutes] : [])]);
  return { fileName: `project-time-${from}-to-${to}.csv`, csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: rows.length };
}

// ------------------------------------------------------------------ settings
export async function getTimesheetSettings(client, c) {
  const policy = await timePolicy(client, c);
  return { ...policy, can: { manage: has(c, "projects.settings.manage") } };
}
// input: { weekStart?, dailyReviewMinutes?, dailyLimitMinutes?, incrementMinutes?, deadlineDays?, lateAllowed?, boundaryDayPolicy?, collaboratorsAllowed? }
export async function saveTimesheetSettings(client, c, input = {}) {
  if (!has(c, "projects.settings.manage")) throw timeError(403, "TIME_PERMISSION_DENIED");
  const current = await timePolicy(client, c);
  const next = { ...current };
  const int = (value, min, max, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw timeError(400, "TIME_DURATION_INVALID", `${label} must be between ${min} and ${max}.`);
    return n;
  };
  if (input.weekStart !== undefined) next.weekStart = int(input.weekStart, 1, 7, "The week start");
  if (input.dailyLimitMinutes !== undefined) next.dailyLimitMinutes = int(input.dailyLimitMinutes, 60, 1440, "The daily limit");
  if (input.dailyReviewMinutes !== undefined) next.dailyReviewMinutes = int(input.dailyReviewMinutes, 1, 1440, "The daily review threshold");
  if (next.dailyReviewMinutes > next.dailyLimitMinutes) throw timeError(400, "TIME_DURATION_INVALID", "The review threshold is at or below the daily limit.");
  if (input.incrementMinutes !== undefined) { next.incrementMinutes = Number(input.incrementMinutes); if (![1, 5, 6, 10, 15, 30].includes(next.incrementMinutes)) throw timeError(400, "TIME_DURATION_INVALID", "Choose 1, 5, 6, 10, 15 or 30 minutes."); }
  if (input.deadlineDays !== undefined) next.deadlineDays = int(input.deadlineDays, 0, 60, "The submission deadline");
  if (input.lateAllowed !== undefined) next.lateAllowed = Boolean(input.lateAllowed);
  if (input.collaboratorsAllowed !== undefined) next.collaboratorsAllowed = Boolean(input.collaboratorsAllowed);
  if (input.boundaryDayPolicy !== undefined) { next.boundaryDayPolicy = String(input.boundaryDayPolicy).toUpperCase(); if (!["REVIEW", "BLOCK"].includes(next.boundaryDayPolicy)) throw timeError(400, "TIME_DURATION_INVALID", "Choose review or block."); }
  await client.query(`INSERT INTO tenant.project_settings (organization_id, time_week_start, time_daily_review_minutes, time_daily_limit_minutes, time_increment_minutes, time_submission_deadline_days,
        time_late_submission_allowed, time_boundary_day_policy, time_collaborators_allowed, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      ON CONFLICT (organization_id) DO UPDATE SET time_week_start = EXCLUDED.time_week_start, time_daily_review_minutes = EXCLUDED.time_daily_review_minutes, time_daily_limit_minutes = EXCLUDED.time_daily_limit_minutes,
        time_increment_minutes = EXCLUDED.time_increment_minutes, time_submission_deadline_days = EXCLUDED.time_submission_deadline_days, time_late_submission_allowed = EXCLUDED.time_late_submission_allowed,
        time_boundary_day_policy = EXCLUDED.time_boundary_day_policy, time_collaborators_allowed = EXCLUDED.time_collaborators_allowed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [c.organizationId, next.weekStart, next.dailyReviewMinutes, next.dailyLimitMinutes, next.incrementMinutes, next.deadlineDays, next.lateAllowed, next.boundaryDayPolicy, next.collaboratorsAllowed, c.userId ?? null]);
  return getTimesheetSettings(client, c);
}

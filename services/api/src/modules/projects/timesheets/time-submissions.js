// Projects — Timesheets, the review: an employee submits a week's unsubmitted time — one review version per project, carrying the exact
// entry versions — and that project's manager (never the employee, nor whoever recorded the time for them) approves it or returns it with
// the reason. Approval locks the time and fixes its labor-cost snapshot; it never creates an invoice, a payroll item or a journal. A
// returned week is corrected and submitted again as a new version. Reminders tell people about due and late weeks, once each.
import { publishDomainEvent } from "../../../core/platform/events/index.js";
import { has, seesAll, text, userNames, uuid } from "../project-core.js";
import { lineProblem, loadContractLine } from "../billable/billable-rules.js";
import { costEntry } from "./time-costing.js";
import { notifyTime, timeEvent, validateTimeEntryEligibility } from "./time-entries.js";
import {
  TIME, addDays, assertPeriodOpen, canTeam, companyToday, deadlineOf, hoursLabel, keyOf, loadProjectRow, timeError, timePolicy, weekOf, workDay,
} from "./time-rules.js";

const publish = (client, c, submission, type, payload = {}) => publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: `projects.timesheet.${type}`,
  entityType: "projects.timesheet", entityId: submission.id, payload: { projectId: submission.project_id, employeeUserId: submission.employee_user_id,
    periodStart: submission.period_start_text ?? submission.period_start, version: submission.submission_version, ...payload } });
const href = (submissionId) => `/projects/timesheets/${submissionId}`;

// ------------------------------------------------------------------ submit
// input: { weekStart? (any day of the week; this week by default), projectIds?, lateReason?, idempotencyKey? }
export async function submitTimesheet(client, c, input = {}) {
  if (!has(c, TIME.submit) || !c.userId) throw timeError(403, "TIME_PERMISSION_DENIED");
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, project_id, submission_version, total_minutes, status FROM tenant.project_timesheet_submissions WHERE organization_id = $1 AND idempotency_key LIKE $2 ORDER BY idempotency_key`,
      [c.organizationId, `${key.replace(/[%_\\]/g, "\\$&")}:%`])).rows;
    if (done.length) return { submissions: done.map((row) => ({ submissionId: row.id, projectId: row.project_id, version: row.submission_version, totalMinutes: row.total_minutes, status: row.status })), replayed: true };
  }
  const policy = await timePolicy(client, c);
  const today = await companyToday(client, c);
  const week = weekOf(workDay(input.weekStart ?? today, "week"), policy.weekStart);
  const end = addDays(week, 6);
  const only = Array.isArray(input.projectIds) && input.projectIds.length ? input.projectIds.map((id) => uuid(id, "Project")) : null;
  const entries = (await client.query(`SELECT *, to_char(work_date, 'YYYY-MM-DD') AS work_date_text FROM tenant.project_time_entries
      WHERE organization_id = $1 AND employee_user_id = $2 AND work_date BETWEEN $3 AND $4 AND entry_status IN ('DRAFT', 'CHANGES_REQUESTED') AND ($5::uuid[] IS NULL OR project_id = ANY($5))
      ORDER BY id FOR UPDATE`, [c.organizationId, c.userId, week, end, only])).rows;
  if (!entries.length) throw timeError(400, "TIME_NOTHING_TO_SUBMIT");
  const deadline = deadlineOf(week, policy);
  const late = today > deadline;
  const lateReason = text(input.lateReason, 1000) || null;
  if (late && !policy.lateAllowed) throw timeError(409, "TIME_PERIOD_CLOSED", `This week's submission window closed on ${deadline}. Ask your project manager for an authorized correction.`);
  if (late && (!lateReason || lateReason.length < 3)) throw timeError(400, "TIME_SUBMISSION_LATE", `This week was due by ${deadline}. Give the reason it is late.`, { deadline });
  const byProject = new Map();
  for (const entry of entries) byProject.set(entry.project_id, [...(byProject.get(entry.project_id) ?? []), entry]);
  const made = [];
  for (const [projectId, rows] of byProject) {
    const project = await loadProjectRow(client, c, projectId);
    const pending = (await client.query(`SELECT 1 FROM tenant.project_timesheet_submissions WHERE organization_id = $1 AND employee_user_id = $2 AND project_id = $3 AND period_start = $4 AND status = 'SUBMITTED'`,
      [c.organizationId, c.userId, projectId, week])).rows[0];
    if (pending) throw timeError(409, "TIME_ALREADY_SUBMITTED", `Your ${project.project_code} time for this week is already waiting for review. Add the rest once it is reviewed.`);
    // Each entry is checked again as it is submitted (the project or the person's team membership may have changed since it was saved).
    // Its billing classification is decided again under the project's policy as it is now, and frozen with the submitted version.
    const flagsOf = new Map();
    const billingOf = new Map();
    for (const entry of rows) {
      const check = await validateTimeEntryEligibility(client, c, { project, employeeUserId: entry.employee_user_id, taskId: entry.task_id, day: entry.work_date_text,
        interval: entry.start_at ? { startAt: entry.start_at, endAt: entry.end_at } : null, duration: entry.duration_minutes, billable: entry.billable, preferredLineId: entry.contract_line_id,
        reasonCode: entry.billing_reason_code, reasonNote: entry.billing_reason_note, excludeEntryId: entry.id, policy, recording: false });
      billingOf.set(entry.id, check.billing);
      flagsOf.set(entry.id, [...new Set([...(entry.review_flags ?? []).filter((flag) => !["DAILY_TOTAL_REVIEW", "BOUNDARY_DAY_REVIEW", "TASK_CANCELLED"].includes(flag)), ...check.flags, ...(late ? ["LATE"] : [])])]);
    }
    const previous = (await client.query(`SELECT id, submission_version FROM tenant.project_timesheet_submissions WHERE organization_id = $1 AND employee_user_id = $2 AND project_id = $3 AND period_start = $4
        ORDER BY submission_version DESC LIMIT 1`, [c.organizationId, c.userId, projectId, week])).rows[0];
    const managerActive = project.manager_user_id && project.manager_user_id !== c.userId
      && (await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [c.organizationId, project.manager_user_id])).rows[0];
    const approver = managerActive ? project.manager_user_id : null;
    const total = rows.reduce((sum, row) => sum + row.duration_minutes, 0);
    const billable = rows.filter((row) => billingOf.get(row.id).billable).reduce((sum, row) => sum + row.duration_minutes, 0);
    const flags = [...new Set([...flagsOf.values()].flat())];
    const submission = (await client.query(`INSERT INTO tenant.project_timesheet_submissions (organization_id, employee_user_id, project_id, period_start, period_end, submission_version, previous_submission_id,
          approver_user_id, total_minutes, billable_minutes, entry_count, late, late_reason, flags, submitted_by, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$2,$15) RETURNING *, to_char(period_start, 'YYYY-MM-DD') AS period_start_text`,
    [c.organizationId, c.userId, projectId, week, end, (previous?.submission_version ?? 0) + 1, previous?.id ?? null, approver, total, billable, rows.length, late, late ? lateReason : null,
      JSON.stringify(flags), key ? `${key}:${projectId}` : null])).rows[0];
    for (const entry of rows) {
      const b = billingOf.get(entry.id);
      const version = (await client.query(`UPDATE tenant.project_time_entries SET entry_status = 'SUBMITTED', submission_id = $3, review_flags = $4::jsonb, row_version = row_version + 1, updated_by = $5, updated_at = now(),
            billable = $6, billing_classification = $7, billing_reason_code = $8, billing_reason_note = $9, billing_policy_version = $10, contract_line_id = $11
          WHERE organization_id = $1 AND id = $2 RETURNING row_version`, [c.organizationId, entry.id, submission.id, JSON.stringify(flagsOf.get(entry.id)), c.userId, b.billable, b.classification, b.reasonCode,
        b.reasonNote, b.policyVersion, b.contractLineId])).rows[0].row_version;
      await client.query(`INSERT INTO tenant.project_timesheet_submission_entries (organization_id, submission_id, entry_id, entry_version, snapshot) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [c.organizationId, submission.id, entry.id, version, JSON.stringify({ projectId, taskId: entry.task_id, workDate: entry.work_date_text, durationMinutes: entry.duration_minutes,
          description: entry.description, billable: b.billable, classification: b.classification, reasonCode: b.reasonCode, contractLineId: b.contractLineId, policyVersion: b.policyVersion,
          startAt: entry.start_at, endAt: entry.end_at, flags: flagsOf.get(entry.id) })]);
      await timeEvent(client, c, { projectId, employeeUserId: c.userId, entryId: entry.id, submissionId: submission.id, action: "SUBMITTED", from: entry.entry_status, to: "SUBMITTED" });
    }
    await timeEvent(client, c, { projectId, employeeUserId: c.userId, submissionId: submission.id, action: submission.submission_version > 1 ? "RESUBMITTED" : "SUBMITTED", to: "SUBMITTED",
      summary: `Week of ${week}: ${hoursLabel(total)} (${hoursLabel(billable)} billable)${late ? `, late: ${lateReason}` : ""}`, details: { version: submission.submission_version, flags } });
    const reviewers = approver ? [approver] : (await client.query(`SELECT user_id FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND role = 'MANAGER' AND left_at IS NULL`,
      [c.organizationId, projectId])).rows.map((row) => row.user_id);
    const names = await userNames(client, [c.userId]);
    await notifyTime(client, c, reviewers, { title: `${names.get(c.userId) ?? "A team member"} submitted time on ${project.project_code}`,
      message: `Week of ${week}: ${hoursLabel(total)}${submission.submission_version > 1 ? ` (version ${submission.submission_version})` : ""}${flags.length ? " — has items to review" : ""}.`, href: href(submission.id), entityId: submission.id });
    await publish(client, c, submission, "submitted", { status: "SUBMITTED", totalMinutes: total, billableMinutes: billable });
    made.push({ submissionId: submission.id, projectId, version: submission.submission_version, totalMinutes: total, status: "SUBMITTED" });
  }
  return { submissions: made, late, weekStart: week };
}

// ------------------------------------------------------------------ decide
async function lockSubmission(client, c, submissionId) {
  const row = (await client.query(`SELECT *, to_char(period_start, 'YYYY-MM-DD') AS period_start_text FROM tenant.project_timesheet_submissions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [c.organizationId, uuid(submissionId, "Timesheet")])).rows[0];
  if (!row) throw timeError(404, "TIME_NOT_FOUND");
  return row;
}
// May this person decide this submission? The project's manager (or someone who reviews every project), with the permission — never the
// employee, and never whoever recorded any of its time for them.
export async function mayDecide(client, c, submission, project, permission) {
  if (!c.userId || !has(c, permission) || !(seesAll(c) || project.manager_user_id === c.userId)) return false;
  if (submission.employee_user_id === c.userId) return false;
  if (submission.approver_user_id && submission.approver_user_id !== c.userId && !seesAll(c)) return false;
  return !(await client.query(`SELECT 1 FROM tenant.project_timesheet_submission_entries link JOIN tenant.project_time_entries entry ON entry.id = link.entry_id
      WHERE link.organization_id = $1 AND link.submission_id = $2 AND entry.entered_by = $3 LIMIT 1`, [c.organizationId, submission.id, c.userId])).rows[0];
}
async function decisionReplay(submission, key, status) {
  if (submission.status === status && key && submission.decision_key === key) return { submissionId: submission.id, status, replayed: true };
  return null;
}
async function currentEntries(client, c, submission) {
  const rows = (await client.query(`SELECT entry.*, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date_text, link.entry_version FROM tenant.project_timesheet_submission_entries link
      JOIN tenant.project_time_entries entry ON entry.id = link.entry_id WHERE link.organization_id = $1 AND link.submission_id = $2 ORDER BY entry.id FOR UPDATE OF entry`, [c.organizationId, submission.id])).rows;
  // The review decides exactly the versions that were submitted.
  if (rows.some((row) => row.entry_status !== "SUBMITTED" || row.submission_id !== submission.id || Number(row.row_version) !== Number(row.entry_version))) throw timeError(409, "TIME_APPROVAL_VERSION_CONFLICT");
  return rows;
}

// input: { expectedVersion?, comment?, idempotencyKey? }
export async function approveTimesheet(client, c, submissionId, input = {}) {
  const key = keyOf(input);
  const submission = await lockSubmission(client, c, submissionId);
  const replay = await decisionReplay(submission, key, "APPROVED");
  if (replay) return replay;
  const project = await loadProjectRow(client, c, submission.project_id);
  if (!(await mayDecide(client, c, submission, project, TIME.approve))) throw timeError(403, "TIME_APPROVAL_PERMISSION_DENIED");
  if (submission.status !== "SUBMITTED") throw timeError(409, submission.status === "APPROVED" ? "TIME_ALREADY_APPROVED" : "TIME_APPROVAL_VERSION_CONFLICT",
    submission.status === "APPROVED" ? "This timesheet is already approved." : "This timesheet was returned for changes; review its new version.");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(submission.row_version)) throw timeError(409, "TIME_APPROVAL_VERSION_CONFLICT");
  const entries = await currentEntries(client, c, submission);
  for (const entry of entries) await assertPeriodOpen(client, c, entry.work_date_text);
  // Approval accepts the time; whether it may be billed is a separate fact. Billable time whose contract line no longer applies (closed, the
  // order cancelled, another customer) is approved and waits for a valid line instead of being billed on a stale one.
  const stale = new Set();
  for (const entry of entries.filter((row) => row.billing_classification === "TIME_AND_MATERIALS_ELIGIBLE")) {
    const line = await loadContractLine(client, c, entry.contract_line_id);
    const task = entry.task_id ? (await client.query(`SELECT id, task_code, task_type FROM tenant.project_tasks WHERE id = $1`, [entry.task_id])).rows[0] : null;
    if (lineProblem(line, { project, day: entry.work_date_text, employeeUserId: entry.employee_user_id, task })) stale.add(entry.id);
  }
  let costed = 0;
  for (const entry of entries) {
    await client.query(`UPDATE tenant.project_time_entries SET entry_status = 'APPROVED', approved_by = $3, approved_at = now(), row_version = row_version + 1, updated_by = $3, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, c.userId]);
    if (stale.has(entry.id)) {
      await client.query(`UPDATE tenant.project_time_entries SET billing_classification = 'ELIGIBILITY_PENDING', contract_line_id = NULL, classification_updated_by = $3, classification_updated_at = now()
          WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, c.userId]);
    }
    if (await costEntry(client, c, { ...entry, entry_status: "APPROVED" })) costed += 1;
    await timeEvent(client, c, { projectId: project.id, employeeUserId: entry.employee_user_id, entryId: entry.id, submissionId: submission.id, action: "APPROVED", from: "SUBMITTED", to: "APPROVED" });
  }
  const comment = text(input.comment, 2000) || null;
  await client.query(`UPDATE tenant.project_timesheet_submissions SET status = 'APPROVED', decided_by = $3, decided_at = now(), decision_comment = $4, decision_key = $5, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, submission.id, c.userId, comment, key]);
  await timeEvent(client, c, { projectId: project.id, employeeUserId: submission.employee_user_id, submissionId: submission.id, action: "APPROVED", from: "SUBMITTED", to: "APPROVED",
    summary: `${hoursLabel(submission.total_minutes)} approved${comment ? `: ${comment}` : ""}` });
  await notifyTime(client, c, [submission.employee_user_id], { title: `Your ${project.project_code} time was approved`, message: `Week of ${submission.period_start_text}: ${hoursLabel(submission.total_minutes)}${comment ? ` — ${comment}` : ""}.`,
    href: href(submission.id), entityId: submission.id });
  await publish(client, c, submission, "approved", { status: "APPROVED", totalMinutes: submission.total_minutes, billableMinutes: submission.billable_minutes });
  return { submissionId: submission.id, status: "APPROVED", approvedMinutes: submission.total_minutes, costed, withoutRate: entries.length - costed, awaitingContractLine: stale.size };
}

// input: { comment (why — which entries need what), entryIds? (the entries to correct), expectedVersion?, idempotencyKey? }
export async function requestTimesheetChanges(client, c, submissionId, input = {}) {
  const key = keyOf(input);
  const submission = await lockSubmission(client, c, submissionId);
  const replay = await decisionReplay(submission, key, "CHANGES_REQUESTED");
  if (replay) return replay;
  const project = await loadProjectRow(client, c, submission.project_id);
  if (!(await mayDecide(client, c, submission, project, TIME.requestChanges))) throw timeError(403, "TIME_APPROVAL_PERMISSION_DENIED");
  if (submission.status !== "SUBMITTED") throw timeError(409, submission.status === "APPROVED" ? "TIME_ALREADY_APPROVED" : "TIME_APPROVAL_VERSION_CONFLICT");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(submission.row_version)) throw timeError(409, "TIME_APPROVAL_VERSION_CONFLICT");
  const comment = text(input.comment, 2000);
  if (comment.length < 3) throw timeError(400, "TIME_REASON_REQUIRED", "Say what needs correcting.");
  const entries = await currentEntries(client, c, submission);
  const flagged = (Array.isArray(input.entryIds) ? input.entryIds : []).map((id) => uuid(id, "Time entry"));
  if (flagged.some((id) => !entries.some((entry) => entry.id === id))) throw timeError(400, "TIME_CORRECTION_INVALID", "Point only at entries in this timesheet.");
  for (const entry of entries) {
    await client.query(`UPDATE tenant.project_time_entries SET entry_status = 'CHANGES_REQUESTED', row_version = row_version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, entry.id, c.userId]);
    await timeEvent(client, c, { projectId: project.id, employeeUserId: entry.employee_user_id, entryId: entry.id, submissionId: submission.id, action: "CHANGES_REQUESTED", from: "SUBMITTED", to: "CHANGES_REQUESTED",
      summary: flagged.includes(entry.id) ? comment : null });
  }
  await client.query(`UPDATE tenant.project_timesheet_submissions SET status = 'CHANGES_REQUESTED', decided_by = $3, decided_at = now(), decision_comment = $4, returned_entry_ids = $5::jsonb, decision_key = $6,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, submission.id, c.userId, comment, JSON.stringify(flagged), key]);
  await timeEvent(client, c, { projectId: project.id, employeeUserId: submission.employee_user_id, submissionId: submission.id, action: "CHANGES_REQUESTED", from: "SUBMITTED", to: "CHANGES_REQUESTED", summary: comment,
    details: { entryIds: flagged } });
  await notifyTime(client, c, [submission.employee_user_id], { title: `Your ${project.project_code} time needs changes`, message: `Week of ${submission.period_start_text}: ${comment}`, href: href(submission.id), entityId: submission.id });
  await publish(client, c, submission, "changes_requested", { status: "CHANGES_REQUESTED" });
  return { submissionId: submission.id, status: "CHANGES_REQUESTED", returnedEntries: flagged.length || entries.length };
}

// Whether a decision or submission sent with this key was applied (the answer was lost on the way back).
export async function getTimesheetOutcome(client, c, input = {}) {
  const key = keyOf(input);
  if (!key) throw timeError(400, "TIME_OPERATION_UNKNOWN");
  const row = (await client.query(`SELECT id, status FROM tenant.project_timesheet_submissions WHERE organization_id = $1 AND (decision_key = $2 OR idempotency_key LIKE $3) LIMIT 1`,
    [c.organizationId, key, `${key.replace(/[%_\\]/g, "\\$&")}:%`])).rows[0];
  if (row) return { applied: true, submissionId: row.id, status: row.status };
  const entry = (await client.query(`SELECT id, entry_status FROM tenant.project_time_entries WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
  if (entry) return { applied: true, entryId: entry.id, status: entry.entry_status };
  const correction = (await client.query(`SELECT id, status FROM tenant.project_time_corrections WHERE organization_id = $1 AND (idempotency_key = $2 OR decision_key = $2)`, [c.organizationId, key])).rows[0];
  if (correction) return { applied: true, correctionId: correction.id, status: correction.status };
  return { applied: false };
}

// ------------------------------------------------------------------ reminders
const once = async (client, c, projectId, alertKey) => Boolean((await client.query(`INSERT INTO tenant.project_alerts (organization_id, project_id, alert_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
  [c.organizationId, projectId, alertKey])).rows[0]);

// A project manager reminds a team member about a week (once a day per person and week). input: { employeeUserId, projectId, weekStart }
export async function remindTimesheet(client, c, input = {}) {
  const project = await loadProjectRow(client, c, input.projectId);
  if (!canTeam(c, project)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const policy = await timePolicy(client, c);
  const employee = uuid(input.employeeUserId, "Employee");
  const week = weekOf(workDay(input.weekStart ?? (await companyToday(client, c)), "week"), policy.weekStart);
  const today = await companyToday(client, c);
  if (!(await once(client, c, project.id, `timesheet-remind:${employee}:${week}:${today}`))) return { sent: false, already: true };
  const drafted = Number((await client.query(`SELECT COALESCE(sum(duration_minutes), 0)::int AS n FROM tenant.project_time_entries WHERE organization_id = $1 AND employee_user_id = $2 AND project_id = $3
      AND work_date BETWEEN $4 AND $5 AND entry_status IN ('DRAFT', 'CHANGES_REQUESTED')`, [c.organizationId, employee, project.id, week, addDays(week, 6)])).rows[0].n);
  await notifyTime(client, c, [employee], { category: "project_timesheet_reminder", title: `Please submit your ${project.project_code} time for the week of ${week}`,
    message: drafted ? `${hoursLabel(drafted)} recorded — submission pending.` : "No time is recorded for this week yet. Record what you worked, if anything.", href: `/projects/timesheets?week=${week}`,
    entityType: "projects.project", entityId: project.id });
  return { sent: true };
}

// The daily sweep (worker): a week whose deadline is today or tomorrow, with unsubmitted time, reminds its employee; a week past its deadline
// tells the employee and escalates to the project's manager. Each once (keyed per person, week and project). Weeks without entries get no
// "zero hours" — missing time is shown in the reports, never invented.
export async function evaluateTimesheetReminders(client, c) {
  const policy = await timePolicy(client, c);
  const today = await companyToday(client, c);
  const rows = (await client.query(`SELECT entry.employee_user_id, entry.project_id, project.project_code, project.manager_user_id, sum(entry.duration_minutes)::int AS minutes,
        to_char(entry.work_date - (((extract(isodow FROM entry.work_date)::int - $3 + 7) % 7) * interval '1 day'), 'YYYY-MM-DD') AS week
      FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id
      WHERE entry.organization_id = $1 AND entry.entry_status IN ('DRAFT', 'CHANGES_REQUESTED') AND entry.work_date >= $2::date - 56 AND entry.work_date <= $2::date
      GROUP BY 1, 2, 3, 4, 6`, [c.organizationId, today, policy.weekStart])).rows;
  let sent = 0;
  for (const row of rows) {
    const deadline = deadlineOf(row.week, policy);
    const weekEnd = addDays(row.week, 6);
    const project = { id: row.project_id };
    if (today >= addDays(deadline, -1) && today <= deadline && today >= weekEnd && await once(client, c, project.id, `timesheet-due:${row.employee_user_id}:${row.week}`)) {
      await notifyTime(client, c, [row.employee_user_id], { category: "project_timesheet_reminder", title: `Your ${row.project_code} time for the week of ${row.week} is due by ${deadline}`,
        message: `${hoursLabel(row.minutes)} recorded — submission pending.`, href: `/projects/timesheets?week=${row.week}`, entityType: "projects.project", entityId: row.project_id });
      sent += 1;
    } else if (today > deadline && await once(client, c, project.id, `timesheet-late:${row.employee_user_id}:${row.week}`)) {
      const names = await userNames(client, [row.employee_user_id]);
      await notifyTime(client, c, [row.employee_user_id], { category: "project_timesheet_reminder", title: `Your ${row.project_code} time for the week of ${row.week} is late`,
        message: `It was due by ${deadline}. ${hoursLabel(row.minutes)} recorded — submission pending.`, href: `/projects/timesheets?week=${row.week}`, entityType: "projects.project", entityId: row.project_id });
      await notifyTime(client, c, [row.manager_user_id], { category: "project_timesheet_reminder", title: `${names.get(row.employee_user_id) ?? "A team member"}'s ${row.project_code} time is late`,
        message: `Week of ${row.week}, due by ${deadline}: ${hoursLabel(row.minutes)} recorded, not submitted.`, href: `/projects/timesheets/team?week=${row.week}`, entityType: "projects.project", entityId: row.project_id });
      sent += 1;
    }
  }
  return { checked: rows.length, sent };
}

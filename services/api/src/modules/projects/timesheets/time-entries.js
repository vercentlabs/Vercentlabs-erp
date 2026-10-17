// Projects — Timesheets, time entries: record, change and remove one's own (or, for a project one leads, a team member's) unsubmitted
// time. Every save is checked again in full — the person was on the team that day, the project was running that day, the task is the
// project's, the duration is real and on the company's increment, the day's total, overlapping intervals, the accounting period, and its
// billing classification (Billable / Non-Billable Time decides it from the project's policy) — and leaves its history. Submitted and approved time is changed only by the review or a correction.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, text, uuid } from "../project-core.js";
import { billError, classifyProjectTimeEntry } from "../billable/billable-rules.js";
import {
  FLAG_LABEL, TIME, activeAccount, assertPeriodOpen, canTeam, companyToday, description, executionWindows, hoursLabel, judgeWorkDate, keyOf,
  loadProjectRow, readDuration, resolveInterval, timeError, timePolicy, wasOnTeam, workDay,
} from "./time-rules.js";

// ------------------------------------------------------------------ history and notices
export async function timeEvent(client, c, { projectId, employeeUserId, entryId = null, submissionId = null, correctionId = null, action, from = null, to = null, summary = null, details = {} }) {
  await client.query(`INSERT INTO tenant.project_time_events (organization_id, project_id, employee_user_id, entry_id, submission_id, correction_id, action, from_status, to_status, summary, details, actor_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
  [c.organizationId, projectId, employeeUserId, entryId, submissionId, correctionId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
// To the given people (never the actor), linked to the timesheet screen that holds the record.
export async function notifyTime(client, c, userIds, { category = "project_timesheet", title, message, href, entityType = "projects.timesheet", entityId }) {
  const users = new Set(userIds.filter(Boolean));
  users.delete(c.userId);
  for (const userId of users) await createNotification(client, { organizationId: c.organizationId, userId, category, title, message, href, entityType, entityId });
}

// ------------------------------------------------------------------ eligibility
// Every check one entry must pass, for the person who did the work, on the day they did it. Returns the review flags (warnings) it earns;
// refuses what is not allowed. `excludeEntryId` leaves the entry itself out of the day's totals and overlaps (an edit or a correction).
// The billing intent (billable, contractLineId, preferredLineId, reasonCode, reasonNote) is classified here too.
export async function validateTimeEntryEligibility(client, c, { project, employeeUserId, taskId = null, day, interval = null, duration, billable = null, contractLineId = null, preferredLineId = null,
  reasonCode = null, reasonNote = null, excludeEntryId = null, policy, delegated = false, recording = true }) {
  const flags = [];
  const warnings = [];
  const today = await companyToday(client, c);
  if (recording && day > today) throw timeError(400, "TIME_WORK_DATE_INVALID", "Time is recorded for work already done: choose today or an earlier date.");
  // The project first (was it running that day?), then the person (were they on its team that day?).
  const windows = await executionWindows(client, c, project, policy);
  const judged = judgeWorkDate(windows, day, interval);
  if (judged.state === "OUTSIDE") throw timeError(409, "TIME_PROJECT_NOT_ELIGIBLE", `Time cannot be recorded for ${day}: that is ${judged.why}.`);
  if (judged.state === "BOUNDARY") {
    if (policy.boundaryDayPolicy === "BLOCK") throw timeError(409, "TIME_PROJECT_NOT_ELIGIBLE", `The project paused, resumed or closed on ${day}. Record the start and end times so the work can be placed on the right side of it.`);
    flags.push("BOUNDARY_DAY_REVIEW");
  }
  if (!(await wasOnTeam(client, c, project, employeeUserId, day))) {
    throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED", delegated ? "That person was not on this project's team on the work date." : "You were not on this project's team on the work date.");
  }
  await assertPeriodOpen(client, c, day);
  let task = null;
  if (taskId) {
    task = (await client.query(`SELECT id, project_id, task_code, title, status, task_type, assignee_user_id, to_char((cancelled_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS cancelled_day
        FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(taskId, "Task"), policy.timezone])).rows[0];
    if (!task) throw timeError(404, "TIME_TASK_MISMATCH", "The task could not be found.");
    if (task.project_id !== project.id) throw timeError(400, "TIME_TASK_MISMATCH");
    if (task.status === "CANCELLED" && task.cancelled_day && day > task.cancelled_day) throw timeError(409, "TIME_PROJECT_NOT_ELIGIBLE", `${task.task_code} was cancelled on ${task.cancelled_day}; work after that is not recorded on it.`);
    if (task.status === "CANCELLED") flags.push("TASK_CANCELLED");
    if (!policy.collaboratorsAllowed && task.assignee_user_id !== employeeUserId && project.manager_user_id !== employeeUserId) {
      throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED", "Only the task's assignee records time on it (company policy).");
    }
  }
  const billing = await classifyProjectTimeEntry(client, c, { project, task, employeeUserId, day, billable, contractLineId, preferredLineId, reasonCode, reasonNote });
  warnings.push(...billing.warnings);
  // The day's total across every project (voided time does not count).
  const dayTotal = Number((await client.query(`SELECT COALESCE(sum(duration_minutes), 0)::int AS n FROM tenant.project_time_entries
      WHERE organization_id = $1 AND employee_user_id = $2 AND work_date = $3 AND entry_status <> 'VOIDED' AND ($4::uuid IS NULL OR id <> $4)`,
  [c.organizationId, employeeUserId, day, excludeEntryId])).rows[0].n) + duration;
  if (dayTotal > policy.dailyLimitMinutes) {
    throw timeError(400, "TIME_DURATION_INVALID", `That makes ${hoursLabel(dayTotal)} on ${day}, over the company's limit of ${hoursLabel(policy.dailyLimitMinutes)} a day — ${hoursLabel(dayTotal - policy.dailyLimitMinutes)} too many. Nothing was saved.`,
      { dayTotalMinutes: dayTotal, limitMinutes: policy.dailyLimitMinutes, overMinutes: dayTotal - policy.dailyLimitMinutes });
  }
  if (dayTotal > policy.dailyReviewMinutes) {
    flags.push("DAILY_TOTAL_REVIEW");
    warnings.push({ code: "TIME_DAILY_TOTAL_REVIEW", message: `${hoursLabel(dayTotal)} recorded on ${day}: your reviewer will check the day's total.` });
  }
  // Real intervals cannot overlap; duration-only time is never claimed to overlap.
  if (interval?.startAt) {
    const clash = (await client.query(`SELECT entry.entry_number, project.project_code FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id
        WHERE entry.organization_id = $1 AND entry.employee_user_id = $2 AND entry.entry_status <> 'VOIDED' AND entry.start_at IS NOT NULL AND ($5::uuid IS NULL OR entry.id <> $5)
          AND entry.start_at < $4 AND entry.end_at > $3 LIMIT 1`, [c.organizationId, employeeUserId, interval.startAt, interval.endAt, excludeEntryId])).rows[0];
    if (clash) throw timeError(409, "TIME_INTERVAL_OVERLAP", `This time overlaps entry TE-${clash.entry_number} on ${clash.project_code}.`);
  }
  return { flags, warnings, task, billing };
}
const duplicateFlag = async (client, c, { employeeUserId, projectId, taskId, day, duration, words, excludeEntryId }) => Boolean((await client.query(`SELECT 1 FROM tenant.project_time_entries
    WHERE organization_id = $1 AND employee_user_id = $2 AND project_id = $3 AND task_id IS NOT DISTINCT FROM $4 AND work_date = $5 AND duration_minutes = $6
      AND lower(btrim(description)) = lower(btrim($7)) AND entry_status <> 'VOIDED' AND ($8::uuid IS NULL OR id <> $8) LIMIT 1`,
[c.organizationId, employeeUserId, projectId, taskId, day, duration, words, excludeEntryId])).rows[0]);
const warningsOf = (flags, warnings) => [...warnings, ...flags.filter((flag) => !warnings.some((w) => w.code === `TIME_${flag}`) && flag !== "DAILY_TOTAL_REVIEW" && flag !== "DELEGATED")
  .map((flag) => ({ code: flag, message: FLAG_LABEL[flag] }))];

// Whose time this is: one's own, or — for a project one leads, with team access — a team member's (recorded as delegated).
async function whoseTime(client, c, project, input) {
  if (!has(c, TIME.create)) throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED");
  const employee = input.employeeUserId ? uuid(input.employeeUserId, "Employee") : c.userId;
  if (!employee) throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED");
  if (employee === c.userId) return { employee, delegated: false };
  if (!canTeam(c, project)) throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED");
  if (!(await activeAccount(client, c, employee))) throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED", "That person's account is not active.");
  return { employee, delegated: true };
}

// The values one entry is saved with, checked. `current` is the entry being edited (its values fill what the input leaves out).
async function prepare(client, c, project, input, { employee, delegated, current = null, policy }) {
  const day = workDay(input.workDate ?? (current ? current.work_date_text : await companyToday(client, c)));
  const timing = input.durationMinutes !== undefined || input.hours !== undefined || input.minutes !== undefined || input.startTime !== undefined || input.endTime !== undefined;
  const source = timing ? input : current ? { durationMinutes: current.start_at ? undefined : current.duration_minutes, startTime: current.start_time ?? undefined, endTime: current.end_time ?? undefined } : input;
  const { duration: given, interval: clock } = readDuration(source, policy);
  const interval = await resolveInterval(client, policy, day, clock, given);
  const words = description(input.description ?? current?.description);
  const taskId = input.taskId === undefined ? current?.task_id ?? null : input.taskId || null;
  // The billing intent: what the person chose now, or what the entry had (its line kept as a preference, its reason kept unless replaced).
  const sameProject = !current || current.project_id === project.id;
  const billable = input.billable === undefined || input.billable === null ? (current && sameProject ? current.billable : null) : Boolean(input.billable);
  const intentKept = current && sameProject && billable === current.billable;
  const check = await validateTimeEntryEligibility(client, c, { project, employeeUserId: employee, taskId, day, interval, duration: interval.duration, billable,
    contractLineId: input.contractLineId || null, preferredLineId: intentKept ? current.contract_line_id : null,
    reasonCode: input.billingReasonCode !== undefined ? input.billingReasonCode || null : intentKept ? current.billing_reason_code : null,
    reasonNote: input.billingReasonNote !== undefined ? input.billingReasonNote || null : intentKept ? current.billing_reason_note : null,
    excludeEntryId: current?.id ?? null, policy, delegated });
  // Time already submitted once (and returned) changes its classification only with the reason.
  const classificationChanged = current && (check.billing.classification !== current.billing_classification || (check.billing.reasonCode ?? null) !== (current.billing_reason_code ?? null));
  if (classificationChanged && current.entry_status === "CHANGES_REQUESTED" && text(input.classificationReason, 500).length < 3) {
    throw billError(400, "TIME_BILLING_REASON_REQUIRED", "This time was submitted before: say why its billing classification changes.");
  }
  const flags = [...check.flags];
  if (delegated || current?.review_flags?.includes("DELEGATED")) flags.push("DELEGATED");
  if (await duplicateFlag(client, c, { employeeUserId: employee, projectId: project.id, taskId, day, duration: interval.duration, words, excludeEntryId: current?.id ?? null })) flags.push("POSSIBLE_DUPLICATE");
  return { day, interval, words, taskId, billing: check.billing, billable: check.billing.billable, classificationChanged, flags: [...new Set(flags)], warnings: warningsOf(flags, check.warnings) };
}

// ------------------------------------------------------------------ commands
// input: { projectId, taskId?, workDate?, durationMinutes | hours + minutes, startTime?, endTime?, description, billable?, contractLineId?, billingReasonCode?,
// billingReasonNote?, employeeUserId?, idempotencyKey? }
export async function createProjectTimeEntry(client, c, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, entry_number, entry_status, duration_minutes FROM tenant.project_time_entries WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { entryId: done.id, entryNumber: `TE-${done.entry_number}`, status: done.entry_status, durationMinutes: done.duration_minutes, warnings: [], replayed: true };
  }
  const project = await loadProjectRow(client, c, input.projectId);
  const policy = await timePolicy(client, c);
  const { employee, delegated } = await whoseTime(client, c, project, input);
  const values = await prepare(client, c, project, input, { employee, delegated, policy });
  const b = values.billing;
  const row = (await client.query(`INSERT INTO tenant.project_time_entries (organization_id, employee_user_id, entered_by, project_id, task_id, work_date, start_at, end_at, duration_minutes, description, billable,
        review_flags, create_key, created_by, updated_by, billing_classification, billing_reason_code, billing_reason_note, billing_policy_version, contract_line_id, classification_updated_by, classification_updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$3,$3,$14,$15,$16,$17,$18,$3,now()) RETURNING id, entry_number`,
  [c.organizationId, employee, c.userId ?? null, project.id, values.taskId, values.day, values.interval.startAt, values.interval.endAt, values.interval.duration, values.words, values.billable,
    JSON.stringify(values.flags), key, b.classification, b.reasonCode, b.reasonNote, b.policyVersion, b.contractLineId])).rows[0];
  await timeEvent(client, c, { projectId: project.id, employeeUserId: employee, entryId: row.id, action: "CREATED", to: "DRAFT",
    summary: `${hoursLabel(values.interval.duration)} on ${values.day} · ${b.explanation}`, details: { flags: values.flags, delegated, classification: b.classification, reasonCode: b.reasonCode, contractLineId: b.contractLineId } });
  if (delegated) {
    await notifyTime(client, c, [employee], { title: `Time recorded for you on ${project.project_code}`, message: `${hoursLabel(values.interval.duration)} on ${values.day}: ${values.words.slice(0, 120)}`,
      href: `/projects/timesheets?week=${values.day}`, entityType: "projects.time_entry", entityId: row.id });
  }
  return { entryId: row.id, entryNumber: `TE-${row.entry_number}`, status: "DRAFT", durationMinutes: values.interval.duration, classification: b.classification, explanation: b.explanation, warnings: values.warnings };
}

export async function loadEntry(client, c, entryId, { lock = false } = {}) {
  const row = (await client.query(`SELECT entry.*, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date_text,
        to_char(entry.start_at AT TIME ZONE COALESCE(org.timezone, 'UTC'), 'HH24:MI') AS start_time, to_char(entry.end_at AT TIME ZONE COALESCE(org.timezone, 'UTC'), 'HH24:MI') AS end_time
      FROM tenant.project_time_entries entry JOIN public.organizations org ON org.id = entry.organization_id
      WHERE entry.organization_id = $1 AND entry.id = $2${lock ? " FOR UPDATE OF entry" : ""}`, [c.organizationId, uuid(entryId, "Time entry")])).rows[0];
  if (!row) throw timeError(404, "TIME_NOT_FOUND");
  return row;
}
// The person whose time it is, or whoever recorded it for them, may change it while it is unsubmitted.
function assertEditable(c, entry) {
  if (!has(c, TIME.editDraft) || (entry.employee_user_id !== c.userId && entry.entered_by !== c.userId)) throw timeError(403, "TIME_EMPLOYEE_NOT_AUTHORIZED");
  if (entry.entry_status === "SUBMITTED") throw timeError(409, "TIME_ALREADY_SUBMITTED");
  if (entry.entry_status === "APPROVED") throw timeError(409, "TIME_ALREADY_APPROVED");
  if (entry.entry_status === "VOIDED") throw timeError(404, "TIME_NOT_FOUND");
}

// input: the fields to change, and expectedVersion.
export async function updateDraftTimeEntry(client, c, entryId, input = {}) {
  const entry = await loadEntry(client, c, entryId, { lock: true });
  assertEditable(c, entry);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(entry.row_version)) throw timeError(409, "TIME_VERSION_CONFLICT");
  if (input.employeeUserId && input.employeeUserId !== entry.employee_user_id) throw timeError(400, "TIME_EMPLOYEE_NOT_AUTHORIZED", "Time stays with the person who worked it.");
  const project = await loadProjectRow(client, c, input.projectId ?? entry.project_id);
  const policy = await timePolicy(client, c);
  // Moving unsubmitted time to another project keeps the person's own eligibility on that project.
  const values = await prepare(client, c, project, input, { employee: entry.employee_user_id, delegated: entry.entered_by !== entry.employee_user_id, current: entry, policy });
  const b = values.billing;
  const row = (await client.query(`UPDATE tenant.project_time_entries SET project_id = $3, task_id = $4, work_date = $5, start_at = $6, end_at = $7, duration_minutes = $8, description = $9, billable = $10,
        review_flags = $11::jsonb, row_version = row_version + 1, updated_by = $12, updated_at = now(), billing_classification = $13, billing_reason_code = $14, billing_reason_note = $15,
        billing_policy_version = $16, contract_line_id = $17, classification_updated_by = CASE WHEN $18 THEN $12 ELSE classification_updated_by END,
        classification_updated_at = CASE WHEN $18 THEN now() ELSE classification_updated_at END WHERE organization_id = $1 AND id = $2 RETURNING row_version`,
  [c.organizationId, entry.id, project.id, values.taskId, values.day, values.interval.startAt, values.interval.endAt, values.interval.duration, values.words, values.billable,
    JSON.stringify(values.flags), c.userId ?? null, b.classification, b.reasonCode, b.reasonNote, b.policyVersion, b.contractLineId, Boolean(values.classificationChanged)])).rows[0];
  const changed = ["project_id", "task_id", "work_date_text", "duration_minutes", "description", "billable", "billing_classification", "billing_reason_code"].filter((field) => String(entry[field] ?? "") !== String({
    project_id: project.id, task_id: values.taskId, work_date_text: values.day, duration_minutes: values.interval.duration, description: values.words, billable: values.billable,
    billing_classification: b.classification, billing_reason_code: b.reasonCode }[field] ?? ""));
  await timeEvent(client, c, { projectId: project.id, employeeUserId: entry.employee_user_id, entryId: entry.id, action: "EDITED", from: entry.entry_status, to: entry.entry_status,
    summary: `${hoursLabel(values.interval.duration)} on ${values.day}`, details: { changed, before: { durationMinutes: entry.duration_minutes, workDate: entry.work_date_text, projectId: entry.project_id, billable: entry.billable,
      classification: entry.billing_classification, reasonCode: entry.billing_reason_code }, classificationReason: values.classificationChanged ? text(input.classificationReason, 500) || null : undefined } });
  return { entryId: entry.id, status: entry.entry_status, version: row.row_version, durationMinutes: values.interval.duration, classification: b.classification, explanation: b.explanation, warnings: values.warnings };
}

// Never-submitted time is removed; time that was submitted once (and returned) is withdrawn — voided, its history kept.
export async function deleteDraftTimeEntry(client, c, entryId, input = {}) {
  const entry = await loadEntry(client, c, entryId, { lock: true });
  assertEditable(c, entry);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(entry.row_version)) throw timeError(409, "TIME_VERSION_CONFLICT");
  const submittedOnce = Boolean((await client.query(`SELECT 1 FROM tenant.project_timesheet_submission_entries WHERE organization_id = $1 AND entry_id = $2 LIMIT 1`, [c.organizationId, entry.id])).rows[0]);
  if (!submittedOnce && entry.entry_status === "DRAFT") {
    await client.query(`DELETE FROM tenant.project_time_entries WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id]);
    await timeEvent(client, c, { projectId: entry.project_id, employeeUserId: entry.employee_user_id, entryId: entry.id, action: "REMOVED", from: "DRAFT",
      summary: `${hoursLabel(entry.duration_minutes)} on ${entry.work_date_text} removed before submission`, details: { description: entry.description } });
    return { entryId: entry.id, removed: true };
  }
  const reason = text(input.reason, 500) || "Withdrawn by the employee before approval";
  await client.query(`UPDATE tenant.project_time_entries SET entry_status = 'VOIDED', voided_by = $3, voided_at = now(), void_reason = $4, row_version = row_version + 1, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, c.userId ?? null, reason]);
  await timeEvent(client, c, { projectId: entry.project_id, employeeUserId: entry.employee_user_id, entryId: entry.id, action: "WITHDRAWN", from: entry.entry_status, to: "VOIDED", summary: reason });
  return { entryId: entry.id, removed: false, status: "VOIDED" };
}

// Whether time can be recorded now for this project and day (the form asks before saving, so the person sees why not).
export async function checkTimeEntry(client, c, input = {}) {
  const project = await loadProjectRow(client, c, input.projectId);
  const policy = await timePolicy(client, c);
  const { employee, delegated } = await whoseTime(client, c, project, input);
  try {
    const values = await prepare(client, c, project, { ...input, description: input.description || "check" }, { employee, delegated, policy, current: input.entryId ? await loadEntry(client, c, input.entryId) : null });
    return { allowed: true, durationMinutes: values.interval.duration, warnings: values.warnings, flags: values.flags };
  } catch (failure) {
    if (failure?.code?.startsWith?.("TIME_")) return { allowed: false, code: failure.code, message: failure.message };
    throw failure;
  }
}

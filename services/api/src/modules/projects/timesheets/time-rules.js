// Projects — Timesheets, the rules: the errors, the company's time policy, weeks, durations, the people who may record, see, review and
// correct time, and the eligibility of one piece of work — judged by the date the work was done, not by the project's status today.
import { has, isoDay, projectError, seesAll, text, uuid } from "../project-core.js";

export const TIME = Object.freeze({
  viewOwn: "projects.time.view_own", create: "projects.time.create", editDraft: "projects.time.edit_draft", submit: "projects.time.submit",
  viewTeam: "projects.time.view_team", approve: "projects.time.approve", requestChanges: "projects.time.request_changes", correct: "projects.time.correct_approved",
  viewCost: "projects.time.view_cost", viewBilling: "projects.time.view_billing", export: "projects.time.export", rates: "projects.time.rates.manage",
});

export const ENTRY_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", VOIDED: "Voided" });
export const SUBMISSION_STATUS_LABEL = Object.freeze({ SUBMITTED: "Awaiting review", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested" });
export const FLAG_LABEL = Object.freeze({
  DAILY_TOTAL_REVIEW: "Daily total above the review threshold", BOUNDARY_DAY_REVIEW: "Recorded on the day the project paused, resumed or closed",
  POSSIBLE_DUPLICATE: "Looks like another entry on the same day", LATE: "Submitted after the deadline", DELEGATED: "Recorded by someone else",
  TASK_CANCELLED: "Task was cancelled after this work", NO_RATE: "No labor rate for the work date",
});

const MESSAGES = Object.freeze({
  TIME_PROJECT_REQUIRED: "Select a Project.",
  TIME_PROJECT_NOT_ELIGIBLE: "Time cannot be recorded for this Project and work date.",
  TIME_TASK_MISMATCH: "This Task belongs to another Project.",
  TIME_EMPLOYEE_NOT_AUTHORIZED: "You are not authorized to record time for this person or Project.",
  TIME_DURATION_INVALID: "Enter a valid number of hours and minutes.",
  TIME_INTERVAL_OVERLAP: "This time overlaps another recorded entry.",
  TIME_DAILY_TOTAL_REVIEW: "Your total recorded hours need review.",
  TIME_DESCRIPTION_REQUIRED: "Describe the work performed.",
  TIME_ALREADY_SUBMITTED: "This time has already been submitted.",
  TIME_ALREADY_APPROVED: "Approved time requires a correction request.",
  TIME_APPROVAL_VERSION_CONFLICT: "The Timesheet changed. Refresh before approving.",
  TIME_APPROVAL_PERMISSION_DENIED: "You are not authorized to approve this Timesheet.",
  TIME_PERIOD_CLOSED: "This period is closed. Request an authorized correction.",
  TIME_OPERATION_UNKNOWN: "Checking the previous action. Do not submit again.",
  TIME_NOT_FOUND: "The time record could not be found.",
  TIME_PERMISSION_DENIED: "You do not have permission for this action.",
  TIME_VERSION_CONFLICT: "This time entry changed. Refresh before saving.",
  TIME_WORK_DATE_INVALID: "Enter a valid work date.",
  TIME_NOTHING_TO_SUBMIT: "There is no unsubmitted time in this week.",
  TIME_SUBMISSION_LATE: "This week's submission deadline has passed. Give the reason it is late.",
  TIME_REASON_REQUIRED: "Give a reason.",
  TIME_CORRECTION_INVALID: "Check the corrected values.",
  TIME_RATE_INVALID: "Check the labor rate.",
});
export const timeError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);
export const TIME_MESSAGES = MESSAGES;

export const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
export const hoursLabel = (minutes) => {
  const total = Number(minutes ?? 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};

// ------------------------------------------------------------------ policy
export async function timePolicy(client, c) {
  const row = (await client.query(`SELECT * FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  const org = (await client.query(`SELECT COALESCE(timezone, 'UTC') AS tz, COALESCE(base_currency, 'INR') AS currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0] ?? {};
  return {
    weekStart: Number(row.time_week_start ?? 1), dailyReviewMinutes: Number(row.time_daily_review_minutes ?? 600), dailyLimitMinutes: Number(row.time_daily_limit_minutes ?? 1440),
    incrementMinutes: Number(row.time_increment_minutes ?? 1), deadlineDays: Number(row.time_submission_deadline_days ?? 3),
    lateAllowed: row.time_late_submission_allowed ?? true, boundaryDayPolicy: row.time_boundary_day_policy ?? "REVIEW", collaboratorsAllowed: row.time_collaborators_allowed ?? true,
    timezone: org.tz ?? "UTC", currency: org.currency ?? "INR",
  };
}
export async function companyToday(client, c) {
  return (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`, [c.organizationId])).rows[0].d;
}
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export { addDays };
// The first day of the week holding `day` (weekStart: 1 = Monday … 7 = Sunday, as the company sets it).
export function weekOf(day, weekStart = 1) {
  const iso = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return addDays(day, -((iso - weekStart + 7) % 7));
}
export const workDay = (value, label = "work date") => {
  try {
    const day = isoDay(value);
    if (!day) throw new Error("missing");
    return day;
  } catch {
    throw timeError(400, "TIME_WORK_DATE_INVALID", `Enter a valid ${label}.`);
  }
};
// The day a week's submission is due (the last day of the week plus the company's grace days).
export const deadlineOf = (weekStart, policy) => addDays(weekStart, 6 + policy.deadlineDays);

// ------------------------------------------------------------------ duration
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const whole = (value) => (value === undefined || value === null || value === "" ? null : Number(value));
// The recorded duration in whole minutes: from durationMinutes, or hours + minutes, and — when start and end times are given — the interval
// they make (an end before the start is the next day). Nothing is rounded: a value off the company's increment is refused with the amount.
export function readDuration(input, policy) {
  const minutesIn = whole(input.durationMinutes);
  const hours = whole(input.hours);
  const mins = whole(input.minutes);
  for (const value of [minutesIn, hours, mins]) {
    if (value !== null && (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)) throw timeError(400, "TIME_DURATION_INVALID", "Enter whole hours and minutes (no negative or fractional values).");
  }
  if (mins !== null && mins > 59 && hours !== null) throw timeError(400, "TIME_DURATION_INVALID", "Minutes run from 0 to 59.");
  let duration = minutesIn ?? (hours !== null || mins !== null ? (hours ?? 0) * 60 + (mins ?? 0) : null);
  const start = input.startTime ? String(input.startTime) : null;
  const end = input.endTime ? String(input.endTime) : null;
  let interval = null;
  if (start || end) {
    if (!start || !end || !CLOCK.test(start) || !CLOCK.test(end)) throw timeError(400, "TIME_DURATION_INVALID", "Give both a start and an end time (HH:MM), or neither.");
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    if (sh * 60 + sm === eh * 60 + em) throw timeError(400, "TIME_DURATION_INVALID", "The end time is after the start time.");
    interval = { start, end, nextDay: eh * 60 + em < sh * 60 + sm };
  }
  if (duration === null && !interval) throw timeError(400, "TIME_DURATION_INVALID");
  if (duration !== null && duration <= 0) throw timeError(400, "TIME_DURATION_INVALID", "Record more than zero minutes.");
  if (duration !== null && duration > 1440) throw timeError(400, "TIME_DURATION_INVALID", `${hoursLabel(duration)} is more than one day; record each day's work on its own date.`);
  if (duration !== null && duration % policy.incrementMinutes !== 0) {
    throw timeError(400, "TIME_DURATION_INVALID", `Time is recorded in steps of ${policy.incrementMinutes} minutes; ${hoursLabel(duration)} is not one (nothing is rounded for you).`);
  }
  return { duration, interval };
}
// The interval's real start and end (in the company's time zone, daylight saving included) and its length; it must match a given duration.
export async function resolveInterval(client, policy, day, interval, duration) {
  if (!interval) return { startAt: null, endAt: null, duration };
  const row = (await client.query(`SELECT (($1::date + $2::time) AT TIME ZONE $4) AS start_at, (($1::date + ($5::int) + $3::time) AT TIME ZONE $4) AS end_at`,
    [day, interval.start, interval.end, policy.timezone, interval.nextDay ? 1 : 0])).rows[0];
  const length = Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60000);
  if (length <= 0) throw timeError(400, "TIME_DURATION_INVALID", "The end time is after the start time.");
  if (duration !== null && duration !== length) throw timeError(400, "TIME_DURATION_INVALID", `${interval.start}–${interval.end} is ${hoursLabel(length)}, not ${hoursLabel(duration)}. Correct one of them.`);
  if (length % policy.incrementMinutes !== 0) throw timeError(400, "TIME_DURATION_INVALID", `Time is recorded in steps of ${policy.incrementMinutes} minutes.`);
  return { startAt: row.start_at, endAt: row.end_at, duration: length };
}
export const description = (value) => {
  const words = text(value, 2000);
  if (words.length < 3) throw timeError(400, "TIME_DESCRIPTION_REQUIRED");
  return words;
};

// ------------------------------------------------------------------ who
export const canTeam = (c, project) => has(c, TIME.viewTeam) && (seesAll(c) || project.manager_user_id === c.userId);
export const mayReview = (c, project, permission = TIME.approve) => has(c, permission) && (seesAll(c) || project.manager_user_id === c.userId);
export const viewsCost = (c) => has(c, TIME.viewCost);
export const viewsBilling = (c) => has(c, TIME.viewBilling);

export async function loadProjectRow(client, c, projectId) {
  if (!projectId) throw timeError(400, "TIME_PROJECT_REQUIRED");
  const id = (() => { try { return uuid(projectId, "Project"); } catch { throw timeError(400, "TIME_PROJECT_REQUIRED"); } })();
  const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`, [c.organizationId, id])).rows[0];
  if (!project) throw timeError(404, "TIME_PROJECT_NOT_ELIGIBLE", "The project could not be found.");
  return project;
}
// Was this person on the project's team (as its manager or a working member) on that date? Viewers do not record work.
export async function wasOnTeam(client, c, project, userId, day) {
  if (project.manager_user_id === userId) return true;
  return Boolean((await client.query(`SELECT 1 FROM tenant.project_members member, public.organizations org
      WHERE member.organization_id = $1 AND member.project_id = $2 AND member.user_id = $3 AND member.role IN ('MANAGER', 'MEMBER') AND org.id = $1
        AND (member.joined_at AT TIME ZONE COALESCE(org.timezone, 'UTC'))::date <= $4::date
        AND (member.left_at IS NULL OR (member.left_at AT TIME ZONE COALESCE(org.timezone, 'UTC'))::date >= $4::date) LIMIT 1`,
  [c.organizationId, project.id, userId, day])).rows[0]);
}
export async function activeAccount(client, c, userId) {
  return Boolean((await client.query(`SELECT 1 FROM public.organization_memberships membership JOIN public.users person ON person.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND person.status = 'active'`, [c.organizationId, userId])).rows[0]);
}

// ------------------------------------------------------------------ when the project was running
// The periods the project was in progress, from its status history: [{ from, fromDay, to, toDay, wholeFirstDay }]. The first start counts from
// the recorded start date (a project started "as of" an earlier day ran from that day); a resume or reopening begins at the moment it happened.
export async function executionWindows(client, c, project, policy) {
  const events = (await client.query(`SELECT action, to_status, occurred_at, to_char((occurred_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day
      FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at`, [c.organizationId, project.id, policy.timezone])).rows;
  const windows = [];
  let open = null;
  for (const event of events) {
    if (event.to_status === "IN_PROGRESS" && !open) {
      const first = !windows.length && event.action === "STARTED";
      const started = project.actual_start_date ? isoDay(project.actual_start_date) : null;
      open = first && started && started <= event.day ? { from: null, fromDay: started, wholeFirstDay: true } : { from: event.occurred_at, fromDay: event.day, wholeFirstDay: false };
    } else if (event.to_status !== "IN_PROGRESS" && open) {
      windows.push({ ...open, to: event.occurred_at, toDay: event.day, closedBy: event.to_status });
      open = null;
    }
  }
  if (open) windows.push({ ...open, to: null, toDay: null, closedBy: null });
  if (!events.length && project.status === "IN_PROGRESS" && project.actual_start_date) windows.push({ from: null, fromDay: isoDay(project.actual_start_date), wholeFirstDay: true, to: null, toDay: null, closedBy: null });
  return windows;
}
// OK (the project was running), BOUNDARY (the day it paused, resumed or closed, with no times to tell which side) or OUTSIDE, with why.
export function judgeWorkDate(windows, day, interval) {
  let boundary = false;
  for (const w of windows) {
    const afterStart = day > w.fromDay || (day === w.fromDay && w.wholeFirstDay);
    const beforeEnd = w.toDay === null || day < w.toDay;
    if (afterStart && beforeEnd) return { state: "OK" };
    const onStart = day === w.fromDay && !w.wholeFirstDay;
    const onEnd = w.toDay !== null && day === w.toDay;
    if ((onStart || onEnd) && (day >= w.fromDay) && (w.toDay === null || day <= w.toDay)) {
      if (interval?.startAt) {
        const s = new Date(interval.startAt).getTime();
        const e = new Date(interval.endAt).getTime();
        if ((!w.from || s >= new Date(w.from).getTime()) && (!w.to || e <= new Date(w.to).getTime())) return { state: "OK" };
      } else boundary = true;
    }
  }
  if (boundary) return { state: "BOUNDARY" };
  if (!windows.length || day < windows[0].fromDay) return { state: "OUTSIDE", why: "before the project started" };
  const last = [...windows].reverse().find((w) => w.toDay !== null && w.toDay <= day);
  const closed = last?.closedBy;
  return { state: "OUTSIDE", why: closed === "ON_HOLD" ? "while the project was on hold" : closed === "COMPLETED" ? "after the project was completed"
    : closed === "CANCELLED" ? "after the project was cancelled" : "while the project was not in progress" };
}

// A closed or locked accounting period refuses new or changed time for its dates.
export async function assertPeriodOpen(client, c, day) {
  const period = (await client.query(`SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date AND status IN ('closed', 'locked')
      ORDER BY start_date DESC LIMIT 1`, [c.organizationId, day])).rows[0];
  if (period) throw timeError(409, "TIME_PERIOD_CLOSED", `${period.name} is ${period.status}. Request an authorized correction.`);
}

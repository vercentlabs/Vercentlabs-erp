// Task Defaults and Follow-up Defaults: what a new task or follow-up starts
// with, and the organization's working week (days, hours, off Saturdays —
// working-week.js). One row per organization (tenant.crm_settings); the
// salesperson can change each task or follow-up value on the record itself.
import { CrmError } from "../data-management/errors.js";
import { FOLLOW_UP_REMINDER_OPTIONS, FOLLOW_UP_TYPES } from "../follow-ups/constants.js";
import { TASK_PRIORITIES, TASK_REMINDER_OPTIONS } from "../tasks/constants.js";
import { getWorkingWeek } from "./working-week.js";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const invalid = (message, field) => new CrmError(400, message, "CRM_DEFAULTS_VALIDATION", { field });

const STANDARD = Object.freeze({ taskPriority: "medium", taskReminderMinutes: null, followUpType: "call", followUpReminderMinutes: null });

export async function getWorkDefaults(client, context) {
  const { rows } = await client.query(
    `SELECT default_task_priority, default_task_reminder_minutes, default_follow_up_type, default_follow_up_reminder_minutes, lead_stale_days
       FROM tenant.crm_settings WHERE organization_id = $1`,
    [context.organizationId],
  );
  const row = rows[0];
  const week = await getWorkingWeek(client, context.organizationId);
  if (!row) return { ...STANDARD, ...week, leadStaleDays: 7 };
  return {
    ...week,
    taskPriority: row.default_task_priority,
    taskReminderMinutes: row.default_task_reminder_minutes,
    // a type that was since removed falls back to the standard one
    followUpType: FOLLOW_UP_TYPES.some((type) => type.code === row.default_follow_up_type) ? row.default_follow_up_type : STANDARD.followUpType,
    followUpReminderMinutes: row.default_follow_up_reminder_minutes,
    // When a lead with no activity is flagged (where its stage sets no time of its own).
    leadStaleDays: row.lead_stale_days ?? 7,
  };
}

// The choices the settings page offers.
export function workDefaultChoices() {
  return {
    taskPriorities: TASK_PRIORITIES,
    taskReminderOptions: TASK_REMINDER_OPTIONS,
    followUpTypes: FOLLOW_UP_TYPES,
    followUpReminderOptions: FOLLOW_UP_REMINDER_OPTIONS,
    weekdays: WEEKDAYS,
    saturdayRules: SATURDAY_RULES,
  };
}

const WEEKDAYS = Object.freeze([
  { day: 1, label: "Monday" }, { day: 2, label: "Tuesday" }, { day: 3, label: "Wednesday" }, { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" }, { day: 6, label: "Saturday" }, { day: 0, label: "Sunday" },
]);
// The usual Saturday patterns in India.
const SATURDAY_RULES = Object.freeze([
  { code: "none", label: "Every Saturday is a working day", saturdaysOff: [] },
  { code: "2_4", label: "2nd and 4th Saturdays off", saturdaysOff: [2, 4] },
  { code: "1_3", label: "1st and 3rd Saturdays off", saturdaysOff: [1, 3] },
  { code: "alternate", label: "1st, 3rd and 5th Saturdays off", saturdaysOff: [1, 3, 5] },
]);
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function reminder(value, options, field) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!options.some((option) => option.minutes === minutes)) throw invalid("Choose a reminder from the list.", field);
  return minutes;
}

// input: { taskPriority?, taskReminderMinutes? (null = no reminder), followUpType?, followUpReminderMinutes?,
//          workingDays? [0 Sunday … 6 Saturday], workStart? "HH:MM", workEnd?, saturdaysOff? [1…5] }
export async function saveWorkDefaults(client, context, input = {}) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes("crm.settings.manage"))
    throw new CrmError(403, "You do not have permission to change CRM settings.", "PERMISSION_DENIED");
  const next = { ...(await getWorkDefaults(client, context)) };
  if (has(input, "taskPriority")) {
    if (!TASK_PRIORITIES.some((priority) => priority.code === input.taskPriority)) throw invalid("Choose a priority.", "taskPriority");
    next.taskPriority = input.taskPriority;
  }
  if (has(input, "taskReminderMinutes")) next.taskReminderMinutes = reminder(input.taskReminderMinutes, TASK_REMINDER_OPTIONS, "taskReminderMinutes");
  if (has(input, "followUpType")) {
    if (!FOLLOW_UP_TYPES.some((type) => type.code === input.followUpType)) throw invalid("Choose a follow-up type.", "followUpType");
    next.followUpType = input.followUpType;
  }
  if (has(input, "followUpReminderMinutes")) next.followUpReminderMinutes = reminder(input.followUpReminderMinutes, FOLLOW_UP_REMINDER_OPTIONS, "followUpReminderMinutes");
  if (has(input, "workingDays")) {
    const days = [...new Set((Array.isArray(input.workingDays) ? input.workingDays : []).map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    if (!days.length) throw invalid("Choose at least one working day.", "workingDays");
    next.workingDays = days;
  }
  if (has(input, "workStart")) next.workStart = String(input.workStart ?? "");
  if (has(input, "workEnd")) next.workEnd = String(input.workEnd ?? "");
  if (!CLOCK.test(next.workStart)) throw invalid("Enter the start time as HH:MM, such as 10:00.", "workStart");
  if (!CLOCK.test(next.workEnd)) throw invalid("Enter the end time as HH:MM, such as 19:00.", "workEnd");
  if (next.workStart >= next.workEnd) throw invalid("The day must end after it starts.", "workEnd");
  if (has(input, "leadStaleDays")) {
    const days = Math.trunc(Number(input.leadStaleDays));
    if (!Number.isFinite(days) || days < 1 || days > 365) throw invalid("Enter between 1 and 365 days.", "leadStaleDays");
    next.leadStaleDays = days;
  }
  if (has(input, "saturdaysOff")) {
    const saturdays = [...new Set((Array.isArray(input.saturdaysOff) ? input.saturdaysOff : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 5).sort();
    next.saturdaysOff = saturdays;
  }
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, default_task_priority, default_task_reminder_minutes, default_follow_up_type, default_follow_up_reminder_minutes,
                                     working_days, work_start, work_end, saturdays_off, lead_stale_days, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::smallint[], $7, $8, $9::smallint[], $11, $10, $10)
     ON CONFLICT (organization_id) DO UPDATE SET default_task_priority = EXCLUDED.default_task_priority, default_task_reminder_minutes = EXCLUDED.default_task_reminder_minutes,
       default_follow_up_type = EXCLUDED.default_follow_up_type, default_follow_up_reminder_minutes = EXCLUDED.default_follow_up_reminder_minutes,
       working_days = EXCLUDED.working_days, work_start = EXCLUDED.work_start, work_end = EXCLUDED.work_end, saturdays_off = EXCLUDED.saturdays_off,
       lead_stale_days = EXCLUDED.lead_stale_days,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, next.taskPriority, next.taskReminderMinutes, next.followUpType, next.followUpReminderMinutes,
      next.workingDays, next.workStart, next.workEnd, next.saturdaysOff, context.userId ?? null, next.leadStaleDays ?? 7],
  );
  return next;
}

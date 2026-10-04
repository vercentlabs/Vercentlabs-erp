// Task Defaults and Follow-up Defaults: what a new task or follow-up starts
// with. One row per organization (tenant.crm_settings); the salesperson can
// change each value on the task or follow-up itself.
import { CrmError } from "../data-management/errors.js";
import { FOLLOW_UP_REMINDER_OPTIONS, FOLLOW_UP_TYPES } from "../follow-ups/constants.js";
import { TASK_PRIORITIES, TASK_REMINDER_OPTIONS } from "../tasks/constants.js";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const invalid = (message, field) => new CrmError(400, message, "CRM_DEFAULTS_VALIDATION", { field });

const STANDARD = Object.freeze({ taskPriority: "medium", taskReminderMinutes: null, followUpType: "call", followUpReminderMinutes: null });

export async function getWorkDefaults(client, context) {
  const { rows } = await client.query(
    `SELECT default_task_priority, default_task_reminder_minutes, default_follow_up_type, default_follow_up_reminder_minutes
       FROM tenant.crm_settings WHERE organization_id = $1`,
    [context.organizationId],
  );
  const row = rows[0];
  if (!row) return { ...STANDARD };
  return {
    taskPriority: row.default_task_priority,
    taskReminderMinutes: row.default_task_reminder_minutes,
    // a type that was since removed falls back to the standard one
    followUpType: FOLLOW_UP_TYPES.some((type) => type.code === row.default_follow_up_type) ? row.default_follow_up_type : STANDARD.followUpType,
    followUpReminderMinutes: row.default_follow_up_reminder_minutes,
  };
}

// The choices the settings page offers.
export function workDefaultChoices() {
  return {
    taskPriorities: TASK_PRIORITIES,
    taskReminderOptions: TASK_REMINDER_OPTIONS,
    followUpTypes: FOLLOW_UP_TYPES,
    followUpReminderOptions: FOLLOW_UP_REMINDER_OPTIONS,
  };
}

function reminder(value, options, field) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!options.some((option) => option.minutes === minutes)) throw invalid("Choose a reminder from the list.", field);
  return minutes;
}

// input: { taskPriority?, taskReminderMinutes? (null = no reminder), followUpType?, followUpReminderMinutes? }
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
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, default_task_priority, default_task_reminder_minutes, default_follow_up_type, default_follow_up_reminder_minutes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (organization_id) DO UPDATE SET default_task_priority = EXCLUDED.default_task_priority, default_task_reminder_minutes = EXCLUDED.default_task_reminder_minutes,
       default_follow_up_type = EXCLUDED.default_follow_up_type, default_follow_up_reminder_minutes = EXCLUDED.default_follow_up_reminder_minutes,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, next.taskPriority, next.taskReminderMinutes, next.followUpType, next.followUpReminderMinutes, context.userId ?? null],
  );
  return next;
}

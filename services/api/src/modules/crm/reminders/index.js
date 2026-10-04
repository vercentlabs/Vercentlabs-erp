// The one reminder mechanism for CRM: a reminder is a row of
// tenant.crm_activity_reminders that fires for an activity (a follow-up, a
// task, a meeting). Rows persist, so a restart, a logout or a closed browser
// never loses one; the worker (crm-follow-up-reminder-dispatch.js) claims the
// due rows and delivers them as notifications.
//
// Idempotent throughout: one row per (activity, offset, channel), a claim
// moves a row out of 'pending' in the same statement that selects it, and a
// reminder of an activity that is no longer open is never delivered.
import { CrmError } from "../data-management/errors.js";
import { addBusinessMinutes } from "../activities/shared/business-hours.js";

// Working hours used to time reminder delivery. There is no per-organization override yet.
const DEFAULT_BUSINESS_HOURS = { timezone: "Asia/Kolkata", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const CHANNELS = new Set(["in_app", "email"]);
// Used when a caller gives no offsets (meetings): a day before, an hour before and at the time.
const DEFAULT_OFFSETS = [1440, 60, 0];
const OPEN_STATUSES = ["planned", "in_progress", "overdue"];

const camelize = (key) => key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
const dto = (row) => Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value]));

function normalizeOffsets(offsets) {
  const list = Array.isArray(offsets) && offsets.length ? offsets : DEFAULT_OFFSETS;
  const cleaned = [...new Set(list.map((value) => Math.trunc(Number(value))))].filter((value) => Number.isFinite(value) && value >= 0 && value <= 43200).sort((a, b) => b - a);
  if (!cleaned.length) throw new CrmError(400, "Choose a valid reminder.", "CRM_REMINDER_INVALID");
  if (cleaned.length > 10) throw new CrmError(400, "An activity can have at most 10 reminders.", "CRM_REMINDER_LIMIT");
  return cleaned;
}

// options.workingHours: false fires at the exact moment (a reminder someone set
// for a time); true (default, meetings) moves a reminder outside working hours
// to the start of the next working period.
export async function createRemindersForActivity(client, context, activityId, dueAt, { offsets, channel = "in_app", workingHours = true } = {}) {
  if (!CHANNELS.has(channel)) throw new CrmError(400, "Reminder channel is invalid.", "CRM_REMINDER_CHANNEL_INVALID");
  const due = new Date(dueAt);
  const created = [];
  for (const offsetMinutes of normalizeOffsets(offsets)) {
    const naive = new Date(due.getTime() - offsetMinutes * 60000);
    const fireAt = workingHours ? addBusinessMinutes(naive, 1, DEFAULT_BUSINESS_HOURS) : naive;
    const result = await client.query(
      `INSERT INTO tenant.crm_activity_reminders (organization_id, activity_id, offset_minutes, channel, fire_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, activity_id, offset_minutes, channel) DO UPDATE
         SET fire_at = EXCLUDED.fire_at, status = 'pending', sent_at = NULL, delivered_at = NULL, acknowledged_at = NULL, failure_reason = NULL, updated_at = now()
         -- re-arm a reminder that was cancelled, or that already fired for an
         -- earlier time; one still waiting or being sent is left alone
         WHERE tenant.crm_activity_reminders.status = 'cancelled'
            OR tenant.crm_activity_reminders.fire_at <> EXCLUDED.fire_at
       RETURNING *`,
      [context.organizationId, activityId, offsetMinutes, channel, fireAt.toISOString(), context.userId ?? null],
    );
    if (result.rows[0]) created.push(dto(result.rows[0]));
  }
  return created;
}

export async function cancelPendingRemindersForActivity(client, context, activityId) {
  await client.query(
    `UPDATE tenant.crm_activity_reminders SET status = 'cancelled', updated_at = now() WHERE organization_id = $1 AND activity_id = $2 AND status = 'pending'`,
    [context.organizationId, activityId],
  );
}

// The activity's single reminder: the old one is cancelled, the new one armed.
// Editing a follow-up five times leaves exactly one pending reminder.
export async function replaceActivityReminder(client, context, activityId, dueAt, offsetMinutes) {
  await cancelPendingRemindersForActivity(client, context, activityId);
  if (offsetMinutes === null || offsetMinutes === undefined) return null;
  if (new Date(dueAt).getTime() - offsetMinutes * 60000 < Date.now() - 60000) return null;
  const [reminder] = await createRemindersForActivity(client, context, activityId, dueAt, { offsets: [offsetMinutes], workingHours: false });
  return reminder ?? null;
}

// Snooze: the reminder fires again at `until`; the activity's own date does not move.
export async function snoozeActivityReminder(client, context, activityId, until) {
  const at = new Date(until);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) throw new CrmError(400, "Choose a time in the future.", "CRM_REMINDER_INVALID");
  // the latest reminder of the activity is the one being snoozed; a snooze never adds a second
  const { rows } = await client.query(
    `UPDATE tenant.crm_activity_reminders SET fire_at = $3, status = 'pending', sent_at = NULL, delivered_at = NULL, acknowledged_at = NULL, failure_reason = NULL, updated_at = now()
      WHERE id = (SELECT id FROM tenant.crm_activity_reminders WHERE organization_id = $1 AND activity_id = $2 AND status <> 'cancelled'
                   ORDER BY fire_at DESC LIMIT 1)
      RETURNING *`,
    [context.organizationId, activityId, at.toISOString()],
  );
  if (rows[0]) return dto(rows[0]);
  const created = await client.query(
    `INSERT INTO tenant.crm_activity_reminders (organization_id, activity_id, offset_minutes, channel, fire_at, created_by)
     VALUES ($1, $2, 0, 'in_app', $3, $4)
     ON CONFLICT (organization_id, activity_id, offset_minutes, channel) DO UPDATE SET fire_at = EXCLUDED.fire_at, status = 'pending', sent_at = NULL, updated_at = now()
     RETURNING *`,
    [context.organizationId, activityId, at.toISOString(), context.userId ?? null],
  );
  return dto(created.rows[0]);
}

export async function listRemindersForActivity(client, context, activityId) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_activity_reminders WHERE organization_id = $1 AND activity_id = $2 ORDER BY fire_at DESC, channel`,
    [context.organizationId, activityId],
  );
  return rows.map(dto);
}

// Claims every reminder due to fire, with what the notification needs: the
// activity, who it is for, the record it is about and that record's company.
// A reminder of an activity that is no longer open is cancelled, not delivered.
export async function claimDueReminders(client, context, { limit = 200 } = {}) {
  const bounded = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
  await client.query(
    `UPDATE tenant.crm_activity_reminders reminder SET status = 'cancelled', updated_at = now()
       FROM tenant.crm_activities activity
      WHERE reminder.organization_id = $1 AND reminder.status = 'pending' AND reminder.fire_at <= now()
        AND activity.organization_id = reminder.organization_id AND activity.id = reminder.activity_id
        AND activity.status <> ALL ($2::text[])`,
    [context.organizationId, OPEN_STATUSES],
  );
  const result = await client.query(
    `UPDATE tenant.crm_activity_reminders reminder SET status = 'dispatching', updated_at = now()
      WHERE reminder.id IN (SELECT id FROM tenant.crm_activity_reminders WHERE organization_id = $1 AND status = 'pending' AND fire_at <= now()
                             ORDER BY fire_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING reminder.*`,
    [context.organizationId, bounded],
  );
  if (!result.rows.length) return [];
  const activities = await client.query(
    `SELECT activity.id, activity.activity_type, activity.subject, activity.entity_type, activity.entity_id, activity.due_at, activity.due_time_set,
            activity.assigned_to, activity.follow_up_type, activity.follow_up_number, activity.task_number, organization.timezone,
            assignee.full_name AS assigned_name, assignee.email AS assigned_email,
            COALESCE(lead.company_name, NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), ''), opportunity.name, account.display_name, contact.display_name) AS related_name,
            COALESCE(related_contact.display_name, CASE WHEN activity.entity_type = 'contact' THEN contact.display_name END,
                     NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), '')) AS person_name,
            COALESCE(company.display_name, account.display_name, opportunity_account.display_name, contact_account.display_name, lead.company_name) AS company_name
       FROM tenant.crm_activities activity
       JOIN public.organizations organization ON organization.id = activity.organization_id
       LEFT JOIN public.users assignee ON assignee.id = activity.assigned_to
       LEFT JOIN tenant.crm_leads lead ON activity.entity_type = 'lead' AND lead.organization_id = activity.organization_id AND lead.id = activity.entity_id
       LEFT JOIN tenant.crm_opportunities opportunity ON activity.entity_type = 'opportunity' AND opportunity.organization_id = activity.organization_id AND opportunity.id = activity.entity_id
       LEFT JOIN tenant.business_parties account ON activity.entity_type = 'party' AND account.organization_id = activity.organization_id AND account.id = activity.entity_id
       LEFT JOIN tenant.contacts contact ON activity.entity_type = 'contact' AND contact.organization_id = activity.organization_id AND contact.id = activity.entity_id
       LEFT JOIN tenant.contacts related_contact ON related_contact.organization_id = activity.organization_id AND related_contact.id = activity.related_contact_id
       LEFT JOIN tenant.business_parties company ON company.organization_id = activity.organization_id AND company.id = activity.related_party_id
       LEFT JOIN tenant.business_parties opportunity_account ON opportunity_account.organization_id = activity.organization_id AND opportunity_account.id = opportunity.party_id
       LEFT JOIN tenant.business_parties contact_account ON contact_account.organization_id = activity.organization_id AND contact_account.id = contact.party_id
      WHERE activity.organization_id = $1 AND activity.id = ANY ($2::uuid[])`,
    [context.organizationId, [...new Set(result.rows.map((row) => row.activity_id))]],
  );
  const byId = new Map(activities.rows.map((row) => [row.id, dto(row)]));
  return result.rows.map((row) => ({ ...dto(row), activity: byId.get(row.activity_id) || null }));
}

export async function markReminderOutcome(client, context, reminderId, { status, failureReason = null }) {
  if (!["sent", "failed"].includes(status)) throw new CrmError(400, "Unsupported reminder outcome.", "CRM_REMINDER_OUTCOME_INVALID");
  await client.query(
    `UPDATE tenant.crm_activity_reminders SET status = $3, sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END, failure_reason = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, reminderId, status, failureReason],
  );
}

// A 'dispatching' row a crashed worker never resolved goes back to 'pending'.
export async function resetStuckDispatchingReminders(client, context, { olderThanMinutes = 15 } = {}) {
  const result = await client.query(
    `UPDATE tenant.crm_activity_reminders SET status = 'pending', updated_at = now()
      WHERE organization_id = $1 AND status = 'dispatching' AND updated_at < now() - ($2 || ' minutes')::interval RETURNING id`,
    [context.organizationId, olderThanMinutes],
  );
  return result.rows.length;
}

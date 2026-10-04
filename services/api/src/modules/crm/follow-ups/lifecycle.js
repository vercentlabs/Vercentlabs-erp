// What happens to a follow-up: it is rescheduled, reassigned, completed with
// an outcome, cancelled, or its reminder snoozed. Each is its own operation,
// checked and recorded; nobody writes a follow-up's status or date directly.
//
// Every operation locks the follow-up first. Repeating one that has already
// happened (a double click on Complete, a retried request) changes nothing
// and records nothing a second time.
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { cancelPendingRemindersForActivity, replaceActivityReminder, snoozeActivityReminder } from "../reminders/index.js";
import { requireFollowUpPermission } from "./access.js";
import { ACTIVITY_OF_TYPE, FOLLOW_UP_OUTCOMES, FOLLOW_UP_PERMISSIONS } from "./constants.js";
import { listFollowUpHistoryEntries, recordFollowUpHistory } from "./history.js";
import { notifyFollowUpAssigned } from "./notify.js";
import {
  assertNotStale, assertOpen, getFollowUp, isOpenRow, lockFollowUp, readFollowUpForNotice, requireAssigneeFor, resolveReminder, resolveSchedule, scheduleFollowUp, toFollowUp, typeLabel,
} from "./records.js";

const text = (value) => String(value ?? "").trim();
const OUTCOME_CODES = FOLLOW_UP_OUTCOMES.map((entry) => entry.code);
const when = (followUp) => `${followUp.scheduledDate}${followUp.scheduledTime ? ` ${followUp.scheduledTime}` : ""}`;

// ------------------------------------------------------------------ reschedule

// input: { scheduledDate, scheduledTime?, reason?, reminderOffsetMinutes? | reminderAt?, expectedUpdatedAt? }
// The old and the new time are kept in the history; the reminder moves with it.
export async function rescheduleFollowUp(client, context, followUpId, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.reschedule, "You do not have permission to reschedule follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  assertOpen(row, "rescheduled");
  assertNotStale(row, input.expectedUpdatedAt);
  const before = toFollowUp(row);
  const { dueAt, dueTimeSet } = await resolveSchedule(client, context, input);
  const reminderOffset = "reminderOffsetMinutes" in input || "reminderAt" in input ? resolveReminder(input, dueAt) : row.reminder_offset_minutes;
  if (dueAt.getTime() === new Date(row.due_at).getTime() && dueTimeSet === row.due_time_set && reminderOffset === row.reminder_offset_minutes) return { changed: false };
  await client.query(
    `UPDATE tenant.crm_activities SET due_at = $3, due_time_set = $4, reminder_offset_minutes = $5, reminder_at = $6, updated_by = $7 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, dueAt, dueTimeSet, reminderOffset, reminderOffset === null ? null : new Date(dueAt.getTime() - reminderOffset * 60000), context.userId ?? null],
  );
  await replaceActivityReminder(client, context, row.id, dueAt, reminderOffset);
  const after = await getFollowUp(client, context, row.id).catch(() => null);
  const reason = text(input.reason).slice(0, 500) || null;
  await recordFollowUpHistory(client, context, row.id, "rescheduled", `Rescheduled: ${when(before)} → ${after ? when(after) : dueAt.toISOString()}${reason ? ` — ${reason}` : ""}`,
    { from: row.due_at, to: dueAt, reason });
  return { changed: true };
}

// ------------------------------------------------------------------ reassign

// input: { assignedTo, reason?, expectedUpdatedAt? }. Completed follow-ups keep who did them.
export async function reassignFollowUp(client, context, followUpId, input = {}, { notify = true } = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.reassign, "You do not have permission to reassign follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  assertOpen(row, "reassigned");
  assertNotStale(row, input.expectedUpdatedAt);
  const assignedTo = text(input.assignedTo);
  if (assignedTo === row.assigned_to) return { changed: false };
  await requireAssigneeFor(client, context, assignedTo, row);
  await client.query(`UPDATE tenant.crm_activities SET assigned_to = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, assignedTo, context.userId ?? null]);
  const name = (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [assignedTo])).rows[0]?.full_name ?? "someone";
  const reason = text(input.reason).slice(0, 500) || null;
  await recordFollowUpHistory(client, context, row.id, "reassigned", `Reassigned: ${row.assigned_name ?? "Unassigned"} → ${name}${reason ? ` — ${reason}` : ""}`, { from: row.assigned_to, to: assignedTo, reason });
  const followUp = await readFollowUpForNotice(client, context, row.id);
  if (notify && followUp) await notifyFollowUpAssigned(client, context, followUp, { reassigned: true });
  return { changed: true };
}

// The open follow-ups the previous owner had on a record follow the record to
// its new owner (lead or opportunity reassignment). Completed ones keep who did them.
export async function transferOpenFollowUps(client, context, { entityType, entityId, fromUserId, toUserId }) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return { transferred: 0 };
  const { rows } = await client.query(
    `UPDATE tenant.crm_activities SET assigned_to = $4, updated_by = $5
      WHERE organization_id = $1 AND activity_type = 'follow_up' AND entity_type = $2 AND entity_id = $3 AND assigned_to = $6
        AND status IN ('planned', 'in_progress', 'overdue')
      RETURNING id`,
    [context.organizationId, entityType, entityId, toUserId, context.userId ?? null, fromUserId],
  );
  for (const row of rows) await recordFollowUpHistory(client, context, row.id, "transferred", "Moved to the record's new owner", { from: fromUserId, to: toUserId });
  return { transferred: rows.length };
}

// ------------------------------------------------------------------ complete

// input: { outcome?, notes?, expectedUpdatedAt?, nextFollowUp?: { type?, scheduledDate, scheduledTime?, subject?, notes? }, nextTask?: { title, dueDate } }
// Completing a call, email, meeting or demo records that activity on the
// record's timeline. The next follow-up or task is scheduled on the same record.
export async function completeFollowUp(client, context, followUpId, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.complete, "You do not have permission to complete follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  if (row.status === "completed") return { changed: false, followUpId: null, taskId: null, activityId: row.logged_activity_id ?? null };
  assertOpen(row, "completed");
  assertNotStale(row, input.expectedUpdatedAt);
  const outcome = text(input.outcome) || null;
  if (outcome && !OUTCOME_CODES.includes(outcome)) throw new CrmError(400, "Choose an outcome from the list.", "CRM_FOLLOW_UP_VALIDATION");
  const notes = text(input.notes).slice(0, 2000) || null;

  // What actually happened, on the timeline: a completed call, email or meeting.
  let activityId = null;
  const activityType = ACTIVITY_OF_TYPE[row.follow_up_type];
  if (activityType) {
    const outcomeLabel = FOLLOW_UP_OUTCOMES.find((entry) => entry.code === outcome)?.label ?? null;
    const { rows } = await client.query(
      `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, outcome, assigned_to,
                                          start_at, completed_at, related_contact_id, related_party_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, now(), now(), $9, $10, $8, $8)
       RETURNING id`,
      [context.organizationId, row.entity_type, row.entity_id, activityType, `${typeLabel(row.follow_up_type)}: ${row.subject}`.slice(0, 300), notes,
        outcomeLabel, context.userId ?? null, row.related_contact_id, row.related_party_id],
    );
    activityId = rows[0].id;
  }
  await client.query(
    `UPDATE tenant.crm_activities SET status = 'completed', completed_at = now(), completed_by = $3, outcome_code = $4, outcome = $5, logged_activity_id = $6, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null, outcome, notes, activityId],
  );
  await cancelPendingRemindersForActivity(client, context, row.id);
  // Talking to the customer is activity on the lead or opportunity.
  if (row.entity_type === "lead") await client.query(`UPDATE tenant.crm_leads SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.entity_id]);
  if (row.entity_type === "opportunity") await client.query(`UPDATE tenant.crm_opportunities SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.entity_id]);
  const outcomeLabel = FOLLOW_UP_OUTCOMES.find((entry) => entry.code === outcome)?.label;
  await recordFollowUpHistory(client, context, row.id, "completed", `Completed${outcomeLabel ? ` — ${outcomeLabel}` : ""}${notes ? `: ${notes}` : ""}`, { outcome, notes, activityId });

  let nextFollowUpId = null;
  if (input.nextFollowUp) {
    const next = await scheduleFollowUp(client, context, {
      relatedType: row.entity_type, relatedId: row.entity_id, contactId: row.related_contact_id, assignedTo: row.assigned_to ?? context.userId,
      type: input.nextFollowUp.type || row.follow_up_type, subject: input.nextFollowUp.subject || row.subject, notes: input.nextFollowUp.notes,
      scheduledDate: input.nextFollowUp.scheduledDate, scheduledTime: input.nextFollowUp.scheduledTime, scheduledAt: input.nextFollowUp.scheduledAt,
      reminderOffsetMinutes: input.nextFollowUp.reminderOffsetMinutes ?? row.reminder_offset_minutes, originLeadId: row.origin_lead_id,
    });
    nextFollowUpId = next.id;
  }
  let taskId = null;
  if (input.nextTask?.title) {
    const { createTask } = await import("../tasks/records.js");
    const task = await createTask(client, context, {
      title: input.nextTask.title, dueDate: input.nextTask.dueDate, relatedType: row.entity_type, relatedId: row.entity_id, assignedTo: row.assigned_to ?? context.userId,
    });
    taskId = task.id;
  }
  await queueOutboxEvent(client, context, "crm.follow_up.completed", "follow_ups", row.id, { outcome, activityId, nextFollowUpId, taskId });
  return { changed: true, followUpId: nextFollowUpId, taskId, activityId };
}

// ------------------------------------------------------------------ cancel

export async function cancelFollowUp(client, context, followUpId, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.cancel, "You do not have permission to cancel follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  if (row.status === "cancelled") return { changed: false };
  if (!isOpenRow(row)) throw new CrmError(409, "This follow-up is completed and cannot be cancelled.", "CRM_FOLLOW_UP_CLOSED");
  assertNotStale(row, input.expectedUpdatedAt);
  const reason = text(input.reason).slice(0, 500) || null;
  await client.query(
    `UPDATE tenant.crm_activities SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null, reason],
  );
  await cancelPendingRemindersForActivity(client, context, row.id);
  await recordFollowUpHistory(client, context, row.id, "cancelled", `Cancelled${reason ? ` — ${reason}` : ""}`, { reason });
  return { changed: true };
}

// ------------------------------------------------------------------ snooze

// input: { minutes } (10, 60…) or { until } (a moment). The reminder fires again
// then; the follow-up's own date does not move unless it is rescheduled.
export async function snoozeFollowUpReminder(client, context, followUpId, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  assertOpen(row, "snoozed");
  if (row.assigned_to !== context.userId) throw new CrmError(403, "Only the person the follow-up is assigned to can snooze its reminder.", "PERMISSION_DENIED");
  const minutes = Math.trunc(Number(input.minutes));
  const until = input.until ? new Date(input.until) : Number.isFinite(minutes) && minutes > 0 && minutes <= 43200 ? new Date(Date.now() + minutes * 60000) : null;
  if (!until || Number.isNaN(until.getTime())) throw new CrmError(400, "Choose how long to snooze.", "CRM_FOLLOW_UP_VALIDATION");
  const reminder = await snoozeActivityReminder(client, context, row.id, until);
  await client.query(`UPDATE tenant.crm_activities SET follow_up_snooze_count = follow_up_snooze_count + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  await recordFollowUpHistory(client, context, row.id, "snoozed", `Reminder snoozed until ${until.toISOString()}`, { until });
  return { changed: true, remindAt: reminder.fireAt };
}

export async function listFollowUpHistory(client, context, followUpId) {
  const followUp = await getFollowUp(client, context, followUpId);
  return listFollowUpHistoryEntries(client, context, followUp.id);
}

// ------------------------------------------------------------------ bulk

async function runBulk(client, ids, operation) {
  const unique = [...new Set(Array.isArray(ids) ? ids : [])];
  if (!unique.length) throw new CrmError(400, "Select at least one follow-up.", "CRM_FOLLOW_UP_VALIDATION");
  if (unique.length > 200) throw new CrmError(400, "Select up to 200 follow-ups at a time.", "CRM_FOLLOW_UP_BULK_LIMIT");
  const results = [];
  for (const followUpId of unique) {
    await client.query("SAVEPOINT follow_up_bulk_operation");
    try {
      const outcome = await operation(followUpId);
      await client.query("RELEASE SAVEPOINT follow_up_bulk_operation");
      results.push({ followUpId, ok: true, changed: outcome?.changed !== false });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT follow_up_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ followUpId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

// input: { followUpIds, action: reassign | reschedule | cancel, assignedTo?, scheduledDate?, scheduledTime?, shiftDays?, reason? }
// There is no bulk complete: each follow-up is a conversation, with its own outcome.
export async function bulkUpdateFollowUps(client, context, input = {}) {
  const action = text(input.action);
  if (action === "reassign") return runBulk(client, input.followUpIds, (id) => reassignFollowUp(client, context, id, { assignedTo: input.assignedTo, reason: input.reason }));
  if (action === "cancel") return runBulk(client, input.followUpIds, (id) => cancelFollowUp(client, context, id, { reason: input.reason }));
  if (action === "reschedule") {
    const shift = Math.trunc(Number(input.shiftDays));
    if (!input.scheduledDate && (!Number.isFinite(shift) || shift === 0)) throw new CrmError(400, "Choose a new date, or how many days to move the follow-ups.", "CRM_FOLLOW_UP_VALIDATION");
    return runBulk(client, input.followUpIds, async (id) => {
      const followUp = await getFollowUp(client, context, id);
      const scheduledDate = input.scheduledDate || new Date(Date.parse(`${followUp.scheduledDate}T00:00:00Z`) + shift * 86400000).toISOString().slice(0, 10);
      return rescheduleFollowUp(client, context, id, { scheduledDate, scheduledTime: input.scheduledTime ?? followUp.scheduledTime ?? "", reason: input.reason });
    });
  }
  throw new CrmError(400, "Choose what to do with the selected follow-ups.", "CRM_FOLLOW_UP_VALIDATION");
}

// The open follow-ups on a record that is being closed (an opportunity won or
// lost, a lead disqualified): kept as they are, or cancelled with the reason given.
export async function settleOpenFollowUps(client, context, entityType, entityId, { action = "keep", reason = null } = {}) {
  if (action !== "cancel") return { cancelled: 0 };
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type = 'follow_up' AND entity_type = $2 AND entity_id = $3
        AND status IN ('planned', 'in_progress', 'overdue') FOR UPDATE`,
    [context.organizationId, entityType, entityId],
  );
  for (const row of rows) {
    await client.query(
      `UPDATE tenant.crm_activities SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, context.userId ?? null, reason],
    );
    await cancelPendingRemindersForActivity(client, context, row.id);
    await recordFollowUpHistory(client, context, row.id, "cancelled", `Cancelled — ${reason}`, { reason });
  }
  return { cancelled: rows.length };
}

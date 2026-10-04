// Logging work done on a deal: a call, an email, a meeting, a demo or a
// general activity — who did it, when, with which contact, the outcome, and
// optionally the next action. These are completed activities in the shared
// CRM activity table, so they appear in the deal's timeline next to tasks,
// follow-ups and notes. Tasks and follow-ups themselves belong to the shared
// CRM Tasks and Follow-ups capabilities; scheduleOpportunityFollowUp is the
// deal-side shortcut for the latter.
import { createCrmFollowUp } from "../activities/follow-ups/follow-up-operations.js";
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_ACTIVITY_TYPES, OPPORTUNITY_FOLLOW_UP_TYPES, OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { getOpportunity, isUuid, lockOpportunity, requireAccountContact } from "./records.js";

const TYPES = new Map(OPPORTUNITY_ACTIVITY_TYPES.map((entry) => [entry.code, entry]));
// The follow-up record stores its type as a channel; "task" has no channel.
const FOLLOW_UP_CHANNEL = Object.freeze({ call: "call", email: "email", meeting: "meeting", task: "other", other: "other" });
const text = (value) => String(value ?? "").trim();

// Everything scheduled or logged on the deal, newest first. Loading the
// opportunity first is what enforces visibility.
export async function listOpportunityActivities(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  const { rows } = await client.query(
    `SELECT activity.id, activity.activity_type, activity.subject, activity.description, activity.status, activity.priority, activity.outcome,
            activity.due_at, activity.completed_at, activity.created_at, activity.updated_at, activity.follow_up_channel,
            activity.assigned_to, assignee.full_name AS assigned_name, creator.full_name AS created_by_name
       FROM tenant.crm_activities activity
       LEFT JOIN public.users assignee ON assignee.id = activity.assigned_to
       LEFT JOIN public.users creator ON creator.id = activity.created_by
      WHERE activity.organization_id = $1 AND activity.entity_type = 'opportunity' AND activity.entity_id = $2
      ORDER BY COALESCE(activity.completed_at, activity.due_at, activity.created_at) DESC
      LIMIT 300`,
    [context.organizationId, opportunity.id],
  );
  return rows.map((row) => ({
    id: row.id, type: row.activity_type, subject: row.subject, notes: row.description, status: row.status, priority: row.priority, outcome: row.outcome,
    dueAt: row.due_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at, channel: row.follow_up_channel,
    assignedTo: row.assigned_to, assignedName: row.assigned_name, createdByName: row.created_by_name,
  }));
}

// input: { type: call | email | meeting | task | other, dueAt, assignedTo?, notes?, subject? }
export async function scheduleOpportunityFollowUp(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to schedule follow-ups on opportunities.");
  const type = text(input.type).toLowerCase() || "call";
  if (!OPPORTUNITY_FOLLOW_UP_TYPES.includes(type)) throw new CrmError(400, "Choose a follow-up type.", "CRM_OPPORTUNITY_FOLLOW_UP_VALIDATION");
  if (!input.dueAt) throw new CrmError(400, "Choose the follow-up date and time.", "CRM_OPPORTUNITY_FOLLOW_UP_VALIDATION");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.status !== "open") throw new CrmError(409, `This opportunity is ${opportunity.status}. Reopen it to schedule more work.`, "CRM_OPPORTUNITY_CLOSED");
  return createCrmFollowUp(client, context, {
    entityType: "opportunity",
    entityId: opportunity.id,
    subject: (text(input.subject) || `${type === "task" ? "Task" : `Follow-up ${type}`}: ${opportunity.name}`).slice(0, 300),
    description: text(input.notes) || null,
    assignedTo: input.assignedTo || opportunity.owner_user_id || context.userId,
    dueAt: input.dueAt,
    followUpChannel: FOLLOW_UP_CHANNEL[type],
    followUpReason: type === "task" ? "Task" : null,
  });
}

// input: { type: call | email | meeting | demo | other, subject?, notes?, outcome?, occurredAt?, contactId?,
//          nextAction?: { type, dueAt, assignedTo?, notes? } }
export async function addOpportunityActivity(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to log activities on opportunities.");
  const type = TYPES.get(text(input.type).toLowerCase());
  if (!type) throw new CrmError(400, "Choose an activity type.", "CRM_OPPORTUNITY_ACTIVITY_VALIDATION");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new CrmError(400, "Enter a valid date and time.", "CRM_OPPORTUNITY_ACTIVITY_VALIDATION");
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000)
    throw new CrmError(400, "A logged activity cannot be in the future. Schedule a follow-up instead.", "CRM_OPPORTUNITY_ACTIVITY_VALIDATION");
  const notes = text(input.notes);
  const outcome = text(input.outcome);
  if (notes.length > 4000 || outcome.length > 1000) throw new CrmError(400, "The notes or outcome are too long.", "CRM_OPPORTUNITY_ACTIVITY_VALIDATION");

  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.archived_at) throw new CrmError(409, "Restore this opportunity before logging work on it.", "CRM_OPPORTUNITY_ARCHIVED");
  const contact = isUuid(input.contactId) ? await requireAccountContact(client, context, input.contactId, opportunity.party_id) : null;
  const subject = (text(input.subject) || `${type.label}${contact ? ` with ${contact.display_name}` : ""}: ${opportunity.name}`).slice(0, 300);
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, outcome,
                                        assigned_to, start_at, completed_at, created_by, updated_by)
     VALUES ($1, 'opportunity', $2, $3, $4, $5, 'completed', $6, $7, $8, $8, $7, $7)
     RETURNING id`,
    [context.organizationId, opportunity.id, type.activityType, subject, notes || null, outcome || null, context.userId, occurredAt.toISOString()],
  );
  await client.query(
    `UPDATE tenant.crm_opportunities SET last_activity_at = GREATEST(COALESCE(last_activity_at, $3::timestamptz), $3::timestamptz), updated_by = $4
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, opportunity.id, occurredAt.toISOString(), context.userId],
  );
  const followUp = input.nextAction?.dueAt && opportunity.status === "open" ? await scheduleOpportunityFollowUp(client, context, opportunity.id, input.nextAction) : null;
  return { activityId: rows[0].id, followUpId: followUp?.id ?? null };
}

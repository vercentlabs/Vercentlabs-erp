// Work done with a person. Calls, emails and meetings are logged on the
// contact and also name the company they worked for at the time (and,
// optionally, the opportunity it was about); follow-ups and tasks are
// scheduled on the contact. The contact's activity list also shows work
// logged elsewhere that names this person.
import { scheduleFollowUp } from "../follow-ups/records.js";
import { CrmError } from "../data-management/errors.js";
import { requireContactPermission } from "./access.js";
import { CONTACT_ACTIVITY_TYPES, CONTACT_FOLLOW_UP_TYPES, CONTACT_PERMISSIONS } from "./constants.js";
import { getContact, lockContact } from "./records.js";
import { requireUuid } from "./validation.js";

const ACTIVITY_TYPES = new Map(CONTACT_ACTIVITY_TYPES.map((entry) => [entry.code, entry.label]));
const FOLLOW_UP_CHANNEL = Object.freeze({ call: "call", email: "email", meeting: "meeting", task: "other", other: "other" });
const text = (value) => String(value ?? "").trim();
const nameOf = (contact) => contact.display_name || `${contact.first_name} ${contact.last_name ?? ""}`.trim();

export async function listContactActivities(client, context, contactId) {
  const contact = await getContact(client, context, contactId);
  const { rows } = await client.query(
    `SELECT activity.id, activity.entity_type, activity.entity_id, activity.activity_type, activity.subject, activity.description, activity.status,
            activity.priority, activity.outcome, activity.due_at, activity.completed_at, activity.created_at, activity.updated_at, activity.follow_up_channel,
            activity.assigned_to, assignee.full_name AS assigned_name, creator.full_name AS created_by_name,
            COALESCE(activity.related_party_id, CASE WHEN activity.entity_type = 'party' THEN activity.entity_id END) AS account_id,
            account.display_name AS account_name, opportunity.id AS opportunity_id, opportunity.name AS opportunity_name
       FROM tenant.crm_activities activity
       LEFT JOIN public.users assignee ON assignee.id = activity.assigned_to
       LEFT JOIN public.users creator ON creator.id = activity.created_by
       LEFT JOIN tenant.business_parties account ON account.organization_id = activity.organization_id
             AND account.id = COALESCE(activity.related_party_id, CASE WHEN activity.entity_type = 'party' THEN activity.entity_id END)
       LEFT JOIN tenant.crm_opportunities opportunity ON activity.entity_type = 'opportunity' AND opportunity.organization_id = activity.organization_id AND opportunity.id = activity.entity_id
      WHERE activity.organization_id = $1 AND activity.activity_type <> 'note'
        AND ((activity.entity_type = 'contact' AND activity.entity_id = $2) OR activity.related_contact_id = $2)
      ORDER BY COALESCE(activity.completed_at, activity.due_at, activity.created_at) DESC
      LIMIT 300`,
    [context.organizationId, contact.id],
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.entity_type === "contact" ? "contact" : row.entity_type === "party" ? "account" : row.entity_type,
    sourceId: row.entity_id,
    type: row.activity_type,
    subject: row.subject,
    notes: row.description,
    status: row.status,
    priority: row.priority,
    outcome: row.outcome,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    channel: row.follow_up_channel,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    createdByName: row.created_by_name,
    accountId: row.account_id,
    accountName: row.account_name,
    opportunityId: row.opportunity_id,
    opportunityName: row.opportunity_name,
  }));
}

// input: { type: call | email | meeting | task | other, dueAt, assignedTo?, notes?, subject? }
export async function scheduleContactFollowUp(client, context, contactId, input = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.edit, "You do not have permission to schedule follow-ups on contacts.");
  if (!input.dueAt && !input.scheduledDate) throw new CrmError(400, "Choose the follow-up date.", "CRM_CONTACT_FOLLOW_UP_VALIDATION");
  const contact = await lockContact(client, context, contactId);
  if (contact.status === "archived") throw new CrmError(409, "Reactivate this contact before scheduling work with them.", "CRM_CONTACT_ARCHIVED");
  return scheduleFollowUp(client, context, {
    relatedType: "contact", relatedId: contact.id, type: input.type, subject: input.subject, notes: input.notes, contactId: input.contactId, assignedTo: input.assignedTo,
    scheduledDate: input.scheduledDate, scheduledTime: input.scheduledTime, scheduledAt: input.dueAt, reminderOffsetMinutes: input.reminderOffsetMinutes,
    reminderAt: input.reminderAt, idempotencyKey: input.idempotencyKey,
  });
}

async function assertContactOpportunity(client, context, contact, opportunityId) {
  if (!opportunityId) return null;
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2
        AND (contact_id = $3 OR party_id = $4 OR EXISTS (SELECT 1 FROM tenant.crm_opportunity_contact_roles r WHERE r.organization_id = $1 AND r.opportunity_id = $2 AND r.contact_id = $3))`,
    [context.organizationId, requireUuid(opportunityId, "Opportunity"), contact.id, contact.party_id],
  );
  if (!rows[0]) throw new CrmError(400, "Choose an opportunity of this contact or their company.", "CRM_CONTACT_ACTIVITY_VALIDATION");
  return rows[0].id;
}

// input: { type: call | email | meeting | other, subject?, notes?, outcome?, occurredAt?, opportunityId?, nextAction?: { type, dueAt, assignedTo?, notes? } }
// With an opportunity the activity is recorded on the opportunity and names this contact.
export async function addContactActivity(client, context, contactId, input = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.edit, "You do not have permission to log activities on contacts.");
  const type = text(input.type).toLowerCase();
  if (!ACTIVITY_TYPES.has(type)) throw new CrmError(400, "Choose an activity type.", "CRM_CONTACT_ACTIVITY_VALIDATION");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new CrmError(400, "Enter a valid date and time.", "CRM_CONTACT_ACTIVITY_VALIDATION");
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000)
    throw new CrmError(400, "A logged activity cannot be in the future. Schedule a follow-up instead.", "CRM_CONTACT_ACTIVITY_VALIDATION");
  const notes = text(input.notes);
  const outcome = text(input.outcome);
  if (notes.length > 4000 || outcome.length > 1000) throw new CrmError(400, "The notes or outcome are too long.", "CRM_CONTACT_ACTIVITY_VALIDATION");

  const contact = await lockContact(client, context, contactId);
  if (contact.status === "archived") throw new CrmError(409, "Reactivate this contact before logging work with them.", "CRM_CONTACT_ARCHIVED");
  const opportunityId = await assertContactOpportunity(client, context, contact, input.opportunityId);
  const subject = (text(input.subject) || `${ACTIVITY_TYPES.get(type)} with ${nameOf(contact)}`).slice(0, 300);
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, outcome,
                                        assigned_to, start_at, completed_at, related_contact_id, related_party_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $9, $10, $11, $8, $8)
     RETURNING id`,
    [context.organizationId, opportunityId ? "opportunity" : "contact", opportunityId ?? contact.id, type, subject, notes || null, outcome || null,
      context.userId, occurredAt.toISOString(), contact.id, contact.party_id],
  );
  const touch = [context.organizationId, occurredAt.toISOString()];
  await client.query(`UPDATE tenant.contacts SET last_activity_at = GREATEST(COALESCE(last_activity_at, $3::timestamptz), $3::timestamptz) WHERE organization_id = $1 AND id = $2`,
    [touch[0], contact.id, touch[1]]);
  if (contact.party_id)
    await client.query(`UPDATE tenant.business_parties SET last_activity_at = GREATEST(COALESCE(last_activity_at, $3::timestamptz), $3::timestamptz) WHERE organization_id = $1 AND id = $2`,
      [touch[0], contact.party_id, touch[1]]);
  const followUp = input.nextAction?.dueAt ? await scheduleContactFollowUp(client, context, contact.id, input.nextAction) : null;
  return { activityId: rows[0].id, followUpId: followUp?.id ?? null };
}

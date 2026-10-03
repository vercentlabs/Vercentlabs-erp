// Work done with a company. Calls, emails and meetings are logged on the
// account and can name the contact involved; follow-ups and tasks are
// scheduled on it. The account's activity list also shows what was logged on
// its contacts and opportunities, so the whole relationship reads in one
// place.
import { createCrmFollowUp } from "../activities/follow-ups/follow-up-operations.js";
import { CrmError } from "../data-management/errors.js";
import { requireAccountPermission } from "./access.js";
import { ACCOUNT_ACTIVITY_TYPES, ACCOUNT_FOLLOW_UP_TYPES, ACCOUNT_PERMISSIONS } from "./constants.js";
import { getAccount, lockAccount } from "./records.js";
import { requireUuid } from "./validation.js";

const ACTIVITY_TYPES = new Map(ACCOUNT_ACTIVITY_TYPES.map((entry) => [entry.code, entry.label]));
// The follow-up record stores its type as a channel; "task" has no channel.
const FOLLOW_UP_CHANNEL = Object.freeze({ call: "call", email: "email", meeting: "meeting", task: "other", other: "other" });
const text = (value) => String(value ?? "").trim();

// Everything on the account itself, on the people working there and on its
// opportunities, newest first. Loading the account first is what enforces visibility.
export async function listAccountActivities(client, context, partyId) {
  const account = await getAccount(client, context, partyId);
  const { rows } = await client.query(
    `SELECT activity.id, activity.entity_type, activity.entity_id, activity.activity_type, activity.subject, activity.description, activity.status,
            activity.priority, activity.outcome, activity.due_at, activity.completed_at, activity.created_at, activity.updated_at, activity.follow_up_channel,
            activity.assigned_to, assignee.full_name AS assigned_name, creator.full_name AS created_by_name,
            activity.related_contact_id, COALESCE(related.first_name || ' ' || COALESCE(related.last_name, ''), contact.first_name || ' ' || COALESCE(contact.last_name, '')) AS contact_name,
            opportunity.name AS opportunity_name
       FROM tenant.crm_activities activity
       LEFT JOIN public.users assignee ON assignee.id = activity.assigned_to
       LEFT JOIN public.users creator ON creator.id = activity.created_by
       LEFT JOIN tenant.contacts related ON related.organization_id = activity.organization_id AND related.id = activity.related_contact_id
       LEFT JOIN tenant.contacts contact ON activity.entity_type = 'contact' AND contact.organization_id = activity.organization_id AND contact.id = activity.entity_id
       LEFT JOIN tenant.crm_opportunities opportunity ON activity.entity_type = 'opportunity' AND opportunity.organization_id = activity.organization_id AND opportunity.id = activity.entity_id
      WHERE activity.organization_id = $1 AND activity.activity_type <> 'note'
        AND ((activity.entity_type = 'party' AND activity.entity_id = $2) OR activity.related_party_id = $2
          OR (activity.entity_type = 'contact' AND activity.related_party_id IS NULL AND contact.party_id = $2)
          OR (activity.entity_type = 'opportunity' AND opportunity.party_id = $2))
      ORDER BY COALESCE(activity.completed_at, activity.due_at, activity.created_at) DESC
      LIMIT 300`,
    [context.organizationId, account.id],
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.entity_type === "party" ? "account" : row.entity_type,
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
    contactId: row.related_contact_id ?? (row.entity_type === "contact" ? row.entity_id : null),
    contactName: row.contact_name?.trim() || null,
    opportunityName: row.opportunity_name,
  }));
}

async function assertAccountContact(client, context, partyId, contactId) {
  if (!contactId) return null;
  const { rows } = await client.query(`SELECT contact_id AS id FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND party_id = $3 AND status = 'active'`,
    [context.organizationId, requireUuid(contactId, "Contact"), partyId]);
  if (!rows[0]) throw new CrmError(400, "Choose a contact of this account.", "CRM_ACCOUNT_ACTIVITY_VALIDATION");
  return rows[0].id;
}

// input: { type: call | email | meeting | task | other, dueAt, assignedTo?, notes?, subject?, contactId? }
export async function scheduleAccountFollowUp(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to schedule follow-ups on accounts.");
  const type = text(input.type).toLowerCase() || "call";
  if (!ACCOUNT_FOLLOW_UP_TYPES.includes(type)) throw new CrmError(400, "Choose a follow-up type.", "CRM_ACCOUNT_FOLLOW_UP_VALIDATION");
  if (!input.dueAt) throw new CrmError(400, "Choose the follow-up date and time.", "CRM_ACCOUNT_FOLLOW_UP_VALIDATION");
  const account = await lockAccount(client, context, partyId);
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before scheduling work on it.", "CRM_ACCOUNT_ARCHIVED");
  const contactId = await assertAccountContact(client, context, account.id, input.contactId);
  const followUp = await createCrmFollowUp(client, context, {
    entityType: "party",
    entityId: account.id,
    subject: text(input.subject) || `${type === "task" ? "Task" : `Follow-up ${type}`}: ${account.display_name}`.slice(0, 300),
    description: text(input.notes) || null,
    assignedTo: input.assignedTo || account.owner_user_id || context.userId,
    dueAt: input.dueAt,
    followUpChannel: FOLLOW_UP_CHANNEL[type],
    followUpReason: type === "task" ? "Task" : null,
  });
  if (contactId) await client.query(`UPDATE tenant.crm_activities SET related_contact_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, followUp.id, contactId]);
  return followUp;
}

// input: { type: call | email | meeting | other, subject?, notes?, outcome?, occurredAt?, contactId?, nextAction?: { type, dueAt, assignedTo?, notes? } }
export async function addAccountActivity(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to log activities on accounts.");
  const type = text(input.type).toLowerCase();
  if (!ACTIVITY_TYPES.has(type)) throw new CrmError(400, "Choose an activity type.", "CRM_ACCOUNT_ACTIVITY_VALIDATION");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new CrmError(400, "Enter a valid date and time.", "CRM_ACCOUNT_ACTIVITY_VALIDATION");
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000)
    throw new CrmError(400, "A logged activity cannot be in the future. Schedule a follow-up instead.", "CRM_ACCOUNT_ACTIVITY_VALIDATION");
  const notes = text(input.notes);
  const outcome = text(input.outcome);
  if (notes.length > 4000 || outcome.length > 1000) throw new CrmError(400, "The notes or outcome are too long.", "CRM_ACCOUNT_ACTIVITY_VALIDATION");

  const account = await lockAccount(client, context, partyId);
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before logging work on it.", "CRM_ACCOUNT_ARCHIVED");
  const contactId = await assertAccountContact(client, context, account.id, input.contactId);
  const subject = (text(input.subject) || `${ACTIVITY_TYPES.get(type)} with ${account.display_name}`).slice(0, 300);
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, outcome,
                                        assigned_to, start_at, completed_at, related_contact_id, created_by, updated_by)
     VALUES ($1, 'party', $2, $3, $4, $5, 'completed', $6, $7, $8, $8, $9, $7, $7)
     RETURNING id`,
    [context.organizationId, account.id, type, subject, notes || null, outcome || null, context.userId, occurredAt.toISOString(), contactId],
  );
  await client.query(
    `UPDATE tenant.business_parties SET last_activity_at = GREATEST(COALESCE(last_activity_at, $3::timestamptz), $3::timestamptz)
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, account.id, occurredAt.toISOString()],
  );
  const followUp = input.nextAction?.dueAt ? await scheduleAccountFollowUp(client, context, account.id, input.nextAction) : null;
  return { activityId: rows[0].id, followUpId: followUp?.id ?? null };
}

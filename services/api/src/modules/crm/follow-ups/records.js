// A follow-up: when to contact a customer or revisit a deal again, by whom
// and how. Reading, listing, scheduling and editing; the lifecycle
// (reschedule, reassign, complete, cancel, snooze) is in lifecycle.js.
//
// A follow-up is a row of tenant.crm_activities with activity_type =
// 'follow_up', the table every CRM timeline already reads. The account and
// contact it concerns are kept on the row (related_party_id,
// related_contact_id), so account and contact pages show it without a copy.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { resolveMemberExecutionContext } from "../../../core/platform/reporting/execution-context.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { assertEligibleLeadAssignee } from "../leads/assignment.js";
import { replaceActivityReminder } from "../reminders/index.js";
import { canViewAllFollowUps, followUpCan, followUpCapabilities, followUpRelatedScopeSql, followUpScopeSql, requireFollowUpPermission } from "./access.js";
import {
  CHANNEL_OF_TYPE, FOLLOW_UP_NUMBER_DOCUMENT_TYPE, FOLLOW_UP_OUTCOMES, FOLLOW_UP_PERMISSIONS, FOLLOW_UP_RELATED_TYPES, FOLLOW_UP_REMINDER_OPTIONS,
  FOLLOW_UP_STATUSES, FOLLOW_UP_TYPES, FOLLOW_UP_VIEWS, OPEN_STORED_STATUSES,
} from "./constants.js";
import { recordFollowUpHistory } from "./history.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPE_CODES = FOLLOW_UP_TYPES.map((entry) => entry.code);
const RELATED_CODES = FOLLOW_UP_RELATED_TYPES.map((entry) => entry.code);
const OPEN = `follow_up.status IN (${OPEN_STORED_STATUSES.map((status) => `'${status}'`).join(", ")})`;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
export const isUuid = (value) => UUID.test(String(value ?? ""));
const invalid = (message, field) => new CrmError(400, message, "CRM_FOLLOW_UP_VALIDATION", { issues: [{ field, message }] });
export const typeLabel = (code) => FOLLOW_UP_TYPES.find((entry) => entry.code === code)?.label ?? "Follow-up";

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is invalid.`, "CRM_FOLLOW_UP_VALIDATION");
  return String(value);
}

// The calendar day and time of the follow-up, in the organization's time zone.
export const FOLLOW_UP_SELECT = `
  SELECT follow_up.*, organization.timezone AS organization_timezone,
         assignee.full_name AS assigned_name, creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         completer.full_name AS completed_by_name, canceller.full_name AS cancelled_by_name,
         to_char(follow_up.due_at AT TIME ZONE organization.timezone, 'YYYY-MM-DD') AS due_on,
         CASE WHEN follow_up.due_time_set THEN to_char(follow_up.due_at AT TIME ZONE organization.timezone, 'HH24:MI') END AS due_time_of_day,
         ((follow_up.due_at AT TIME ZONE organization.timezone)::date = (now() AT TIME ZONE organization.timezone)::date) AS due_today,
         ((follow_up.due_at AT TIME ZONE organization.timezone)::date > (now() AT TIME ZONE organization.timezone)::date) AS due_later,
         (follow_up.due_at < now()) AS past_due,
         COALESCE(lead.company_name, NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), '')) AS lead_name, lead.code AS lead_code,
         NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), '') AS lead_person,
         opportunity.name AS opportunity_name, opportunity.code AS opportunity_code,
         related_contact.display_name AS contact_name, related_contact.email AS contact_email, related_contact.mobile AS contact_mobile,
         entity_contact.display_name AS entity_contact_name,
         account.id AS account_id, COALESCE(account.display_name, lead.company_name) AS account_name,
         origin.code AS origin_lead_code
    FROM tenant.crm_activities follow_up
    JOIN public.organizations organization ON organization.id = follow_up.organization_id
    LEFT JOIN public.users assignee ON assignee.id = follow_up.assigned_to
    LEFT JOIN public.users creator ON creator.id = follow_up.created_by
    LEFT JOIN public.users updater ON updater.id = follow_up.updated_by
    LEFT JOIN public.users completer ON completer.id = follow_up.completed_by
    LEFT JOIN public.users canceller ON canceller.id = follow_up.cancelled_by
    LEFT JOIN tenant.crm_leads lead ON follow_up.entity_type = 'lead' AND lead.organization_id = follow_up.organization_id AND lead.id = follow_up.entity_id
    LEFT JOIN tenant.crm_opportunities opportunity ON follow_up.entity_type = 'opportunity' AND opportunity.organization_id = follow_up.organization_id AND opportunity.id = follow_up.entity_id
    LEFT JOIN tenant.contacts entity_contact ON follow_up.entity_type = 'contact' AND entity_contact.organization_id = follow_up.organization_id AND entity_contact.id = follow_up.entity_id
    LEFT JOIN tenant.contacts related_contact ON related_contact.organization_id = follow_up.organization_id
          AND related_contact.id = COALESCE(follow_up.related_contact_id, CASE WHEN follow_up.entity_type = 'contact' THEN follow_up.entity_id END)
    LEFT JOIN tenant.business_parties account ON account.organization_id = follow_up.organization_id
          AND account.id = COALESCE(follow_up.related_party_id, CASE WHEN follow_up.entity_type = 'party' THEN follow_up.entity_id END, opportunity.party_id, entity_contact.party_id)
    LEFT JOIN tenant.crm_leads origin ON origin.organization_id = follow_up.organization_id AND origin.id = follow_up.origin_lead_id`;

const STATUS_OF = Object.freeze({ planned: "scheduled", in_progress: "scheduled", overdue: "scheduled", completed: "completed", cancelled: "cancelled" });
const RELATED_PATH = Object.freeze({ lead: "/crm/leads", opportunity: "/crm/opportunities", party: "/crm/accounts", contact: "/crm/contacts" });

export function toFollowUp(row) {
  const status = STATUS_OF[row.status] ?? "scheduled";
  const open = status === "scheduled";
  const relatedName = { lead: row.lead_name, opportunity: row.opportunity_name, party: row.account_name, contact: row.entity_contact_name }[row.entity_type] ?? null;
  return {
    id: row.id,
    number: row.follow_up_number ?? null,
    subject: row.subject,
    notes: row.description,
    type: TYPE_CODES.includes(row.follow_up_type) ? row.follow_up_type : "other",
    status,
    relatedType: row.entity_id && RELATED_CODES.includes(row.entity_type) ? row.entity_type : null,
    relatedId: row.entity_id ?? null,
    relatedName,
    relatedCode: row.entity_type === "lead" ? row.lead_code : row.entity_type === "opportunity" ? row.opportunity_code : null,
    relatedHref: row.entity_id && RELATED_PATH[row.entity_type] ? `${RELATED_PATH[row.entity_type]}/${row.entity_id}` : null,
    // who to contact: the follow-up's contact, the contact it is about, or the lead's person
    contactId: row.related_contact_id ?? (row.entity_type === "contact" ? row.entity_id : null),
    contactName: row.contact_name ?? row.lead_person ?? null,
    contactEmail: row.contact_email ?? null,
    contactMobile: row.contact_mobile ?? null,
    accountId: row.account_id ?? null,
    accountName: row.account_name ?? null,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name ?? null,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    scheduledAt: row.due_at,
    scheduledDate: row.due_on ?? null,
    scheduledTime: row.due_time_of_day ?? null,
    reminderOffsetMinutes: row.reminder_offset_minutes ?? null,
    reminderAt: row.reminder_at,
    // calculated, never stored as a status
    isOverdue: open && row.past_due === true,
    isDueToday: open && row.due_today === true,
    isUpcoming: open && row.due_later === true,
    outcome: row.outcome_code ?? null,
    outcomeLabel: FOLLOW_UP_OUTCOMES.find((entry) => entry.code === row.outcome_code)?.label ?? null,
    outcomeNotes: row.outcome,
    loggedActivityId: row.logged_activity_id ?? null,
    originLeadId: row.origin_lead_id ?? null,
    originLeadCode: row.origin_lead_code ?? null,
    snoozeCount: row.follow_up_snooze_count ?? 0,
    completedAt: row.completed_at,
    completedByName: row.completed_by_name ?? null,
    cancelledAt: row.cancelled_at,
    cancelledByName: row.cancelled_by_name ?? null,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name ?? null,
  };
}

// ------------------------------------------------------------------ read

async function loadRow(client, context, followUpId, { lock = false } = {}) {
  const values = [context.organizationId, requireUuid(followUpId, "Follow-up")];
  const scope = followUpScopeSql(context, values, "follow_up");
  const { rows } = await client.query(
    `${FOLLOW_UP_SELECT} WHERE follow_up.organization_id = $1 AND follow_up.id = $2 AND follow_up.activity_type = 'follow_up'${scope}${lock ? " FOR UPDATE OF follow_up" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Follow-up not found.", "CRM_FOLLOW_UP_NOT_FOUND");
  return rows[0];
}

// The follow-up as just written, for its notification: the caller may no
// longer see it (it went to someone outside their team).
export async function readFollowUpForNotice(client, context, followUpId) {
  const { rows } = await client.query(`${FOLLOW_UP_SELECT} WHERE follow_up.organization_id = $1 AND follow_up.id = $2`, [context.organizationId, followUpId]);
  return rows[0] ? toFollowUp(rows[0]) : null;
}

export async function lockFollowUp(client, context, followUpId) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  return loadRow(client, context, followUpId, { lock: true });
}

export async function getFollowUp(client, context, followUpId) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  return toFollowUp(await loadRow(client, context, followUpId));
}

export function assertNotStale(row, expectedUpdatedAt) {
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This follow-up was changed by someone else. Reload it and try again.", "CRM_FOLLOW_UP_STALE_WRITE");
}

export const isOpenRow = (row) => OPEN_STORED_STATUSES.includes(row.status);

export function assertOpen(row, action) {
  if (!isOpenRow(row)) throw new CrmError(409, `This follow-up is ${STATUS_OF[row.status]}. It cannot be ${action}.`, "CRM_FOLLOW_UP_CLOSED");
}

// ------------------------------------------------------------------ list

const SORTS = Object.freeze({
  // scheduled first, then by when: overdue, today, upcoming
  smart: `CASE WHEN ${OPEN} THEN 0 ELSE 1 END, follow_up.due_at ASC NULLS LAST, follow_up.created_at DESC`,
  scheduledAt: "follow_up.due_at",
  createdAt: "follow_up.created_at",
  updatedAt: "follow_up.updated_at",
  assignee: "lower(assignee.full_name)",
  subject: "lower(follow_up.subject)",
});

// The WHERE clause shared by the list, the export and the summary.
export function buildFollowUpListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`follow_up.organization_id = ${bind(context.organizationId)}`, "follow_up.activity_type = 'follow_up'"];
  const view = filters.view || "mine";
  const me = () => bind(context.userId);
  const localToday = "(now() AT TIME ZONE organization.timezone)::date";
  const localDue = "(follow_up.due_at AT TIME ZONE organization.timezone)::date";
  if (["mine", "due_today", "upcoming", "overdue", "completed"].includes(view)) where.push(`follow_up.assigned_to = ${me()}`);
  if (["mine", "due_today", "upcoming", "overdue", "team"].includes(view)) where.push(OPEN);
  if (view === "due_today") where.push(`${localDue} = ${localToday}`);
  if (view === "upcoming") where.push(`${localDue} > ${localToday}`);
  if (view === "overdue") where.push("follow_up.due_at < now()");
  if (view === "completed") where.push("follow_up.status = 'completed'");
  if (view === "cancelled") where.push("follow_up.status = 'cancelled'");
  if (view === "created_by_me") where.push(`follow_up.created_by = ${me()}`);
  if (view === "team") {
    const caller = me();
    where.push(canViewAllFollowUps(context) ? `follow_up.assigned_to IS DISTINCT FROM ${caller}` : `follow_up.assigned_to IN (SELECT member.user_id FROM tenant.crm_sales_team_members member
      JOIN tenant.crm_sales_teams team ON team.organization_id = member.organization_id AND team.id = member.team_id AND team.status = 'active'
     WHERE member.organization_id = follow_up.organization_id AND member.status = 'active' AND team.manager_user_id = ${caller} AND member.user_id <> ${caller})`);
  }
  const status = {
    scheduled: OPEN, completed: "follow_up.status = 'completed'", cancelled: "follow_up.status = 'cancelled'", overdue: `${OPEN} AND follow_up.due_at < now()`,
  }[filters.status];
  if (status) where.push(status);
  if (TYPE_CODES.includes(filters.type)) where.push(`follow_up.follow_up_type = ${bind(filters.type)}`);
  if (filters.outcome && FOLLOW_UP_OUTCOMES.some((entry) => entry.code === filters.outcome)) where.push(`follow_up.outcome_code = ${bind(filters.outcome)}`);
  for (const [key, column] of Object.entries({ assigneeId: "assigned_to", createdBy: "created_by", completedBy: "completed_by" })) {
    if (filters[key] === "me") where.push(`follow_up.${column} = ${me()}`);
    else if (isUuid(filters[key])) where.push(`follow_up.${column} = ${bind(filters[key])}`);
  }
  if (RELATED_CODES.includes(filters.relatedType)) where.push(`follow_up.entity_type = ${bind(filters.relatedType)}`);
  if (isUuid(filters.relatedId)) where.push(`follow_up.entity_id = ${bind(filters.relatedId)}`);
  for (const [key, type] of Object.entries({ leadId: "lead", opportunityId: "opportunity" }))
    if (isUuid(filters[key])) where.push(`follow_up.entity_type = '${type}' AND follow_up.entity_id = ${bind(filters[key])}`);
  // A contact's follow-ups: about the contact, or with the contact on another record.
  if (isUuid(filters.contactId)) {
    const id = bind(filters.contactId);
    where.push(`(follow_up.related_contact_id = ${id} OR (follow_up.entity_type = 'contact' AND follow_up.entity_id = ${id}))`);
  }
  // An account's follow-ups: on the account, its opportunities and its contacts.
  if (isUuid(filters.accountId)) where.push(`account.id = ${bind(filters.accountId)}`);
  for (const [key, sql] of Object.entries({
    dueFrom: `${localDue} >= $::date`, dueTo: `${localDue} <= $::date`,
    createdFrom: "follow_up.created_at >= $::date", createdTo: "follow_up.created_at < $::date + interval '1 day'",
  })) if (DATE.test(String(filters[key] ?? ""))) where.push(sql.replace("$", bind(filters[key])));
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`follow_up.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);
  const search = text(filters.search).toLowerCase();
  if (search)
    where.push(`lower(follow_up.subject || ' ' || COALESCE(follow_up.follow_up_number, '') || ' ' || COALESCE(related_contact.display_name, '') || ' ' || COALESCE(account.display_name, ''))
      LIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  return `WHERE ${where.join(" AND ")}${followUpScopeSql(context, values, "follow_up")}`;
}

export async function listFollowUps(client, context, filters = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortKey = SORTS[filters.sortBy] ? filters.sortBy : "smart";
  const direction = String(filters.sortDirection).toLowerCase() === "desc" ? "DESC" : "ASC";
  const order = sortKey === "smart" ? SORTS.smart : `${SORTS[sortKey]} ${direction} NULLS LAST, follow_up.created_at DESC`;
  const values = [];
  const where = buildFollowUpListWhere(context, filters, values);
  const total = await client.query(`SELECT count(*)::int AS total FROM (${FOLLOW_UP_SELECT} ${where}) counted`, values);
  const { rows } = await client.query(`${FOLLOW_UP_SELECT} ${where} ORDER BY ${order}, follow_up.id LIMIT ${limit} OFFSET ${offset}`, values);
  return { followUps: rows.map(toFollowUp), total: total.rows[0].total, limit, offset, capabilities: followUpCapabilities(context) };
}

export async function getFollowUpSummary(client, context) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  const count = async (view, extra = {}) => {
    const values = [];
    const where = buildFollowUpListWhere(context, { view, ...extra }, values);
    return (await client.query(`SELECT count(*)::int AS total FROM (${FOLLOW_UP_SELECT} ${where}) counted`, values)).rows[0].total;
  };
  const managesTeam = canViewAllFollowUps(context) || followUpCan(context, FOLLOW_UP_PERMISSIONS.viewTeam);
  return {
    dueToday: await count("due_today"),
    overdue: await count("overdue"),
    upcoming: await count("upcoming"),
    open: await count("mine"),
    teamOverdue: managesTeam ? await count("team", { status: "overdue" }) : null,
  };
}

// ------------------------------------------------------------------ validation

// The record a follow-up is about: visible to the caller, in this organization.
// Returns its owner (the default assignee) and its account.
async function requireRelated(client, context, type, id) {
  if (!RELATED_CODES.includes(type)) throw invalid("Choose what the follow-up is about: a lead, account, contact or opportunity.", "relatedType");
  const values = [context.organizationId, requireUuid(id, "Related record")];
  const scope = followUpRelatedScopeSql(context, values, "follow_up");
  const { rows } = await client.query(`SELECT 1 FROM (SELECT $1::uuid AS organization_id, $2::uuid AS entity_id, '${type}'::text AS entity_type) follow_up WHERE true${scope}`, values);
  if (!rows[0]) throw new CrmError(404, "The related record was not found, or you do not have access to it.", "CRM_FOLLOW_UP_RELATED_INVALID");
  const sql = {
    lead: `SELECT owner_user_id, NULL::uuid AS account_id, status, archived_at IS NOT NULL AS archived FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2`,
    opportunity: `SELECT owner_user_id, party_id AS account_id, status, archived_at IS NOT NULL AS archived FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2`,
    party: `SELECT owner_user_id, id AS account_id, status, status = 'archived' AS archived FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    contact: `SELECT owner_user_id, party_id AS account_id, status, status = 'archived' AS archived FROM tenant.contacts WHERE organization_id = $1 AND id = $2`,
  }[type];
  const record = (await client.query(sql, [context.organizationId, id])).rows[0];
  if (!record) throw new CrmError(404, "The related record was not found.", "CRM_FOLLOW_UP_RELATED_INVALID");
  if (record.archived) throw new CrmError(409, "This record is archived. Restore it before scheduling follow-ups on it.", "CRM_FOLLOW_UP_RELATED_ARCHIVED");
  if (type === "lead" && record.status === "converted") throw new CrmError(409, "This lead is converted. Schedule the follow-up on its opportunity.", "CRM_FOLLOW_UP_RELATED_CLOSED");
  return { entity_type: type, entity_id: id, ownerUserId: record.owner_user_id, accountId: record.account_id };
}

// The contact to speak to: a person at the record's account.
async function requireContact(client, context, contactId, related) {
  if (!contactId) return null;
  requireUuid(contactId, "Contact");
  if (related.entity_type === "contact") {
    if (contactId !== related.entity_id) throw invalid("This follow-up is about that contact already.", "contactId");
    return contactId;
  }
  if (!related.accountId) throw invalid("Choose a contact only for an account, contact or opportunity follow-up.", "contactId");
  const { rows } = await client.query(
    `SELECT contact.id FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.id = $2 AND contact.status <> 'archived'
        AND (contact.party_id = $3 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link
              WHERE link.organization_id = contact.organization_id AND link.contact_id = contact.id AND link.party_id = $3 AND link.status = 'active'))`,
    [context.organizationId, contactId, related.accountId],
  );
  if (!rows[0]) throw invalid("Choose a contact who belongs to this account.", "contactId");
  return contactId;
}

// The assignee: an active member with CRM access who can see the record the follow-up is about.
export async function requireAssignee(client, context, userId, related) {
  if (!userId) throw invalid("Every follow-up needs someone responsible.", "assignedTo");
  await assertEligibleLeadAssignee(client, context, requireUuid(userId, "Assignee")).catch((error) => {
    throw new CrmError(409, error.message, "CRM_FOLLOW_UP_ASSIGNEE_INVALID");
  });
  if (userId === context.userId) return;
  const assignee = await resolveMemberExecutionContext(client, context.organizationId, { userId });
  if (!assignee || !followUpCan(assignee, FOLLOW_UP_PERMISSIONS.view)) throw new CrmError(409, "This person does not have access to CRM follow-ups.", "CRM_FOLLOW_UP_ASSIGNEE_INVALID");
  const values = [context.organizationId, related.entity_id];
  const scope = followUpRelatedScopeSql(assignee, values, "follow_up");
  const { rows } = await client.query(`SELECT 1 FROM (SELECT $1::uuid AS organization_id, $2::uuid AS entity_id, '${related.entity_type}'::text AS entity_type) follow_up WHERE true${scope}`, values);
  if (!rows[0]) throw new CrmError(409, "This person cannot see the record the follow-up is about. Choose someone who has access to it.", "CRM_FOLLOW_UP_ASSIGNEE_NO_ACCESS");
}
export const requireAssigneeFor = (client, context, userId, row) => requireAssignee(client, context, userId, { entity_type: row.entity_type, entity_id: row.entity_id });

// scheduledDate (YYYY-MM-DD) is required; scheduledTime (HH:MM) is optional:
// "Follow up Friday" is due by the end of Friday in the organization's time
// zone. scheduledAt, an exact moment, is accepted from older callers.
export async function resolveSchedule(client, context, input) {
  if (!input.scheduledDate && input.scheduledAt) {
    const at = new Date(input.scheduledAt);
    if (Number.isNaN(at.getTime())) throw invalid("Choose a valid date and time.", "scheduledAt");
    return { dueAt: at, dueTimeSet: true };
  }
  const date = text(input.scheduledDate).slice(0, 10);
  if (!DATE.test(date)) throw invalid("Choose the date of the follow-up.", "scheduledDate");
  const time = text(input.scheduledTime);
  if (time && !TIME.test(time)) throw invalid("Enter the time as HH:MM.", "scheduledTime");
  const { rows } = await client.query(
    `SELECT (($2::date + COALESCE($3::time, time '23:59:59')) AT TIME ZONE timezone) AS due_at FROM public.organizations WHERE id = $1`,
    [context.organizationId, date, time || null],
  );
  if (!rows[0]?.due_at) throw invalid("Choose a valid date.", "scheduledDate");
  return { dueAt: new Date(rows[0].due_at), dueTimeSet: Boolean(time) };
}

// reminderOffsetMinutes (0, 15, 30, 60, 1440…) or reminderAt (custom). Neither: no reminder. Returns the offset.
export function resolveReminder(input, dueAt) {
  if (has(input, "reminderAt") && input.reminderAt) {
    const at = new Date(input.reminderAt);
    if (Number.isNaN(at.getTime())) throw invalid("Choose a valid reminder date and time.", "reminderAt");
    const minutes = Math.round((dueAt.getTime() - at.getTime()) / 60000);
    if (minutes < 0) throw invalid("The reminder must be at or before the follow-up.", "reminderAt");
    if (minutes > 43200) throw invalid("The reminder can be at most 30 days before the follow-up.", "reminderAt");
    return minutes;
  }
  const value = input.reminderOffsetMinutes;
  if (value === null || value === undefined || value === "") return null;
  const minutes = Math.trunc(Number(value));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 43200) throw invalid("Choose a reminder.", "reminderOffsetMinutes");
  return minutes;
}

export function validType(value) {
  const type = text(value).toLowerCase() || "call";
  // older screens still send "task" for a follow-up without a channel
  if (type === "task") return "other";
  if (!TYPE_CODES.includes(type)) throw invalid("Choose how to follow up: call, email, meeting, demo or other.", "type");
  return type;
}

function validSubject(value, fallback) {
  const subject = text(value) || fallback;
  if (subject.length > 300) throw invalid("Use 300 characters or fewer.", "subject");
  return subject;
}

function validNotes(value) {
  const notes = text(value);
  if (notes.length > 4000) throw invalid("Use 4,000 characters or fewer.", "notes");
  return notes || null;
}

async function relatedLabel(client, context, related) {
  const sql = {
    lead: `SELECT COALESCE(company_name, NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), code) AS name FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2`,
    opportunity: `SELECT name FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2`,
    party: `SELECT display_name AS name FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    contact: `SELECT display_name AS name FROM tenant.contacts WHERE organization_id = $1 AND id = $2`,
  }[related.entity_type];
  return (await client.query(sql, [context.organizationId, related.entity_id])).rows[0]?.name ?? "";
}

// ------------------------------------------------------------------ schedule

// input: { relatedType, relatedId, type?, subject?, notes?, contactId?, scheduledDate, scheduledTime? | scheduledAt?,
//          reminderOffsetMinutes? | reminderAt?, assignedTo?, idempotencyKey? }
// The follow-up goes to the record's owner unless assignedTo names someone else.
export async function scheduleFollowUp(client, context, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.create, "You do not have permission to schedule follow-ups.");
  const key = text(input.idempotencyKey).slice(0, 120);
  if (key) {
    const { rows } = await client.query(`SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type = 'follow_up' AND external_id = $2`, [context.organizationId, `follow-up:${key}`]);
    if (rows[0]) return getFollowUp(client, context, rows[0].id);
  }
  const related = await requireRelated(client, context, input.relatedType, input.relatedId);
  const type = validType(input.type);
  const contactId = await requireContact(client, context, input.contactId || null, related);
  const subject = validSubject(input.subject, `${typeLabel(type)}: ${await relatedLabel(client, context, related)}`.slice(0, 300));
  const notes = validNotes(input.notes);
  const assignedTo = input.assignedTo || related.ownerUserId || context.userId;
  await requireAssignee(client, context, assignedTo, related);
  const { dueAt, dueTimeSet } = await resolveSchedule(client, context, input);
  const reminderOffset = resolveReminder(input, dueAt);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: FOLLOW_UP_NUMBER_DOCUMENT_TYPE });

  const { rows } = await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, priority, assigned_to, due_at, due_time_set,
                                        follow_up_type, follow_up_channel, related_contact_id, related_party_id, reminder_offset_minutes, reminder_at, follow_up_number,
                                        origin_lead_id, external_id, created_by, updated_by)
     VALUES ($1, $2, $3, 'follow_up', $4, $5, 'planned', 'medium', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
     RETURNING id`,
    [context.organizationId, related.entity_type, related.entity_id, subject, notes, assignedTo, dueAt, dueTimeSet, type, CHANNEL_OF_TYPE[type],
      related.entity_type === "contact" ? null : contactId, related.entity_type === "party" ? null : related.accountId, reminderOffset,
      reminderOffset === null ? null : new Date(dueAt.getTime() - reminderOffset * 60000), number, isUuid(input.originLeadId) ? input.originLeadId : null,
      key ? `follow-up:${key}` : null, context.userId ?? null],
  );
  const id = rows[0].id;
  await replaceActivityReminder(client, context, id, dueAt, reminderOffset);
  const followUp = await readFollowUpForNotice(client, context, id);
  await recordFollowUpHistory(client, context, id, "scheduled",
    `Scheduled for ${followUp?.scheduledDate ?? dueAt.toISOString().slice(0, 10)}${followUp?.scheduledTime ? ` ${followUp.scheduledTime}` : ""}${assignedTo !== context.userId ? ` — assigned to ${followUp?.assignedName ?? "someone else"}` : ""}`,
    { type, assignedTo, scheduledAt: dueAt, reminderOffsetMinutes: reminderOffset });
  if (assignedTo !== context.userId && followUp) {
    const { notifyFollowUpAssigned } = await import("./notify.js");
    await notifyFollowUpAssigned(client, context, followUp, { reassigned: false });
  }
  await queueOutboxEvent(client, context, "crm.follow_up.scheduled", "follow_ups", id, { relatedType: related.entity_type, relatedId: related.entity_id, assignedTo });
  return followUp ?? { id };
}

// ------------------------------------------------------------------ update

// input: any of { subject, notes, type, contactId, reminderOffsetMinutes, reminderAt }, plus expectedUpdatedAt.
// Moving it in time is rescheduleFollowUp; changing who does it, reassignFollowUp.
export async function updateFollowUp(client, context, followUpId, input = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.edit, "You do not have permission to edit follow-ups.");
  for (const field of ["status", "assignedTo", "scheduledDate", "scheduledTime", "scheduledAt", "completedAt", "completedBy", "outcome", "number"])
    if (has(input, field))
      throw new CrmError(409, field === "assignedTo" ? "Use Reassign to change who follows up." : field.startsWith("scheduled") ? "Use Reschedule to move the follow-up." : "This field is set by the follow-up's own actions.", "CRM_FOLLOW_UP_FIELD_GOVERNED");
  const row = await lockFollowUp(client, context, followUpId);
  assertOpen(row, "edited");
  assertNotStale(row, input.expectedUpdatedAt);
  const sets = [];
  const values = [context.organizationId, row.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  const events = [];
  if (has(input, "subject") && validSubject(input.subject, row.subject) !== row.subject) {
    const subject = validSubject(input.subject, row.subject);
    set("subject", subject);
    events.push(["updated", `Subject: ${row.subject} → ${subject}`, { from: row.subject, to: subject }]);
  }
  if (has(input, "notes") && validNotes(input.notes) !== row.description) {
    set("description", validNotes(input.notes));
    events.push(["updated", "Notes changed", {}]);
  }
  if (has(input, "type") && validType(input.type) !== row.follow_up_type) {
    const type = validType(input.type);
    set("follow_up_type", type);
    set("follow_up_channel", CHANNEL_OF_TYPE[type]);
    events.push(["updated", `Type: ${typeLabel(row.follow_up_type)} → ${typeLabel(type)}`, { from: row.follow_up_type, to: type }]);
  }
  if (has(input, "contactId") && row.entity_type !== "contact") {
    const related = { entity_type: row.entity_type, entity_id: row.entity_id, accountId: row.account_id };
    const contactId = await requireContact(client, context, input.contactId || null, related);
    if ((contactId ?? null) !== (row.related_contact_id ?? null)) {
      set("related_contact_id", contactId);
      events.push(["related_changed", contactId ? "Contact changed" : "Contact removed", { from: row.related_contact_id, to: contactId }]);
    }
  }
  let reminderOffset = row.reminder_offset_minutes;
  if (has(input, "reminderOffsetMinutes") || has(input, "reminderAt")) {
    reminderOffset = resolveReminder(input, new Date(row.due_at));
    if (reminderOffset !== row.reminder_offset_minutes) {
      set("reminder_offset_minutes", reminderOffset);
      set("reminder_at", reminderOffset === null ? null : new Date(new Date(row.due_at).getTime() - reminderOffset * 60000));
      events.push(["reminder_changed", reminderOffset === null ? "Reminder removed" : "Reminder changed", { from: row.reminder_offset_minutes, to: reminderOffset }]);
    }
  }
  if (!sets.length) return toFollowUp(row);
  values.push(context.userId ?? null);
  await client.query(`UPDATE tenant.crm_activities SET ${sets.join(", ")}, updated_by = $${values.length} WHERE organization_id = $1 AND id = $2`, values);
  if (reminderOffset !== row.reminder_offset_minutes) await replaceActivityReminder(client, context, row.id, row.due_at, reminderOffset);
  for (const [type, summary, changes] of events) await recordFollowUpHistory(client, context, row.id, type, summary, changes);
  return getFollowUp(client, context, row.id);
}

// ------------------------------------------------------------------ delete

// Only a follow-up scheduled by mistake: never completed, cancelled, rescheduled,
// reassigned or reminded. Anything else is cancelled, so its history stays.
export async function deleteFollowUp(client, context, followUpId) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.delete, "You do not have permission to delete follow-ups.");
  const row = await lockFollowUp(client, context, followUpId);
  const used = await client.query(
    `SELECT EXISTS (SELECT 1 FROM tenant.crm_follow_up_history WHERE organization_id = $1 AND follow_up_id = $2 AND event_type IN ('rescheduled', 'reassigned', 'transferred', 'snoozed', 'completed', 'cancelled'))
         OR EXISTS (SELECT 1 FROM tenant.crm_activity_reminders WHERE organization_id = $1 AND activity_id = $2 AND status IN ('sent', 'delivered', 'acknowledged')) AS used`,
    [context.organizationId, row.id],
  );
  if (!isOpenRow(row) || used.rows[0].used) throw new CrmError(409, "This follow-up has history. Cancel it instead, so it is kept.", "CRM_FOLLOW_UP_IN_USE");
  await client.query(`DELETE FROM tenant.crm_follow_up_history WHERE organization_id = $1 AND follow_up_id = $2`, [context.organizationId, row.id]);
  await client.query(`DELETE FROM tenant.crm_activities WHERE organization_id = $1 AND id = $2 AND activity_type = 'follow_up'`, [context.organizationId, row.id]);
  return { deleted: true };
}

// ------------------------------------------------------------------ options

async function followUpDefaults(client, context) {
  const { getWorkDefaults } = await import("../workspace/defaults.js");
  const defaults = await getWorkDefaults(client, context);
  return { type: defaults.followUpType, reminderOffsetMinutes: defaults.followUpReminderMinutes };
}

export async function getFollowUpOptions(client, context) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.view, "You do not have permission to view follow-ups.");
  const { listLeadAssignmentOptions } = await import("../leads/assignment.js");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const managesTeam = canViewAllFollowUps(context) || followUpCan(context, FOLLOW_UP_PERMISSIONS.viewTeam);
  return {
    views: FOLLOW_UP_VIEWS.filter((view) => !["team", "all"].includes(view.key) || managesTeam),
    statuses: FOLLOW_UP_STATUSES,
    types: FOLLOW_UP_TYPES,
    outcomes: FOLLOW_UP_OUTCOMES,
    relatedTypes: FOLLOW_UP_RELATED_TYPES,
    reminderOptions: FOLLOW_UP_REMINDER_OPTIONS,
    // What a new follow-up starts with (CRM Settings, Follow-up Defaults).
    defaults: await followUpDefaults(client, context),
    users,
    teams,
    currentUserId: context.userId,
    capabilities: followUpCapabilities(context),
  };
}

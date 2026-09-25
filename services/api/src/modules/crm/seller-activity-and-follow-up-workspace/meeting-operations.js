import { crmOwnerScopeSql } from "../crm-data-operations-and-customization/crm-access-scope.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { assertEligibleLeadAssignee } from "../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { upsertMeetingCalendarEvent, markMeetingCalendarEventCancelling, enqueueCalendarPushJob } from "./communications.js";
import { createRemindersForActivity, cancelPendingRemindersForActivity } from "./follow-ups/follow-up-operations.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const RELATED = new Set(["lead", "opportunity", "party", "contact", "campaign", "general"]);
const LOCATION_TYPES = new Set(["in_person", "online", "phone", "other"]);
const OUTCOMES = new Set(["held", "no_show"]);
const EDITABLE_STATUSES = new Set(["planned", "overdue"]);
const ATTENDEE_RESPONSES = new Set(["needs_action", "accepted", "declined", "tentative"]);
const MEETING_FIELDS = new Set([
  "companyId", "branchId", "entityType", "entityId", "subject", "description", "priority", "assignedTo",
  "startAt", "endAt", "locationType", "location", "meetingUrl", "attendees",
]);
const CREATE_FIELDS = new Set([...MEETING_FIELDS, "mode", "occurredAt", "durationMinutes", "outcomeCode", "outcome"]);
const EXPECTATION_FIELDS = new Set(["expectedUpdatedAt", "expectedStatus"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => String(value ?? "").trim();
const iso = (value) => (value ? new Date(value).toISOString() : null);

function camelize(key) {
  return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
}
function dto(row) {
  const result = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value]));
  result.locationType = result.meetingLocationType ?? null;
  result.meetingUrl = result.meetingUrl ?? null;
  result.outcomeCode = result.meetingOutcomeCode ?? null;
  result.actualStartedAt = result.meetingStartedAt ?? null;
  result.actualEndedAt = result.meetingEndedAt ?? null;
  result.durationSeconds = result.meetingDurationSeconds ?? null;
  result.bookingId = result.meetingBookingId ?? null;
  result.calendarEventId = result.meetingCalendarEventId ?? null;
  result.attendeeCount = Number(result.attendeeCount ?? 0);
  return result;
}
// crm_meeting_events rows already name their own columns (location_type,
// outcome_code, duration_seconds) without the meeting_* prefix crm_activities
// uses — reusing dto()'s meeting_*-derived overrides would read those as
// absent and null out the very fields this ledger exists to preserve.
function eventDto(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value]));
}
function add(values, value) {
  values.push(value);
  return `$${values.length}`;
}
function assertUuid(value, label, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_MEETING_REFERENCE_INVALID");
  return String(value);
}
function dateValue(value, label, nullable = true) {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && nullable) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new CrmError(400, `${label} must be a valid date and time.`, "CRM_MEETING_DATETIME_INVALID");
  return new Date(parsed).toISOString();
}
function assertAllowed(input, allowed) {
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw new CrmError(400, `Unsupported Meeting field: ${key}.`, "CRM_MEETING_INPUT_INVALID");
  }
}
function normalizeUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  if (raw.length > 2048) throw new CrmError(400, "Meeting URL must be at most 2,048 characters.", "CRM_MEETING_URL_INVALID");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new CrmError(400, "Meeting URL is invalid.", "CRM_MEETING_URL_INVALID"); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol))
    throw new CrmError(400, "Meeting URL must use http or https.", "CRM_MEETING_URL_INVALID");
  return parsed.toString();
}
function normalizeBase(input, { create = false } = {}) {
  assertAllowed(input, create ? CREATE_FIELDS : MEETING_FIELDS);
  const out = {};
  if (hasOwn(input, "companyId")) out.companyId = assertUuid(input.companyId, "Company", true);
  if (hasOwn(input, "branchId")) out.branchId = assertUuid(input.branchId, "Branch", true);
  if (hasOwn(input, "entityType")) {
    const value = text(input.entityType).toLowerCase() || "general";
    if (!RELATED.has(value)) throw new CrmError(400, "Related record type is invalid.", "CRM_MEETING_RELATION_INVALID");
    out.entityType = value;
  }
  if (hasOwn(input, "entityId")) out.entityId = assertUuid(input.entityId, "Related record", true);
  if (hasOwn(input, "subject")) {
    const value = text(input.subject);
    if (!value || value.length > 300) throw new CrmError(400, "Meeting subject is required and must be at most 300 characters.", "CRM_MEETING_SUBJECT_INVALID");
    out.subject = value;
  }
  if (hasOwn(input, "description")) {
    const value = text(input.description);
    if (value.length > 4000) throw new CrmError(400, "Meeting notes must be at most 4,000 characters.", "CRM_MEETING_DESCRIPTION_INVALID");
    out.description = value || null;
  }
  if (hasOwn(input, "priority")) {
    const value = text(input.priority).toLowerCase();
    if (!PRIORITIES.has(value)) throw new CrmError(400, "Meeting priority is invalid.", "CRM_MEETING_PRIORITY_INVALID");
    out.priority = value;
  }
  if (hasOwn(input, "assignedTo")) out.assignedTo = assertUuid(input.assignedTo, "Assignee", true);
  for (const [field, label] of [["startAt", "Start"], ["endAt", "End"]]) {
    if (hasOwn(input, field)) out[field] = dateValue(input[field], label, true);
  }
  if (hasOwn(input, "locationType")) {
    const value = text(input.locationType).toLowerCase();
    if (!LOCATION_TYPES.has(value)) throw new CrmError(400, "Meeting location type is invalid.", "CRM_MEETING_LOCATION_TYPE_INVALID");
    out.locationType = value;
  }
  if (hasOwn(input, "location")) {
    const value = text(input.location);
    if (value.length > 500) throw new CrmError(400, "Meeting location must be at most 500 characters.", "CRM_MEETING_LOCATION_INVALID");
    out.location = value || null;
  }
  if (hasOwn(input, "meetingUrl")) out.meetingUrl = normalizeUrl(input.meetingUrl);
  if (hasOwn(input, "attendees")) out.attendees = input.attendees;
  return out;
}
function scopeSql(context, values, alias = "activity") {
  let sql = "";
  if (context.activeCompanyId) sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=${add(values, context.activeCompanyId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  if (context.activeBranchId) sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=${add(values, context.activeBranchId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  // Own + managed-team members + unassigned queue (crm-access-scope.js).
  sql += crmOwnerScopeSql(context, (value) => add(values, value), `${alias}.assigned_to`, `${alias}.organization_id`, { resource: "activities", alias: alias });
  if (!canViewSensitiveLeadContent(context))
    sql += ` AND COALESCE(${alias}.entity_type,'general') <> 'lead'`;
  return sql;
}
function assertWritableScope(context, prepared) {
  if (!context.activeCompanyId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed company before maintaining Meetings.", "CRM_MEETING_SCOPE_FORBIDDEN");
  if (context.activeCompanyId && prepared.companyId && prepared.companyId !== context.activeCompanyId)
    throw new CrmError(403, "The Meeting belongs to another company.", "CRM_MEETING_SCOPE_FORBIDDEN");
  if (!context.activeBranchId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed branch before maintaining Meetings.", "CRM_MEETING_SCOPE_FORBIDDEN");
  if (context.activeBranchId && prepared.branchId && prepared.branchId !== context.activeBranchId)
    throw new CrmError(403, "The Meeting belongs to another branch.", "CRM_MEETING_SCOPE_FORBIDDEN");
}
async function relationRecord(client, context, entityType, entityId) {
  if (entityType === "general") {
    if (entityId) throw new CrmError(400, "General Meetings cannot carry a related-record ID.", "CRM_MEETING_RELATION_INVALID");
    return null;
  }
  if (!entityId) throw new CrmError(400, "Select the related CRM record for this Meeting.", "CRM_MEETING_RELATION_REQUIRED");
  let result;
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(403, "You do not have permission to create Lead-related meeting content.", "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN");
    const values = [context.organizationId, entityId];
    const scope = leadScopeSql(context, values, "lead");
    result = await client.query(
      `SELECT lead.id,lead.company_id,lead.branch_id FROM tenant.crm_leads lead
       WHERE lead.organization_id=$1 AND lead.id=$2 AND lead.record_status <> 'archived'${scope} LIMIT 1`,
      values,
    );
  } else if (entityType === "contact") {
    result = await client.query(
      `SELECT contact.id,party.company_id,NULL::uuid AS branch_id
         FROM tenant.contacts contact
         JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id
        WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND party.status='active' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "party") {
    result = await client.query(
      `SELECT party.id,party.company_id,NULL::uuid AS branch_id
         FROM tenant.business_parties party
        WHERE party.organization_id=$1 AND party.id=$2 AND party.status='active' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "opportunity") {
    result = await client.query(
      `SELECT id,company_id,branch_id FROM tenant.crm_opportunities
       WHERE organization_id=$1 AND id=$2 AND status <> 'archived' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "campaign") {
    result = await client.query(
      `SELECT id,company_id,NULL::uuid AS branch_id FROM tenant.crm_campaigns
       WHERE organization_id=$1 AND id=$2 AND status <> 'cancelled' LIMIT 1`,
      [context.organizationId, entityId],
    );
  }
  const row = result?.rows?.[0];
  if (!row) throw new CrmError(409, "The related CRM record is unavailable.", "CRM_MEETING_RELATION_INVALID");
  if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId)
    throw new CrmError(403, "The related CRM record belongs to another company.", "CRM_MEETING_RELATION_SCOPE_INVALID");
  if (context.activeBranchId && row.branch_id && row.branch_id !== context.activeBranchId)
    throw new CrmError(403, "The related CRM record belongs to another branch.", "CRM_MEETING_RELATION_SCOPE_INVALID");
  return row;
}
function email(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new CrmError(400, "Meeting attendee email is invalid.", "CRM_MEETING_ATTENDEE_INVALID");
  return normalized;
}
async function normalizeAttendees(client, context, input, { companyId = null } = {}) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new CrmError(400, "Meeting attendees must be an array.", "CRM_MEETING_ATTENDEE_INVALID");
  if (input.length > 100) throw new CrmError(400, "A Meeting can contain at most 100 attendees.", "CRM_MEETING_ATTENDEE_INVALID");
  const normalized = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new CrmError(400, "Each Meeting attendee must be an object.", "CRM_MEETING_ATTENDEE_INVALID");
    for (const key of Object.keys(raw)) {
      if (!new Set(["contactId", "email", "name", "responseStatus"]).has(key))
        throw new CrmError(400, `Unsupported Meeting attendee field: ${key}.`, "CRM_MEETING_ATTENDEE_INVALID");
    }
    let contactId = raw.contactId ? assertUuid(raw.contactId, "Attendee Contact") : null;
    let attendeeEmail = email(raw.email);
    let name = text(raw.name) || null;
    let responseStatus = text(raw.responseStatus || "needs_action").toLowerCase();
    if (!ATTENDEE_RESPONSES.has(responseStatus))
      throw new CrmError(400, "Meeting attendee response is invalid.", "CRM_MEETING_ATTENDEE_INVALID");
    if (name && name.length > 200) throw new CrmError(400, "Meeting attendee name is too long.", "CRM_MEETING_ATTENDEE_INVALID");
    if (contactId) {
      const found = await client.query(
        `SELECT contact.id,trim(concat_ws(' ',contact.first_name,contact.last_name)) AS full_name,contact.email,party.company_id
           FROM tenant.contacts contact
           JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id
          WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND party.status='active' LIMIT 1`,
        [context.organizationId, contactId],
      );
      const contact = found.rows[0];
      if (!contact) throw new CrmError(409, "Meeting attendee Contact is unavailable.", "CRM_MEETING_ATTENDEE_INVALID");
      const attendeeCompanyId = companyId || context.activeCompanyId || null;
      if (attendeeCompanyId && contact.company_id && contact.company_id !== attendeeCompanyId)
        throw new CrmError(403, "Meeting attendee belongs to another company.", "CRM_MEETING_ATTENDEE_SCOPE_INVALID");
      attendeeEmail ||= email(contact.email);
      name ||= text(contact.full_name) || null;
    }
    if (!contactId && !attendeeEmail)
      throw new CrmError(400, "Each Meeting attendee needs a Contact or email.", "CRM_MEETING_ATTENDEE_INVALID");
    const key = attendeeEmail ? `email:${attendeeEmail}` : `contact:${contactId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ contactId, email: attendeeEmail, name, responseStatus });
  }
  normalized.sort((a, b) => String(a.email || a.contactId).localeCompare(String(b.email || b.contactId)));
  return normalized;
}
async function validatePrepared(client, context, prepared, existing = null, { mode = "update" } = {}) {
  const effective = { ...(existing || {}), ...prepared };
  effective.entityType ||= "general";
  effective.priority ||= "medium";
  effective.assignedTo ||= context.userId;
  effective.companyId ??= context.activeCompanyId || null;
  effective.branchId ??= context.activeBranchId || null;
  effective.locationType ||= "other";
  assertWritableScope(context, effective);
  if (!effective.subject) throw new CrmError(400, "Meeting subject is required.", "CRM_MEETING_SUBJECT_INVALID");
  const related = await relationRecord(client, context, effective.entityType, effective.entityId || null);
  if (!effective.companyId && related?.company_id) {
    effective.companyId = related.company_id;
    prepared.companyId = related.company_id;
  }
  if (!effective.branchId && related?.branch_id) {
    effective.branchId = related.branch_id;
    prepared.branchId = related.branch_id;
  }
  if (related?.company_id && effective.companyId && related.company_id !== effective.companyId)
    throw new CrmError(409, "The related CRM record belongs to another company.", "CRM_MEETING_RELATION_SCOPE_INVALID");
  if (related?.branch_id && effective.branchId && related.branch_id !== effective.branchId)
    throw new CrmError(409, "The related CRM record belongs to another branch.", "CRM_MEETING_RELATION_SCOPE_INVALID");
  try {
    await assertEligibleLeadAssignee(client, context, effective.assignedTo, {
      companyId: effective.companyId || null,
      branchId: effective.branchId || null,
    });
  } catch (error) {
    if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw new CrmError(409, error.message, "CRM_MEETING_ASSIGNEE_INVALID");
    throw error;
  }
  if (mode === "schedule" || mode === "update") {
    if (!effective.startAt || !effective.endAt)
      throw new CrmError(400, "A scheduled Meeting requires start and end date/time.", "CRM_MEETING_SCHEDULE_REQUIRED");
    const start = Date.parse(effective.startAt);
    const end = Date.parse(effective.endAt);
    if (!(end > start))
      throw new CrmError(400, "Meeting end time must be after start time.", "CRM_MEETING_SCHEDULE_INVALID");
    if (end - start > 24 * 60 * 60 * 1000)
      throw new CrmError(400, "Meeting duration cannot exceed 24 hours.", "CRM_MEETING_SCHEDULE_INVALID");
  }
  if (effective.locationType === "in_person" && !text(effective.location))
    throw new CrmError(400, "In-person Meetings require a location.", "CRM_MEETING_LOCATION_REQUIRED");
  if (effective.locationType === "online" && !effective.meetingUrl)
    throw new CrmError(400, "Online Meetings require a meeting URL.", "CRM_MEETING_URL_REQUIRED");
  if (hasOwn(prepared, "attendees")) prepared.attendees = await normalizeAttendees(client, context, prepared.attendees, { companyId: effective.companyId || null });
  return effective;
}
async function recordEvent(client, context, activityId, eventType, before, after, attendeeCount = 0) {
  await client.query(
    `INSERT INTO tenant.crm_meeting_events(
       organization_id,activity_id,event_type,previous_status,next_status,location_type,outcome_code,duration_seconds,attendee_count,changed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [context.organizationId, activityId, eventType, before?.status || null, after?.status || null,
      after?.locationType || before?.locationType || null, after?.outcomeCode || before?.outcomeCode || null,
      after?.durationSeconds ?? before?.durationSeconds ?? null, attendeeCount, context.userId],
  );
}
function safeEventPayload(meeting, attendeeCount = 0) {
  return {
    id: meeting.id,
    status: meeting.status,
    entityType: meeting.entityType,
    entityId: meeting.entityId,
    assignedTo: meeting.assignedTo,
    companyId: meeting.companyId,
    branchId: meeting.branchId,
    locationType: meeting.locationType,
    outcomeCode: meeting.outcomeCode,
    durationSeconds: meeting.durationSeconds,
    attendeeCount,
    bookingId: meeting.bookingId,
  };
}
async function touchParentOnCompletion(client, context, meeting) {
  if (meeting.outcomeCode !== "held") return;
  if (meeting.entityType === "lead" && meeting.entityId)
    await client.query(
      `UPDATE tenant.crm_leads
          SET last_contacted_at=now(),first_responded_at=COALESCE(first_responded_at,now()),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, meeting.entityId],
    );
  if (meeting.entityType === "opportunity" && meeting.entityId)
    await client.query(
      `UPDATE tenant.crm_opportunities SET last_activity_at=now(),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, meeting.entityId],
    );
}
function normalizeOutcome(input, { required = true } = {}) {
  const code = input?.outcomeCode == null || input?.outcomeCode === "" ? null : text(input.outcomeCode).toLowerCase();
  if (required && !code) throw new CrmError(400, "Select a Meeting outcome before completing the Meeting.", "CRM_MEETING_OUTCOME_REQUIRED");
  if (code && !OUTCOMES.has(code)) throw new CrmError(400, "Meeting outcome is invalid.", "CRM_MEETING_OUTCOME_INVALID");
  const note = text(input?.outcome);
  if (note.length > 4000) throw new CrmError(400, "Meeting outcome note must be at most 4,000 characters.", "CRM_MEETING_OUTCOME_INVALID");
  return { code, note };
}
function stale(current, expectedUpdatedAt, expectedStatus) {
  if (expectedUpdatedAt && iso(current.updatedAt) !== iso(expectedUpdatedAt))
    throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_STALE_WRITE");
  if (expectedStatus && current.status !== expectedStatus)
    throw new CrmError(409, "This Meeting is no longer in the expected status.", "CRM_MEETING_CONFLICT");
}
async function loadAttendees(client, context, activityId) {
  const result = await client.query(
    `SELECT attendee.*,trim(concat_ws(' ',contact.first_name,contact.last_name)) AS contact_name
       FROM tenant.crm_activity_attendees attendee
       LEFT JOIN tenant.contacts contact
         ON contact.organization_id=attendee.organization_id AND contact.id=attendee.contact_id
      WHERE attendee.organization_id=$1 AND attendee.activity_id=$2
      ORDER BY lower(COALESCE(attendee.email,contact.email,'')),attendee.id`,
    [context.organizationId, activityId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    contactId: row.contact_id || null,
    email: row.email || null,
    name: row.name || row.contact_name || null,
    responseStatus: row.response_status,
  }));
}
function attendeeSignature(rows) {
  return JSON.stringify((rows || []).map((row) => ({
    contactId: row.contactId || null,
    email: row.email || null,
    name: row.name || null,
    responseStatus: row.responseStatus || "needs_action",
  })));
}
async function replaceAttendees(client, context, activityId, attendees) {
  await client.query(
    `DELETE FROM tenant.crm_activity_attendees WHERE organization_id=$1 AND activity_id=$2`,
    [context.organizationId, activityId],
  );
  for (const attendee of attendees || []) {
    await client.query(
      `INSERT INTO tenant.crm_activity_attendees(organization_id,activity_id,contact_id,name,email,response_status)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [context.organizationId, activityId, attendee.contactId, attendee.name, attendee.email, attendee.responseStatus],
    );
  }
}

export async function listCrmMeetings(client, context, filters = {}) {
  const values = [context.organizationId];
  let where = `activity.organization_id=$1 AND activity.activity_type='meeting'${scopeSql(context, values)}`;
  const status = text(filters.status || "all");
  if (status && status !== "all") where += ` AND activity.status=${add(values, status)}`;
  const search = text(filters.search).slice(0, 200);
  if (search) {
    const pattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const p = add(values, pattern);
    where += ` AND (activity.subject ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.description,'') ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.location,'') ILIKE ${p} ESCAPE '\\')`;
  }
  const due = text(filters.due || "all");
  if (due === "today") where += ` AND activity.start_at>=current_date AND activity.start_at<current_date+interval '1 day'`;
  if (due === "overdue") where += ` AND activity.start_at<now() AND activity.status NOT IN ('completed','cancelled')`;
  if (due === "upcoming") where += ` AND activity.start_at>=now() AND activity.status NOT IN ('completed','cancelled')`;
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(filters.limit) || 25)));
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset) || 0)));
  const count = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_activities activity WHERE ${where}`, values);
  const queryValues = [...values];
  const rows = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name,
            (SELECT count(*)::int FROM tenant.crm_activity_attendees attendee
              WHERE attendee.organization_id=activity.organization_id AND attendee.activity_id=activity.id) AS attendee_count
       FROM tenant.crm_activities activity
       LEFT JOIN public.users u ON u.id=activity.assigned_to
      WHERE ${where}
      ORDER BY COALESCE(activity.start_at,activity.created_at),activity.created_at DESC
      LIMIT ${add(queryValues, limit)} OFFSET ${add(queryValues, offset)}`,
    queryValues,
  );
  return { rows: rows.rows.map(dto), total: Number(count.rows[0]?.total || 0), limit, offset };
}

export async function getCrmMeeting(client, context, id, { lock = false, includeAttendees = true } = {}) {
  assertUuid(id, "Meeting");
  const values = [context.organizationId, id];
  const result = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name,
            (SELECT count(*)::int FROM tenant.crm_activity_attendees attendee
              WHERE attendee.organization_id=activity.organization_id AND attendee.activity_id=activity.id) AS attendee_count
       FROM tenant.crm_activities activity
       LEFT JOIN public.users u ON u.id=activity.assigned_to
      WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='meeting'${scopeSql(context, values)}
      LIMIT 1${lock ? " FOR UPDATE OF activity" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Meeting not found.", "CRM_MEETING_NOT_FOUND");
  const meeting = dto(result.rows[0]);
  if (includeAttendees) meeting.attendees = await loadAttendees(client, context, id);
  return meeting;
}

export async function listCrmMeetingEvents(client, context, activityId, limit = 50) {
  await getCrmMeeting(client, context, activityId, { includeAttendees: false });
  const result = await client.query(
    `SELECT event.*,u.full_name AS changed_by_name
       FROM tenant.crm_meeting_events event
       LEFT JOIN public.users u ON u.id=event.changed_by
      WHERE event.organization_id=$1 AND event.activity_id=$2
      ORDER BY event.changed_at DESC,event.id DESC LIMIT $3`,
    [context.organizationId, activityId, Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)))],
  );
  return result.rows.map(eventDto);
}

export async function createCrmMeeting(client, context, input = {}) {
  const prepared = normalizeBase(input, { create: true });
  const mode = text(input.mode || "schedule").toLowerCase();
  if (!new Set(["schedule", "log"]).has(mode))
    throw new CrmError(400, "Meeting mode must be schedule or log.", "CRM_MEETING_MODE_INVALID");
  prepared.entityType ||= "general";
  prepared.priority ||= "medium";
  prepared.assignedTo ||= context.userId;
  prepared.companyId ??= context.activeCompanyId || null;
  prepared.branchId ??= context.activeBranchId || null;
  prepared.locationType ||= "other";
  await validatePrepared(client, context, prepared, null, { mode });

  let status = "planned";
  let completedAt = null;
  let actualStartedAt = null;
  let actualEndedAt = null;
  let durationSeconds = null;
  let outcomeCode = null;
  let outcome = null;
  let startAt = prepared.startAt || null;
  let endAt = prepared.endAt || null;

  if (mode === "log") {
    const occurredAt = dateValue(input.occurredAt || new Date().toISOString(), "Occurred at", false);
    const durationMinutes = Number(input.durationMinutes ?? 0);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440)
      throw new CrmError(400, "Meeting duration must be a whole number of minutes from 0 to 1,440.", "CRM_MEETING_DURATION_INVALID");
    const normalizedOutcome = normalizeOutcome(input);
    status = "completed";
    completedAt = occurredAt;
    actualEndedAt = occurredAt;
    actualStartedAt = new Date(Date.parse(occurredAt) - durationMinutes * 60_000).toISOString();
    durationSeconds = durationMinutes * 60;
    outcomeCode = normalizedOutcome.code;
    outcome = normalizedOutcome.note || null;
    startAt = actualStartedAt;
    endAt = actualEndedAt;
  }

  const result = await client.query(
    `INSERT INTO tenant.crm_activities(
       organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,assigned_to,
       start_at,due_at,end_at,completed_at,outcome,location,meeting_location_type,meeting_url,meeting_outcome_code,
       meeting_started_at,meeting_ended_at,meeting_duration_seconds,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,'meeting',$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
     RETURNING *`,
    [context.organizationId, prepared.companyId, prepared.branchId, prepared.entityType, prepared.entityId || null, prepared.subject,
      prepared.description || null, status, prepared.priority, prepared.assignedTo, startAt, endAt, completedAt, outcome,
      prepared.location || null, prepared.locationType, prepared.meetingUrl || null, outcomeCode, actualStartedAt, actualEndedAt,
      durationSeconds, context.userId],
  );
  const meeting = dto(result.rows[0]);
  const attendees = prepared.attendees || [];
  await replaceAttendees(client, context, meeting.id, attendees);
  meeting.attendees = attendees;
  meeting.attendeeCount = attendees.length;
  await recordEvent(client, context, meeting.id, mode === "log" ? "logged" : "scheduled", null, meeting, attendees.length);
  if (mode === "log") await touchParentOnCompletion(client, context, meeting);
  // Canonical calendar-sync-intent step (final self-closing pass): a
  // freshly-scheduled Meeting (never a "log" of one that already
  // happened — nothing forward to sync) gets its own crm_calendar_events
  // row and an outbound push job, exactly the same architecture
  // bookMeeting's public-booking flow already used — no second
  // representation. Remains a legitimate, silent no-op if the host has no
  // connected outbound-capable calendar account (see
  // prepareMeetingCalendarPush).
  if (mode === "schedule") {
    const calendarEventId = await upsertMeetingCalendarEvent(client, context, meeting);
    if (calendarEventId) {
      await client.query(
        `UPDATE tenant.crm_activities SET meeting_calendar_event_id=$3 WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, meeting.id, calendarEventId],
      );
      meeting.calendarEventId = calendarEventId;
      await enqueueCalendarPushJob(client, context, meeting.id, "create", meeting.updatedAt);
    }
    // F014 Stage A2 closeout: a scheduled Meeting joins the SAME shared
    // reminder engine Follow-ups already uses (crm_activity_reminders,
    // keyed generically by activity_id) — not a second reminder system.
    // Never for "log" mode, since there is nothing forward-in-time to
    // remind about.
    await createRemindersForActivity(client, context, meeting.id, startAt);
  }
  await queueOutboxEvent(client, context, mode === "log" ? "crm.meeting.completed" : "crm.meeting.scheduled", "meeting", meeting.id, safeEventPayload(meeting, attendees.length));
  return meeting;
}

export async function updateCrmMeeting(client, context, id, input = {}) {
  const allowed = new Set([...MEETING_FIELDS, ...EXPECTATION_FIELDS]);
  assertAllowed(input, allowed);
  const expectedUpdatedAt = input.expectedUpdatedAt;
  const expectedStatus = input.expectedStatus;
  const raw = { ...input };
  delete raw.expectedUpdatedAt;
  delete raw.expectedStatus;
  const prepared = normalizeBase(raw);
  const before = await getCrmMeeting(client, context, id, { lock: true });
  if (!EDITABLE_STATUSES.has(before.status))
    throw new CrmError(409, "Started, completed or cancelled Meetings cannot be edited.", "CRM_MEETING_READ_ONLY");
  if (before.bookingId)
    throw new CrmError(409, "Booked Meetings must be rescheduled through their booking workflow.", "CRM_MEETING_BOOKING_MANAGED");
  if (hasOwn(prepared, "entityType") && prepared.entityType !== before.entityType && !hasOwn(prepared, "entityId"))
    throw new CrmError(400, "Changing the related-record type also requires selecting its related record.", "CRM_MEETING_RELATION_REQUIRED");
  await validatePrepared(client, context, prepared, before, { mode: "update" });
  const mapping = {
    companyId: "company_id", branchId: "branch_id", entityType: "entity_type", entityId: "entity_id", subject: "subject",
    description: "description", priority: "priority", assignedTo: "assigned_to", startAt: "start_at", endAt: "end_at",
    locationType: "meeting_location_type", location: "location", meetingUrl: "meeting_url",
  };
  const entries = Object.entries(prepared).filter(([key]) => mapping[key]);
  const attendeesChanged = hasOwn(prepared, "attendees") &&
    attendeeSignature(prepared.attendees) !== attendeeSignature(before.attendees || []);
  const noChange = entries.every(([key, value]) => {
    if (["startAt", "endAt"].includes(key)) return iso(before[key]) === iso(value);
    return String(before[key] ?? "") === String(value ?? "");
  });
  if (noChange && !attendeesChanged) return { ...before, replayed: true };
  stale(before, expectedUpdatedAt, expectedStatus);
  let after = before;
  if (entries.length) {
    const values = entries.map(([, value]) => value);
    const sets = entries.map(([key], i) => `${mapping[key]}=$${i + 1}`);
    if (entries.some(([key]) => key === "startAt")) sets.push(`due_at=$${entries.findIndex(([key]) => key === "startAt") + 1}`);
    values.push(context.userId, context.organizationId, id);
    const result = await client.query(
      `UPDATE tenant.crm_activities SET ${sets.join(",")},updated_by=$${entries.length + 1},updated_at=now()
       WHERE organization_id=$${entries.length + 2} AND id=$${entries.length + 3} AND activity_type='meeting' AND status IN ('planned','overdue')
       RETURNING *`,
      values,
    );
    if (!result.rows[0]) throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_CONFLICT");
    after = dto(result.rows[0]);
  } else {
    const touch = await client.query(
      `UPDATE tenant.crm_activities SET updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND id=$3 AND activity_type='meeting' AND status IN ('planned','overdue') RETURNING *`,
      [context.userId, context.organizationId, id],
    );
    if (!touch.rows[0]) throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_CONFLICT");
    after = dto(touch.rows[0]);
  }
  if (hasOwn(prepared, "attendees")) await replaceAttendees(client, context, id, prepared.attendees);
  after.attendees = hasOwn(prepared, "attendees") ? prepared.attendees : before.attendees || [];
  after.attendeeCount = after.attendees.length;
  const rescheduled = entries.some(([key, value]) => ["startAt", "endAt"].includes(key) && iso(before[key]) !== iso(value));
  await recordEvent(client, context, id, rescheduled ? "rescheduled" : "updated", before, after, after.attendeeCount);
  // Canonical calendar-sync-intent step: any content field a real
  // calendar invite would show (time, subject, description, location,
  // meeting URL) OR the attendee list changing re-pushes the SAME
  // provider event via its retained external_event_id — pushProviderCalendarEvent
  // PATCHes rather than creating a second one, so a repeated/retried
  // update job can never duplicate the provider event.
  const calendarFieldsChanged = entries.some(([key]) => ["subject", "description", "startAt", "endAt", "location", "meetingUrl"].includes(key));
  if ((calendarFieldsChanged || attendeesChanged) && after.startAt && after.endAt) {
    const calendarEventId = await upsertMeetingCalendarEvent(client, context, after);
    if (calendarEventId) {
      if (!after.calendarEventId) {
        await client.query(
          `UPDATE tenant.crm_activities SET meeting_calendar_event_id=$3 WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, id, calendarEventId],
        );
        after.calendarEventId = calendarEventId;
      }
      await enqueueCalendarPushJob(client, context, id, "update", after.updatedAt);
    }
  }
  if (rescheduled && after.startAt) {
    await cancelPendingRemindersForActivity(client, context, id);
    await createRemindersForActivity(client, context, id, after.startAt);
  }
  await queueOutboxEvent(client, context, rescheduled ? "crm.meeting.rescheduled" : "crm.meeting.updated", "meeting", id, safeEventPayload(after, after.attendeeCount));
  return after;
}

export async function startCrmMeeting(client, context, id, expectations = {}) {
  assertAllowed(expectations, EXPECTATION_FIELDS);
  const before = await getCrmMeeting(client, context, id, { lock: true });
  if (before.status === "in_progress") return { ...before, replayed: true };
  if (!EDITABLE_STATUSES.has(before.status))
    throw new CrmError(409, "Only a planned or overdue Meeting can be started.", "CRM_MEETING_START_INVALID");
  stale(before, expectations.expectedUpdatedAt, expectations.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities
        SET status='in_progress',meeting_started_at=COALESCE(meeting_started_at,now()),updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND activity_type='meeting' AND status IN ('planned','overdue') RETURNING *`,
    [context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_CONFLICT");
  const after = dto(result.rows[0]);
  after.attendees = before.attendees || [];
  after.attendeeCount = before.attendeeCount || after.attendees.length;
  await recordEvent(client, context, id, "started", before, after, after.attendeeCount);
  await queueOutboxEvent(client, context, "crm.meeting.started", "meeting", id, safeEventPayload(after, after.attendeeCount));
  return after;
}

export async function completeCrmMeeting(client, context, id, input = {}) {
  assertAllowed(input, new Set(["outcomeCode", "outcome", ...EXPECTATION_FIELDS]));
  const normalizedOutcome = normalizeOutcome(input);
  const before = await getCrmMeeting(client, context, id, { lock: true });
  if (before.status === "completed") {
    if ((before.outcomeCode || null) === normalizedOutcome.code && String(before.outcome || "") === normalizedOutcome.note)
      return { ...before, replayed: true };
    throw new CrmError(409, "This Meeting has already been completed with different outcome data.", "CRM_MEETING_COMPLETED");
  }
  if (before.status === "cancelled") throw new CrmError(409, "Cancelled Meetings cannot be completed.", "CRM_MEETING_CANCELLED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities
        SET status='completed',completed_at=now(),outcome=$1,meeting_outcome_code=$2,
            meeting_started_at=COALESCE(meeting_started_at,start_at,now()),meeting_ended_at=now(),
            meeting_duration_seconds=GREATEST(0,LEAST(86400,EXTRACT(EPOCH FROM (now()-COALESCE(meeting_started_at,start_at,now())))::int)),
            updated_by=$3,updated_at=now()
      WHERE organization_id=$4 AND id=$5 AND activity_type='meeting' AND status NOT IN ('completed','cancelled') RETURNING *`,
    [normalizedOutcome.note || null, normalizedOutcome.code, context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_CONFLICT");
  const after = dto(result.rows[0]);
  after.attendees = before.attendees || [];
  after.attendeeCount = before.attendeeCount || after.attendees.length;
  if (before.bookingId) {
    const bookingStatus = normalizedOutcome.code === "no_show" ? "no_show" : "completed";
    const booking = await client.query(
      `UPDATE tenant.crm_meeting_bookings
          SET status=$3,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND status='confirmed'
        RETURNING id`,
      [context.organizationId, before.bookingId, bookingStatus],
    );
    if (!booking.rows[0])
      throw new CrmError(409, "The linked Meeting booking changed. Refresh before completing.", "CRM_MEETING_BOOKING_CONFLICT");
  }
  await touchParentOnCompletion(client, context, after);
  await recordEvent(client, context, id, "completed", before, after, after.attendeeCount);
  await cancelPendingRemindersForActivity(client, context, id);
  await queueOutboxEvent(client, context, "crm.meeting.completed", "meeting", id, safeEventPayload(after, after.attendeeCount));
  return after;
}

export async function cancelCrmMeeting(client, context, id, input = {}) {
  assertAllowed(input, EXPECTATION_FIELDS);
  const before = await getCrmMeeting(client, context, id, { lock: true });
  if (before.status === "cancelled") return { ...before, replayed: true };
  if (before.status === "completed") throw new CrmError(409, "Completed Meetings cannot be cancelled.", "CRM_MEETING_COMPLETED");
  if (before.bookingId)
    throw new CrmError(409, "Booked Meetings must be cancelled through their booking workflow.", "CRM_MEETING_BOOKING_MANAGED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities SET status='cancelled',updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND activity_type='meeting' AND status <> 'completed' RETURNING *`,
    [context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Meeting changed. Refresh it before continuing.", "CRM_MEETING_CONFLICT");
  const after = dto(result.rows[0]);
  after.attendees = before.attendees || [];
  after.attendeeCount = before.attendeeCount || after.attendees.length;
  await recordEvent(client, context, id, "cancelled", before, after, after.attendeeCount);
  // Canonical calendar-sync-intent step: mark the sync-intent row
  // "cancelling" (an honest, immediately-visible UI state) and enqueue the
  // provider cancel — a no-op if no real external event was ever pushed
  // (prepareMeetingCalendarPush returns externalEventId: null for an
  // 'internal'/'vercentlabs' placeholder), and idempotent against an
  // already-provider-deleted event (providerRequest's allowNotFound).
  if (after.calendarEventId) {
    await markMeetingCalendarEventCancelling(client, context, after.calendarEventId);
    await enqueueCalendarPushJob(client, context, id, "cancel", after.updatedAt);
  }
  await cancelPendingRemindersForActivity(client, context, id);
  await queueOutboxEvent(client, context, "crm.meeting.cancelled", "meeting", id, safeEventPayload(after, after.attendeeCount));
  return after;
}

import { crmOwnerScopeSql } from "../crm-data-operations-and-customization/crm-access-scope.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { assertEligibleLeadAssignee } from "../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../lead-lifecycle-qualification-and-prioritization/lead-security.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECTIONS = new Set(["inbound", "outbound"]);
const OUTCOMES = new Set(["connected", "no_answer", "busy", "voicemail", "callback_requested", "wrong_number", "failed"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const RELATED = new Set(["lead", "opportunity", "party", "contact", "campaign", "general"]);
const EDITABLE_STATUSES = new Set(["planned", "overdue"]);
const CALL_FIELDS = new Set([
  "companyId", "branchId", "entityType", "entityId", "subject", "description", "priority", "assignedTo",
  "startAt", "dueAt", "reminderAt", "direction", "phoneNumber",
]);
const CREATE_FIELDS = new Set([...CALL_FIELDS, "mode", "occurredAt", "durationSeconds", "outcomeCode", "outcome"]);
const EXPECTATION_FIELDS = new Set(["expectedUpdatedAt", "expectedStatus"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => String(value ?? "").trim();
const iso = (value) => (value ? new Date(value).toISOString() : null);

function camelize(key) {
  return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
}
function dto(row) {
  const result = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value]));
  result.phoneNumber = result.callPhone ?? null;
  result.direction = result.callDirection ?? null;
  result.outcomeCode = result.callOutcomeCode ?? null;
  result.actualStartedAt = result.callStartedAt ?? null;
  result.actualEndedAt = result.callEndedAt ?? null;
  result.durationSeconds = result.callDurationSeconds ?? null;
  return result;
}
// crm_call_events rows already name their own columns (direction,
// outcome_code, duration_seconds) without the call_* prefix crm_activities
// uses — reusing dto()'s call_*-derived overrides above would read those as
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
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_CALL_REFERENCE_INVALID");
  return String(value);
}
function dateValue(value, label, nullable = true) {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && nullable) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new CrmError(400, `${label} must be a valid date and time.`, "CRM_CALL_DATETIME_INVALID");
  return new Date(parsed).toISOString();
}
function assertAllowed(input, allowed) {
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw new CrmError(400, `Unsupported Call field: ${key}.`, "CRM_CALL_INPUT_INVALID");
  }
}
function normalizePhone(value) {
  const raw = text(value);
  if (!raw) return null;
  if (raw.length > 40 || !/^[+()\-.\s0-9]{5,40}$/.test(raw))
    throw new CrmError(400, "Phone number must contain only normal dialling characters and be at most 40 characters.", "CRM_CALL_PHONE_INVALID");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 18)
    throw new CrmError(400, "Phone number must contain between 5 and 18 digits.", "CRM_CALL_PHONE_INVALID");
  return raw;
}
function normalizeBase(input, { create = false } = {}) {
  assertAllowed(input, create ? CREATE_FIELDS : CALL_FIELDS);
  const out = {};
  if (hasOwn(input, "companyId")) out.companyId = assertUuid(input.companyId, "Company", true);
  if (hasOwn(input, "branchId")) out.branchId = assertUuid(input.branchId, "Branch", true);
  if (hasOwn(input, "entityType")) {
    const value = text(input.entityType).toLowerCase() || "general";
    if (!RELATED.has(value)) throw new CrmError(400, "Related record type is invalid.", "CRM_CALL_RELATION_INVALID");
    out.entityType = value;
  }
  if (hasOwn(input, "entityId")) out.entityId = assertUuid(input.entityId, "Related record", true);
  if (hasOwn(input, "subject")) {
    const value = text(input.subject);
    if (!value || value.length > 300) throw new CrmError(400, "Call subject is required and must be at most 300 characters.", "CRM_CALL_SUBJECT_INVALID");
    out.subject = value;
  }
  if (hasOwn(input, "description")) {
    const value = text(input.description);
    if (value.length > 4000) throw new CrmError(400, "Call notes must be at most 4,000 characters.", "CRM_CALL_DESCRIPTION_INVALID");
    out.description = value || null;
  }
  if (hasOwn(input, "priority")) {
    const value = text(input.priority).toLowerCase();
    if (!PRIORITIES.has(value)) throw new CrmError(400, "Call priority is invalid.", "CRM_CALL_PRIORITY_INVALID");
    out.priority = value;
  }
  if (hasOwn(input, "assignedTo")) out.assignedTo = assertUuid(input.assignedTo, "Assignee", true);
  for (const [field, label] of [["startAt", "Start"], ["dueAt", "Due"], ["reminderAt", "Reminder"]]) {
    if (hasOwn(input, field)) out[field] = dateValue(input[field], label, true);
  }
  if (hasOwn(input, "direction")) {
    const value = text(input.direction).toLowerCase();
    if (!DIRECTIONS.has(value)) throw new CrmError(400, "Call direction must be inbound or outbound.", "CRM_CALL_DIRECTION_INVALID");
    out.direction = value;
  }
  if (hasOwn(input, "phoneNumber")) out.phoneNumber = normalizePhone(input.phoneNumber);
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
    throw new CrmError(403, "Select an allowed company before maintaining Calls.", "CRM_CALL_SCOPE_FORBIDDEN");
  if (context.activeCompanyId && prepared.companyId && prepared.companyId !== context.activeCompanyId)
    throw new CrmError(403, "The Call belongs to another company.", "CRM_CALL_SCOPE_FORBIDDEN");
  if (!context.activeBranchId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed branch before maintaining Calls.", "CRM_CALL_SCOPE_FORBIDDEN");
  if (context.activeBranchId && prepared.branchId && prepared.branchId !== context.activeBranchId)
    throw new CrmError(403, "The Call belongs to another branch.", "CRM_CALL_SCOPE_FORBIDDEN");
}
async function relationRecord(client, context, entityType, entityId) {
  if (entityType === "general") {
    if (entityId) throw new CrmError(400, "General Calls cannot carry a related-record ID.", "CRM_CALL_RELATION_INVALID");
    return null;
  }
  if (!entityId) throw new CrmError(400, "Select the related CRM record for this Call.", "CRM_CALL_RELATION_REQUIRED");
  let query;
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(403, "You do not have permission to use sensitive Lead contact data.", "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN");
    const values = [context.organizationId, entityId];
    const scope = leadScopeSql(context, values, "lead");
    query = await client.query(
      `SELECT lead.id,lead.company_id,lead.branch_id,COALESCE(lead.mobile,lead.phone) AS phone,lead.do_not_contact
         FROM tenant.crm_leads lead
        WHERE lead.organization_id=$1 AND lead.id=$2 AND lead.record_status <> 'archived'${scope} LIMIT 1`,
      values,
    );
  } else if (entityType === "contact") {
    query = await client.query(
      `SELECT contact.id,party.company_id,NULL::uuid AS branch_id,COALESCE(contact.mobile,contact.phone) AS phone,false AS do_not_contact
         FROM tenant.contacts contact
         JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id
        WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND party.status='active' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "party") {
    query = await client.query(
      `SELECT party.id,party.company_id,NULL::uuid AS branch_id,
              (SELECT COALESCE(contact.mobile,contact.phone) FROM tenant.contacts contact
                WHERE contact.organization_id=party.organization_id AND contact.party_id=party.id AND contact.status='active'
                ORDER BY contact.is_primary DESC,contact.created_at ASC LIMIT 1) AS phone,
              false AS do_not_contact
         FROM tenant.business_parties party
        WHERE party.organization_id=$1 AND party.id=$2 AND party.status='active' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "opportunity") {
    query = await client.query(
      `SELECT opportunity.id,opportunity.company_id,opportunity.branch_id,
              COALESCE(direct_contact.mobile,direct_contact.phone,
                (SELECT COALESCE(account_contact.mobile,account_contact.phone) FROM tenant.contacts account_contact
                  WHERE account_contact.organization_id=opportunity.organization_id
                    AND account_contact.party_id=opportunity.party_id AND account_contact.status='active'
                  ORDER BY account_contact.is_primary DESC,account_contact.created_at ASC LIMIT 1)) AS phone,
              false AS do_not_contact
         FROM tenant.crm_opportunities opportunity
         LEFT JOIN tenant.contacts direct_contact
           ON direct_contact.organization_id=opportunity.organization_id AND direct_contact.id=opportunity.contact_id AND direct_contact.status='active'
        WHERE opportunity.organization_id=$1 AND opportunity.id=$2 AND opportunity.status <> 'archived' LIMIT 1`,
      [context.organizationId, entityId],
    );
  } else if (entityType === "campaign") {
    query = await client.query(
      `SELECT id,company_id,NULL::uuid AS branch_id,NULL::text AS phone,false AS do_not_contact
         FROM tenant.crm_campaigns
        WHERE organization_id=$1 AND id=$2 AND status <> 'cancelled' LIMIT 1`,
      [context.organizationId, entityId],
    );
  }
  const row = query?.rows?.[0];
  if (!row) throw new CrmError(409, "The related CRM record is unavailable.", "CRM_CALL_RELATION_INVALID");
  if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId)
    throw new CrmError(403, "The related CRM record belongs to another company.", "CRM_CALL_RELATION_SCOPE_INVALID");
  if (context.activeBranchId && row.branch_id && row.branch_id !== context.activeBranchId)
    throw new CrmError(403, "The related CRM record belongs to another branch.", "CRM_CALL_RELATION_SCOPE_INVALID");
  return row;
}
async function validatePrepared(client, context, prepared, existing = null, { mode = "update" } = {}) {
  const effective = { ...(existing || {}), ...prepared };
  effective.entityType ||= "general";
  effective.priority ||= "medium";
  effective.assignedTo ||= context.userId;
  effective.companyId ??= context.activeCompanyId || null;
  effective.branchId ??= context.activeBranchId || null;
  assertWritableScope(context, effective);
  if (!effective.subject) throw new CrmError(400, "Call subject is required.", "CRM_CALL_SUBJECT_INVALID");
  if (!effective.direction) throw new CrmError(400, "Call direction is required.", "CRM_CALL_DIRECTION_INVALID");
  const related = await relationRecord(client, context, effective.entityType, effective.entityId || null);
  // A related CRM record owns its company/branch boundary. In an all-company
  // administrator context there may be no active selector, so inherit that
  // boundary instead of creating an organization-wide Call that could later
  // be visible from another company through the nullable-company scope rule.
  if (!effective.companyId && related?.company_id) {
    effective.companyId = related.company_id;
    prepared.companyId = related.company_id;
  }
  if (!effective.branchId && related?.branch_id) {
    effective.branchId = related.branch_id;
    prepared.branchId = related.branch_id;
  }
  if (related?.company_id && effective.companyId && related.company_id !== effective.companyId)
    throw new CrmError(409, "The related CRM record belongs to another company.", "CRM_CALL_RELATION_SCOPE_INVALID");
  if (related?.branch_id && effective.branchId && related.branch_id !== effective.branchId)
    throw new CrmError(409, "The related CRM record belongs to another branch.", "CRM_CALL_RELATION_SCOPE_INVALID");
  if (effective.direction === "outbound" && related?.do_not_contact)
    throw new CrmError(409, "This Lead is marked do not contact. Outbound Calls are blocked.", "CRM_CALL_DO_NOT_CONTACT");
  if (!effective.phoneNumber && related?.phone) prepared.phoneNumber = normalizePhone(related.phone);
  if (!(prepared.phoneNumber ?? effective.phoneNumber))
    throw new CrmError(400, "A dialable phone number is required for the Call.", "CRM_CALL_PHONE_REQUIRED");
  try {
    await assertEligibleLeadAssignee(client, context, effective.assignedTo, {
      companyId: effective.companyId || null,
      branchId: effective.branchId || null,
    });
  } catch (error) {
    if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw new CrmError(409, error.message, "CRM_CALL_ASSIGNEE_INVALID");
    throw error;
  }
  if (effective.startAt && effective.dueAt && Date.parse(effective.startAt) > Date.parse(effective.dueAt))
    throw new CrmError(400, "Call start cannot be later than its due time.", "CRM_CALL_SCHEDULE_INVALID");
  if (effective.reminderAt && effective.dueAt && Date.parse(effective.reminderAt) > Date.parse(effective.dueAt))
    throw new CrmError(400, "Call reminder cannot be later than its due time.", "CRM_CALL_SCHEDULE_INVALID");
  if (mode === "schedule" && !effective.dueAt)
    throw new CrmError(400, "A scheduled Call requires a due date and time.", "CRM_CALL_DUE_REQUIRED");
  return effective;
}
async function recordEvent(client, context, activityId, eventType, before, after) {
  await client.query(
    `INSERT INTO tenant.crm_call_events(organization_id,activity_id,event_type,previous_status,next_status,direction,outcome_code,duration_seconds,changed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [context.organizationId, activityId, eventType, before?.status || null, after?.status || null, after?.direction || before?.direction || null, after?.outcomeCode || before?.outcomeCode || null, after?.durationSeconds ?? before?.durationSeconds ?? null, context.userId],
  );
}
function safeEventPayload(call) {
  return {
    id: call.id,
    status: call.status,
    direction: call.direction,
    entityType: call.entityType,
    entityId: call.entityId,
    assignedTo: call.assignedTo,
    companyId: call.companyId,
    branchId: call.branchId,
    outcomeCode: call.outcomeCode,
    durationSeconds: call.durationSeconds,
  };
}
async function touchParentOnCompletion(client, context, call) {
  if (call.entityType === "lead" && call.entityId)
    await client.query(
      `UPDATE tenant.crm_leads
          SET last_contacted_at=now(),first_responded_at=COALESCE(first_responded_at,now()),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, call.entityId],
    );
  if (call.entityType === "opportunity" && call.entityId)
    await client.query(
      `UPDATE tenant.crm_opportunities SET last_activity_at=now(),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, call.entityId],
    );
}
function normalizeOutcome(input, { required = true } = {}) {
  const code = input?.outcomeCode == null || input?.outcomeCode === "" ? null : text(input.outcomeCode).toLowerCase();
  if (required && !code) throw new CrmError(400, "Select a Call outcome before completing the Call.", "CRM_CALL_OUTCOME_REQUIRED");
  if (code && !OUTCOMES.has(code)) throw new CrmError(400, "Call outcome is invalid.", "CRM_CALL_OUTCOME_INVALID");
  const note = text(input?.outcome);
  if (note.length > 4000) throw new CrmError(400, "Call outcome note must be at most 4,000 characters.", "CRM_CALL_OUTCOME_INVALID");
  return { code, note };
}
function stale(current, expectedUpdatedAt, expectedStatus) {
  if (expectedUpdatedAt && iso(current.updatedAt) !== iso(expectedUpdatedAt))
    throw new CrmError(409, "This Call changed. Refresh it before continuing.", "CRM_CALL_STALE_WRITE");
  if (expectedStatus && current.status !== expectedStatus)
    throw new CrmError(409, "This Call is no longer in the expected status.", "CRM_CALL_CONFLICT");
}

export async function listCrmCalls(client, context, filters = {}) {
  const values = [context.organizationId];
  let where = `activity.organization_id=$1 AND activity.activity_type='call'${scopeSql(context, values)}`;
  const status = text(filters.status || "all");
  if (status && status !== "all") where += ` AND activity.status=${add(values, status)}`;
  const direction = text(filters.direction || "all");
  if (DIRECTIONS.has(direction)) where += ` AND activity.call_direction=${add(values, direction)}`;
  const search = text(filters.search).slice(0, 200);
  if (search) {
    const pattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const p = add(values, pattern);
    where += ` AND (activity.subject ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.description,'') ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.call_phone,'') ILIKE ${p} ESCAPE '\\')`;
  }
  const due = text(filters.due || "all");
  if (due === "today") where += ` AND activity.due_at>=current_date AND activity.due_at<current_date+interval '1 day'`;
  if (due === "overdue") where += ` AND activity.due_at<now() AND activity.status NOT IN ('completed','cancelled')`;
  if (due === "upcoming") where += ` AND activity.due_at>=now() AND activity.status NOT IN ('completed','cancelled')`;
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(filters.limit) || 25)));
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset) || 0)));
  const count = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_activities activity WHERE ${where}`, values);
  const queryValues = [...values];
  const rows = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name
       FROM tenant.crm_activities activity
       LEFT JOIN public.users u ON u.id=activity.assigned_to
      WHERE ${where}
      ORDER BY COALESCE(activity.due_at,activity.start_at,activity.created_at),activity.created_at DESC
      LIMIT ${add(queryValues, limit)} OFFSET ${add(queryValues, offset)}`,
    queryValues,
  );
  return { rows: rows.rows.map(dto), total: Number(count.rows[0]?.total || 0), limit, offset };
}

export async function getCrmCall(client, context, id, { lock = false } = {}) {
  assertUuid(id, "Call");
  const values = [context.organizationId, id];
  const result = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name
       FROM tenant.crm_activities activity
       LEFT JOIN public.users u ON u.id=activity.assigned_to
      WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='call'${scopeSql(context, values)}
      LIMIT 1${lock ? " FOR UPDATE OF activity" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Call not found.", "CRM_CALL_NOT_FOUND");
  return dto(result.rows[0]);
}

export async function listCrmCallEvents(client, context, activityId, limit = 50) {
  await getCrmCall(client, context, activityId);
  const result = await client.query(
    `SELECT event.*,u.full_name AS changed_by_name
       FROM tenant.crm_call_events event
       LEFT JOIN public.users u ON u.id=event.changed_by
      WHERE event.organization_id=$1 AND event.activity_id=$2
      ORDER BY event.changed_at DESC,event.id DESC LIMIT $3`,
    [context.organizationId, activityId, Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)))],
  );
  return result.rows.map(eventDto);
}

export async function createCrmCall(client, context, input = {}) {
  const prepared = normalizeBase(input, { create: true });
  const mode = text(input.mode || "schedule").toLowerCase();
  if (!new Set(["schedule", "log"]).has(mode)) throw new CrmError(400, "Call mode must be schedule or log.", "CRM_CALL_MODE_INVALID");
  prepared.entityType ||= "general";
  prepared.priority ||= "medium";
  prepared.assignedTo ||= context.userId;
  prepared.companyId ??= context.activeCompanyId || null;
  prepared.branchId ??= context.activeBranchId || null;
  await validatePrepared(client, context, prepared, null, { mode });

  let status = "planned";
  let completedAt = null;
  let actualStartedAt = null;
  let actualEndedAt = null;
  let durationSeconds = null;
  let outcomeCode = null;
  let outcome = null;
  if (mode === "log") {
    const occurredAt = dateValue(input.occurredAt || new Date().toISOString(), "Occurred at", false);
    const duration = Number(input.durationSeconds ?? 0);
    if (!Number.isInteger(duration) || duration < 0 || duration > 86400)
      throw new CrmError(400, "Call duration must be a whole number of seconds from 0 to 86,400.", "CRM_CALL_DURATION_INVALID");
    const normalizedOutcome = normalizeOutcome(input);
    status = "completed";
    completedAt = occurredAt;
    actualEndedAt = occurredAt;
    actualStartedAt = new Date(Date.parse(occurredAt) - duration * 1000).toISOString();
    durationSeconds = duration;
    outcomeCode = normalizedOutcome.code;
    outcome = normalizedOutcome.note || null;
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_activities(
       organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,assigned_to,
       start_at,due_at,reminder_at,completed_at,outcome,call_direction,call_phone,call_outcome_code,call_started_at,call_ended_at,
       call_duration_seconds,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,'call',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
     RETURNING *`,
    [context.organizationId, prepared.companyId, prepared.branchId, prepared.entityType, prepared.entityId || null, prepared.subject,
      prepared.description || null, status, prepared.priority, prepared.assignedTo, prepared.startAt || null, prepared.dueAt || null,
      prepared.reminderAt || null, completedAt, outcome, prepared.direction, prepared.phoneNumber, outcomeCode, actualStartedAt,
      actualEndedAt, durationSeconds, context.userId],
  );
  const call = dto(result.rows[0]);
  await recordEvent(client, context, call.id, mode === "log" ? "logged" : "scheduled", null, call);
  if (mode === "log") await touchParentOnCompletion(client, context, call);
  await queueOutboxEvent(client, context, mode === "log" ? "crm.call.completed" : "crm.call.scheduled", "call", call.id, safeEventPayload(call));
  return call;
}

export async function updateCrmCall(client, context, id, input = {}) {
  const allowed = new Set([...CALL_FIELDS, ...EXPECTATION_FIELDS]);
  assertAllowed(input, allowed);
  const expectedUpdatedAt = input.expectedUpdatedAt;
  const expectedStatus = input.expectedStatus;
  const raw = { ...input };
  delete raw.expectedUpdatedAt;
  delete raw.expectedStatus;
  const prepared = normalizeBase(raw);
  const before = await getCrmCall(client, context, id, { lock: true });
  if (!EDITABLE_STATUSES.has(before.status)) throw new CrmError(409, "Started, completed or cancelled Calls cannot be edited.", "CRM_CALL_READ_ONLY");
  if (hasOwn(prepared, "entityType") && prepared.entityType !== before.entityType && !hasOwn(prepared, "entityId"))
    throw new CrmError(400, "Changing the related-record type also requires selecting its related record.", "CRM_CALL_RELATION_REQUIRED");
  await validatePrepared(client, context, prepared, before, { mode: "schedule" });
  const mapping = {
    companyId: "company_id", branchId: "branch_id", entityType: "entity_type", entityId: "entity_id", subject: "subject",
    description: "description", priority: "priority", assignedTo: "assigned_to", startAt: "start_at", dueAt: "due_at",
    reminderAt: "reminder_at", direction: "call_direction", phoneNumber: "call_phone",
  };
  const entries = Object.entries(prepared).filter(([key]) => mapping[key]);
  if (!entries.length) return { ...before, replayed: true };
  const noChange = entries.every(([key, value]) => {
    if (["startAt", "dueAt", "reminderAt"].includes(key)) return iso(before[key]) === iso(value);
    return String(before[key] ?? "") === String(value ?? "");
  });
  if (noChange) return { ...before, replayed: true };
  stale(before, expectedUpdatedAt, expectedStatus);
  const values = entries.map(([, value]) => value);
  const sets = entries.map(([key], i) => `${mapping[key]}=$${i + 1}`);
  values.push(context.userId, context.organizationId, id);
  const result = await client.query(
    `UPDATE tenant.crm_activities SET ${sets.join(",")},updated_by=$${entries.length + 1},updated_at=now()
      WHERE organization_id=$${entries.length + 2} AND id=$${entries.length + 3} AND activity_type='call' AND status IN ('planned','overdue')
      RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(409, "This Call changed. Refresh it before continuing.", "CRM_CALL_CONFLICT");
  const after = dto(result.rows[0]);
  await recordEvent(client, context, id, "updated", before, after);
  await queueOutboxEvent(client, context, "crm.call.updated", "call", id, safeEventPayload(after));
  return after;
}

export async function startCrmCall(client, context, id, expectations = {}) {
  assertAllowed(expectations, EXPECTATION_FIELDS);
  const before = await getCrmCall(client, context, id, { lock: true });
  if (before.status === "in_progress") return { ...before, replayed: true };
  if (!EDITABLE_STATUSES.has(before.status)) throw new CrmError(409, "Only a planned or overdue Call can be started.", "CRM_CALL_START_INVALID");
  stale(before, expectations.expectedUpdatedAt, expectations.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities
        SET status='in_progress',call_started_at=COALESCE(call_started_at,now()),updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND activity_type='call' AND status IN ('planned','overdue') RETURNING *`,
    [context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Call changed. Refresh it before continuing.", "CRM_CALL_CONFLICT");
  const after = dto(result.rows[0]);
  await recordEvent(client, context, id, "started", before, after);
  await queueOutboxEvent(client, context, "crm.call.started", "call", id, safeEventPayload(after));
  return after;
}

export async function completeCrmCall(client, context, id, input = {}) {
  assertAllowed(input, new Set(["outcomeCode", "outcome", ...EXPECTATION_FIELDS]));
  const normalizedOutcome = normalizeOutcome(input);
  const before = await getCrmCall(client, context, id, { lock: true });
  if (before.status === "completed") {
    if ((before.outcomeCode || null) === normalizedOutcome.code && String(before.outcome || "") === normalizedOutcome.note)
      return { ...before, replayed: true };
    throw new CrmError(409, "This Call has already been completed with different outcome data.", "CRM_CALL_COMPLETED");
  }
  if (before.status === "cancelled") throw new CrmError(409, "Cancelled Calls cannot be completed.", "CRM_CALL_CANCELLED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities
        SET status='completed',completed_at=now(),outcome=$1,call_outcome_code=$2,
            call_started_at=COALESCE(call_started_at,now()),call_ended_at=now(),
            call_duration_seconds=GREATEST(0,LEAST(86400,EXTRACT(EPOCH FROM (now()-COALESCE(call_started_at,now())))::int)),
            updated_by=$3,updated_at=now()
      WHERE organization_id=$4 AND id=$5 AND activity_type='call' AND status NOT IN ('completed','cancelled') RETURNING *`,
    [normalizedOutcome.note || null, normalizedOutcome.code, context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Call changed. Refresh it before continuing.", "CRM_CALL_CONFLICT");
  const after = dto(result.rows[0]);
  await touchParentOnCompletion(client, context, after);
  await recordEvent(client, context, id, "completed", before, after);
  await queueOutboxEvent(client, context, "crm.call.completed", "call", id, safeEventPayload(after));
  return after;
}

export async function cancelCrmCall(client, context, id, input = {}) {
  assertAllowed(input, EXPECTATION_FIELDS);
  const before = await getCrmCall(client, context, id, { lock: true });
  if (before.status === "cancelled") return { ...before, replayed: true };
  if (before.status === "completed") throw new CrmError(409, "Completed Calls cannot be cancelled.", "CRM_CALL_COMPLETED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities SET status='cancelled',updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND activity_type='call' AND status <> 'completed' RETURNING *`,
    [context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Call changed. Refresh it before continuing.", "CRM_CALL_CONFLICT");
  const after = dto(result.rows[0]);
  await recordEvent(client, context, id, "cancelled", before, after);
  await queueOutboxEvent(client, context, "crm.call.cancelled", "call", id, safeEventPayload(after));
  return after;
}

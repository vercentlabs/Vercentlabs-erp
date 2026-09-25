import { crmOwnerScopeSql } from "../../crm-data-operations-and-customization/crm-access-scope.js";
// Prompt 6 (CRM-CAP-004, F016 — Follow-ups and reminders). Re-audit
// confirmed this feature had no dedicated implementation at all before this
// pass: no table beyond the shared crm_activities.reminder_at column, no
// worker, no route, no UI. This module specializes the same canonical
// crm_activities row Calls/Meetings/Tasks already use (activity_type=
// 'follow_up'), following task-operations.js's established structure
// exactly, plus the new first-class crm_activity_reminders table for the
// dossier's REQUIRED "multiple reminders" scope (a single timestamp column
// cannot represent that).
import { CrmError } from "../../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../../crm-data-operations-and-customization/outbox.js";
import { assertEligibleLeadAssignee } from "../../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../../lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { addBusinessMinutes } from "../../lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";
import { createInAppNotification, getManagerForUser } from "../shared/notify.js";

// Same default business-hours shape crm_lead_sla_policies already uses
// (018/035) — reused rather than re-invented so working-hours behavior is
// consistent across F005 SLA timers and F016 reminders. No per-organization
// override exists for reminder delivery specifically (crm_lead_sla_policies
// itself is criteria-matched per-Lead, not a general org setting) — using
// this fixed default rather than building a new configurable policy engine
// for it is a deliberate, proportionate scope decision for this pass.
const DEFAULT_BUSINESS_HOURS = { timezone: "Asia/Kolkata", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

// Reminder delivery must respect working hours (DEC-CRM-P1-F016): if the
// naive offset-before-due instant falls outside the configured window, defer
// it to the next window rather than firing at 2am. addBusinessMinutes's own
// window-seeking logic (lead-intelligence.js) already does exactly this —
// called with a nominal 1-minute add so a fire_at already inside the window
// passes through effectively unchanged (+1 minute), while one outside it is
// moved to the start of the next valid window + 1 minute.
function deferToWorkingHours(instant) {
  return addBusinessMinutes(instant, 1, DEFAULT_BUSINESS_HOURS);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELATED = new Set(["lead", "opportunity", "party", "contact", "campaign", "general"]);
const CHANNELS = new Set(["call", "email", "meeting", "whatsapp", "sms", "other"]);
const REMINDER_CHANNELS = new Set(["in_app", "email"]);
const EDITABLE = new Set(["planned", "in_progress", "overdue"]);
const TERMINAL = new Set(["completed", "cancelled"]);
// Default reminder plan when the caller doesn't specify one — matches the
// dossier's own worked example ("24 hours before / 1 hour before / at due
// time"), expressed as minutes-before-due.
const DEFAULT_REMINDER_OFFSETS = [1440, 60, 0];
const MAX_REMINDERS_PER_FOLLOW_UP = 10;

const FOLLOW_UP_FIELDS = new Set([
  "companyId", "branchId", "entityType", "entityId", "subject", "description",
  "assignedTo", "dueAt", "followUpReason", "followUpChannel", "escalateAfterMinutes",
]);
const EXPECTATION_FIELDS = new Set(["expectedUpdatedAt", "expectedStatus"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => String(value ?? "").trim();
const iso = (value) => (value ? new Date(value).toISOString() : null);
function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function add(values, value) { values.push(value); return `$${values.length}`; }
function uuid(value, label, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_FOLLOW_UP_REFERENCE_INVALID");
  return String(value);
}
function dateValue(value, label, nullable = true) {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && nullable) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new CrmError(400, `${label} must be a valid date and time.`, "CRM_FOLLOW_UP_DATETIME_INVALID");
  return new Date(parsed).toISOString();
}
function assertAllowed(input, allowed) {
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw new CrmError(400, `Unsupported Follow-up field: ${key}.`, "CRM_FOLLOW_UP_INPUT_INVALID");
  }
}
function normalize(input, { create = false } = {}) {
  assertAllowed(input, create ? FOLLOW_UP_FIELDS : new Set([...FOLLOW_UP_FIELDS, ...EXPECTATION_FIELDS]));
  const out = {};
  if (hasOwn(input, "companyId")) out.companyId = uuid(input.companyId, "Company", true);
  if (hasOwn(input, "branchId")) out.branchId = uuid(input.branchId, "Branch", true);
  if (hasOwn(input, "entityType")) {
    const value = text(input.entityType).toLowerCase() || "general";
    if (!RELATED.has(value)) throw new CrmError(400, "Related record type is invalid.", "CRM_FOLLOW_UP_RELATION_INVALID");
    out.entityType = value;
  }
  if (hasOwn(input, "entityId")) out.entityId = uuid(input.entityId, "Related record", true);
  if (hasOwn(input, "subject")) {
    const value = text(input.subject);
    if (!value || value.length > 300) throw new CrmError(400, "Follow-up subject is required and must be at most 300 characters.", "CRM_FOLLOW_UP_SUBJECT_INVALID");
    out.subject = value;
  }
  if (hasOwn(input, "description")) {
    const value = text(input.description);
    if (value.length > 4000) throw new CrmError(400, "Follow-up description must be at most 4,000 characters.", "CRM_FOLLOW_UP_DESCRIPTION_INVALID");
    out.description = value || null;
  }
  if (hasOwn(input, "assignedTo")) out.assignedTo = uuid(input.assignedTo, "Owner", true);
  if (hasOwn(input, "dueAt")) {
    const value = dateValue(input.dueAt, "Follow-up date/time", false);
    if (!value) throw new CrmError(400, "Follow-up date/time is required.", "CRM_FOLLOW_UP_DUE_REQUIRED");
    out.dueAt = value;
  }
  if (hasOwn(input, "followUpReason")) {
    const value = text(input.followUpReason);
    if (value.length > 1000) throw new CrmError(400, "Follow-up reason must be at most 1,000 characters.", "CRM_FOLLOW_UP_REASON_INVALID");
    out.followUpReason = value || null;
  }
  if (hasOwn(input, "followUpChannel")) {
    const value = text(input.followUpChannel).toLowerCase();
    if (value && !CHANNELS.has(value)) throw new CrmError(400, "Follow-up channel is invalid.", "CRM_FOLLOW_UP_CHANNEL_INVALID");
    out.followUpChannel = value || null;
  }
  if (hasOwn(input, "escalateAfterMinutes")) {
    if (input.escalateAfterMinutes === null || input.escalateAfterMinutes === "") {
      out.escalateAfterMinutes = null;
    } else {
      const value = Math.trunc(Number(input.escalateAfterMinutes));
      if (!Number.isFinite(value) || value <= 0 || value > 43200)
        throw new CrmError(400, "Escalation window must be between 1 minute and 30 days.", "CRM_FOLLOW_UP_ESCALATION_INVALID");
      out.escalateAfterMinutes = value;
    }
  }
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
function assertWritableScope(context) {
  if (!context.activeCompanyId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed company before maintaining Follow-ups.", "CRM_FOLLOW_UP_SCOPE_FORBIDDEN");
  if (!context.activeBranchId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed branch before maintaining Follow-ups.", "CRM_FOLLOW_UP_SCOPE_FORBIDDEN");
}
// Mirrors task-operations.js's relationRecord exactly — the SAME
// corrected Prompt-5 record-scope architecture, reused rather than
// re-derived, so a Follow-up can never be associated with a parent record
// the caller cannot access (an inaccessible entityId must fail, not
// silently succeed or leak the parent's existence).
async function relationRecord(client, context, entityType, entityId) {
  if (entityType === "general") {
    if (entityId) throw new CrmError(400, "General Follow-ups cannot carry a related-record ID.", "CRM_FOLLOW_UP_RELATION_INVALID");
    return null;
  }
  if (!entityId) throw new CrmError(400, "Select the related CRM record for this Follow-up.", "CRM_FOLLOW_UP_RELATION_REQUIRED");
  const specs = {
    opportunity: ["tenant.crm_opportunities", "status <> 'archived'", "company_id", "branch_id"],
    campaign: ["tenant.crm_campaigns", "status <> 'cancelled'", "company_id", "NULL::uuid"],
  };
  let result;
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(403, "You do not have permission to create Lead-related follow-up content.", "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN");
    const values = [context.organizationId, entityId];
    const scope = leadScopeSql(context, values, "lead");
    result = await client.query(
      `SELECT lead.id,lead.company_id,lead.branch_id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2 AND lead.record_status <> 'archived'${scope} LIMIT 1`,
      values,
    );
  } else if (specs[entityType]) {
    const [table, state, company, branch] = specs[entityType];
    result = await client.query(`SELECT id,${company} AS company_id,${branch} AS branch_id FROM ${table} WHERE organization_id=$1 AND id=$2 AND ${state} LIMIT 1`, [context.organizationId, entityId]);
  } else if (entityType === "party") {
    result = await client.query(`SELECT id,company_id,NULL::uuid AS branch_id FROM tenant.business_parties WHERE organization_id=$1 AND id=$2 AND status='active' LIMIT 1`, [context.organizationId, entityId]);
  } else if (entityType === "contact") {
    result = await client.query(`SELECT contact.id,party.company_id,NULL::uuid AS branch_id FROM tenant.contacts contact JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND party.status='active' LIMIT 1`, [context.organizationId, entityId]);
  }
  const row = result?.rows?.[0];
  if (!row) throw new CrmError(409, "The related CRM record is unavailable.", "CRM_FOLLOW_UP_RELATION_INVALID");
  if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId)
    throw new CrmError(403, "The related CRM record belongs to another company.", "CRM_FOLLOW_UP_RELATION_SCOPE_INVALID");
  if (context.activeBranchId && row.branch_id && row.branch_id !== context.activeBranchId)
    throw new CrmError(403, "The related CRM record belongs to another branch.", "CRM_FOLLOW_UP_RELATION_SCOPE_INVALID");
  return row;
}
async function validate(client, context, prepared, existing = null) {
  const effective = { ...(existing || {}), ...prepared };
  effective.entityType ||= "general";
  effective.assignedTo ||= context.userId;
  effective.companyId ??= context.activeCompanyId || null;
  effective.branchId ??= context.activeBranchId || null;
  assertWritableScope(context);
  if (!effective.subject) throw new CrmError(400, "Follow-up subject is required.", "CRM_FOLLOW_UP_SUBJECT_INVALID");
  if (!effective.dueAt) throw new CrmError(400, "Follow-up date/time is required.", "CRM_FOLLOW_UP_DUE_REQUIRED");
  const related = await relationRecord(client, context, effective.entityType, effective.entityId || null);
  if (!effective.companyId && related?.company_id) prepared.companyId = effective.companyId = related.company_id;
  if (!effective.branchId && related?.branch_id) prepared.branchId = effective.branchId = related.branch_id;
  if (related?.company_id && effective.companyId && related.company_id !== effective.companyId)
    throw new CrmError(409, "The related CRM record belongs to another company.", "CRM_FOLLOW_UP_RELATION_SCOPE_INVALID");
  if (related?.branch_id && effective.branchId && related.branch_id !== effective.branchId)
    throw new CrmError(409, "The related CRM record belongs to another branch.", "CRM_FOLLOW_UP_RELATION_SCOPE_INVALID");
  try {
    await assertEligibleLeadAssignee(client, context, effective.assignedTo, { companyId: effective.companyId || null, branchId: effective.branchId || null });
  } catch (error) {
    if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw new CrmError(409, error.message, "CRM_FOLLOW_UP_ASSIGNEE_INVALID");
    throw error;
  }
  return effective;
}
function stale(current, expectedUpdatedAt, expectedStatus) {
  if (expectedUpdatedAt && iso(current.updatedAt) !== iso(expectedUpdatedAt))
    throw new CrmError(409, "This Follow-up changed. Refresh it before continuing.", "CRM_FOLLOW_UP_STALE_WRITE");
  if (expectedStatus && current.status !== expectedStatus)
    throw new CrmError(409, "This Follow-up is no longer in the expected status.", "CRM_FOLLOW_UP_CONFLICT");
}
async function event(client, context, activityId, type, before, after, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.crm_follow_up_events(organization_id,activity_id,event_type,from_status,to_status,metadata,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [context.organizationId, activityId, type, before?.status || null, after?.status || null, JSON.stringify(metadata), context.userId],
  );
}
function safe(followUp) {
  return { id: followUp.id, status: followUp.status, entityType: followUp.entityType, entityId: followUp.entityId, assignedTo: followUp.assignedTo, companyId: followUp.companyId, branchId: followUp.branchId, dueAt: followUp.dueAt };
}
async function touchParent(client, context, followUp) {
  if (followUp.entityType === "lead" && followUp.entityId)
    await client.query(`UPDATE tenant.crm_leads SET updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, followUp.entityId]);
  if (followUp.entityType === "opportunity" && followUp.entityId)
    await client.query(`UPDATE tenant.crm_opportunities SET last_activity_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, followUp.entityId]);
}

// --- Reminders -------------------------------------------------------

function normalizeOffsets(offsets) {
  const list = Array.isArray(offsets) && offsets.length ? offsets : DEFAULT_REMINDER_OFFSETS;
  const cleaned = [...new Set(list.map((value) => Math.trunc(Number(value))))]
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 43200)
    .sort((a, b) => b - a);
  if (!cleaned.length) throw new CrmError(400, "At least one valid reminder offset is required.", "CRM_FOLLOW_UP_REMINDER_INVALID");
  if (cleaned.length > MAX_REMINDERS_PER_FOLLOW_UP)
    throw new CrmError(400, `A Follow-up may have at most ${MAX_REMINDERS_PER_FOLLOW_UP} reminders.`, "CRM_FOLLOW_UP_REMINDER_LIMIT");
  return cleaned;
}

// Idempotent by construction: (organization_id, activity_id, offset_minutes,
// channel) is a real UNIQUE constraint (migration 101), so replaying this
// call for the same activity/offsets is always safe — ON CONFLICT DO
// NOTHING, never a duplicate reminder row.
export async function createRemindersForActivity(client, context, activityId, dueAt, { offsets, channel = "in_app" } = {}) {
  if (!REMINDER_CHANNELS.has(channel)) throw new CrmError(400, "Reminder channel is invalid.", "CRM_FOLLOW_UP_REMINDER_CHANNEL_INVALID");
  const resolvedOffsets = normalizeOffsets(offsets);
  const due = new Date(dueAt);
  const created = [];
  for (const offsetMinutes of resolvedOffsets) {
    const naiveFireAt = new Date(due.getTime() - offsetMinutes * 60000);
    const fireAt = deferToWorkingHours(naiveFireAt);
    const result = await client.query(
      `INSERT INTO tenant.crm_activity_reminders(organization_id,activity_id,offset_minutes,channel,fire_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id,activity_id,offset_minutes,channel) DO NOTHING
       RETURNING *`,
      [context.organizationId, activityId, offsetMinutes, channel, fireAt.toISOString(), context.userId],
    );
    if (result.rows[0]) created.push(dto(result.rows[0]));
  }
  return created;
}

export async function cancelPendingRemindersForActivity(client, context, activityId) {
  await client.query(
    `UPDATE tenant.crm_activity_reminders SET status='cancelled',updated_at=now() WHERE organization_id=$1 AND activity_id=$2 AND status='pending'`,
    [context.organizationId, activityId],
  );
}

// Atomically claims every reminder due to fire (fire_at <= now()) for this
// organization, returning enough parent-activity context (subject, related
// record, assignee id/email/name) for the caller to actually deliver it
// without a second round trip. The UPDATE...RETURNING is the claim itself —
// a reminder moves 'pending' -> 'dispatching' in the same statement that
// selects it, so two overlapping worker ticks (or a retried job) can never
// both claim and double-send the same reminder; only one query's WHERE
// status='pending' can match a given row.
export async function claimDueReminders(client, context, { limit = 200 } = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
  const result = await client.query(
    `UPDATE tenant.crm_activity_reminders reminder
        SET status='dispatching',updated_at=now()
       WHERE reminder.id IN (
         SELECT id FROM tenant.crm_activity_reminders
          WHERE organization_id=$1 AND status='pending' AND fire_at<=now()
          ORDER BY fire_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
      RETURNING reminder.*`,
    [context.organizationId, boundedLimit],
  );
  if (!result.rows.length) return [];
  const activityIds = [...new Set(result.rows.map((row) => row.activity_id))];
  const activities = await client.query(
    `SELECT activity.id,activity.subject,activity.entity_type,activity.entity_id,activity.due_at,activity.assigned_to,
            u.full_name AS assigned_name,u.email AS assigned_email
       FROM tenant.crm_activities activity
       LEFT JOIN public.users u ON u.id=activity.assigned_to
      WHERE activity.organization_id=$1 AND activity.id = ANY($2::uuid[])`,
    [context.organizationId, activityIds],
  );
  const byActivityId = new Map(activities.rows.map((row) => [row.id, dto(row)]));
  return result.rows.map((row) => ({ ...dto(row), activity: byActivityId.get(row.activity_id) || null }));
}

// A 'dispatching' row that a crashed worker never resolved should not stay
// stuck forever — the next tick's claim query only matches status='pending',
// so a caller (the worker) that fails between claiming and marking the
// outcome must reset stragglers back to 'pending' itself before the next
// scan (see crm-follow-up-reminder-dispatch.js's own recovery step) rather
// than this module silently reclaiming on a timer, which would risk a
// double-send if the original attempt was actually still in flight.
export async function markReminderOutcome(client, context, reminderId, { status, failureReason = null }) {
  if (!["sent", "failed"].includes(status)) throw new CrmError(400, "Unsupported reminder outcome.", "CRM_FOLLOW_UP_REMINDER_OUTCOME_INVALID");
  await client.query(
    `UPDATE tenant.crm_activity_reminders
        SET status=$3,sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END,
            failure_reason=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, reminderId, status, failureReason],
  );
}

export async function resetStuckDispatchingReminders(client, context, { olderThanMinutes = 15 } = {}) {
  const result = await client.query(
    `UPDATE tenant.crm_activity_reminders SET status='pending',updated_at=now()
      WHERE organization_id=$1 AND status='dispatching' AND updated_at < now() - ($2 || ' minutes')::interval
      RETURNING id`,
    [context.organizationId, olderThanMinutes],
  );
  return result.rows.length;
}

// Escalation (DEC-CRM-P1-F016): an open Follow-up past its own configured
// follow_up_escalate_after_minutes window (opt-in per Follow-up — see
// migration 101) is escalated once to the assignee's sales-team manager, if
// one is resolvable. No manager found is a legitimate, logged outcome, not
// an error — this pass does not invent a fallback escalation target (e.g.
// "any view_all holder"), since that could notify an unrelated admin about
// an ordinary seller's overdue follow-up.
export async function escalateOverdueFollowUps(client, context) {
  const result = await client.query(
    `SELECT activity.* FROM tenant.crm_activities activity
      WHERE activity.organization_id=$1 AND activity.activity_type='follow_up'
        AND activity.status NOT IN ('completed','cancelled')
        AND activity.follow_up_escalate_after_minutes IS NOT NULL
        AND activity.follow_up_escalated_at IS NULL
        AND activity.due_at IS NOT NULL
        AND activity.due_at + (activity.follow_up_escalate_after_minutes || ' minutes')::interval <= now()
      ORDER BY activity.due_at ASC
      LIMIT 200
      FOR UPDATE SKIP LOCKED`,
    [context.organizationId],
  );
  let escalated = 0;
  for (const row of result.rows) {
    const followUp = dto(row);
    const managerUserId = await getManagerForUser(client, context.organizationId, followUp.assignedTo);
    await client.query(
      `UPDATE tenant.crm_activities SET follow_up_escalated_at=now(),follow_up_escalated_to=$3,updated_at=updated_at WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, followUp.id, managerUserId],
    );
    await event(client, context, followUp.id, "escalated", followUp, followUp, { managerUserId, escalateAfterMinutes: followUp.followUpEscalateAfterMinutes });
    if (managerUserId) {
      await createInAppNotification(client, context, {
        userId: managerUserId,
        type: "crm_follow_up_escalation",
        category: "crm_follow_up_escalation",
        title: "Overdue Follow-up needs attention",
        message: `${followUp.subject || "A Follow-up"} is overdue and was escalated to you.`,
        href: `/crm/follow-ups/${followUp.id}`,
      });
    }
    escalated += 1;
  }
  return escalated;
}

// Real delivery-receipt tracking (DEC-CRM-P1-F016), honest about what each
// channel can actually confirm: in-app has no "delivered" signal beyond
// "the row was inserted for the user to see" (there is no read-receipt
// pixel/webhook for an in-app bell item), so the dispatch worker sets
// in-app reminders straight to 'sent', never a fabricated 'delivered'.
// 'acknowledged' is the one receipt state a human action can genuinely
// prove — the user actively opened this reminder and confirmed it —
// which is what this function records.
export async function acknowledgeReminder(client, context, activityId, reminderId) {
  await getCrmFollowUp(client, context, activityId);
  const result = await client.query(
    `UPDATE tenant.crm_activity_reminders SET status='acknowledged',acknowledged_at=now(),updated_at=now()
     WHERE organization_id=$1 AND activity_id=$2 AND id=$3 AND status IN ('sent','delivered') RETURNING *`,
    [context.organizationId, activityId, reminderId],
  );
  if (!result.rows[0]) throw new CrmError(409, "This reminder cannot be acknowledged in its current state.", "CRM_FOLLOW_UP_REMINDER_ACK_INVALID");
  return dto(result.rows[0]);
}

export async function listRemindersForActivity(client, context, activityId) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_activity_reminders WHERE organization_id=$1 AND activity_id=$2 ORDER BY offset_minutes DESC,channel`,
    [context.organizationId, activityId],
  );
  return rows.map(dto);
}

// --- Follow-up CRUD/lifecycle ------------------------------------------

export async function listCrmFollowUps(client, context, filters = {}) {
  const values = [context.organizationId];
  let where = `activity.organization_id=$1 AND activity.activity_type='follow_up'${scopeSql(context, values)}`;
  const status = text(filters.status || "all").toLowerCase();
  if (status !== "all" && new Set(["planned", "in_progress", "completed", "cancelled", "overdue"]).has(status)) where += ` AND activity.status=${add(values, status)}`;
  const due = text(filters.due || "all").toLowerCase();
  if (due === "overdue") where += ` AND activity.due_at<now() AND activity.status NOT IN ('completed','cancelled')`;
  if (due === "today") where += ` AND activity.due_at>=current_date AND activity.due_at<current_date+interval '1 day'`;
  if (due === "upcoming") where += ` AND activity.due_at>=now() AND activity.status NOT IN ('completed','cancelled')`;
  const search = text(filters.search).slice(0, 200);
  if (search) { const p = add(values, `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); where += ` AND (activity.subject ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.description,'') ILIKE ${p} ESCAPE '\\')`; }
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(filters.limit) || 25)));
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset) || 0)));
  const count = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_activities activity WHERE ${where}`, values);
  const qv = [...values];
  const result = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to WHERE ${where} ORDER BY COALESCE(activity.due_at,activity.created_at),activity.created_at DESC LIMIT ${add(qv, limit)} OFFSET ${add(qv, offset)}`,
    qv,
  );
  return { rows: result.rows.map(dto), total: Number(count.rows[0]?.total || 0), limit, offset };
}

export async function getCrmFollowUp(client, context, id, { lock = false } = {}) {
  uuid(id, "Follow-up");
  const values = [context.organizationId, id];
  const result = await client.query(
    `SELECT activity.*,u.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='follow_up'${scopeSql(context, values)} LIMIT 1${lock ? " FOR UPDATE OF activity" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Follow-up not found.", "CRM_FOLLOW_UP_NOT_FOUND");
  return dto(result.rows[0]);
}

export async function createCrmFollowUp(client, context, input = {}) {
  if (hasOwn(input, "activityType") || hasOwn(input, "status")) throw new CrmError(409, "Follow-up type and initial status are server governed.", "CRM_FOLLOW_UP_LIFECYCLE_GOVERNED");
  const reminderOffsets = hasOwn(input, "reminderOffsets") ? input.reminderOffsets : undefined;
  const reminderChannel = hasOwn(input, "reminderChannel") ? text(input.reminderChannel).toLowerCase() : "in_app";
  // reminderOffsets/reminderChannel are request-level delivery instructions,
  // not crm_activities columns — they must be stripped (not merely set to
  // undefined, which would still leave them as own-enumerable keys and trip
  // normalize()'s assertAllowed check) before the rest is validated as
  // Follow-up fields.
  const { reminderOffsets: _reminderOffsets, reminderChannel: _reminderChannel, ...rest } = input;
  const prepared = normalize(rest, { create: true });
  const effective = await validate(client, context, prepared);
  const result = await client.query(
    `INSERT INTO tenant.crm_activities(
       organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,
       assigned_to,due_at,follow_up_reason,follow_up_channel,follow_up_escalate_after_minutes,created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,'follow_up',$6,$7,'planned','medium',$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
    [
      context.organizationId, effective.companyId, effective.branchId, effective.entityType, effective.entityId || null,
      effective.subject, effective.description || null, effective.assignedTo, effective.dueAt,
      effective.followUpReason || null, effective.followUpChannel || null, effective.escalateAfterMinutes || null,
      context.userId,
    ],
  );
  const followUp = dto(result.rows[0]);
  await event(client, context, followUp.id, "created", null, followUp);
  await createRemindersForActivity(client, context, followUp.id, followUp.dueAt, { offsets: reminderOffsets, channel: REMINDER_CHANNELS.has(reminderChannel) ? reminderChannel : "in_app" });
  await queueOutboxEvent(client, context, "crm.follow_up.created", "follow_up", followUp.id, safe(followUp));
  return followUp;
}

export async function updateCrmFollowUp(client, context, id, input = {}) {
  const allowed = new Set([...FOLLOW_UP_FIELDS, ...EXPECTATION_FIELDS, "reminderOffsets", "reminderChannel"]);
  assertAllowed(input, allowed);
  const before = await getCrmFollowUp(client, context, id, { lock: true });
  if (TERMINAL.has(before.status)) throw new CrmError(409, "Completed or cancelled Follow-ups are read-only.", "CRM_FOLLOW_UP_READ_ONLY");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  // F016 Stage A2 closeout: reminderOffsets/reminderChannel are request-level
  // delivery instructions, not crm_activities columns — same stripping
  // discipline createCrmFollowUp already uses, so a caller can now edit an
  // existing Follow-up's reminder plan, not only set one at creation.
  const reminderPlanGiven = hasOwn(input, "reminderOffsets") || hasOwn(input, "reminderChannel");
  const reminderOffsets = hasOwn(input, "reminderOffsets") ? input.reminderOffsets : undefined;
  const reminderChannel = hasOwn(input, "reminderChannel") ? text(input.reminderChannel).toLowerCase() : undefined;
  const raw = { ...input };
  delete raw.expectedUpdatedAt; delete raw.expectedStatus; delete raw.reminderOffsets; delete raw.reminderChannel;
  const prepared = normalize(raw);
  const effective = await validate(client, context, prepared, before);
  const pairs = [];
  const values = [];
  const columns = {
    companyId: "company_id", branchId: "branch_id", entityType: "entity_type", entityId: "entity_id",
    subject: "subject", description: "description", assignedTo: "assigned_to", dueAt: "due_at",
    followUpReason: "follow_up_reason", followUpChannel: "follow_up_channel", escalateAfterMinutes: "follow_up_escalate_after_minutes",
  };
  for (const [field, column] of Object.entries(columns)) if (hasOwn(prepared, field)) pairs.push(`${column}=${add(values, prepared[field])}`);
  if (!pairs.length && !reminderPlanGiven) return before;
  let followUp = before;
  if (pairs.length) {
    values.push(context.userId, context.organizationId, id);
    const result = await client.query(
      `UPDATE tenant.crm_activities SET ${pairs.join(",")},updated_by=$${values.length - 2},updated_at=now() WHERE organization_id=$${values.length - 1} AND id=$${values.length} AND activity_type='follow_up' RETURNING *`,
      values,
    );
    followUp = dto(result.rows[0]);
    await event(client, context, followUp.id, "updated", before, followUp, { changedFields: Object.keys(prepared) });
  }
  // A due-date change invalidates the previous reminder schedule, and an
  // explicit reminder-plan edit is itself a request to replace it — either
  // one cancels whatever is still pending and regenerates, rather than
  // leaving stale reminders or silently ignoring the caller's new plan.
  if (hasOwn(prepared, "dueAt") || reminderPlanGiven) {
    await cancelPendingRemindersForActivity(client, context, followUp.id);
    await createRemindersForActivity(client, context, followUp.id, followUp.dueAt, {
      offsets: reminderOffsets,
      channel: reminderChannel && REMINDER_CHANNELS.has(reminderChannel) ? reminderChannel : "in_app",
    });
  }
  if (pairs.length) await queueOutboxEvent(client, context, "crm.follow_up.updated", "follow_up", followUp.id, safe(followUp));
  return followUp;
}

// Snooze: the dossier-named reschedule action, distinct from a plain edit —
// tracked with its own event type and snooze_count so "this follow-up was
// pushed back 3 times" is visible history, not silently indistinguishable
// from a normal due-date edit.
export async function snoozeCrmFollowUp(client, context, id, input = {}) {
  assertAllowed(input, new Set(["dueAt", ...EXPECTATION_FIELDS]));
  const before = await getCrmFollowUp(client, context, id, { lock: true });
  if (TERMINAL.has(before.status)) throw new CrmError(409, "Completed or cancelled Follow-ups cannot be snoozed.", "CRM_FOLLOW_UP_READ_ONLY");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const newDueAt = dateValue(input.dueAt, "Follow-up date/time", false);
  if (!newDueAt) throw new CrmError(400, "A new date/time is required to snooze this Follow-up.", "CRM_FOLLOW_UP_DUE_REQUIRED");
  if (Date.parse(newDueAt) <= Date.now()) throw new CrmError(400, "Snooze must move the Follow-up into the future.", "CRM_FOLLOW_UP_SCHEDULE_INVALID");
  const result = await client.query(
    `UPDATE tenant.crm_activities SET due_at=$3,follow_up_snooze_count=follow_up_snooze_count+1,
       follow_up_escalated_at=NULL,follow_up_escalated_to=NULL,updated_by=$4,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND activity_type='follow_up' RETURNING *`,
    [context.organizationId, id, newDueAt, context.userId],
  );
  const followUp = dto(result.rows[0]);
  await event(client, context, followUp.id, "snoozed", before, followUp, { previousDueAt: before.dueAt, snoozeCount: followUp.followUpSnoozeCount });
  await cancelPendingRemindersForActivity(client, context, followUp.id);
  await createRemindersForActivity(client, context, followUp.id, followUp.dueAt, {});
  await queueOutboxEvent(client, context, "crm.follow_up.snoozed", "follow_up", followUp.id, safe(followUp));
  return followUp;
}

async function transition(client, context, id, nextStatus, type, input = {}) {
  assertAllowed(input, EXPECTATION_FIELDS);
  const before = await getCrmFollowUp(client, context, id, { lock: true });
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  if (before.status === nextStatus) return before;
  if (TERMINAL.has(before.status)) throw new CrmError(409, "This Follow-up is already closed.", "CRM_FOLLOW_UP_ALREADY_CLOSED");
  if (!EDITABLE.has(before.status)) throw new CrmError(409, "This Follow-up cannot make that transition.", "CRM_FOLLOW_UP_TRANSITION_INVALID");
  const result = await client.query(
    `UPDATE tenant.crm_activities SET status=$3,completed_at=${nextStatus === "completed" ? "now()" : "NULL"},updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 AND activity_type='follow_up' RETURNING *`,
    [context.organizationId, id, nextStatus, context.userId],
  );
  const followUp = dto(result.rows[0]);
  await event(client, context, id, type, before, followUp);
  await cancelPendingRemindersForActivity(client, context, id);
  if (nextStatus === "completed") await touchParent(client, context, followUp);
  await queueOutboxEvent(client, context, `crm.follow_up.${type}`, "follow_up", id, safe(followUp));
  return followUp;
}

export const completeCrmFollowUp = (client, context, id, input = {}) => transition(client, context, id, "completed", "completed", input);
export const cancelCrmFollowUp = (client, context, id, input = {}) => transition(client, context, id, "cancelled", "cancelled", input);

export async function listCrmFollowUpHistory(client, context, id) {
  await getCrmFollowUp(client, context, id);
  const { rows } = await client.query(
    `SELECT event_type,from_status,to_status,metadata,actor_user_id,occurred_at FROM tenant.crm_follow_up_events WHERE organization_id=$1 AND activity_id=$2 ORDER BY occurred_at DESC,id DESC`,
    [context.organizationId, id],
  );
  return rows.map(dto);
}

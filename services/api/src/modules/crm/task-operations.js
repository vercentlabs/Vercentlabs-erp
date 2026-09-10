import { CrmError, queueOutboxEvent } from "./index.js";
import { assertEligibleLeadAssignee } from "./lead-governance.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "./lead-security.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const RELATED = new Set(["lead", "opportunity", "party", "contact", "campaign", "general"]);
const EDITABLE = new Set(["planned", "in_progress", "overdue"]);
const TERMINAL = new Set(["completed", "cancelled"]);
const TASK_FIELDS = new Set([
  "companyId", "branchId", "entityType", "entityId", "subject", "description", "priority",
  "assignedTo", "teamId", "startAt", "dueAt", "reminderAt", "recurringRule", "recurrenceConfig",
]);
const EXPECTATION_FIELDS = new Set(["expectedUpdatedAt", "expectedStatus"]);

// F015 closeout: the ONE canonical "is this overdue" predicate — CRM Home,
// the Activities workspace list, the Task list and the Timeline must all
// agree on what "overdue" means (dossier: "one canonical, centrally-
// defined overdue formula reused everywhere"). A prior audit found this
// predicate duplicated near-identically across task-operations.js, the
// generic activities list, the KPI count and the activities report — all
// textually independent copies that could silently drift. This is now the
// single source of truth every one of those call sites imports.
export function taskOverdueSql(alias = "activity") {
  return `${alias}.due_at<now() AND ${alias}.status NOT IN ('completed','cancelled')`;
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => String(value ?? "").trim();
const iso = (value) => (value ? new Date(value).toISOString() : null);
function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function add(values, value) { values.push(value); return `$${values.length}`; }
function uuid(value, label, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_TASK_REFERENCE_INVALID");
  return String(value);
}
function dateValue(value, label, nullable = true) {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && nullable) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new CrmError(400, `${label} must be a valid date and time.`, "CRM_TASK_DATETIME_INVALID");
  return new Date(parsed).toISOString();
}
function assertAllowed(input, allowed = new Set([...TASK_FIELDS, ...EXPECTATION_FIELDS])) {
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw new CrmError(400, `Unsupported Task field: ${key}.`, "CRM_TASK_INPUT_INVALID");
  }
}
function normalize(input, { create = false } = {}) {
  assertAllowed(input, create ? TASK_FIELDS : new Set([...TASK_FIELDS, ...EXPECTATION_FIELDS]));
  const out = {};
  if (hasOwn(input, "companyId")) out.companyId = uuid(input.companyId, "Company", true);
  if (hasOwn(input, "branchId")) out.branchId = uuid(input.branchId, "Branch", true);
  if (hasOwn(input, "entityType")) {
    const value = text(input.entityType).toLowerCase() || "general";
    if (!RELATED.has(value)) throw new CrmError(400, "Related record type is invalid.", "CRM_TASK_RELATION_INVALID");
    out.entityType = value;
  }
  if (hasOwn(input, "entityId")) out.entityId = uuid(input.entityId, "Related record", true);
  if (hasOwn(input, "subject")) {
    const value = text(input.subject);
    if (!value || value.length > 300) throw new CrmError(400, "Task subject is required and must be at most 300 characters.", "CRM_TASK_SUBJECT_INVALID");
    out.subject = value;
  }
  if (hasOwn(input, "description")) {
    const value = text(input.description);
    if (value.length > 4000) throw new CrmError(400, "Task description must be at most 4,000 characters.", "CRM_TASK_DESCRIPTION_INVALID");
    out.description = value || null;
  }
  if (hasOwn(input, "priority")) {
    const value = text(input.priority).toLowerCase();
    if (!PRIORITIES.has(value)) throw new CrmError(400, "Task priority is invalid.", "CRM_TASK_PRIORITY_INVALID");
    out.priority = value;
  }
  if (hasOwn(input, "assignedTo")) out.assignedTo = uuid(input.assignedTo, "Assignee", true);
  if (hasOwn(input, "teamId")) out.teamId = uuid(input.teamId, "Team", true);
  for (const [field, label] of [["startAt", "Start"], ["dueAt", "Due"], ["reminderAt", "Reminder"]]) {
    if (hasOwn(input, field)) out[field] = dateValue(input[field], label, true);
  }
  if (hasOwn(input, "recurringRule")) {
    const rule = text(input.recurringRule);
    if (rule.length > 1000) throw new CrmError(400, "Recurring rule must be at most 1,000 characters.", "CRM_TASK_RECURRENCE_INVALID");
    out.recurringRule = rule || null;
  }
  if (hasOwn(input, "recurrenceConfig")) out.recurrenceConfig = normalizeRecurrenceConfig(input.recurrenceConfig);
  return out;
}

// --- Recurrence -------------------------------------------------------

const RECURRENCE_FREQUENCIES = new Set(["daily", "weekly", "monthly"]);

// recurring_rule (text, pre-existing) stays a human-readable label a
// caller may still set/display; recurrenceConfig is the machine-readable
// field the actual engine reads — a small structured shape, not a full
// RRULE parser, proportionate to the dossier's own worked scope (daily/
// weekly/monthly/interval/weekdays/end-date/count).
function normalizeRecurrenceConfig(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new CrmError(400, "Recurrence configuration must be an object.", "CRM_TASK_RECURRENCE_INVALID");
  const freq = text(value.freq).toLowerCase();
  if (!RECURRENCE_FREQUENCIES.has(freq))
    throw new CrmError(400, "Recurrence frequency must be daily, weekly or monthly.", "CRM_TASK_RECURRENCE_INVALID");
  const interval = value.interval === undefined ? 1 : Math.trunc(Number(value.interval));
  if (!Number.isFinite(interval) || interval < 1 || interval > 365)
    throw new CrmError(400, "Recurrence interval must be between 1 and 365.", "CRM_TASK_RECURRENCE_INVALID");
  const config = { freq, interval };
  if (value.count !== undefined && value.count !== null) {
    const count = Math.trunc(Number(value.count));
    if (!Number.isFinite(count) || count < 1 || count > 500)
      throw new CrmError(400, "Recurrence count must be between 1 and 500.", "CRM_TASK_RECURRENCE_INVALID");
    config.count = count;
  }
  if (value.until !== undefined && value.until !== null && value.until !== "") {
    const until = Date.parse(String(value.until));
    if (!Number.isFinite(until)) throw new CrmError(400, "Recurrence end date is invalid.", "CRM_TASK_RECURRENCE_INVALID");
    config.until = new Date(until).toISOString();
  }
  if (freq === "weekly" && Array.isArray(value.byWeekday) && value.byWeekday.length) {
    const days = [...new Set(value.byWeekday.map((day) => Math.trunc(Number(day))))].filter((day) => day >= 0 && day <= 6);
    if (!days.length) throw new CrmError(400, "Recurrence weekdays are invalid.", "CRM_TASK_RECURRENCE_INVALID");
    config.byWeekday = days.sort((a, b) => a - b);
  }
  return config;
}

// Pure, deterministic, unit-testable next-occurrence calculator. Returns
// null when the series has ended (count/until reached) — the caller must
// treat that as "stop recurring," not an error. UTC-based (matches every
// other date calculation already in this module — no per-organization
// timezone concept exists for Task scheduling today, consistent with
// F016's own documented working-hours scope decision).
export function computeNextTaskOccurrence(config, fromDueAt, occurrenceIndex) {
  if (!config || !RECURRENCE_FREQUENCIES.has(config.freq)) return null;
  if (config.count && occurrenceIndex > config.count) return null;
  const interval = Math.max(1, Math.trunc(Number(config.interval) || 1));
  const base = new Date(fromDueAt);
  if (Number.isNaN(base.getTime())) return null;
  let next;
  if (config.freq === "daily") {
    next = new Date(base.getTime() + interval * 86_400_000);
  } else if (config.freq === "weekly") {
    if (Array.isArray(config.byWeekday) && config.byWeekday.length) {
      const weekdays = new Set(config.byWeekday);
      next = new Date(base.getTime() + 86_400_000);
      let guard = 0;
      while (!weekdays.has(next.getUTCDay()) && guard < 14) {
        next = new Date(next.getTime() + 86_400_000);
        guard += 1;
      }
    } else {
      next = new Date(base.getTime() + interval * 7 * 86_400_000);
    }
  } else {
    next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + interval, base.getUTCDate(), base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()));
  }
  if (config.until && next.getTime() > Date.parse(config.until)) return null;
  return next.toISOString();
}

// Generates exactly ONE next occurrence for a completed recurring Task —
// never a batch of future rows (see migration 106's own comment). The
// UNIQUE(organization_id, parent_task_id, occurrence_index) constraint on
// crm_task_recurrence_occurrences is the real idempotency mechanism: a
// worker retry, a duplicate completion-event replay, or two concurrent
// callers racing to generate the same next occurrence all collide on the
// same claim row, and only the caller whose INSERT actually returns a row
// creates the follow-on Task.
export async function generateNextTaskOccurrence(client, context, completedTask) {
  const config = completedTask.recurrenceConfig;
  if (!config) return null;
  const parentId = completedTask.recurrenceParentId || completedTask.id;
  const countResult = await client.query(
    `SELECT count(*)::int AS total FROM tenant.crm_task_recurrence_occurrences WHERE organization_id=$1 AND parent_task_id=$2`,
    [context.organizationId, parentId],
  );
  const nextIndex = Number(countResult.rows[0]?.total || 0) + 1;
  const fromDueAt = completedTask.dueAt || completedTask.completedAt || new Date().toISOString();
  const nextDueAt = computeNextTaskOccurrence(config, fromDueAt, nextIndex);
  if (!nextDueAt) return null;

  const claim = await client.query(
    `INSERT INTO tenant.crm_task_recurrence_occurrences(organization_id,parent_task_id,occurrence_index,occurrence_due_at)
     VALUES($1,$2,$3,$4) ON CONFLICT (organization_id,parent_task_id,occurrence_index) DO NOTHING RETURNING id`,
    [context.organizationId, parentId, nextIndex, nextDueAt],
  );
  if (!claim.rows[0]) return null;

  const result = await client.query(
    `INSERT INTO tenant.crm_activities(
       organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,
       assigned_to,due_at,recurring_rule,recurrence_config,recurrence_parent_id,task_source,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,'task',$6,$7,'planned',$8,$9,$10,$11,$12::jsonb,$13,'recurrence_generated',$14,$14) RETURNING *`,
    [
      context.organizationId, completedTask.companyId, completedTask.branchId, completedTask.entityType, completedTask.entityId || null,
      completedTask.subject, completedTask.description || null, completedTask.priority, completedTask.assignedTo, nextDueAt,
      completedTask.recurringRule || null, JSON.stringify(config), parentId, context.userId,
    ],
  );
  const generated = dto(result.rows[0]);
  await client.query(
    `UPDATE tenant.crm_task_recurrence_occurrences SET generated_task_id=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, claim.rows[0].id, generated.id],
  );
  await event(client, context, generated.id, "created", null, generated, { recurrenceParentId: parentId, occurrenceIndex: nextIndex });
  await queueOutboxEvent(client, context, "crm.task.created", "task", generated.id, safe(generated));
  return generated;
}

// --- Dependencies -------------------------------------------------------

// Reachability check, not a DB trigger (mirrors this codebase's existing
// account-hierarchy cycle-prevention pattern): would adding
// (taskId -> dependsOnTaskId) create a cycle? A cycle exists iff
// dependsOnTaskId can already transitively reach taskId through existing
// dependency edges.
async function assertNoDependencyCycle(client, context, taskId, dependsOnTaskId) {
  const result = await client.query(
    `WITH RECURSIVE reachable AS (
       SELECT depends_on_task_id AS node FROM tenant.crm_task_dependencies WHERE organization_id=$1 AND task_id=$2
       UNION
       SELECT dependency.depends_on_task_id FROM tenant.crm_task_dependencies dependency JOIN reachable ON dependency.task_id=reachable.node WHERE dependency.organization_id=$1
     )
     SELECT 1 FROM reachable WHERE node=$3 LIMIT 1`,
    [context.organizationId, dependsOnTaskId, taskId],
  );
  if (result.rows[0]) throw new CrmError(409, "This dependency would create a cycle.", "CRM_TASK_DEPENDENCY_CYCLE");
}

export async function addTaskDependency(client, context, taskId, dependsOnTaskId) {
  uuid(taskId, "Task");
  uuid(dependsOnTaskId, "Dependency");
  if (taskId === dependsOnTaskId) throw new CrmError(400, "A Task cannot depend on itself.", "CRM_TASK_DEPENDENCY_INVALID");
  await getCrmTask(client, context, taskId);
  await getCrmTask(client, context, dependsOnTaskId);
  await assertNoDependencyCycle(client, context, taskId, dependsOnTaskId);
  const result = await client.query(
    `INSERT INTO tenant.crm_task_dependencies(organization_id,task_id,depends_on_task_id,created_by)
     VALUES($1,$2,$3,$4) ON CONFLICT (organization_id,task_id,depends_on_task_id) DO NOTHING RETURNING *`,
    [context.organizationId, taskId, dependsOnTaskId, context.userId],
  );
  return result.rows[0] ? dto(result.rows[0]) : null;
}

export async function removeTaskDependency(client, context, taskId, dependsOnTaskId) {
  uuid(taskId, "Task");
  uuid(dependsOnTaskId, "Dependency");
  await getCrmTask(client, context, taskId);
  await client.query(
    `DELETE FROM tenant.crm_task_dependencies WHERE organization_id=$1 AND task_id=$2 AND depends_on_task_id=$3`,
    [context.organizationId, taskId, dependsOnTaskId],
  );
}

export async function listTaskDependencies(client, context, taskId) {
  await getCrmTask(client, context, taskId);
  const { rows } = await client.query(
    `SELECT dependency.*,blocker.status AS depends_on_status,blocker.subject AS depends_on_subject
       FROM tenant.crm_task_dependencies dependency
       JOIN tenant.crm_activities blocker ON blocker.organization_id=dependency.organization_id AND blocker.id=dependency.depends_on_task_id
      WHERE dependency.organization_id=$1 AND dependency.task_id=$2
      ORDER BY dependency.created_at`,
    [context.organizationId, taskId],
  );
  return rows.map(dto);
}
function scopeSql(context, values, alias = "activity") {
  let sql = "";
  if (context.activeCompanyId) sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=${add(values, context.activeCompanyId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  if (context.activeBranchId) sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=${add(values, context.activeBranchId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  const canViewAll = Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
  if (!canViewAll) {
    // Visible to a non-view-all caller: Tasks assigned to them; ordinary
    // unassigned (non-team) Tasks (the pre-existing, unrestricted-triage
    // behavior); and queued (unclaimed) team Tasks, but ONLY for a Team the
    // caller actually belongs to — an unclaimed queue item must not leak to
    // every seller in the organization just because it has no assignee yet.
    sql += ` AND (
      ${alias}.assigned_to=${add(values, context.userId)}
      OR (${alias}.assigned_to IS NULL AND ${alias}.team_id IS NULL)
      OR (${alias}.team_id IS NOT NULL AND ${alias}.team_id IN (
        SELECT team_id FROM tenant.crm_sales_team_members
         WHERE organization_id=${add(values, context.organizationId)} AND user_id=${add(values, context.userId)} AND status='active'
      ))
    )`;
  }
  if (!canViewSensitiveLeadContent(context))
    sql += ` AND COALESCE(${alias}.entity_type,'general') <> 'lead'`;
  return sql;
}
function assertWritableScope(context, task) {
  if (!context.activeCompanyId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed company before maintaining Tasks.", "CRM_TASK_SCOPE_FORBIDDEN");
  if (context.activeCompanyId && task.companyId && task.companyId !== context.activeCompanyId)
    throw new CrmError(403, "The Task belongs to another company.", "CRM_TASK_SCOPE_FORBIDDEN");
  if (!context.activeBranchId && !context.allowAllCompanies)
    throw new CrmError(403, "Select an allowed branch before maintaining Tasks.", "CRM_TASK_SCOPE_FORBIDDEN");
  if (context.activeBranchId && task.branchId && task.branchId !== context.activeBranchId)
    throw new CrmError(403, "The Task belongs to another branch.", "CRM_TASK_SCOPE_FORBIDDEN");
}
async function relationRecord(client, context, entityType, entityId) {
  if (entityType === "general") {
    if (entityId) throw new CrmError(400, "General Tasks cannot carry a related-record ID.", "CRM_TASK_RELATION_INVALID");
    return null;
  }
  if (!entityId) throw new CrmError(400, "Select the related CRM record for this Task.", "CRM_TASK_RELATION_REQUIRED");
  const specs = {
    opportunity: ["tenant.crm_opportunities", "status <> 'archived'", "company_id", "branch_id"],
    campaign: ["tenant.crm_campaigns", "status <> 'cancelled'", "company_id", "NULL::uuid"],
  };
  let result;
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(403, "You do not have permission to create Lead-related task content.", "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN");
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
  if (!row) throw new CrmError(409, "The related CRM record is unavailable.", "CRM_TASK_RELATION_INVALID");
  if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId)
    throw new CrmError(403, "The related CRM record belongs to another company.", "CRM_TASK_RELATION_SCOPE_INVALID");
  if (context.activeBranchId && row.branch_id && row.branch_id !== context.activeBranchId)
    throw new CrmError(403, "The related CRM record belongs to another branch.", "CRM_TASK_RELATION_SCOPE_INVALID");
  return row;
}
// F015 team/queue: fetch and validate the referenced crm_sales_team row —
// must be active, in-organization and, when the Task already carries a
// company, in the same company (no cross-company queue inference, per the
// dossier's explicit "no cross-company/branch inference" requirement).
async function assertTeamValid(client, context, teamId, companyId) {
  const result = await client.query(
    `SELECT id,company_id,manager_user_id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND id=$2 AND status='active' LIMIT 1`,
    [context.organizationId, teamId],
  );
  const team = result.rows[0];
  if (!team) throw new CrmError(409, "The selected Team is unavailable.", "CRM_TASK_TEAM_INVALID");
  if (companyId && team.company_id && team.company_id !== companyId)
    throw new CrmError(403, "The selected Team belongs to another company.", "CRM_TASK_TEAM_SCOPE_INVALID");
  return { id: team.id, companyId: team.company_id, managerUserId: team.manager_user_id };
}
async function isActiveTeamMember(client, context, teamId, userId) {
  if (!teamId || !userId) return false;
  const result = await client.query(
    `SELECT 1 FROM tenant.crm_sales_team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3 AND status='active' LIMIT 1`,
    [context.organizationId, teamId, userId],
  );
  return Boolean(result.rows[0]);
}
function canManageAllTasks(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
}
async function validate(client, context, prepared, existing = null) {
  const effective = { ...(existing || {}), ...prepared };
  effective.entityType ||= "general";
  effective.priority ||= "medium";
  effective.companyId ??= context.activeCompanyId || null;
  effective.branchId ??= context.activeBranchId || null;
  // A queued (team) Task legitimately starts unassigned — only default the
  // assignee to the caller for an ordinary personal Task. An explicit
  // assignedTo (including a deliberate null on a team Task, meaning "leave
  // it queued") is always respected as-is via the `??=` below.
  if (!effective.teamId) effective.assignedTo ??= context.userId;
  else effective.assignedTo ??= null;
  assertWritableScope(context, effective);
  if (!effective.subject) throw new CrmError(400, "Task subject is required.", "CRM_TASK_SUBJECT_INVALID");
  const related = await relationRecord(client, context, effective.entityType, effective.entityId || null);
  if (!effective.companyId && related?.company_id) prepared.companyId = effective.companyId = related.company_id;
  if (!effective.branchId && related?.branch_id) prepared.branchId = effective.branchId = related.branch_id;
  if (related?.company_id && effective.companyId && related.company_id !== effective.companyId)
    throw new CrmError(409, "The related CRM record belongs to another company.", "CRM_TASK_RELATION_SCOPE_INVALID");
  if (related?.branch_id && effective.branchId && related.branch_id !== effective.branchId)
    throw new CrmError(409, "The related CRM record belongs to another branch.", "CRM_TASK_RELATION_SCOPE_INVALID");
  let team = null;
  if (effective.teamId) {
    team = await assertTeamValid(client, context, effective.teamId, effective.companyId || null);
    // Assigning INTO a queue (creating/updating with a team) is already
    // gated by crm.activities.manage at the route level; directly handing a
    // queued Task to a SPECIFIC other person (rather than leaving it
    // unclaimed for anyone to claim) is a manager action — the dossier's
    // "owner/manager permissions" requirement — unless the caller is
    // assigning it to themselves.
    if (effective.assignedTo && effective.assignedTo !== context.userId && !canManageAllTasks(context) && context.userId !== team.managerUserId)
      throw new CrmError(403, "Only the Team's manager can assign this Task to a specific person.", "CRM_TASK_ASSIGN_FORBIDDEN");
    if (effective.assignedTo && !(await isActiveTeamMember(client, context, effective.teamId, effective.assignedTo)))
      throw new CrmError(409, "The assignee is not an active member of this Team.", "CRM_TASK_ASSIGNEE_NOT_TEAM_MEMBER");
  }
  if (effective.assignedTo && !effective.teamId) {
    try {
      await assertEligibleLeadAssignee(client, context, effective.assignedTo, { companyId: effective.companyId || null, branchId: effective.branchId || null });
    } catch (error) {
      if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw new CrmError(409, error.message, "CRM_TASK_ASSIGNEE_INVALID");
      throw error;
    }
  }
  if (effective.startAt && effective.dueAt && Date.parse(effective.startAt) > Date.parse(effective.dueAt))
    throw new CrmError(400, "Task start cannot be later than its due time.", "CRM_TASK_SCHEDULE_INVALID");
  if (effective.reminderAt && effective.dueAt && Date.parse(effective.reminderAt) > Date.parse(effective.dueAt))
    throw new CrmError(400, "Task reminder cannot be later than its due time.", "CRM_TASK_SCHEDULE_INVALID");
  return effective;
}
function stale(current, expectedUpdatedAt, expectedStatus) {
  if (expectedUpdatedAt && iso(current.updatedAt) !== iso(expectedUpdatedAt))
    throw new CrmError(409, "This Task changed. Refresh it before continuing.", "CRM_TASK_STALE_WRITE");
  if (expectedStatus && current.status !== expectedStatus)
    throw new CrmError(409, "This Task is no longer in the expected status.", "CRM_TASK_CONFLICT");
}
async function event(client, context, taskId, type, before, after, metadata = {}) {
  await client.query(`INSERT INTO tenant.crm_task_events(organization_id,activity_id,event_type,from_status,to_status,metadata,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [context.organizationId, taskId, type, before?.status || null, after?.status || null, JSON.stringify(metadata), context.userId]);
}
function safe(task) {
  return { id: task.id, status: task.status, entityType: task.entityType, entityId: task.entityId, assignedTo: task.assignedTo, companyId: task.companyId, branchId: task.branchId, priority: task.priority, dueAt: task.dueAt };
}
async function touchParent(client, context, task) {
  if (task.entityType === "lead" && task.entityId)
    await client.query(`UPDATE tenant.crm_leads SET updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, task.entityId]);
  if (task.entityType === "opportunity" && task.entityId)
    await client.query(`UPDATE tenant.crm_opportunities SET last_activity_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, task.entityId]);
}

export async function listCrmTasks(client, context, filters = {}) {
  const values = [context.organizationId];
  let where = `activity.organization_id=$1 AND activity.activity_type='task'${scopeSql(context, values)}`;
  const status = text(filters.status || "all").toLowerCase();
  if (status !== "all" && new Set(["planned", "in_progress", "completed", "cancelled", "overdue"]).has(status)) where += ` AND activity.status=${add(values, status)}`;
  const due = text(filters.due || "all").toLowerCase();
  if (due === "overdue") where += ` AND ${taskOverdueSql("activity")}`;
  if (due === "today") where += ` AND activity.due_at>=current_date AND activity.due_at<current_date+interval '1 day'`;
  if (due === "upcoming") where += ` AND activity.due_at>=now() AND activity.status NOT IN ('completed','cancelled')`;
  // F015 Tasks workspace: "My Tasks" (mine=true) vs "Team/Queue Tasks"
  // (a specific teamId, optionally queueOnly for just the unclaimed rows) —
  // scopeSql above already confines a non-view-all caller to their own
  // Tasks and the queues they actually belong to, so these filters narrow
  // within that same authorized set rather than granting new visibility.
  if (filters.mine) where += ` AND activity.assigned_to=${add(values, context.userId)}`;
  if (filters.teamId) where += ` AND activity.team_id=${add(values, uuid(filters.teamId, "Team"))}`;
  if (filters.queueOnly) where += ` AND activity.assigned_to IS NULL AND activity.team_id IS NOT NULL`;
  const search = text(filters.search).slice(0, 200);
  if (search) { const p = add(values, `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); where += ` AND (activity.subject ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.description,'') ILIKE ${p} ESCAPE '\\')`; }
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(filters.limit) || 25)));
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset) || 0)));
  const count = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_activities activity WHERE ${where}`, values);
  const qv = [...values];
  const result = await client.query(`SELECT activity.*,u.full_name AS assigned_name,team.name AS team_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to LEFT JOIN tenant.crm_sales_teams team ON team.organization_id=activity.organization_id AND team.id=activity.team_id WHERE ${where} ORDER BY COALESCE(activity.due_at,activity.start_at,activity.created_at),activity.created_at DESC LIMIT ${add(qv, limit)} OFFSET ${add(qv, offset)}`, qv);
  return { rows: result.rows.map(dto), total: Number(count.rows[0]?.total || 0), limit, offset };
}

export async function getCrmTask(client, context, id, { lock = false } = {}) {
  uuid(id, "Task");
  const values = [context.organizationId, id];
  const result = await client.query(`SELECT activity.*,u.full_name AS assigned_name,team.name AS team_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to LEFT JOIN tenant.crm_sales_teams team ON team.organization_id=activity.organization_id AND team.id=activity.team_id WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='task'${scopeSql(context, values)} LIMIT 1${lock ? " FOR UPDATE OF activity" : ""}`, values);
  if (!result.rows[0]) throw new CrmError(404, "Task not found.", "CRM_TASK_NOT_FOUND");
  return dto(result.rows[0]);
}

export async function createCrmTask(client, context, input = {}) {
  if (hasOwn(input, "activityType") || hasOwn(input, "status")) throw new CrmError(409, "Task type and initial status are server governed.", "CRM_TASK_LIFECYCLE_GOVERNED");
  const prepared = normalize(input, { create: true });
  const effective = await validate(client, context, prepared);
  const result = await client.query(`INSERT INTO tenant.crm_activities(organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,assigned_to,team_id,start_at,due_at,reminder_at,recurring_rule,recurrence_config,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'task',$6,$7,'planned',$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16) RETURNING *`, [context.organizationId, effective.companyId, effective.branchId, effective.entityType, effective.entityId || null, effective.subject, effective.description || null, effective.priority, effective.assignedTo, effective.teamId || null, effective.startAt || null, effective.dueAt || null, effective.reminderAt || null, effective.recurringRule || null, effective.recurrenceConfig ? JSON.stringify(effective.recurrenceConfig) : null, context.userId]);
  const task = dto(result.rows[0]);
  await event(client, context, task.id, "created", null, task);
  await queueOutboxEvent(client, context, "crm.task.created", "task", task.id, safe(task));
  return task;
}

export async function updateCrmTask(client, context, id, input = {}) {
  const allowed = new Set([...TASK_FIELDS, ...EXPECTATION_FIELDS]);
  assertAllowed(input, allowed);
  const before = await getCrmTask(client, context, id, { lock: true });
  if (TERMINAL.has(before.status)) throw new CrmError(409, "Completed or cancelled Tasks are read-only.", "CRM_TASK_READ_ONLY");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const raw = { ...input }; delete raw.expectedUpdatedAt; delete raw.expectedStatus;
  const prepared = normalize(raw);
  const effective = await validate(client, context, prepared, before);
  const pairs = [];
  const values = [];
  const columns = { companyId: "company_id", branchId: "branch_id", entityType: "entity_type", entityId: "entity_id", subject: "subject", description: "description", priority: "priority", assignedTo: "assigned_to", teamId: "team_id", startAt: "start_at", dueAt: "due_at", reminderAt: "reminder_at", recurringRule: "recurring_rule" };
  for (const [field, column] of Object.entries(columns)) if (hasOwn(prepared, field)) pairs.push(`${column}=${add(values, prepared[field])}`);
  if (hasOwn(prepared, "recurrenceConfig")) pairs.push(`recurrence_config=${add(values, prepared.recurrenceConfig ? JSON.stringify(prepared.recurrenceConfig) : null)}::jsonb`);
  if (!pairs.length) return before;
  values.push(context.userId, context.organizationId, id);
  const result = await client.query(`UPDATE tenant.crm_activities SET ${pairs.join(",")},updated_by=$${values.length - 2},updated_at=now() WHERE organization_id=$${values.length - 1} AND id=$${values.length} AND activity_type='task' RETURNING *`, values);
  const task = dto(result.rows[0]);
  await event(client, context, task.id, "updated", before, task, { changedFields: Object.keys(prepared) });
  await queueOutboxEvent(client, context, "crm.task.updated", "task", task.id, safe(task));
  return task;
}

async function transition(client, context, id, nextStatus, type, input = {}) {
  const allowed = new Set(EXPECTATION_FIELDS);
  if (type === "completed") allowed.add("outcome");
  assertAllowed(input, allowed);
  const before = await getCrmTask(client, context, id, { lock: true });
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  if (before.status === nextStatus) return before;
  if (TERMINAL.has(before.status)) throw new CrmError(409, "This Task is already closed.", "CRM_TASK_ALREADY_CLOSED");
  if (!EDITABLE.has(before.status)) throw new CrmError(409, "This Task cannot make that transition.", "CRM_TASK_TRANSITION_INVALID");
  if (nextStatus === "in_progress" && before.status === "overdue") { /* overdue tasks can still be started */ }
  if (nextStatus === "completed") {
    const blocking = await client.query(
      `SELECT blocker.id FROM tenant.crm_task_dependencies dependency
         JOIN tenant.crm_activities blocker ON blocker.organization_id=dependency.organization_id AND blocker.id=dependency.depends_on_task_id
        WHERE dependency.organization_id=$1 AND dependency.task_id=$2 AND blocker.status NOT IN ('completed','cancelled') LIMIT 1`,
      [context.organizationId, id],
    );
    if (blocking.rows[0]) throw new CrmError(409, "This Task has incomplete dependencies and cannot be completed yet.", "CRM_TASK_DEPENDENCY_BLOCKED");
  }
  const outcome = type === "completed" ? text(input.outcome).slice(0, 4000) || null : null;
  const result = await client.query(`UPDATE tenant.crm_activities SET status=$3,completed_at=${nextStatus === "completed" ? "now()" : "NULL"},outcome=CASE WHEN $3='completed' THEN COALESCE($4,outcome) ELSE outcome END,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 AND activity_type='task' RETURNING *`, [context.organizationId, id, nextStatus, outcome, context.userId]);
  const task = dto(result.rows[0]);
  await event(client, context, id, type, before, task);
  if (nextStatus === "completed") {
    await touchParent(client, context, task);
    if (task.recurrenceConfig) await generateNextTaskOccurrence(client, context, task);
  }
  await queueOutboxEvent(client, context, `crm.task.${type}`, "task", id, safe(task));
  return task;
}

export const startCrmTask = (client, context, id, input = {}) => transition(client, context, id, "in_progress", "started", input);
export const completeCrmTask = (client, context, id, input = {}) => transition(client, context, id, "completed", "completed", input);
export const cancelCrmTask = (client, context, id, input = {}) => transition(client, context, id, "cancelled", "cancelled", input);

export async function listCrmTaskHistory(client, context, id) {
  await getCrmTask(client, context, id);
  const { rows } = await client.query(`SELECT event_type,from_status,to_status,metadata,actor_user_id,occurred_at FROM tenant.crm_task_events WHERE organization_id=$1 AND activity_id=$2 ORDER BY occurred_at DESC,id DESC`, [context.organizationId, id]);
  return rows.map(dto);
}

// --- Team/queue claim, release, reassign --------------------------------

// The atomic claim itself: an ordinary UPDATE ... WHERE assigned_to IS NULL
// is the real concurrency guarantee, not application-level locking — under
// Postgres READ COMMITTED, a second concurrent UPDATE matching the same row
// blocks behind the first's row lock, then re-evaluates its WHERE clause
// once that lock releases; by then assigned_to is no longer NULL, so the
// loser's UPDATE matches zero rows instead of overwriting the winner. The
// getCrmTask() call before it is what enforces "may only claim from an
// authorized queue" (scopeSql only makes an unclaimed team Task visible to
// that team's active members), not the UPDATE itself.
export async function claimCrmTask(client, context, id, input = {}) {
  assertAllowed(input, new Set(EXPECTATION_FIELDS));
  const before = await getCrmTask(client, context, id);
  if (!before.teamId) throw new CrmError(409, "This Task is not part of a team queue.", "CRM_TASK_NOT_QUEUED");
  if (before.assignedTo) throw new CrmError(409, "This Task has already been claimed.", "CRM_TASK_CLAIM_CONFLICT");
  if (TERMINAL.has(before.status)) throw new CrmError(409, "This Task is already closed.", "CRM_TASK_ALREADY_CLOSED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  const result = await client.query(
    `UPDATE tenant.crm_activities SET assigned_to=$3,updated_by=$3,updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND activity_type='task' AND assigned_to IS NULL
       RETURNING *`,
    [context.organizationId, id, context.userId],
  );
  if (!result.rows[0]) throw new CrmError(409, "This Task was just claimed by someone else.", "CRM_TASK_CLAIM_CONFLICT");
  const task = dto(result.rows[0]);
  await event(client, context, task.id, "claimed", before, task, { claimedBy: context.userId });
  await queueOutboxEvent(client, context, "crm.task.claimed", "task", task.id, safe(task));
  return task;
}

// Releases a claimed queue Task back to unclaimed (assigned_to=NULL) so any
// other authorized team member can claim it. The current assignee may
// always release their own claim; releasing someone ELSE's claim is a
// manager action (the Team's manager, or an org-wide view-all/owner).
export async function releaseCrmTask(client, context, id, input = {}) {
  assertAllowed(input, new Set(EXPECTATION_FIELDS));
  const before = await getCrmTask(client, context, id, { lock: true });
  if (!before.teamId) throw new CrmError(409, "This Task is not part of a team queue.", "CRM_TASK_NOT_QUEUED");
  if (!before.assignedTo) throw new CrmError(409, "This Task is already unclaimed.", "CRM_TASK_NOT_CLAIMED");
  if (TERMINAL.has(before.status)) throw new CrmError(409, "This Task is already closed.", "CRM_TASK_ALREADY_CLOSED");
  stale(before, input.expectedUpdatedAt, input.expectedStatus);
  if (before.assignedTo !== context.userId && !canManageAllTasks(context)) {
    const team = await assertTeamValid(client, context, before.teamId, before.companyId || null);
    if (team.managerUserId !== context.userId)
      throw new CrmError(403, "Only the assignee or the Team's manager can release this Task back to the queue.", "CRM_TASK_RELEASE_FORBIDDEN");
  }
  const result = await client.query(
    `UPDATE tenant.crm_activities SET assigned_to=NULL,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 AND activity_type='task' RETURNING *`,
    [context.organizationId, id, context.userId],
  );
  const task = dto(result.rows[0]);
  await event(client, context, task.id, "released", before, task, { releasedBy: context.userId, previousAssignee: before.assignedTo });
  await queueOutboxEvent(client, context, "crm.task.released", "task", task.id, safe(task));
  return task;
}

// Teams the caller can queue Tasks against — powers the Tasks workspace's
// Team/Queue picker without exposing every Team in the organization.
export async function listMyTaskTeams(client, context) {
  if (canManageAllTasks(context)) {
    const { rows } = await client.query(
      `SELECT id,name,manager_user_id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND status='active' ORDER BY name`,
      [context.organizationId],
    );
    return rows.map(dto);
  }
  const { rows } = await client.query(
    `SELECT team.id,team.name,team.manager_user_id FROM tenant.crm_sales_teams team
       JOIN tenant.crm_sales_team_members member ON member.organization_id=team.organization_id AND member.team_id=team.id
      WHERE team.organization_id=$1 AND team.status='active' AND member.user_id=$2 AND member.status='active'
      ORDER BY team.name`,
    [context.organizationId, context.userId],
  );
  return rows.map(dto);
}

// Powers the Tasks workspace's "assign to a specific Team member" picker —
// only a Team's own active members (or a view-all/manager caller) may see
// its roster, matching the same authorization the queue-visibility rule in
// scopeSql already applies.
export async function listTeamMembers(client, context, teamId) {
  const id = uuid(teamId, "Team");
  if (!canManageAllTasks(context) && !(await isActiveTeamMember(client, context, id, context.userId)))
    throw new CrmError(403, "You are not a member of this Team.", "CRM_TASK_TEAM_SCOPE_FORBIDDEN");
  const { rows } = await client.query(
    `SELECT member.user_id,member.member_role,u.full_name FROM tenant.crm_sales_team_members member
       JOIN public.users u ON u.id=member.user_id
      WHERE member.organization_id=$1 AND member.team_id=$2 AND member.status='active'
      ORDER BY u.full_name`,
    [context.organizationId, id],
  );
  return rows.map(dto);
}

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
  "assignedTo", "startAt", "dueAt", "reminderAt", "recurringRule",
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
  for (const [field, label] of [["startAt", "Start"], ["dueAt", "Due"], ["reminderAt", "Reminder"]]) {
    if (hasOwn(input, field)) out[field] = dateValue(input[field], label, true);
  }
  if (hasOwn(input, "recurringRule")) {
    const rule = text(input.recurringRule);
    if (rule.length > 1000) throw new CrmError(400, "Recurring rule must be at most 1,000 characters.", "CRM_TASK_RECURRENCE_INVALID");
    out.recurringRule = rule || null;
  }
  return out;
}
function scopeSql(context, values, alias = "activity") {
  let sql = "";
  if (context.activeCompanyId) sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=${add(values, context.activeCompanyId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  if (context.activeBranchId) sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=${add(values, context.activeBranchId)})`;
  else if (!context.allowAllCompanies) return " AND false";
  const canViewAll = Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
  if (!canViewAll) sql += ` AND (${alias}.assigned_to IS NULL OR ${alias}.assigned_to=${add(values, context.userId)})`;
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
async function validate(client, context, prepared, existing = null) {
  const effective = { ...(existing || {}), ...prepared };
  effective.entityType ||= "general";
  effective.priority ||= "medium";
  effective.assignedTo ||= context.userId;
  effective.companyId ??= context.activeCompanyId || null;
  effective.branchId ??= context.activeBranchId || null;
  assertWritableScope(context, effective);
  if (!effective.subject) throw new CrmError(400, "Task subject is required.", "CRM_TASK_SUBJECT_INVALID");
  const related = await relationRecord(client, context, effective.entityType, effective.entityId || null);
  if (!effective.companyId && related?.company_id) prepared.companyId = effective.companyId = related.company_id;
  if (!effective.branchId && related?.branch_id) prepared.branchId = effective.branchId = related.branch_id;
  if (related?.company_id && effective.companyId && related.company_id !== effective.companyId)
    throw new CrmError(409, "The related CRM record belongs to another company.", "CRM_TASK_RELATION_SCOPE_INVALID");
  if (related?.branch_id && effective.branchId && related.branch_id !== effective.branchId)
    throw new CrmError(409, "The related CRM record belongs to another branch.", "CRM_TASK_RELATION_SCOPE_INVALID");
  try {
    await assertEligibleLeadAssignee(client, context, effective.assignedTo, { companyId: effective.companyId || null, branchId: effective.branchId || null });
  } catch (error) {
    if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw new CrmError(409, error.message, "CRM_TASK_ASSIGNEE_INVALID");
    throw error;
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
  if (due === "overdue") where += ` AND activity.due_at<now() AND activity.status NOT IN ('completed','cancelled')`;
  if (due === "today") where += ` AND activity.due_at>=current_date AND activity.due_at<current_date+interval '1 day'`;
  if (due === "upcoming") where += ` AND activity.due_at>=now() AND activity.status NOT IN ('completed','cancelled')`;
  const search = text(filters.search).slice(0, 200);
  if (search) { const p = add(values, `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); where += ` AND (activity.subject ILIKE ${p} ESCAPE '\\' OR COALESCE(activity.description,'') ILIKE ${p} ESCAPE '\\')`; }
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(filters.limit) || 25)));
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset) || 0)));
  const count = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_activities activity WHERE ${where}`, values);
  const qv = [...values];
  const result = await client.query(`SELECT activity.*,u.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to WHERE ${where} ORDER BY COALESCE(activity.due_at,activity.start_at,activity.created_at),activity.created_at DESC LIMIT ${add(qv, limit)} OFFSET ${add(qv, offset)}`, qv);
  return { rows: result.rows.map(dto), total: Number(count.rows[0]?.total || 0), limit, offset };
}

export async function getCrmTask(client, context, id, { lock = false } = {}) {
  uuid(id, "Task");
  const values = [context.organizationId, id];
  const result = await client.query(`SELECT activity.*,u.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users u ON u.id=activity.assigned_to WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='task'${scopeSql(context, values)} LIMIT 1${lock ? " FOR UPDATE OF activity" : ""}`, values);
  if (!result.rows[0]) throw new CrmError(404, "Task not found.", "CRM_TASK_NOT_FOUND");
  return dto(result.rows[0]);
}

export async function createCrmTask(client, context, input = {}) {
  if (hasOwn(input, "activityType") || hasOwn(input, "status")) throw new CrmError(409, "Task type and initial status are server governed.", "CRM_TASK_LIFECYCLE_GOVERNED");
  const prepared = normalize(input, { create: true });
  const effective = await validate(client, context, prepared);
  const result = await client.query(`INSERT INTO tenant.crm_activities(organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,assigned_to,start_at,due_at,reminder_at,recurring_rule,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'task',$6,$7,'planned',$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`, [context.organizationId, effective.companyId, effective.branchId, effective.entityType, effective.entityId || null, effective.subject, effective.description || null, effective.priority, effective.assignedTo, effective.startAt || null, effective.dueAt || null, effective.reminderAt || null, effective.recurringRule || null, context.userId]);
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
  const columns = { companyId: "company_id", branchId: "branch_id", entityType: "entity_type", entityId: "entity_id", subject: "subject", description: "description", priority: "priority", assignedTo: "assigned_to", startAt: "start_at", dueAt: "due_at", reminderAt: "reminder_at", recurringRule: "recurring_rule" };
  for (const [field, column] of Object.entries(columns)) if (hasOwn(prepared, field)) pairs.push(`${column}=${add(values, prepared[field])}`);
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
  const outcome = type === "completed" ? text(input.outcome).slice(0, 4000) || null : null;
  const result = await client.query(`UPDATE tenant.crm_activities SET status=$3,completed_at=${nextStatus === "completed" ? "now()" : "NULL"},outcome=CASE WHEN $3='completed' THEN COALESCE($4,outcome) ELSE outcome END,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 AND activity_type='task' RETURNING *`, [context.organizationId, id, nextStatus, outcome, context.userId]);
  const task = dto(result.rows[0]);
  await event(client, context, id, type, before, task);
  if (nextStatus === "completed") await touchParent(client, context, task);
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

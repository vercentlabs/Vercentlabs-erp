// The workflow engine (Settings > Automations; platform.workflows.manage).
//
//   definitions  versioned: saving an active workflow creates a new version
//                (kept in workflow_definition_versions); runs record the
//                version they evaluated.
//   fan-out      for every committed REGISTERED event, one pending run per
//                active workflow on that trigger, idempotent on
//                workflow + version + event (unique idempotency_key).
//   execution    worker, one tenant transaction per run, no external I/O:
//                evaluate conditions, run at most WORKFLOW_LIMITS.maxActions
//                registered actions, record output or error evidence. All
//                actions commit together or not at all (a failed run is
//                recorded, never half-applied).
//   authority    actions need no user authority (notification only). Any
//                future business-command action must run with an explicitly
//                persisted actor and normal authorization, never the editing
//                administrator's permissions.
//   loops        actions do not publish domain events; events that carry
//                origin "workflow" are ignored as triggers.
import { getDomainEvent, projectDomainEvent } from "../events/index.js";
import { isFeatureFlagEnabled } from "../configuration/index.js";
import { createNotification } from "../notifications/index.js";
import { audit } from "../../security.js";
import { CONDITION_OPERATORS, WORKFLOW_ACTIONS, WORKFLOW_ENTITY_LINKS, WORKFLOW_LIMITS, WORKFLOW_NOTIFICATION_CATEGORY } from "./registry.js";

export class WorkflowError extends Error {
  constructor(status, message, code = "WORKFLOW_ERROR") {
    super(message);
    this.name = "WorkflowError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message) => new WorkflowError(400, message, "WORKFLOW_DEFINITION_INVALID");

function readPath(data, path) {
  return String(path)
    .split(".")
    .reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), data);
}

// ------------------------------------------------------------ validation

async function validateDefinition(client, organizationId, input) {
  const name = String(input?.name ?? "").trim();
  if (!name || name.length > WORKFLOW_LIMITS.maxNameLength) throw invalid("Name the automation (up to 120 characters).");
  const event = getDomainEvent(input?.trigger);
  if (!event) throw invalid("Choose a supported trigger event.");
  const conditionFields = new Map(event.conditionFields.map((field) => [field.key, field]));

  const conditions = Array.isArray(input?.conditions) ? input.conditions : [];
  if (conditions.length > WORKFLOW_LIMITS.maxConditions) throw invalid(`Use at most ${WORKFLOW_LIMITS.maxConditions} conditions.`);
  const cleanConditions = conditions.map((condition) => {
    const field = conditionFields.get(String(condition?.field));
    if (!field) throw invalid("A condition uses a field this event does not have.");
    const operator = CONDITION_OPERATORS.find((entry) => entry.key === condition?.operator);
    if (!operator) throw invalid("A condition uses an unsupported comparison.");
    if (operator.key === "changed_includes" && field.type !== "list") throw invalid(`"${field.label}" cannot use "includes".`);
    if (operator.key === "in") {
      if (!Array.isArray(condition.value) || !condition.value.length || condition.value.length > 50) throw invalid("Give up to 50 values for \"is one of\".");
      return { field: field.key, operator: operator.key, value: condition.value.map((value) => String(value).slice(0, 200)) };
    }
    if (condition.value === undefined || condition.value === null || String(condition.value).length > 200) throw invalid("Every condition needs a value.");
    return { field: field.key, operator: operator.key, value: String(condition.value) };
  });

  const actions = Array.isArray(input?.actions) ? input.actions : [];
  if (!actions.length || actions.length > WORKFLOW_LIMITS.maxActions) throw invalid(`Add between 1 and ${WORKFLOW_LIMITS.maxActions} actions.`);
  const cleanActions = [];
  for (const action of actions) {
    if (!WORKFLOW_ACTIONS.some((entry) => entry.key === action?.type)) throw invalid("An action is not supported.");
    const title = String(action.title ?? "").trim();
    const message = String(action.message ?? "").trim();
    if (!title || title.length > WORKFLOW_LIMITS.maxTitle) throw invalid("Give the notification a title (up to 120 characters).");
    if (message.length > WORKFLOW_LIMITS.maxMessage) throw invalid("The notification message is too long.");
    const recipient = action.recipient || {};
    if (recipient.type === "event_field") {
      const field = conditionFields.get(String(recipient.field));
      if (!field || field.type !== "user") throw invalid("Choose who in the event receives the notification.");
      cleanActions.push({ type: "notify", recipient: { type: "event_field", field: field.key }, title, message });
    } else if (recipient.type === "user") {
      if (!UUID.test(String(recipient.userId || ""))) throw invalid("Choose a member to notify.");
      const member = await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [organizationId, recipient.userId]);
      if (!member.rows[0]) throw invalid("The member to notify must be active in this organization.");
      cleanActions.push({ type: "notify", recipient: { type: "user", userId: recipient.userId }, title, message });
    } else {
      throw invalid("Choose who receives the notification.");
    }
  }
  return { name, trigger: event.key, definition: { trigger: event.key, conditions: cleanConditions, actions: cleanActions } };
}

// ------------------------------------------------------------ administration

function workflowDto(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    trigger: row.trigger_event,
    triggerLabel: getDomainEvent(row.trigger_event)?.label ?? "Unsupported trigger",
    definition: row.definition,
    version: row.version,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? null,
    failedRuns: Number(row.failed_runs ?? 0),
  };
}

export async function listWorkflows(client, organizationId) {
  const { rows } = await client.query(
    `SELECT workflow.*, (SELECT max(run.created_at) FROM workflow_runs run WHERE run.workflow_id=workflow.id) AS last_run_at,
            (SELECT count(*) FROM workflow_runs run WHERE run.workflow_id=workflow.id AND run.status='failed')::int AS failed_runs
       FROM workflow_definitions workflow WHERE workflow.organization_id=$1 ORDER BY workflow.updated_at DESC`,
    [organizationId],
  );
  return rows.map(workflowDto);
}

async function saveVersion(client, organizationId, workflowId, version, definition, userId) {
  await client.query(
    `INSERT INTO workflow_definition_versions (organization_id, workflow_id, version, definition, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [organizationId, workflowId, version, JSON.stringify(definition), userId],
  );
}

export async function createWorkflow(client, session, input) {
  const validated = await validateDefinition(client, session.organizationId, input);
  const status = input?.status === "active" ? "active" : "inactive";
  const { rows } = await client.query(
    `INSERT INTO workflow_definitions (organization_id, name, entity_type, status, definition, trigger_event, version, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,1,$7,$7) RETURNING *`,
    [session.organizationId, validated.name, getDomainEvent(validated.trigger).entityType, status, JSON.stringify(validated.definition), validated.trigger, session.userId],
  );
  await saveVersion(client, session.organizationId, rows[0].id, 1, validated.definition, session.userId);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "workflow.created", entityType: "workflow", entityId: rows[0].id, afterData: { name: validated.name, trigger: validated.trigger, status } });
  return workflowDto(rows[0]);
}

// A saved change is a new version; the previous definition stays for past runs.
export async function updateWorkflow(client, session, workflowId, input) {
  if (!UUID.test(String(workflowId || ""))) throw new WorkflowError(404, "Automation not found.", "WORKFLOW_NOT_FOUND");
  const current = (await client.query(`SELECT * FROM workflow_definitions WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [session.organizationId, workflowId])).rows[0];
  if (!current) throw new WorkflowError(404, "Automation not found.", "WORKFLOW_NOT_FOUND");
  if (input?.expectedVersion !== undefined && Number(input.expectedVersion) !== current.version) throw new WorkflowError(409, "Someone else changed this automation. Reload and try again.", "WORKFLOW_VERSION_CONFLICT");
  const validated = await validateDefinition(client, session.organizationId, input);
  const version = current.version + 1;
  const { rows } = await client.query(
    `UPDATE workflow_definitions SET name=$2, entity_type=$3, definition=$4::jsonb, trigger_event=$5, version=$6, updated_by=$7, updated_at=now() WHERE id=$1 RETURNING *`,
    [current.id, validated.name, getDomainEvent(validated.trigger).entityType, JSON.stringify(validated.definition), validated.trigger, version, session.userId],
  );
  await saveVersion(client, session.organizationId, current.id, version, validated.definition, session.userId);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "workflow.updated", entityType: "workflow", entityId: current.id, metadata: { version } });
  return workflowDto(rows[0]);
}

export async function setWorkflowStatus(client, session, workflowId, status) {
  if (!["active", "inactive"].includes(status)) throw new WorkflowError(400, "Unsupported status.", "WORKFLOW_DEFINITION_INVALID");
  if (!UUID.test(String(workflowId || ""))) throw new WorkflowError(404, "Automation not found.", "WORKFLOW_NOT_FOUND");
  const { rows } = await client.query(`UPDATE workflow_definitions SET status=$3, updated_by=$4, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [session.organizationId, workflowId, status, session.userId]);
  if (!rows[0]) throw new WorkflowError(404, "Automation not found.", "WORKFLOW_NOT_FOUND");
  if (!getDomainEvent(rows[0].trigger_event) && status === "active") throw new WorkflowError(409, "This automation's trigger is no longer supported. Edit it first.", "WORKFLOW_DEFINITION_INVALID");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: status === "active" ? "workflow.activated" : "workflow.deactivated", entityType: "workflow", entityId: workflowId });
  return workflowDto(rows[0]);
}

// Who a "notify a specific member" action can name: active members only.
export async function listWorkflowRecipients(client, organizationId) {
  const { rows } = await client.query(
    `SELECT member.user_id AS id, users.full_name AS name FROM organization_memberships member JOIN users ON users.id = member.user_id
      WHERE member.organization_id=$1 AND member.status='active' ORDER BY users.full_name LIMIT 500`,
    [organizationId],
  );
  return rows;
}

export async function listWorkflowRuns(client, organizationId, { workflowId = null, limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT id, workflow_id, workflow_version, trigger_key, entity_type, entity_id, status, output_payload, error_code, error_message, started_at, finished_at, created_at
       FROM workflow_runs WHERE organization_id=$1 AND ($2::uuid IS NULL OR workflow_id=$2::uuid)
      ORDER BY created_at DESC LIMIT $3`,
    [organizationId, workflowId && UUID.test(workflowId) ? workflowId : null, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    version: row.workflow_version,
    trigger: row.trigger_key,
    triggerLabel: getDomainEvent(row.trigger_key)?.label ?? row.trigger_key,
    status: row.status,
    matched: row.output_payload?.matched ?? null,
    actionsRun: Array.isArray(row.output_payload?.actions) ? row.output_payload.actions.length : 0,
    error: row.error_message ? String(row.error_message).slice(0, 300) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }));
}

// ------------------------------------------------------------ fan-out (worker)

export async function fanOutWorkflowRuns(client, event) {
  const definition = getDomainEvent(event.event_type);
  if (!definition || event.payload?.origin === "workflow") return;
  if (!(await isFeatureFlagEnabled(client, event.organization_id, "platform.workflows", "enabled"))) return;
  const envelope = projectDomainEvent(event);
  await client.query(
    `INSERT INTO workflow_runs (organization_id, workflow_id, workflow_version, event_id, trigger_key, entity_type, entity_id, idempotency_key, status, input_payload, created_by)
     SELECT $1, workflow.id, workflow.version, $2::uuid, $3, $4, $5, workflow.id::text || ':' || workflow.version::text || ':' || $2::text, 'pending', $6::jsonb, NULL
       FROM workflow_definitions workflow
      WHERE workflow.organization_id=$1 AND workflow.status='active' AND workflow.trigger_event=$3
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
    [event.organization_id, event.id, definition.key, definition.entityType, String(event.entity_id), JSON.stringify(envelope)],
  );
}

// ------------------------------------------------------------ execution (worker)

export async function claimWorkflowRuns(client, organizationId, { limit = WORKFLOW_LIMITS.runsPerTick, leaseMilliseconds = 5 * 60 * 1000 } = {}) {
  const { rows } = await client.query(
    `WITH due AS (
       SELECT id FROM workflow_runs
        WHERE organization_id=$1 AND (status='pending' OR (status='running' AND started_at < now() - ($3 || ' milliseconds')::interval))
        ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     UPDATE workflow_runs run SET status='running', started_at=now(), attempt_count=attempt_count+1, updated_at=now()
       FROM due WHERE run.id=due.id RETURNING run.*`,
    [organizationId, limit, String(leaseMilliseconds)],
  );
  return rows;
}

function conditionHolds(condition, data) {
  const actual = readPath(data, condition.field);
  switch (condition.operator) {
    case "equals":
      return actual !== undefined && actual !== null && String(actual) === condition.value;
    case "not_equals":
      return actual === undefined || actual === null || String(actual) !== condition.value;
    case "in":
      return actual !== undefined && actual !== null && condition.value.includes(String(actual));
    case "changed_includes":
      return Array.isArray(actual) && actual.map(String).includes(condition.value);
    default:
      return false;
  }
}

export function evaluateWorkflowConditions(conditions, data) {
  return (conditions || []).every((condition) => conditionHolds(condition, data));
}

/** Executes one claimed run inside the caller's tenant transaction. */
export async function executeWorkflowRun(client, run) {
  const version = (
    await client.query(`SELECT definition FROM workflow_definition_versions WHERE organization_id=$1 AND workflow_id=$2 AND version=$3`, [run.organization_id, run.workflow_id, run.workflow_version])
  ).rows[0];
  if (!version) throw new WorkflowError(409, "The automation version no longer exists.", "WORKFLOW_VERSION_MISSING");
  const envelope = run.input_payload || {};
  const data = envelope.data || {};
  const definition = version.definition;
  if (!evaluateWorkflowConditions(definition.conditions, data)) {
    await client.query(`UPDATE workflow_runs SET status='succeeded', output_payload=$2::jsonb, finished_at=now(), updated_at=now() WHERE id=$1`, [run.id, JSON.stringify({ matched: false, actions: [] })]);
    return { matched: false, actions: [] };
  }
  const moduleKey = String(envelope.module || "");
  const category = WORKFLOW_NOTIFICATION_CATEGORY[moduleKey];
  if (!category) throw new WorkflowError(409, "This event's module has no automation notification category.", "WORKFLOW_ACTION_UNAVAILABLE");
  const link = WORKFLOW_ENTITY_LINKS[envelope.entity?.type]?.(envelope.entity?.id) ?? null;
  const results = [];
  for (const action of (definition.actions || []).slice(0, WORKFLOW_LIMITS.maxActions)) {
    if (action.type !== "notify") throw new WorkflowError(409, "An action is not supported.", "WORKFLOW_ACTION_UNAVAILABLE");
    const userId = action.recipient.type === "user" ? action.recipient.userId : readPath(data, action.recipient.field);
    if (!UUID.test(String(userId || ""))) {
      results.push({ type: "notify", delivered: false, reason: "NO_RECIPIENT" });
      continue;
    }
    const delivered = await createNotification(client, {
      organizationId: run.organization_id,
      userId,
      category,
      title: action.title,
      message: action.message,
      href: link,
      entityType: envelope.entity?.type?.replace(".", "_") ?? null,
      entityId: envelope.entity?.id ?? null,
    });
    results.push({ type: "notify", delivered, reason: delivered ? null : "RECIPIENT_OPTED_OUT_OR_INACTIVE" });
  }
  await client.query(`UPDATE workflow_runs SET status='succeeded', output_payload=$2::jsonb, finished_at=now(), updated_at=now() WHERE id=$1`, [run.id, JSON.stringify({ matched: true, actions: results })]);
  return { matched: true, actions: results };
}

export async function failWorkflowRun(client, runId, error) {
  await client.query(
    `UPDATE workflow_runs SET status='failed', error_code=$2, error_message=$3, finished_at=now(), updated_at=now() WHERE id=$1`,
    [runId, String(error?.code || "WORKFLOW_RUN_FAILED").slice(0, 80), String(error?.message || error).slice(0, 1000)],
  );
}

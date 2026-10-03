// Generic CRM record commands: createCrmRecord / updateCrmRecord /
// archiveCrmRecord for every resource in resource-registry.js.
//
// This file owns the generic mechanics (governed-resource redirects, scope and
// owner checks, code numbering, the INSERT/UPDATE/
// archive SQL, optimistic-concurrency guards, the outbox event and the
// projection). Behaviour that belongs to one aggregate lives with its owner
// and is called here at fixed points:
//   Leads         -> not handled here: leads/ owns every lead operation
//   Opportunities -> pipeline/opportunity-record-rules.js
//   Automation    -> automation/automation-engine.js (runCrmAutomation)
import { afterOpportunityRowUpdated, assertOpportunityCreateInput, assertOpportunityExpectedRevenueNotSupplied, assertOpportunityUpdateAllowed, completeOpportunityCreate, normalizeOpportunityRecordInput, opportunityChangedFields, opportunityOutboxSnapshot, prepareOpportunityForCreate, validateOpportunityForUpdate, withOpportunityArchiveTransition } from "../pipeline/opportunity-record-rules.js";
import { recordAccountHistory } from "../accounts/history.js";
import { recordContactHistory } from "../contacts/history.js";
import { runCrmAutomation } from "./automation/automation-engine.js";
import { CrmError } from "./errors.js";
import { assertSalesTeamParentAllowed, assertTerritoryParentAllowed } from "../sales-organization/hierarchy-rules.js";
import { queueOutboxEvent } from "./outbox.js";
import { assertLeadLinkedContentAllowed, assertLifecycleUpdate, assertOwnerAssignmentAllowed, projectCrmRecord, recordScope } from "./record-policy.js";
import { addParameter, camelizeRow } from "./record-utils.js";
import { getCrmRecord, nextCode } from "./resource-query-service.js";
import { auditColumns, definitionFor } from "./resource-registry.js";
import { GENERIC_VERSIONED_RESOURCES, assertCustomFieldRequiredRolloutSafe, assertGenericLeadLinkedTarget, assertRecordExpectedVersion, mutableEntries, normalizeStorageInput, validateCustomRecord, validateOrganizationUserReferences } from "./resource-validation.js";

// The audit stamps an UPDATE may write on this resource's table.
function updateStamps(resource, userParameter) {
  const audit = auditColumns(resource);
  return [
    ...(audit.updatedBy ? [`updated_by = ${userParameter}`] : []),
    ...(audit.updatedAt ? ["updated_at = now()"] : []),
  ];
}

export async function createCrmRecord(client, context, resource, input) {
  if (resource === "activities") {
    const activityType = String(input?.activityType || "").toLowerCase();
    if (activityType === "call")
      throw new CrmError(410, "Use the governed Calls operations.", "CRM_CALL_API_MOVED");
    if (activityType === "meeting")
      throw new CrmError(410, "Use the governed Meetings operations.", "CRM_MEETING_API_MOVED");
    if (activityType === "follow_up")
      throw new CrmError(410, "Use the governed Follow-ups operations.", "CRM_FOLLOW_UP_API_MOVED");
    // Tasks are redirected too — otherwise POST /api/crm/activities with
    // {activityType:"task",...} would insert a crm_activities row directly,
    // bypassing createCrmTask's own governance (status always 'planned', activityType/status rejected
    // as caller-supplied input, recurrenceConfig validation).
    if (activityType === "task")
      throw new CrmError(410, "Use the governed Tasks operations.", "CRM_TASK_API_MOVED");
  }
  if (resource === "stages")
    throw new CrmError(
      410,
      "Use the governed Sales Stages operations.",
      "CRM_SALES_STAGE_API_MOVED",
    );
  if (resource === "leads")
    throw new CrmError(410, "Use the Lead operations.", "CRM_LEAD_API_MOVED");
  if (resource === "sources")
    throw new CrmError(
      410,
      "Use the governed Lead Source operations.",
      "CRM_LEAD_SOURCE_API_MOVED",
    );
  // F025: submissions change only through forecast-service.js (versioned,
  // reviewed, period-locked); the generic path could set a seller's own
  // manager_adjustment and skip review entirely.
  if (resource === "forecast-submissions")
    throw new CrmError(410, "Use the governed forecast operations (submit, review, period lifecycle).", "CRM_FORECAST_API_MOVED");
  if (resource === "forecast-periods" && input && Object.prototype.hasOwnProperty.call(input, "status") && input.status !== "planned" && input.status !== "open")
    throw new CrmError(410, "Use the governed forecast operations (submit, review, period lifecycle).", "CRM_FORECAST_API_MOVED");
  const definition = definitionFor(resource);
  assertLeadLinkedContentAllowed(context, resource, input);
  if (resource === "opportunities") assertOpportunityCreateInput(input);
  await assertOwnerAssignmentAllowed(client, definition, context, input);
  const prepared =
    resource === "opportunities"
      ? normalizeOpportunityRecordInput(input)
      : normalizeStorageInput(resource, input);
  if (definition.codeEntity && !prepared[definition.codeField])
    prepared[definition.codeField] = await nextCode(
      client,
      context.organizationId,
      definition.codeEntity,
    );
  if (resource === "custom-field-definitions" && prepared.required === true) {
    await assertCustomFieldRequiredRolloutSafe(
      client,
      context,
      prepared.objectDefinitionId,
      prepared.fieldKey,
      Boolean(input.confirmRequiredRollout),
    );
  }
  await assertGenericLeadLinkedTarget(client, context, resource, prepared);
  if (resource === "opportunities") await prepareOpportunityForCreate(client, context, prepared);
  if (resource === "custom-records")
    await validateCustomRecord(client, context, prepared);
  await validateOrganizationUserReferences(
    client,
    context,
    definition,
    prepared,
  );
  const entries = mutableEntries(definition, prepared);
  if (!entries.length)
    throw new CrmError(400, "No CRM fields were supplied.");
  const audit = auditColumns(resource);
  const columns = [
    "organization_id",
    ...entries.map(([key]) => definition.fields[key]),
    ...(audit.createdBy ? ["created_by"] : []),
    ...(audit.updatedBy ? ["updated_by"] : []),
  ];
  const rawValues = [
    context.organizationId,
    ...entries.map(([, value]) => value),
    ...(audit.createdBy ? [context.userId] : []),
    ...(audit.updatedBy ? [context.userId] : []),
  ];
  // A field sent as null on create means "no value": write DEFAULT, not NULL.
  // For a nullable column without a default that is still NULL; for a NOT
  // NULL column with a default (a Lead's rating, a territory's coverage) it
  // is the default instead of a constraint error that failed the whole save
  // with a 500. No CRM table has a nullable column with a default, so no
  // explicit null is ever turned into a different value.
  const values = [];
  const placeholders = rawValues.map((value) => {
    if (value === null) return "DEFAULT";
    values.push(value);
    return `$${values.length}`;
  });
  const result = await client.query(
    `INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values,
  );
  const created = camelizeRow(result.rows[0]);
  if (resource === "opportunities") {
    await completeOpportunityCreate(client, context, created);
    if (created.partyId)
      await recordAccountHistory(client, context, created.partyId, "opportunity_created", `Opportunity ${created.code ?? ""} created: ${created.name}`.replace("  ", " "), { opportunityId: created.id });
    if (created.contactId)
      await recordContactHistory(client, context, created.contactId, "opportunity_associated", `Primary contact of opportunity ${created.code ?? ""} ${created.name}`.replace("  ", " "), { opportunityId: created.id });
    await runCrmAutomation(
      client,
      context,
      "opportunity.created",
      "opportunity",
      created.id,
      created,
    );
  }
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.created`,
    resource,
    created.id,
    resource === "opportunities" ? opportunityOutboxSnapshot(created) : created,
  );
  return projectCrmRecord(client, context, resource, created);
}

export async function updateCrmRecord(
  client,
  context,
  resource,
  id,
  input,
  expectations = {},
) {
  // F025: submissions and period status change only through forecast-service.js.
  if (resource === "forecast-submissions")
    throw new CrmError(410, "Use the governed forecast operations (submit, review, period lifecycle).", "CRM_FORECAST_API_MOVED");
  if (resource === "forecast-periods" && input && Object.prototype.hasOwnProperty.call(input, "status"))
    throw new CrmError(410, "Use the governed forecast operations (submit, review, period lifecycle).", "CRM_FORECAST_API_MOVED");
  if (resource === "stages")
    throw new CrmError(
      410,
      "Use the governed Sales Stages operations.",
      "CRM_SALES_STAGE_API_MOVED",
    );
  if (resource === "leads")
    throw new CrmError(410, "Use the Lead operations.", "CRM_LEAD_API_MOVED");
  if (resource === "sources")
    throw new CrmError(
      410,
      "Use the governed Lead Source operations.",
      "CRM_LEAD_SOURCE_API_MOVED",
    );
  const definition = definitionFor(resource);
  const before = await getCrmRecord(client, context, resource, id);
  assertLeadLinkedContentAllowed(context, resource, input, before);
  if (resource === "opportunities")
    assertRecordExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
      "Opportunity",
      "CRM_OPPORTUNITY",
    );
  if (GENERIC_VERSIONED_RESOURCES[resource])
    assertRecordExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
      GENERIC_VERSIONED_RESOURCES[resource].entityLabel,
      GENERIC_VERSIONED_RESOURCES[resource].codePrefix,
    );
  if (resource === "activities") {
    const requestedActivityType = String(input?.activityType || "").toLowerCase();
    if (before.activityType === "call" || requestedActivityType === "call")
      throw new CrmError(410, "Use the governed Calls operations.", "CRM_CALL_API_MOVED");
    if (before.activityType === "meeting" || requestedActivityType === "meeting")
      throw new CrmError(410, "Use the governed Meetings operations.", "CRM_MEETING_API_MOVED");
    if (before.activityType === "follow_up" || requestedActivityType === "follow_up")
      throw new CrmError(410, "Use the governed Follow-ups operations.", "CRM_FOLLOW_UP_API_MOVED");
    // Tasks (activity_type='task') are redirected like Calls/Meetings/
    // Follow-ups: task-operations.js enforces claim-conflict handling,
    // dependency-blocked completion, terminal-state read-only enforcement
    // and recurrence generation, which a direct PATCH of
    // /api/crm/activities/[taskId] through this generic path would skip.
    if (before.activityType === "task" || requestedActivityType === "task")
      throw new CrmError(410, "Use the governed Tasks operations.", "CRM_TASK_API_MOVED");
  }
  if (resource === "opportunities") assertOpportunityUpdateAllowed(context, before, input);
  // No Opportunity controlled-field guard is needed here: record-policy.js's
  // assertLifecycleUpdate already blocks the full controlled-field set
  // (pipelineId/stageId/probability/forecastCategory/status/actualCloseDate/
  // lostReasonId/lossNotes/outcomeReasonId/outcomeNotes) further down this
  // same call chain, and crm-opportunities-f009.test.mjs already covers it
  // ("outcome and stage-owned fields cannot be forged through generic
  // PATCH"). Do not add a redundant/conflicting guard here.
  await assertOwnerAssignmentAllowed(client, definition, context, input);
  if (resource === "opportunities") assertOpportunityExpectedRevenueNotSupplied(input);
  assertLifecycleUpdate(resource, before, input, context);
  const prepared =
    resource === "opportunities"
      ? normalizeOpportunityRecordInput(input)
      : normalizeStorageInput(resource, input);
  if (resource === "opportunities") await validateOpportunityForUpdate(client, context, prepared, before);
  if (resource === "custom-records") {
    const callerSuppliedData = Object.prototype.hasOwnProperty.call(prepared, "data");
    prepared.objectDefinitionId ??= before.objectDefinitionId;
    prepared.data ??= before.data;
    await validateCustomRecord(
      client,
      context,
      prepared,
      id,
      callerSuppliedData ? new Set(Object.keys(prepared.data)) : new Set(),
    );
  }
  if (
    resource === "custom-field-definitions" &&
    prepared.required === true &&
    before.required !== true
  ) {
    await assertCustomFieldRequiredRolloutSafe(
      client,
      context,
      before.objectDefinitionId,
      before.fieldKey,
      Boolean(input.confirmRequiredRollout),
    );
  }
  await assertTerritoryParentAllowed(client, context, resource, id, prepared);
  await assertSalesTeamParentAllowed(client, context, resource, id, prepared);
  await assertGenericLeadLinkedTarget(client, context, resource, {
    ...before,
    ...prepared,
  });
  await validateOrganizationUserReferences(
    client,
    context,
    definition,
    prepared,
  );
  const entries = mutableEntries(definition, prepared);
  if (!entries.length)
    throw new CrmError(400, "No CRM fields were supplied.");
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([key], index) => `${definition.fields[key]} = $${index + 1}`,
  );
  // The acting user is bound only when the table records it (an unused
  // bound parameter is rejected by Postgres: "could not determine data type").
  const stampsUser = auditColumns(resource).updatedBy;
  parameters.push(...(stampsUser ? [context.userId] : []), context.organizationId, id);
  const userParameter = stampsUser ? entries.length + 1 : null;
  const organizationParameter = entries.length + (stampsUser ? 2 : 1);
  const idParameter = entries.length + (stampsUser ? 3 : 2);
  const scope = recordScope(definition, context, parameters);
  // Checked-write: when a version was actually asserted above (opportunities
  // and the versioned generic resources), the UPDATE's own WHERE clause re-confirms updated_at
  // still matches — closing the read-then-write race window atomically. A
  // zero-row result then unambiguously means a concurrent writer won that
  // race (existence was already confirmed by the `before` read), not a
  // genuine 404.
  const versionChecked =
    expectations.expectedUpdatedAt &&
    (resource === "opportunities" || Boolean(GENERIC_VERSIONED_RESOURCES[resource]));
  // Optimistic-concurrency precision: `updated_at` is `timestamptz`
  // with genuine microsecond precision (e.g. `.700902`), but `before`
  // (read moments earlier via getCrmRecord/camelizeRow) comes
  // back from `pg`'s default type parser as a JS `Date`, which can only
  // hold millisecond precision (`.700000`) -- so re-binding that
  // ALREADY-TRUNCATED value for an exact `=` comparison against the
  // full-precision stored value fails almost every time, even with zero
  // real concurrent writes, because no API response can ever hand a
  // client more than millisecond precision to begin with (JSON/ISO-8601
  // via JS Date) — every checked write would fail with a false
  // CRM_STALE_WRITE. Compares at
  // millisecond precision on both sides instead -- the only precision any
  // client-supplied `expectedUpdatedAt` can ever meaningfully carry, so
  // this only removes a false-positive rejection, never masks a real
  // concurrent change (which will practically always land in a different
  // millisecond).
  const versionGuard = versionChecked
    ? ` AND date_trunc('milliseconds', record.updated_at) = date_trunc('milliseconds', ${addParameter(parameters, before.updatedAt)}::timestamptz)`
    : "";
  let updated = before;
  if (entries.length) {
    const result = await client.query(
      `UPDATE ${definition.table} record SET ${[...assignments, ...updateStamps(resource, userParameter ? `$${userParameter}` : null)].join(", ")} WHERE record.organization_id = $${organizationParameter} AND record.id = $${idParameter}${scope}${versionGuard} RETURNING record.*`,
      parameters,
    );
    if (!result.rows[0]) {
      if (versionChecked) {
        const entityLabel =
          resource === "opportunities" ? "Opportunity" : GENERIC_VERSIONED_RESOURCES[resource].entityLabel;
        throw new CrmError(
          409,
          `This ${entityLabel} changed after you loaded it. Refresh and try again.`,
          "CRM_STALE_WRITE",
        );
      }
      throw new CrmError(404, "CRM record not found.");
    }
    updated = camelizeRow(result.rows[0]);
    if (resource === "opportunities") await afterOpportunityRowUpdated(client, context, id, input, updated);
  }
  const changedFields = resource === "opportunities" ? opportunityChangedFields(before, updated, Object.keys(input)) : undefined;
  await queueOutboxEvent(
      client,
      context,
      `crm.${resource}.updated`,
      resource,
      id,
      resource === "opportunities"
        ? { before: opportunityOutboxSnapshot(before), after: opportunityOutboxSnapshot(updated), changedFields }
        : { before, after: updated, changedFields },
    );
  return projectCrmRecord(client, context, resource, updated);
}



export async function archiveCrmRecord(
  client,
  context,
  resource,
  id,
  expectations = {},
) {
  // F025: archiving a submission (superseded) or a period (closed) is a
  // forecast lifecycle decision, made by forecast-service.js.
  if (resource === "forecast-submissions" || resource === "forecast-periods")
    throw new CrmError(410, "Use the governed forecast operations (submit, review, period lifecycle).", "CRM_FORECAST_API_MOVED");
  if (resource === "stages")
    throw new CrmError(
      410,
      "Use the governed Sales Stages operations.",
      "CRM_SALES_STAGE_API_MOVED",
    );
  if (resource === "sources")
    throw new CrmError(
      410,
      "Use the governed Lead Source operations.",
      "CRM_LEAD_SOURCE_API_MOVED",
    );
  if (resource === "leads")
    throw new CrmError(410, "Use the Lead operations.", "CRM_LEAD_API_MOVED");
  const definition = definitionFor(resource);
  const before = await getCrmRecord(client, context, resource, id);
  if (resource === "opportunities")
    assertRecordExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
      "Opportunity",
      "CRM_OPPORTUNITY",
    );
  // Qualification criteria is deliberately excluded here (GENERIC_VERSIONED_
  // RESOURCES covers updateCrmRecord above) — it has no archive/DELETE
  // transition (see archiveStatuses below), so only lost-reasons applies.
  if (resource === "lost-reasons")
    assertRecordExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
      GENERIC_VERSIONED_RESOURCES["lost-reasons"].entityLabel,
      GENERIC_VERSIONED_RESOURCES["lost-reasons"].codePrefix,
    );
  if (resource === "activities" && before.activityType === "call")
    throw new CrmError(410, "Use the governed Calls operations.", "CRM_CALL_API_MOVED");
  if (resource === "activities" && before.activityType === "meeting")
    throw new CrmError(410, "Use the governed Meetings operations.", "CRM_MEETING_API_MOVED");
  if (resource === "activities" && before.activityType === "follow_up")
    throw new CrmError(410, "Use the governed Follow-ups operations.", "CRM_FOLLOW_UP_API_MOVED");
  // Tasks are redirected too — otherwise DELETE /api/crm/activities/[taskId]
  // would run the generic archive path instead of the governed
  // cancelCrmTask transition.
  if (resource === "activities" && before.activityType === "task")
    throw new CrmError(410, "Use the governed Tasks operations.", "CRM_TASK_API_MOVED");
  const parameters = [context.organizationId, id];
  const scope = recordScope(definition, context, parameters);

  if (resource === "opportunities" && before.status === "archived") return before;

  if (
    resource === "consent-events" ||
    resource === "communications" ||
    resource === "playbook-responses" ||
    resource === "data-quality-scores" ||
    resource === "pipeline-inspections" ||
    resource === "ai-feedback"
  ) {
    throw new CrmError(
      409,
      "This CRM record is immutable and cannot be deleted.",
      "CRM_RECORD_IMMUTABLE",
    );
  }
  if (resource === "privacy-requests" && before.status === "completed") {
    throw new CrmError(
      409,
      "Completed privacy requests cannot be archived.",
      "CRM_PRIVACY_REQUEST_CLOSED",
    );
  }

  const archiveStatuses = {
    opportunities: "archived",
    activities: "cancelled",
    campaigns: "cancelled",
    pipelines: "inactive",
    stages: "inactive",
    sources: "inactive",
    "lost-reasons": "inactive",
    tags: "inactive",
    sequences: "archived",
    "sequence-enrollments": "cancelled",
    "automation-rules": "inactive",
    "capture-forms": "inactive",
    competitors: "inactive",
    integrations: "disabled",
    "sales-teams": "inactive",
    "sales-team-members": "inactive",
    territories: "archived",
    "quota-plans": "cancelled",
    "forecast-periods": "closed",
    "forecast-submissions": "superseded",
    "account-plans": "archived",
    "account-stakeholders": "inactive",
    playbooks: "archived",
    "playbook-questions": "inactive",
    "privacy-requests": "cancelled",
    "engagement-templates": "archived",
    "meeting-links": "archived",
    "sync-accounts": "disabled",
    conversations: "archived",
    "conversation-insights": "superseded",
    "deal-risks": "dismissed",
    recommendations: "expired",
    "buying-committees": "archived",
    "buying-committee-members": "inactive",
    "relationship-edges": "inactive",
    "account-signals": "dismissed",
    "partner-accounts": "archived",
    "partner-deals": "cancelled",
    "custom-object-definitions": "archived",
    "custom-field-definitions": "archived",
    "custom-records": "archived",
    "field-visits": "cancelled",
    "ai-predictions": "expired",
  };
  const status = archiveStatuses[resource];
  if (!definition.statusColumn || !status) {
    throw new CrmError(
      409,
      "This CRM resource has no supported archive transition.",
      "CRM_ARCHIVE_UNSUPPORTED",
    );
  }

  const statusParameter = addParameter(parameters, status);
  const userParameter = auditColumns(resource).updatedBy
    ? addParameter(parameters, context.userId)
    : null;
  // Derive the archive-path version check from the same
  // GENERIC_VERSIONED_RESOURCES map as the PATCH path above, rather than a
  // second hand-maintained resource list — a resource added to that map for
  // edit-concurrency protection now also gets it on archive, with no risk of
  // the two lists drifting apart.
  const archiveVersionChecked =
    (resource === "opportunities" || Boolean(GENERIC_VERSIONED_RESOURCES[resource])) &&
    Boolean(expectations.expectedUpdatedAt);
  // Same millisecond-truncation rule as the PATCH versionGuard above:
  // `before.updatedAt` can only ever carry millisecond precision (it
  // came back through pg's default Date parser), while the stored
  // `updated_at` is a full-microsecond-precision timestamptz — an untruncated
  // `=` here would reject almost every archive as a false CRM_STALE_WRITE
  // even with zero real concurrent writes.
  const archiveVersionGuard = archiveVersionChecked
    ? ` AND date_trunc('milliseconds', record.updated_at) = date_trunc('milliseconds', ${addParameter(parameters, before.updatedAt)}::timestamptz)`
    : "";
  // Opportunities: the status write is allowed only inside the governed
  // lifecycle-transition flag (see withOpportunityArchiveTransition).
  const archive = () =>
    client.query(
      `UPDATE ${definition.table} record SET ${[`${definition.statusColumn} = ${statusParameter}`, ...updateStamps(resource, userParameter)].join(", ")} WHERE record.organization_id = $1 AND record.id = $2${scope}${archiveVersionGuard} RETURNING record.*`,
      parameters,
    );
  const result =
    resource === "opportunities" ? await withOpportunityArchiveTransition(client, archive) : await archive();
  if (!result.rows[0]) {
    if (archiveVersionChecked)
      throw new CrmError(
        409,
        `This ${resource === "opportunities" ? "Opportunity" : GENERIC_VERSIONED_RESOURCES[resource].entityLabel} changed after you loaded it. Refresh and try again.`,
        "CRM_STALE_WRITE",
      );
    throw new CrmError(404, "CRM record not found.");
  }
  const record = camelizeRow(result.rows[0]);
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.archived`,
    resource,
    id,
    resource === "opportunities" ? opportunityOutboxSnapshot(record) : record,
  );
  return record;
}

// Compatibility: runCrmAutomation lives in automation/automation-engine.js;
// crm/index.js and existing importers still take it from this file.
export { runCrmAutomation };

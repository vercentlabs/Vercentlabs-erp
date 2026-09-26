import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertNoQualificationMutation } from "../lead-lifecycle-qualification-and-prioritization/lead-qualification.js";
import { ensureDefaultLeadStages } from "../lead-lifecycle-qualification-and-prioritization/lifecycle/stage-catalog.js";
import { normalizeLeadRecordInput, validateLeadRecord } from "../lead-lifecycle-qualification-and-prioritization/lead-record-validation.js";
import { normalizeOpportunityRecordInput, opportunityChangedFields, validateOpportunityRecord } from "../opportunity-and-pipeline-governance/opportunity-record-validation.js";
import { ensurePrimaryContactRoleFromLegacyField } from "../opportunity-and-pipeline-governance/opportunity-contacts.js";
import { assertLeadDuplicatePolicy, hasLeadDuplicateIdentityChange, recordLeadDuplicateOverride } from "../prospect-and-relationship-master-data/lead-duplicates.js";
import { assertEligibleLeadAssignee, resolveLeadAssignment } from "../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { recalculateLeadScoreInternal } from "../lead-lifecycle-qualification-and-prioritization/scoring/scoring-engine.js";
import { projectLeadForContext } from "../lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { CrmError } from "./errors.js";
import { assignLeadOwner, recordLeadAssignment } from "../lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
import { criteriaMatches } from "../crm-conversion-and-sales-handoff/lead-conversion.js";
import { opportunityOutboxSnapshot, resolveOpportunityInitialStage, throwOpportunityValidation, validateOpportunityRelationships } from "../opportunity-and-pipeline-governance/opportunity-validation.js";
import { leadOutboxChangedFields, queueOutboxEvent } from "./outbox.js";
import { assertGenericLeadLinkedTarget, assertLeadLinkedContentAllowed, assertLifecycleUpdate, assertOwnerAssignmentAllowed, assertSensitiveLeadMutationAllowed, assertWritableScope, canViewAllCrmRecords, projectCrmRecord, recordScope } from "./record-policy.js";
import { getCrmRecord, nextCode } from "./resource-query-service.js";
import { definitionFor } from "./resource-registry.js";
import { addParameter, assertLeadSourceAssignment, camelizeRow } from "./record-utils.js";
import { GENERIC_VERSIONED_RESOURCES, assertActiveOrganizationUsers, assertCustomFieldRequiredRolloutSafe, assertLeadExpectedVersion, assertQualificationCriterionFieldsValid, assertRecordExpectedVersion, getLeadRecordForUpdate, isPlainObject, mutableEntries, normalizeStorageInput, validateCustomRecord, validateOrganizationUserReferences, validationErrorDetails } from "./resource-validation.js";



// F027: fields whose change can plausibly affect the deterministic score
// (they appear in the seeded demographic/firmographic rule predicates, or
// are the qualifying "source change" trigger the dossier calls out).
// Recalculation on update is scoped to these — not every field save —
// per Prompt 4 §44's "avoid recalculating synchronously on unrelated
// updates".
const LEAD_SCORE_RECALC_TRIGGER_FIELDS = new Set([
  "email",
  "mobile",
  "companyName",
  "productInterest",
  "sourceId",
]);

// F025 Stage A2 §11 — "locked/closed period behavior" was a genuine gap:
// nothing cross-referenced a forecast-submission against its own
// tenant.crm_forecast_periods.status, so a submission could be created or
// edited against an already-closed period through the generic path.
// 'frozen' is deliberately still mutable — resource-options.js's own
// period picker already includes 'frozen' alongside 'planned'/'open'
// when offering periods to submit against, an established convention
// this reuses rather than inventing a stricter interpretation.
async function assertForecastPeriodMutable(client, context, periodId) {
  const result = await client.query(
    `SELECT status FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, periodId],
  );
  if (result.rows[0]?.status === "closed")
    throw new CrmError(
      409,
      "This forecast period is closed and can no longer be submitted or adjusted.",
      "CRM_FORECAST_PERIOD_CLOSED",
    );
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
    // Checkpoint audit (Prompt 3 continuation): task was not redirected here
    // either — POST /api/crm/activities with {activityType:"task",...} would
    // have inserted a crm_activities row directly, bypassing createCrmTask's
    // own governance (status always 'planned', activityType/status rejected
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
  const duplicateOverrideReason =
    resource === "leads" ? input?.duplicateOverrideReason : undefined;
  if (
    resource === "leads" &&
    Object.prototype.hasOwnProperty.call(input || {}, "duplicateOverrideReason")
  ) {
    input = { ...input };
    delete input.duplicateOverrideReason;
  }
  if (resource === "sources")
    throw new CrmError(
      410,
      "Use the governed Lead Source operations.",
      "CRM_LEAD_SOURCE_API_MOVED",
    );
  if (resource === "forecast-submissions" && input?.periodId)
    await assertForecastPeriodMutable(client, context, input.periodId);
  const definition = definitionFor(resource);
  assertLeadLinkedContentAllowed(context, resource, input);
  if (resource === "leads") {
    assertNoQualificationMutation(input);
    assertSensitiveLeadMutationAllowed(context, input);
    if (
      ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
        (field) => Object.prototype.hasOwnProperty.call(input, field),
      )
    )
      throw new CrmError(
        409,
        "New Leads always begin in the configured initial lifecycle stage.",
        "CRM_LEAD_INITIAL_STAGE_GOVERNED",
      );
  }
  if (resource === "opportunities") {
    if (Object.prototype.hasOwnProperty.call(input || {}, "expectedRevenue"))
      throw new CrmError(
        409,
        "Expected revenue is calculated automatically from amount and probability.",
        "CRM_OPPORTUNITY_EXPECTED_REVENUE_DERIVED",
      );
    for (const field of [
      "status",
      "actualCloseDate",
      "lostReasonId",
      "lossNotes",
      "outcomeReasonId",
      "outcomeNotes",
    ]) {
      if (Object.prototype.hasOwnProperty.call(input || {}, field))
        throw new CrmError(409, "Opportunity lifecycle and outcome fields are governed by CRM actions.", "CRM_OPPORTUNITY_LIFECYCLE_GOVERNED");
    }
  }
  assertWritableScope(definition, context, input);
  await assertOwnerAssignmentAllowed(client, definition, context, input);
  const ownerChangeRequested =
    resource === "leads" &&
    Object.prototype.hasOwnProperty.call(input, "ownerUserId");
  const requestedOwnerUserId = ownerChangeRequested
    ? input.ownerUserId || null
    : undefined;
  const prepared =
    resource === "leads"
      ? normalizeLeadRecordInput(input)
      : resource === "opportunities"
        ? normalizeOpportunityRecordInput(input)
        : normalizeStorageInput(resource, input);
  if (ownerChangeRequested) delete prepared.ownerUserId;
  if (resource === "leads") {
    // F007 protects the immutable `new` code as the one active initial stage;
    // administrators may rename its label but cannot deactivate or replace it.
    prepared.status = "new";
    // F004: original_source_id is fixed at creation and never changes again
    // (see the update-path guard below), so attribution reporting can always
    // answer "what acquired this lead" even after source_id is corrected
    // later. Ignore any caller-supplied value — only what the lead is
    // actually created with counts.
    prepared.originalSourceId = prepared.sourceId ?? null;
    const leadErrors = validateLeadRecord(prepared, { mode: "create" });
    if (leadErrors.length) {
      const first = leadErrors[0];
      throw new CrmError(
        400,
        first.message,
        first.code,
        validationErrorDetails(leadErrors),
      );
    }
    // Pure in-memory validation must fail before any DB access — only
    // reachable here once the input is already known to be well-formed.
    // A truly brand-new organization has no crm_lead_stages rows at all
    // yet (nothing seeds them at organization-creation time — only
    // listLeadStages/getLeadStages ever did, until now) — without this,
    // the very first Lead any such organization ever creates would violate
    // crm_leads_lifecycle_stage_fkey, since no ('org','new') row would
    // exist for it to reference. ensureDefaultLeadStages is idempotent
    // (a no-op once stages already exist), so this is safe to call on
    // every creation, not just the first.
    await ensureDefaultLeadStages(client, context);
    if (Object.prototype.hasOwnProperty.call(prepared, "sourceId"))
      await assertLeadSourceAssignment(client, context, prepared.sourceId);
  }
  if (definition.codeEntity && !prepared[definition.codeField])
    prepared[definition.codeField] = await nextCode(
      client,
      context.organizationId,
      definition.codeEntity,
    );
  if (
    definition.companyScoped &&
    !prepared.companyId &&
    context.activeCompanyId
  )
    prepared.companyId = context.activeCompanyId;
  if (
    definition.companyScoped &&
    !prepared.branchId &&
    context.activeBranchId &&
    definition.fields.branchId
  )
    prepared.branchId = context.activeBranchId;
  if (resource === "custom-field-definitions" && prepared.required === true) {
    await assertCustomFieldRequiredRolloutSafe(
      client,
      context,
      prepared.objectDefinitionId,
      prepared.fieldKey,
      Boolean(input.confirmRequiredRollout),
    );
  }
  if (resource === "qualification-criteria")
    assertQualificationCriterionFieldsValid(prepared);
  await assertGenericLeadLinkedTarget(client, context, resource, prepared);
  let leadDuplicateEvaluation = null;
  if (resource === "leads") {
    // F008 commit-time duplicate protection runs before F005 assignment
    // evaluation so a rejected duplicate cannot consume round-robin state.
    leadDuplicateEvaluation = await assertLeadDuplicatePolicy(
      client,
      context,
      prepared,
      { overrideReason: duplicateOverrideReason, lock: true },
    );
  }
  let initialLeadAssignment = null;
  if (resource === "leads") {
    if (ownerChangeRequested && requestedOwnerUserId) {
      try {
        await assertEligibleLeadAssignee(
          client,
          context,
          requestedOwnerUserId,
          {
            companyId: prepared.companyId || null,
            branchId: prepared.branchId || null,
          },
        );
      } catch (error) {
        if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID")
          throw new CrmError(409, error.message, error.code);
        throw error;
      }
      prepared.ownerUserId = requestedOwnerUserId;
      initialLeadAssignment = {
        ownerUserId: requestedOwnerUserId,
        policyId: null,
        reason: "manual:create",
      };
    } else if (!ownerChangeRequested) {
      initialLeadAssignment = await resolveLeadAssignment(
        client,
        context,
        prepared,
      );
      prepared.ownerUserId = initialLeadAssignment.ownerUserId;
    }
  }
  if (resource === "opportunities") {
    prepared.status = "open";
    prepared.actualCloseDate = null;
    prepared.lostReasonId = null;
    prepared.lossNotes = null;
    prepared.outcomeReasonId = null;
    prepared.outcomeNotes = null;
    // Manual creation is owned by the actor unless an eligible owner was
    // explicitly selected. This avoids accidentally creating a broadly
    // visible unowned Opportunity.
    prepared.ownerUserId ||= context.userId;
    throwOpportunityValidation(validateOpportunityRecord(prepared, { mode: "create" }));
    await resolveOpportunityInitialStage(client, context, prepared);
    await validateOpportunityRelationships(client, context, prepared);
  }
  // F027 Prompt 4: score is no longer set pre-insert by the legacy
  // uncapped/undecayed/unversioned rule engine (System B) — it defaults to
  // 0 via the column default and is computed by the real deterministic
  // scoring engine (System A, recalculateLeadScoreInternal) once the row
  // exists, right below.
  if (resource === "custom-records")
    await validateCustomRecord(client, context, prepared);
  await validateOrganizationUserReferences(
    client,
    context,
    definition,
    prepared,
  );
  const entries = mutableEntries(definition, prepared);
  if (!entries.length && !ownerChangeRequested)
    throw new CrmError(400, "No CRM fields were supplied.");
  const columns = [
    "organization_id",
    ...entries.map(([key]) => definition.fields[key]),
    "created_by",
    "updated_by",
  ];
  const rawValues = [
    context.organizationId,
    ...entries.map(([, value]) => value),
    context.userId,
    context.userId,
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
  let created = camelizeRow(result.rows[0]);
  if (resource === "leads") {
    await recordLeadDuplicateOverride(
      client,
      context,
      created.id,
      leadDuplicateEvaluation,
      "create",
    );
    const scored = await recalculateLeadScoreInternal(client, context, created.id, "Initial lead scoring");
    if (scored)
      created = {
        ...created,
        score: scored.score,
        leadGrade: scored.grade,
        scoreCalculatedAt: scored.calculatedAt,
        scoreExplanation: scored.explanation,
      };
    await runCrmAutomation(
      client,
      context,
      "lead.created",
      "lead",
      created.id,
      created,
    );
  }
  if (resource === "opportunities") {
    await client.query(
      `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, to_stage_id, probability, changed_by, note) VALUES ($1, $2, $3, $4, $5, 'Opportunity created')`,
      [
        context.organizationId,
        created.id,
        created.stageId,
        created.probability,
        context.userId,
      ],
    );
    // F003 gap-closure: keep tenant.crm_opportunity_contact_roles in sync
    // with the classic single contactId field regardless of entry point —
    // see ensurePrimaryContactRoleFromLegacyField's own comment.
    if (created.contactId) {
      await ensurePrimaryContactRoleFromLegacyField(client, context, created.id, created.contactId);
    }
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
  if (resource === "leads" && created.ownerUserId)
    await recordLeadAssignment(client, context, {
      leadId: created.id,
      previousOwnerUserId: null,
      ownerUserId: created.ownerUserId,
      policyId: initialLeadAssignment?.policyId || null,
      reason: initialLeadAssignment?.reason || "manual:create",
      evaluationTrace: initialLeadAssignment?.trace || null,
      leadName: created.fullName || created.firstName || null,
    });
  return projectCrmRecord(client, context, resource, created);
}

// Turns a manual consent-checkbox toggle on the Lead edit form into a
// permanent tenant.crm_consent_events row per changed channel, instead of
// leaving consent as a mutable boolean with no evidence trail — the same
// gap Zoho's GDPR Compliance module closes with its "Data Processing
// Basis" log. doNotContact is recorded on the "all" channel since it
// suppresses every channel at once. record-policy.js already makes
// consent-events create-only/immutable once written.
const CONSENT_CHANNEL_FIELDS = Object.freeze({
  consentEmail: "email",
  consentSms: "sms",
  consentWhatsapp: "whatsapp",
});
async function logLeadConsentChanges(client, context, leadId, before, after) {
  const events = [];
  for (const [field, channel] of Object.entries(CONSENT_CHANNEL_FIELDS)) {
    if (before[field] !== after[field] && after[field] !== undefined)
      events.push({ channel, action: after[field] ? "granted" : "withdrawn" });
  }
  if (before.doNotContact !== after.doNotContact && after.doNotContact !== undefined)
    events.push({ channel: "all", action: after.doNotContact ? "suppressed" : "resubscribed" });
  for (const event of events)
    await client.query(
      `INSERT INTO tenant.crm_consent_events(organization_id,company_id,lead_id,channel,purpose,action,lawful_basis,source,evidence,created_by)
       VALUES($1,$2,$3,$4,'sales',$5,'consent','manual',$6::jsonb,$7)`,
      [
        context.organizationId,
        after.companyId || null,
        leadId,
        event.channel,
        event.action,
        JSON.stringify({ changedVia: "lead_edit_form" }),
        context.userId,
      ],
    );
}

export async function updateCrmRecord(
  client,
  context,
  resource,
  id,
  input,
  expectations = {},
) {
  if (resource === "stages")
    throw new CrmError(
      410,
      "Use the governed Sales Stages operations.",
      "CRM_SALES_STAGE_API_MOVED",
    );
  const duplicateOverrideReason =
    resource === "leads" ? input?.duplicateOverrideReason : undefined;
  if (
    resource === "leads" &&
    Object.prototype.hasOwnProperty.call(input || {}, "duplicateOverrideReason")
  ) {
    input = { ...input };
    delete input.duplicateOverrideReason;
  }
  if (resource === "sources")
    throw new CrmError(
      410,
      "Use the governed Lead Source operations.",
      "CRM_LEAD_SOURCE_API_MOVED",
    );
  const definition = definitionFor(resource);
  if (resource === "leads") {
    assertNoQualificationMutation(input);
    assertSensitiveLeadMutationAllowed(context, input);
  }
  const before =
    resource === "leads"
      ? await getLeadRecordForUpdate(client, context, id)
      : await getCrmRecord(client, context, resource, id);
  if (resource === "forecast-submissions" && before.periodId)
    await assertForecastPeriodMutable(client, context, before.periodId);
  assertLeadLinkedContentAllowed(context, resource, input, before);
  if (resource === "leads")
    assertLeadExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
    );
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
    // Checkpoint audit (Prompt 3 continuation): Tasks (activity_type='task')
    // were the one activity kind NOT redirected here, even though
    // task-operations.js is exactly as governed as Calls/Meetings/Follow-ups
    // (claim-conflict handling, dependency-blocked completion, terminal-state
    // read-only enforcement, recurrence generation) — a caller could PATCH
    // /api/crm/activities/[taskId] with {status:"completed"} directly through
    // this generic path and skip every one of those checks. Same fix shape
    // as the other three activity kinds.
    if (before.activityType === "task" || requestedActivityType === "task")
      throw new CrmError(410, "Use the governed Tasks operations.", "CRM_TASK_API_MOVED");
  }
  if (resource === "opportunities" && before.status === "archived")
    throw new CrmError(409, "Archived Opportunities are read-only.", "CRM_OPPORTUNITY_ARCHIVED");
  if (resource === "opportunities" && Object.prototype.hasOwnProperty.call(input || {}, "ownerUserId") && !input.ownerUserId && !canViewAllCrmRecords(context))
    throw new CrmError(403, "You do not have permission to leave this Opportunity unassigned.", "CRM_OPPORTUNITY_OWNER_REQUIRED");
  // Checkpoint audit (Prompt 3 continuation): initially suspected Opportunities
  // had no guard against stageId/status/probability/outcome fields being
  // forged through this generic path. FALSE ALARM — record-policy.js's
  // assertWritableScope already blocks the full controlled-field set
  // (pipelineId/stageId/probability/forecastCategory/status/actualCloseDate/
  // lostReasonId/lossNotes/outcomeReasonId/outcomeNotes) further down this
  // same call chain, and crm-opportunities-f009.test.mjs already covers it
  // ("outcome and stage-owned fields cannot be forged through generic
  // PATCH"). Do not re-add a redundant/conflicting guard here — this was
  // caught by re-running that test after an incorrect first attempt.
  if (
    resource === "leads" &&
    ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
      (field) => Object.prototype.hasOwnProperty.call(input, field),
    )
  )
    throw new CrmError(
      409,
      "Use the governed Lead lifecycle transition action.",
      "CRM_LEAD_STAGE_ACTION_REQUIRED",
    );
  if (
    resource === "leads" &&
    Object.prototype.hasOwnProperty.call(input, "originalSourceId")
  )
    throw new CrmError(
      409,
      "Original source is fixed at creation and cannot be edited.",
      "CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE",
    );
  assertWritableScope(definition, context, input);
  await assertOwnerAssignmentAllowed(client, definition, context, input);
  const ownerChangeRequested =
    resource === "leads" &&
    Object.prototype.hasOwnProperty.call(input, "ownerUserId");
  const requestedOwnerUserId = ownerChangeRequested
    ? input.ownerUserId || null
    : undefined;
  if (
    resource === "opportunities" &&
    Object.prototype.hasOwnProperty.call(input || {}, "expectedRevenue")
  )
    throw new CrmError(
      409,
      "Expected revenue is calculated automatically from amount and probability.",
      "CRM_OPPORTUNITY_EXPECTED_REVENUE_DERIVED",
    );
  assertLifecycleUpdate(resource, before, input, context);
  const prepared =
    resource === "leads"
      ? normalizeLeadRecordInput(input)
      : resource === "opportunities"
        ? normalizeOpportunityRecordInput(input)
        : normalizeStorageInput(resource, input);
  if (ownerChangeRequested) delete prepared.ownerUserId;
  let leadDuplicateEvaluation = null;
  let leadScoreRecalcNeeded = false;
  if (resource === "leads") {
    const leadErrors = validateLeadRecord(prepared, {
      mode: "update",
      existing: before,
    });
    if (leadErrors.length) {
      const first = leadErrors[0];
      throw new CrmError(
        400,
        first.message,
        first.code,
        validationErrorDetails(leadErrors),
      );
    }
    if (Object.prototype.hasOwnProperty.call(prepared, "sourceId"))
      await assertLeadSourceAssignment(client, context, prepared.sourceId, {
        allowUnchangedInactive: true,
        currentSourceId: before.sourceId,
      });
    if (hasLeadDuplicateIdentityChange(prepared)) {
      leadDuplicateEvaluation = await assertLeadDuplicatePolicy(
        client,
        context,
        { ...before, ...prepared },
        {
          excludeLeadId: id,
          overrideReason: duplicateOverrideReason,
          lock: true,
        },
      );
    }
    // F027 Prompt 4: score is no longer overwritten unconditionally by the
    // legacy uncapped/undecayed/unversioned rule engine on every field
    // save. The real deterministic scoring engine (System A) recalculates
    // — after this UPDATE commits, so it reads the merged final values —
    // only when a scoring-relevant field actually changed (create,
    // qualifying-field change, source change), not on every unrelated
    // edit (§44: "avoid recalculating synchronously on unrelated updates").
    leadScoreRecalcNeeded = Object.keys(prepared).some((field) => LEAD_SCORE_RECALC_TRIGGER_FIELDS.has(field));
  }
  if (resource === "opportunities") {
    // before.expectedCloseDate comes straight from getCrmRecord, which
    // never stringifies DATE columns — node-postgres returns them as real
    // Date instances. Every update merges before+prepared into one
    // candidate for revalidation (even one that never touches this field),
    // so without this normalization, validateOpportunityRecord's strict
    // YYYY-MM-DD regex check rejected a Date instance on literally every
    // update to an Opportunity that already had a close date set — the
    // same class of bug already fixed on the client side for DateInput
    // (apps/web/.../DateTimeInput.tsx), now closed at the server boundary too.
    const normalizedBefore = before.expectedCloseDate instanceof Date
      ? { ...before, expectedCloseDate: before.expectedCloseDate.toISOString().slice(0, 10) }
      : before;
    const candidate = { ...normalizedBefore, ...prepared };
    throwOpportunityValidation(validateOpportunityRecord(candidate, { mode: "update" }));
    const relationshipFields = new Set(["companyId", "branchId", "leadId", "partyId", "contactId", "ownerUserId"]);
    if (Object.keys(prepared).some((field) => relationshipFields.has(field)))
      await validateOpportunityRelationships(client, context, prepared, before);
  }
  if (resource === "custom-records") {
    const callerSuppliedData = Object.prototype.hasOwnProperty.call(prepared, "data");
    prepared.objectDefinitionId ??= before.objectDefinitionId;
    prepared.companyId ??= before.companyId;
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
  if (resource === "qualification-criteria")
    assertQualificationCriterionFieldsValid(prepared);
  if (
    resource === "territories" &&
    Object.prototype.hasOwnProperty.call(prepared, "parentTerritoryId") &&
    prepared.parentTerritoryId
  ) {
    // F020 CAP-001: mirrors setAccountParent's cycle guard (account-intelligence.js)
    // — the same self-parent/ancestor-cycle problem, solved the same way, for
    // territory hierarchy. Previously unguarded: any parent could be assigned,
    // including one that would make the territory its own ancestor.
    if (prepared.parentTerritoryId === id)
      throw new CrmError(
        409,
        "A territory cannot be its own parent.",
        "CRM_TERRITORY_HIERARCHY_SELF_PARENT",
      );
    const cycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT territory.id, territory.parent_territory_id
           FROM tenant.crm_territories territory
          WHERE territory.organization_id=$1 AND territory.id=$2
         UNION ALL
         SELECT parent.id, parent.parent_territory_id
           FROM tenant.crm_territories parent
           JOIN ancestors child ON child.parent_territory_id=parent.id
          WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, prepared.parentTerritoryId, id],
    );
    if (cycle.rows[0])
      throw new CrmError(
        409,
        "The selected parent would create a territory hierarchy cycle.",
        "CRM_TERRITORY_HIERARCHY_CYCLE",
      );
  }
  if (
    resource === "sales-teams" &&
    Object.prototype.hasOwnProperty.call(prepared, "parentTeamId") &&
    prepared.parentTeamId
  ) {
    // F020 Tranche D (Stage A): same self-parent/ancestor-cycle guard as
    // territories immediately above, for sales-team hierarchy. Previously
    // unguarded — any parent team could be assigned, including one that
    // would make the team its own ancestor.
    if (prepared.parentTeamId === id)
      throw new CrmError(
        409,
        "A sales team cannot be its own parent.",
        "CRM_SALES_TEAM_HIERARCHY_SELF_PARENT",
      );
    const teamCycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT team.id, team.parent_team_id
           FROM tenant.crm_sales_teams team
          WHERE team.organization_id=$1 AND team.id=$2
         UNION ALL
         SELECT parent.id, parent.parent_team_id
           FROM tenant.crm_sales_teams parent
           JOIN ancestors child ON child.parent_team_id=parent.id
          WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, prepared.parentTeamId, id],
    );
    if (teamCycle.rows[0])
      throw new CrmError(
        409,
        "The selected parent would create a sales-team hierarchy cycle.",
        "CRM_SALES_TEAM_HIERARCHY_CYCLE",
      );
  }
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
  if (!entries.length && !ownerChangeRequested)
    throw new CrmError(400, "No CRM fields were supplied.");
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([key], index) => `${definition.fields[key]} = $${index + 1}`,
  );
  parameters.push(context.userId, context.organizationId, id);
  const userParameter = entries.length + 1;
  const organizationParameter = entries.length + 2;
  const idParameter = entries.length + 3;
  const scope = recordScope(definition, context, parameters);
  // Checked-write: when a version was actually asserted above (leads or
  // opportunities), the UPDATE's own WHERE clause re-confirms updated_at
  // still matches — closing the read-then-write race window atomically. A
  // zero-row result then unambiguously means a concurrent writer won that
  // race (existence was already confirmed by the `before` read), not a
  // genuine 404.
  const versionChecked =
    expectations.expectedUpdatedAt &&
    (resource === "leads" || resource === "opportunities" || Boolean(GENERIC_VERSIONED_RESOURCES[resource]));
  // Real bug found and root-caused while building the UI 2.0 Lead Edit
  // form's optimistic-concurrency handling (not assumed -- confirmed by
  // instrumenting this exact query): `crm_leads.updated_at` is `timestamptz`
  // with genuine microsecond precision (e.g. `.700902`), but `before`
  // (read moments earlier via getLeadRecordForUpdate/camelizeRow) comes
  // back from `pg`'s default type parser as a JS `Date`, which can only
  // hold millisecond precision (`.700000`) -- so re-binding that
  // ALREADY-TRUNCATED value for an exact `=` comparison against the
  // full-precision stored value fails almost every time, even with zero
  // real concurrent writes, because no API response can ever hand a
  // client more than millisecond precision to begin with (JSON/ISO-8601
  // via JS Date). This made every checked write on leads/opportunities/
  // the generic versioned resources (this same shared function) fail with
  // a false CRM_STALE_WRITE close to 100% of the time. Compares at
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
      `UPDATE ${definition.table} record SET ${assignments.join(", ")}, updated_by = $${userParameter}, updated_at = now() WHERE record.organization_id = $${organizationParameter} AND record.id = $${idParameter}${scope}${versionGuard} RETURNING record.*`,
      parameters,
    );
    if (!result.rows[0]) {
      if (versionChecked) {
        const entityLabel =
          resource === "leads"
            ? "Lead"
            : resource === "opportunities"
              ? "Opportunity"
              : GENERIC_VERSIONED_RESOURCES[resource].entityLabel;
        throw new CrmError(
          409,
          `This ${entityLabel} changed after you loaded it. Refresh and try again.`,
          "CRM_STALE_WRITE",
        );
      }
      throw new CrmError(404, "CRM record not found.");
    }
    updated = camelizeRow(result.rows[0]);
    if (resource === "leads") await logLeadConsentChanges(client, context, id, before, updated);
    if (resource === "opportunities" && Object.prototype.hasOwnProperty.call(input, "contactId")) {
      await ensurePrimaryContactRoleFromLegacyField(client, context, id, updated.contactId);
    }
  }
  if (ownerChangeRequested) {
    const assignment = await assignLeadOwner(
      client,
      context,
      id,
      requestedOwnerUserId,
      { reason: "manual:patch" },
    );
    updated = assignment.lead;
  }
  if (resource === "leads" && leadDuplicateEvaluation?.overrideReason) {
    await recordLeadDuplicateOverride(
      client,
      context,
      id,
      leadDuplicateEvaluation,
      "update",
    );
  }
  if (resource === "leads" && leadScoreRecalcNeeded) {
    const scored = await recalculateLeadScoreInternal(client, context, id, "Lead fields updated");
    if (scored)
      updated = {
        ...updated,
        score: scored.score,
        leadGrade: scored.grade,
        scoreCalculatedAt: scored.calculatedAt,
        scoreExplanation: scored.explanation,
      };
  }
  const changedFields =
    resource === "leads"
      ? leadOutboxChangedFields(before, updated, Object.keys(input)).filter(
          (field) => field !== "ownerUserId",
        )
      : resource === "opportunities"
        ? opportunityChangedFields(before, updated, Object.keys(input))
        : undefined;
  if (resource !== "leads" || changedFields.length)
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
  if (resource === "leads" && changedFields.length)
    await runCrmAutomation(client, context, "lead.updated", "lead", id, updated);
  return projectCrmRecord(client, context, resource, updated);
}



export async function archiveCrmRecord(
  client,
  context,
  resource,
  id,
  expectations = {},
) {
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
  const definition = definitionFor(resource);
  const before =
    resource === "leads"
      ? await getLeadRecordForUpdate(client, context, id)
      : await getCrmRecord(client, context, resource, id);
  if (resource === "leads")
    assertLeadExpectedVersion(
      before,
      expectations.expectedUpdatedAt,
      expectations.requireVersion === true,
    );
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
  // Checkpoint audit (Prompt 3 continuation): task was not redirected here
  // either — DELETE /api/crm/activities/[taskId] would have run the generic
  // archive path instead of the governed cancelCrmTask transition.
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

  if (resource === "leads") {
    if (before.recordStatus === "archived")
      return projectLeadForContext(context, before);
    if (before.recordStatus === "converted")
      throw new CrmError(409, "Converted Leads cannot be archived.", "CRM_LEAD_RECORD_CLOSED");
    const userParameter = addParameter(parameters, context.userId);
    const result = await client.query(
      `UPDATE tenant.crm_leads record SET record_status='archived',updated_by=${userParameter},updated_at=now()
       WHERE record.organization_id=$1 AND record.id=$2${scope} RETURNING record.*`,
      parameters,
    );
    if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
    const record = camelizeRow(result.rows[0]);
    await queueOutboxEvent(client, context, "crm.leads.archived", "leads", id, record);
    return projectLeadForContext(context, record);
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
    "scoring-rules": "inactive",
    "assignment-rules": "inactive",
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
    "report-definitions": "archived",
    dashboards: "archived",
    "dashboard-widgets": "inactive",
    "custom-object-definitions": "archived",
    "custom-field-definitions": "archived",
    "custom-records": "archived",
    "field-visits": "cancelled",
    "enrichment-jobs": "cancelled",
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
  const userParameter = addParameter(parameters, context.userId);
  // Stage A2 §14: derive the archive-path version check from the same
  // GENERIC_VERSIONED_RESOURCES map as the PATCH path above, rather than a
  // second hand-maintained resource list — a resource added to that map for
  // edit-concurrency protection now also gets it on archive, with no risk of
  // the two lists drifting apart.
  const archiveVersionChecked =
    (resource === "opportunities" || Boolean(GENERIC_VERSIONED_RESOURCES[resource])) &&
    Boolean(expectations.expectedUpdatedAt);
  // Same millisecond-truncation fix as the PATCH versionGuard above (line
  // ~701): `before.updatedAt` can only ever carry millisecond precision (it
  // came back through pg's default Date parser), while the stored
  // `updated_at` is a full-microsecond-precision timestamptz — an untruncated
  // `=` here would reject almost every archive as a false CRM_STALE_WRITE
  // even with zero real concurrent writes. Widening this path (Stage A2
  // §14) to many more resources made this latent bug reachable far more
  // often, so it is fixed here rather than shipped forward.
  const archiveVersionGuard = archiveVersionChecked
    ? ` AND date_trunc('milliseconds', record.updated_at) = date_trunc('milliseconds', ${addParameter(parameters, before.updatedAt)}::timestamptz)`
    : "";
  // Opportunities specifically: this UPDATE touches `status`, one of the
  // columns tenant.crm_opportunity_lifecycle_write_guard (migration 098)
  // watches, and that trigger only allows the change while the governed
  // session flag reads 'allowed'. Discovered live (not theoretical): a
  // pooled connection that had ever run a real stage/probability
  // transition left the flag at '' (node-postgres never resets custom GUCs
  // on client.release()), so archiving an Opportunity would then fail with
  // "Use the governed Opportunity stage/probability service" — while a
  // connection that had never touched the flag (current_setting(...,true)
  // returns NULL there, and `NULL <> 'allowed'` is NULL, which PL/pgSQL's
  // IF treats as false) let it through. Same set-then-reset pattern
  // moveOpportunityStage/updateOpportunityProbability/restoreOpportunity
  // already use, so archiving behaves consistently regardless of which
  // pooled connection happens to service the request.
  if (resource === "opportunities")
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','allowed',true)");
  let result;
  try {
    result = await client.query(
      `UPDATE ${definition.table} record SET ${definition.statusColumn} = ${statusParameter}, updated_by = ${userParameter}, updated_at = now() WHERE record.organization_id = $1 AND record.id = $2${scope}${archiveVersionGuard} RETURNING record.*`,
      parameters,
    );
  } finally {
    if (resource === "opportunities")
      await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','',true)");
  }
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



// Automation entity type → CRM web route segment.
const CRM_NOTIFICATION_ROUTE = Object.freeze({ lead: "leads", opportunity: "opportunities", party: "accounts", contact: "contacts", campaign: "campaigns", activity: "activities" });

export async function runCrmAutomation(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  const rules = await client.query(
    `SELECT * FROM tenant.crm_automation_rules WHERE organization_id = $1 AND event_type = $2 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId, eventType],
  );
  const results = [];
  for (const rule of rules.rows) {
    if (!criteriaMatches(payload, rule.conditions)) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const output = [];
    await client.query("SAVEPOINT crm_automation_rule");
    try {
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (action.type === "create_activity") {
          const created = await createCrmRecord(client, context, "activities", {
            entityType,
            entityId,
            activityType: action.activityType || "task",
            subject:
              action.subject ||
              `Follow up: ${payload.name || payload.fullName || entityType}`,
            description: action.description || null,
            assignedTo:
              action.assignedTo || payload.ownerUserId || context.userId,
            dueAt: new Date(
              Date.now() + Number(action.delayMinutes || 0) * 60000,
            ).toISOString(),
          });
          output.push({ action: action.type, id: created.id });
        }
        if (action.type === "notification" && action.userId) {
          await assertActiveOrganizationUsers(client, context, [action.userId]);
          await createNotification(client, {
            organizationId: context.organizationId,
            userId: action.userId,
            category: "crm_automation",
            title: action.title || "CRM automation",
            message: action.message || "A CRM automation rule ran.",
            // Always the triggering record's real route, so the link works and
            // notification redaction (notification-visibility.js) can
            // re-check access to it; a free-form href is not accepted.
            href: `/crm/${CRM_NOTIFICATION_ROUTE[entityType] ?? `${entityType}s`}/${entityId}`,
            entityType: `crm_${entityType}`,
            entityId,
          });
          output.push({ action: action.type });
        }
        if (action.type === "update_record" && isPlainObject(action.fields)) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot update ${entityType} records.`,
            );
          await updateCrmRecord(
            client,
            context,
            targetResource,
            entityId,
            action.fields,
          );
          output.push({ action: action.type, resource: targetResource });
        }
        if (action.type === "assign_owner" && action.userId) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          const ownerField =
            targetResource === "activities" ? "assignedTo" : "ownerUserId";
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot assign ${entityType} records.`,
            );
          const membership = await client.query(
            `SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
            [context.organizationId, action.userId],
          );
          if (!membership.rows[0])
            throw new CrmError(
              409,
              "Automation owner must be an active organization member.",
            );
          await updateCrmRecord(client, context, targetResource, entityId, {
            [ownerField]: action.userId,
          });
          output.push({ action: action.type, userId: action.userId });
        }
        if (action.type === "enroll_sequence" && action.sequenceId) {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot enroll ${entityType} in a sequence.`,
            );
          const enrollment = await createCrmRecord(
            client,
            context,
            "sequence-enrollments",
            {
              sequenceId: action.sequenceId,
              [targetField]: entityId,
              currentStep: 0,
              nextRunAt: new Date(
                Date.now() + Number(action.delayMinutes || 0) * 60000,
              ).toISOString(),
              status: "active",
              enrolledBy: context.userId,
            },
          );
          output.push({ action: action.type, id: enrollment.id });
        }
        if (action.type === "create_recommendation" && action.title) {
          const recommendation = await createCrmRecord(
            client,
            context,
            "recommendations",
            {
              companyId: payload.companyId || context.activeCompanyId,
              entityType,
              entityId,
              recommendationType:
                action.recommendationType || "next_best_action",
              title: action.title,
              rationale:
                action.rationale || "Created by a governed CRM automation.",
              actionPayload: action.actionPayload || {},
              priority: action.priority || "medium",
              confidence: action.confidence ?? null,
              source: "rules",
              dueAt: action.dueAt || null,
              status: "open",
            },
          );
          output.push({ action: action.type, id: recommendation.id });
        }
        if (action.type === "queue_communication") {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : entityType === "party"
                    ? "partyId"
                    : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot communicate with ${entityType}.`,
            );
          const communication = await createCrmRecord(
            client,
            context,
            "communications",
            {
              channel: action.channel || "email",
              direction: "outbound",
              [targetField]: entityId,
              provider: action.provider || "outbox",
              subject: action.subject || null,
              body: action.body || "",
              fromAddress: action.fromAddress || null,
              toAddresses: Array.isArray(action.toAddresses)
                ? action.toAddresses
                : [],
              status: "queued",
              occurredAt: new Date().toISOString(),
              metadata: { automationRuleId: rule.id },
            },
          );
          output.push({ action: action.type, id: communication.id });
        }
        if (action.type === "emit_event" && action.eventType) {
          await queueOutboxEvent(
            client,
            context,
            action.eventType,
            entityType,
            entityId,
            isPlainObject(action.payload) ? action.payload : payload,
          );
          output.push({ action: action.type, eventType: action.eventType });
        }
      }
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, result, finished_at) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          output,
        ],
      );
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      results.push({ ruleId: rule.id, status: "succeeded", output });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_automation_rule");
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, error_message, finished_at) VALUES ($1, $2, $3, $4, $5, 'failed', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          String(error?.message || error),
        ],
      );
      results.push({ ruleId: rule.id, status: "failed" });
    }
  }
  return results;
}

// Lead rules applied when a Lead goes through the generic CRM record commands
// (createCrmRecord / updateCrmRecord / archiveCrmRecord in
// data-management/resource-mutation-service.js). Each function is one step
// that coordinator calls at a fixed point in the mutation; the order matters
// (for example F008 duplicate checks run before F005 assignment so a rejected
// duplicate never consumes round-robin state).
//
// These functions coordinate the existing Lead services (validation, sources,
// duplicates, governance/assignment, qualification, scoring, lifecycle); they
// do not re-implement them. Lifecycle stage moves stay in lifecycle/.
import { CrmError } from "../data-management/errors.js";
import { leadOutboxChangedFields, queueOutboxEvent } from "../data-management/outbox.js";
import { assertSensitiveLeadMutationAllowed } from "../data-management/record-policy.js";
import { addParameter, assertLeadSourceAssignment, camelizeRow } from "../data-management/record-utils.js";
import { validationErrorDetails } from "../data-management/resource-validation.js";
import { assertLeadDuplicatePolicy, hasLeadDuplicateIdentityChange, recordLeadDuplicateOverride } from "../master-data/lead-duplicates.js";
import { assignLeadOwner, recordLeadAssignment } from "./lead-assignment.js";
import { assertEligibleLeadAssignee, resolveLeadAssignment } from "./lead-governance.js";
import { assertNoQualificationMutation } from "./qualification-fields.js";
import { normalizeLeadRecordInput, validateLeadRecord } from "./lead-record-validation.js";
import { projectLeadForContext } from "./lead-security.js";
import { ensureDefaultLeadStages } from "./lifecycle/stage-catalog.js";
import { recalculateLeadScoreInternal } from "./scoring/scoring-engine.js";

export { normalizeLeadRecordInput };

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

// F008: the duplicate override reason is a command argument, not a field.
export function takeLeadDuplicateOverrideReason(input) {
  const duplicateOverrideReason = input?.duplicateOverrideReason;
  if (Object.prototype.hasOwnProperty.call(input || {}, "duplicateOverrideReason")) {
    input = { ...input };
    delete input.duplicateOverrideReason;
  }
  return { input, duplicateOverrideReason };
}

// A requested owner goes through F005 assignment, never a plain field write.
export function leadOwnerRequest(input) {
  const ownerChangeRequested = Object.prototype.hasOwnProperty.call(input, "ownerUserId");
  return {
    ownerChangeRequested,
    requestedOwnerUserId: ownerChangeRequested ? input.ownerUserId || null : undefined,
  };
}

function throwLeadValidation(leadErrors) {
  if (leadErrors.length) {
    const first = leadErrors[0];
    throw new CrmError(
      400,
      first.message,
      first.code,
      validationErrorDetails(leadErrors),
    );
  }
}

// ------------------------------------------------------------------ create

export function assertLeadCreateInput(context, input) {
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

export async function prepareLeadForCreate(client, context, prepared) {
  // F007 protects the immutable `new` code as the one active initial stage;
  // administrators may rename its label but cannot deactivate or replace it.
  prepared.status = "new";
  // F004: original_source_id is fixed at creation and never changes again
  // (see the update-path guard), so attribution reporting can always
  // answer "what acquired this lead" even after source_id is corrected
  // later. Ignore any caller-supplied value — only what the lead is
  // actually created with counts.
  prepared.originalSourceId = prepared.sourceId ?? null;
  throwLeadValidation(validateLeadRecord(prepared, { mode: "create" }));
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

// F008 duplicate protection, then F005 owner assignment, before the INSERT.
export async function applyLeadCreatePolicies(client, context, prepared, { duplicateOverrideReason, ownerChangeRequested, requestedOwnerUserId }) {
  // F008 commit-time duplicate protection runs before F005 assignment
  // evaluation so a rejected duplicate cannot consume round-robin state.
  const leadDuplicateEvaluation = await assertLeadDuplicatePolicy(
    client,
    context,
    prepared,
    { overrideReason: duplicateOverrideReason, lock: true },
  );
  let initialLeadAssignment = null;
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
  return { leadDuplicateEvaluation, initialLeadAssignment };
}

// After the INSERT: the duplicate-override record and the initial F027 score.
// F027 Prompt 4: the score is no longer set pre-insert by the legacy
// uncapped/undecayed/unversioned rule engine (System B) — it defaults to 0
// via the column default and is computed here by the deterministic scoring
// engine (System A, recalculateLeadScoreInternal) once the row exists.
export async function completeLeadCreate(client, context, created, leadDuplicateEvaluation) {
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
  return created;
}

// After the created outbox event: the F005 assignment history row.
export async function recordInitialLeadAssignment(client, context, created, initialLeadAssignment) {
  if (created.ownerUserId)
    await recordLeadAssignment(client, context, {
      leadId: created.id,
      previousOwnerUserId: null,
      ownerUserId: created.ownerUserId,
      policyId: initialLeadAssignment?.policyId || null,
      reason: initialLeadAssignment?.reason || "manual:create",
      evaluationTrace: initialLeadAssignment?.trace || null,
      leadName: created.fullName || created.firstName || null,
    });
}

// ------------------------------------------------------------------ update

export function assertLeadUpdateInput(context, input) {
  assertNoQualificationMutation(input);
  assertSensitiveLeadMutationAllowed(context, input);
}

export function assertLeadUpdateFieldsGoverned(input) {
  if (
    ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
      (field) => Object.prototype.hasOwnProperty.call(input, field),
    )
  )
    throw new CrmError(
      409,
      "Use the governed Lead lifecycle transition action.",
      "CRM_LEAD_STAGE_ACTION_REQUIRED",
    );
  if (Object.prototype.hasOwnProperty.call(input, "originalSourceId"))
    throw new CrmError(
      409,
      "Original source is fixed at creation and cannot be edited.",
      "CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE",
    );
}

export async function prepareLeadForUpdate(client, context, id, prepared, before, duplicateOverrideReason) {
  let leadDuplicateEvaluation = null;
  throwLeadValidation(
    validateLeadRecord(prepared, {
      mode: "update",
      existing: before,
    }),
  );
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
  // — after the UPDATE commits, so it reads the merged final values —
  // only when a scoring-relevant field actually changed (create,
  // qualifying-field change, source change), not on every unrelated
  // edit (§44: "avoid recalculating synchronously on unrelated updates").
  const leadScoreRecalcNeeded = Object.keys(prepared).some((field) => LEAD_SCORE_RECALC_TRIGGER_FIELDS.has(field));
  return { leadDuplicateEvaluation, leadScoreRecalcNeeded };
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
export async function logLeadConsentChanges(client, context, leadId, before, after) {
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

// A requested owner change goes through the F005 assignment command.
export async function applyLeadOwnerChange(client, context, id, requestedOwnerUserId) {
  const assignment = await assignLeadOwner(
    client,
    context,
    id,
    requestedOwnerUserId,
    { reason: "manual:patch" },
  );
  return assignment.lead;
}

// After the UPDATE: the duplicate-override record and, when a scoring field
// changed, the F027 score recalculation.
export async function completeLeadUpdate(client, context, id, updated, leadDuplicateEvaluation, leadScoreRecalcNeeded) {
  if (leadDuplicateEvaluation?.overrideReason) {
    await recordLeadDuplicateOverride(
      client,
      context,
      id,
      leadDuplicateEvaluation,
      "update",
    );
  }
  if (leadScoreRecalcNeeded) {
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
  return updated;
}

// Owner changes are reported by the assignment history, not the update event.
export function leadUpdateChangedFields(before, updated, inputKeys) {
  return leadOutboxChangedFields(before, updated, inputKeys).filter(
    (field) => field !== "ownerUserId",
  );
}

// ----------------------------------------------------------------- archive

export async function archiveLeadRecord(client, context, id, before, parameters, scope) {
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

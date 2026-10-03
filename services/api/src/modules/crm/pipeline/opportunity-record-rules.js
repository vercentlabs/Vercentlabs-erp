// Opportunity rules applied when an Opportunity goes through the generic CRM
// record commands (createCrmRecord / updateCrmRecord / archiveCrmRecord in
// data-management/resource-mutation-service.js). Each function is one step
// that coordinator calls at a fixed point in the mutation.
//
// Stage moves, probability changes, close outcomes and restore are NOT here:
// they are governed business transitions (opportunity-transitions.js). These
// rules only keep generic field edits from forging those fields.
import { CrmError } from "../data-management/errors.js";
import { canViewAllCrmRecords } from "../data-management/record-policy.js";
import { ensurePrimaryContactRoleFromLegacyField } from "./opportunity-contacts.js";
import { normalizeOpportunityRecordInput, opportunityChangedFields, validateOpportunityRecord } from "./opportunity-record-validation.js";
import { opportunityOutboxSnapshot, resolveOpportunityInitialStage, throwOpportunityValidation, validateOpportunityRelationships } from "./opportunity-validation.js";

export { normalizeOpportunityRecordInput, opportunityChangedFields, opportunityOutboxSnapshot };

// F011: expected revenue is always derived from amount and probability.
export function assertOpportunityExpectedRevenueNotSupplied(input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, "expectedRevenue"))
    throw new CrmError(
      409,
      "Expected revenue is calculated automatically from amount and probability.",
      "CRM_OPPORTUNITY_EXPECTED_REVENUE_DERIVED",
    );
}

// Lifecycle and outcome fields change only through governed CRM actions.
export function assertOpportunityCreateInput(input) {
  assertOpportunityExpectedRevenueNotSupplied(input);
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

export async function prepareOpportunityForCreate(client, context, prepared) {
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

// After the INSERT: the opening stage-history row and the primary contact role.
export async function completeOpportunityCreate(client, context, created) {
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
}

export function assertOpportunityUpdateAllowed(context, before, input) {
  if (before.status === "archived")
    throw new CrmError(409, "Archived Opportunities are read-only.", "CRM_OPPORTUNITY_ARCHIVED");
  if (Object.prototype.hasOwnProperty.call(input || {}, "ownerUserId") && !input.ownerUserId && !canViewAllCrmRecords(context))
    throw new CrmError(403, "You do not have permission to leave this Opportunity unassigned.", "CRM_OPPORTUNITY_OWNER_REQUIRED");
}

export async function validateOpportunityForUpdate(client, context, prepared, before) {
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
  const relationshipFields = new Set(["leadId", "partyId", "contactId", "ownerUserId"]);
  if (Object.keys(prepared).some((field) => relationshipFields.has(field)))
    await validateOpportunityRelationships(client, context, prepared, before);
}

// After the UPDATE wrote a row: keep the primary contact role in sync.
export async function afterOpportunityRowUpdated(client, context, id, input, updated) {
  if (Object.prototype.hasOwnProperty.call(input, "contactId")) {
    await ensurePrimaryContactRoleFromLegacyField(client, context, id, updated.contactId);
  }
}

// Opportunities specifically: the archive UPDATE touches `status`, one of the
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
export async function withOpportunityArchiveTransition(client, work) {
  await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','allowed',true)");
  try {
    return await work();
  } finally {
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','',true)");
  }
}

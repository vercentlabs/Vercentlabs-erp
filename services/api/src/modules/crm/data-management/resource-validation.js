import { canViewSensitiveLeadContent } from "../leads/access.js";
import { CrmError } from "./errors.js";
import { LEAD_LINKED_GENERIC_RESOURCES } from "./record-policy.js";
import { getCrmRecord } from "./resource-query-service.js";



// Generic optimistic-concurrency check, originally Lead-only (hence the
// CRM_LEAD_* codes preserved for that entity's backward-compatible
// contract). Generalized with an entityLabel/codePrefix so the same check
// also protects ordinary Opportunity edits through the generic
// updateCrmRecord/archiveCrmRecord path, so two concurrent editors can
// never silently overwrite each other.
export function assertRecordExpectedVersion(
  record,
  expectedUpdatedAt,
  required = false,
  entityLabel = "Lead",
  codePrefix = "CRM_LEAD",
) {
  const supplied = String(expectedUpdatedAt || "").trim();
  if (!supplied) {
    if (required)
      throw new CrmError(
        400,
        `Refresh this ${entityLabel} before changing it.`,
        `${codePrefix}_VERSION_REQUIRED`,
      );
    return;
  }
  const expected = new Date(supplied);
  if (!Number.isFinite(expected.getTime()))
    throw new CrmError(
      400,
      `The ${entityLabel} version is invalid. Refresh and try again.`,
      `${codePrefix}_VERSION_INVALID`,
    );
  const actual = new Date(record.updatedAt ?? "");
  if (!Number.isFinite(actual.getTime()) || expected.getTime() !== actual.getTime())
    throw new CrmError(
      409,
      `This ${entityLabel} changed after you loaded it. Refresh and try again.`,
      "CRM_STALE_WRITE",
    );
}





// Mutable generic-CRUD
// configuration resources with no existing append-only/versioned model —
// Qualification criteria (F006) and Won/Lost reasons (F026) — get the same
// checked-write contract as leads/opportunities through the generic
// updateCrmRecord/archiveCrmRecord path below, rather than three more
// bespoke timestamp-comparison implementations. Sales Stages (F012),
// Lead Sources and Account/Contact already have their own dedicated
// version-checked operation files and are NOT routed through here.
// Qualification criteria has no archive/DELETE transition defined
// (archiveStatuses below), so it is PATCH-only.
//
// The web PATCH route (apps/web .../[resource]/[id]/route.ts) sends
// `expectedUpdatedAt`/`requireVersion: true` on every request, but
// updateCrmRecord/archiveCrmRecord only enforce them for resources in this
// map. It covers every mutable CRM configuration/aggregate resource that
// is genuinely editable post-creation (has real
// fields a second editor could race on) rather than append-only: sales
// teams, team memberships, account plans, account stakeholders, forecast periods, forecast
// submissions, report definitions, assignment rules, scoring rules, and
// pipelines. (Pipeline Stages and Lead Sources already had their own
// dedicated, already-enforced version checks — see sales-stage-operations.js
// and lead-source-operations.js — so they are deliberately not added here.)
export const GENERIC_VERSIONED_RESOURCES = {
  "sales-teams": { entityLabel: "Sales team", codePrefix: "CRM_SALES_TEAM" },
  "sales-team-members": { entityLabel: "Team membership", codePrefix: "CRM_TEAM_MEMBERSHIP" },
  "account-plans": { entityLabel: "Account plan", codePrefix: "CRM_ACCOUNT_PLAN" },
  "account-stakeholders": { entityLabel: "Account stakeholder", codePrefix: "CRM_ACCOUNT_STAKEHOLDER" },
  "forecast-periods": { entityLabel: "Forecast period", codePrefix: "CRM_FORECAST_PERIOD" },
  "forecast-submissions": { entityLabel: "Forecast submission", codePrefix: "CRM_FORECAST_SUBMISSION" },
  pipelines: { entityLabel: "Pipeline", codePrefix: "CRM_PIPELINE" },
};



export function mutableEntries(definition, input) {
  return Object.entries(input).filter(
    ([key, value]) => definition.fields[key] && value !== undefined,
  );
}



export function validationErrorDetails(issues) {
  const errors = {};
  for (const item of issues) {
    const field = String(item?.field || "form");
    errors[field] ||= [];
    errors[field].push(String(item?.message || "Invalid value."));
  }
  return { errors, issues };
}



export function normalizeStorageInput(resource, input) {
  const prepared = { ...input };
  // comparison_value is jsonb. Web/API validation intentionally decodes the
  // structured-field JSON into its real primitive type. node-postgres sends a
  // JavaScript string verbatim, which PostgreSQL then tries to parse as raw JSON
  // and rejects (for example Manufacturing is not valid JSON). Re-encode string
  // primitives at the storage boundary so guided UI values and API values are
  // stored as a JSON string instead of causing a database 500.
  if (
    resource === "scoring-rules" &&
    Object.prototype.hasOwnProperty.call(prepared, "comparisonValue") &&
    typeof prepared.comparisonValue === "string"
  ) {
    prepared.comparisonValue = JSON.stringify(prepared.comparisonValue);
  }
  if (
    LEAD_LINKED_GENERIC_RESOURCES.has(resource) &&
    Object.prototype.hasOwnProperty.call(prepared, "entityType")
  ) {
    prepared.entityType = String(prepared.entityType || "").trim().toLowerCase();
  }
  // field_keys is a real Postgres text[] column, but the generic admin form
  // only has scalar inputs — accept a comma-separated string from the UI
  // (an actual array from a direct API caller passes through untouched).
  if (
    resource === "qualification-criteria" &&
    typeof prepared.fieldKeys === "string"
  ) {
    prepared.fieldKeys = prepared.fieldKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  // objectives/risks/whiteSpace/successPlan are jsonb columns. The generic
  // create/update paths bind every field's value as a plain query parameter
  // with no ::jsonb cast (see createCrmRecord/updateCrmRecord), so an
  // actual JS array/object sent from a real API caller (or AccountPlanPanel,
  // once it's fixed to send one) would be handed to `pg` as-is — which
  // serializes an array using Postgres's ARRAY wire format, not JSON, and
  // fails to cast into a jsonb column. Every other write in this codebase
  // that targets a jsonb column JSON.stringify()s first; this resource
  // never got that treatment because crm_account_plans had zero rows
  // anywhere until F002's Customer 360 seed data first populated one.
  if (resource === "account-plans") {
    for (const field of ["objectives", "risks", "whiteSpace", "successPlan"]) {
      if (Object.prototype.hasOwnProperty.call(prepared, field) && typeof prepared[field] === "object" && prepared[field] !== null) {
        prepared[field] = JSON.stringify(prepared[field]);
      }
    }
  }
  return prepared;
}



export const organizationUserReferenceFields = new Set([
  "ownerUserId",
  "assignedTo",
  "assigneeUserId",
  "userId",
  "managerUserId",
  "executiveSponsorUserId",
  "relationshipOwnerUserId",
  "reviewedBy",
  "internalOwnerUserId",
]);



export async function assertActiveOrganizationUsers(client, context, userIds) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;
  const memberships = await client.query(
    `SELECT user_id FROM public.organization_memberships
     WHERE organization_id = $1
       AND user_id = ANY($2::uuid[])
       AND status = 'active'`,
    [context.organizationId, uniqueUserIds],
  );
  const active = new Set(memberships.rows.map((row) => row.user_id));
  const invalid = uniqueUserIds.filter((userId) => !active.has(userId));
  if (invalid.length) {
    throw new CrmError(
      409,
      "CRM owners and assignees must be active members of this organization.",
      "CRM_USER_OUTSIDE_ORGANIZATION",
    );
  }
}



export async function validateOrganizationUserReferences(
  client,
  context,
  definition,
  prepared,
) {
  const userIds = Object.entries(prepared)
    .filter(
      ([key, value]) =>
        value &&
        definition.fields[key] &&
        organizationUserReferenceFields.has(key),
    )
    .map(([, value]) => value);
  await assertActiveOrganizationUsers(client, context, userIds);
}



// A Lead-linked generic record (consent evidence, data-quality scores,
// enrichment jobs, AI predictions/feedback) may only reference a Lead or
// prediction the caller can open: the reference is loaded through the same
// scoped read as the record itself (404 when out of scope).
export async function assertGenericLeadLinkedTarget(client, context, resource, effective) {
  if (resource === "consent-events" && effective?.leadId) {
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(
        403,
        "You do not have permission to access Lead consent evidence.",
        "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
      );
    await getCrmRecord(client, context, "leads", effective.leadId);
    return;
  }
  if (LEAD_LINKED_GENERIC_RESOURCES.has(resource)) {
    if (String(effective?.entityType || "").toLowerCase() !== "lead") return;
    if (!canViewSensitiveLeadContent(context))
      throw new CrmError(
        403,
        "You do not have permission to access Lead-linked CRM intelligence.",
        "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
      );
    const leadId = String(effective?.entityId || "").trim();
    if (!leadId)
      throw new CrmError(400, "A Lead reference is required.", "CRM_LEAD_REFERENCE_REQUIRED");
    await getCrmRecord(client, context, "leads", leadId);
    return;
  }
  if (resource === "ai-feedback" && effective?.predictionId)
    await getCrmRecord(client, context, "ai-predictions", effective.predictionId);
}



export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}










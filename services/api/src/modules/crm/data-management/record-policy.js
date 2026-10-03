import { canViewSensitiveLeadContent, firstSensitiveLeadInputField, projectLeadForContext } from "../lead-management/lead-security.js";
import { communicationVisibilitySql, projectCrmCommunication } from "./communication-access.js";
import { CrmError } from "./errors.js";
import { comparable } from "./condition-matching.js";
import { resources } from "./resource-registry.js";
import { addParameter } from "./record-utils.js";
import { salesDocumentVisibilitySql } from "../../sales/index.js";
import { receivablesDocumentVisibilitySql } from "../../accounting/index.js";
import { assertCrmOwnerAssignable, canViewAllCrmRecords, canViewAllCrmResource, crmAccountAccessSql, crmOwnerScopeSql } from "./crm-access-scope.js";

export { canViewAllCrmRecords };



// A caller may see every record in the organization ("crm.records
// .view_all" — granted to CRM/sales manager and administrator roles) or,
// lacking that permission, only records they own/are assigned (definition.
// ownerField, currently set for leads, opportunities and activities). Records with
// no owner yet (owner_user_id/assigned_to IS NULL, e.g. a freshly captured
// lead awaiting assignment) remain visible to anyone who can otherwise see
// the resource.
// (canViewAllCrmRecords now lives in crm-access-scope.js with the team rule.)



export const LEAD_LINKED_GENERIC_TABLES = new Set([
  "tenant.crm_data_quality_scores",
  "tenant.crm_enrichment_jobs",
  "tenant.crm_ai_predictions",
]);



export function directLeadLinkedScope(definition, context, parameters, alias) {
  if (definition.table === "tenant.crm_consent_events") {
    const leadIdColumn = definition.fields?.leadId;
    if (!leadIdColumn) return "";
    if (!canViewSensitiveLeadContent(context))
      return ` AND ${alias}.${leadIdColumn} IS NULL`;
    const leadScope = recordScope(resources.leads, context, parameters, "lead");
    return ` AND (${alias}.${leadIdColumn} IS NULL OR EXISTS (SELECT 1 FROM tenant.crm_leads lead WHERE lead.organization_id=${alias}.organization_id AND lead.id=${alias}.${leadIdColumn}${leadScope}))`;
  }
  if (!LEAD_LINKED_GENERIC_TABLES.has(definition.table)) return "";
  const entityTypeColumn = definition.fields?.entityType;
  const entityIdColumn = definition.fields?.entityId;
  if (!entityTypeColumn || !entityIdColumn) return "";
  if (!canViewSensitiveLeadContent(context))
    return ` AND lower(COALESCE(${alias}.${entityTypeColumn},'')) <> 'lead'`;
  const leadScope = recordScope(resources.leads, context, parameters, "lead");
  return ` AND (lower(COALESCE(${alias}.${entityTypeColumn},'')) <> 'lead' OR EXISTS (SELECT 1 FROM tenant.crm_leads lead WHERE lead.organization_id=${alias}.organization_id AND lead.id=${alias}.${entityIdColumn}${leadScope}))`;
}



export function aiFeedbackLeadScope(definition, context, parameters, alias) {
  if (definition.table !== "tenant.crm_ai_feedback") return "";
  const predictionColumn = definition.fields?.predictionId;
  if (!predictionColumn) return "";
  if (!canViewSensitiveLeadContent(context))
    return ` AND NOT EXISTS (SELECT 1 FROM tenant.crm_ai_predictions prediction WHERE prediction.organization_id=${alias}.organization_id AND prediction.id=${alias}.${predictionColumn} AND lower(prediction.entity_type)='lead')`;
  const leadScope = recordScope(resources.leads, context, parameters, "lead");
  return ` AND (NOT EXISTS (SELECT 1 FROM tenant.crm_ai_predictions prediction WHERE prediction.organization_id=${alias}.organization_id AND prediction.id=${alias}.${predictionColumn} AND lower(prediction.entity_type)='lead') OR EXISTS (SELECT 1 FROM tenant.crm_ai_predictions prediction JOIN tenant.crm_leads lead ON lead.organization_id=prediction.organization_id AND lead.id=prediction.entity_id WHERE prediction.organization_id=${alias}.organization_id AND prediction.id=${alias}.${predictionColumn} AND lower(prediction.entity_type)='lead'${leadScope}))`;
}



// crm_communications carries no owner column of its own — it is
// organization-scoped only, with owner meaning derived entirely from
// whichever parent record it is linked to. A
// communication is visible (once the caller already holds the separate
// content permission — see recordScope) only if its actual parent is
// itself visible under that parent resource's own real scope rules, so
// this can never grant broader access than the parent record already
// grants.
function communicationParentScopeSql(context, parameters, alias) {
  const leadScope = recordScope(resources.leads, context, parameters, "lead");
  const opportunityScope = recordScope(
    resources.opportunities,
    context,
    parameters,
    "opportunity",
  );
  // The Account ownership rule (crm-access-scope.js), so a communication
  // logged against an Account is visible exactly when the Account is.
  const partyVisible = `true${crmAccountAccessSql(context, (value) => addParameter(parameters, value), "party")}`;
  const standaloneVisible = "true";
  return ` AND (
    (${alias}.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenant.crm_leads lead WHERE lead.organization_id=${alias}.organization_id AND lead.id=${alias}.lead_id${leadScope}))
    OR (${alias}.lead_id IS NULL AND ${alias}.opportunity_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=${alias}.organization_id AND opportunity.id=${alias}.opportunity_id${opportunityScope}))
    OR (${alias}.lead_id IS NULL AND ${alias}.opportunity_id IS NULL AND ${alias}.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenant.business_parties party WHERE party.organization_id=${alias}.organization_id AND party.id=${alias}.party_id AND ${partyVisible}))
    OR (${alias}.lead_id IS NULL AND ${alias}.opportunity_id IS NULL AND ${alias}.party_id IS NULL AND ${alias}.contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenant.contacts contact JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id WHERE contact.organization_id=${alias}.organization_id AND contact.id=${alias}.contact_id AND ${partyVisible}))
    OR (${alias}.lead_id IS NULL AND ${alias}.opportunity_id IS NULL AND ${alias}.party_id IS NULL AND ${alias}.contact_id IS NULL AND ${standaloneVisible})
  )`;
}



// Registry key of a resource definition ("leads", "opportunities", …) —
// what resource-specific view-all and relationship grants are keyed on.
export function crmResourceName(definition) {
  return Object.keys(resources).find((key) => resources[key] === definition) ?? null;
}

export function recordScope(definition, context, parameters, alias = "record") {
  let sql = "";
  if (definition.table === "tenant.crm_communications") {
    // AUDIENCE ("may this caller know this communication exists") and
    // CONTENT ("may this caller read subject/body/recipients") are two
    // separate authorization decisions, not one combined gate. This SQL fragment only ever decides audience:
    // the owner boundary comes from the communication's actual parent
    // record's own scope (communicationParentScopeSql, so the sensitive
    // permission alone never reads every owner's mail org-wide),
    // and the visibility tier (team/private/participant) is the ONE
    // canonical fragment every other audience call site (getCommunication-
    // Timeline, the canonical Timeline's communication branch, the shared
    // inbox) also uses — see communication-access.js. Content
    // (whether the caller sees full subject/body or only a metadata stub)
    // is not a row-visibility decision here at all: it is applied by
    // the route layer via projectCrmCommunication(s) AFTER this query
    // returns, for every one of those same call sites, so a caller without
    // crm.leads.view_sensitive can still know a team-visible communication
    // exists (audience) without being able to read its content — never an
    // implicit "no permission = doesn't exist" leak-through-absence.
    sql += communicationParentScopeSql(context, parameters, alias);
    sql += ` AND ${communicationVisibilitySql(context, parameters, alias)}`;
  }
  if (!canViewSensitiveLeadContent(context)) {
    if (definition.table === "tenant.crm_activities")
      sql += ` AND COALESCE(${alias}.entity_type,'general') <> 'lead'`;
  }
  if (definition.ownerField) {
    // One rule for every owner-scoped resource (leads, opportunities,
    // activities, forecast submissions): own + managed-team members +
    // unassigned queue, unless the caller can view all — crm-access-scope.js.
    const column = definition.fields[definition.ownerField];
    sql += crmOwnerScopeSql(context, (value) => addParameter(parameters, value), `${alias}.${column}`, `${alias}.organization_id`, { resource: crmResourceName(definition), alias });
  }
  sql += directLeadLinkedScope(definition, context, parameters, alias);
  sql += aiFeedbackLeadScope(definition, context, parameters, alias);
  return sql;
}



// A caller without crm.records.view_all can create/own a record themselves
// (or leave ownership to the existing lead-assignment engine) but cannot
// hand a record off to a different, arbitrary user — that requires the same
// elevated permission that grants organization-wide visibility. Checked against
// the RAW input (hasOwnProperty), not the merged/defaulted payload, so an
// update that never mentions ownerField is unaffected.
export async function assertOwnerAssignmentAllowed(client, definition, context, input) {
  if (!definition.ownerField || canViewAllCrmResource(context, crmResourceName(definition))) return;
  if (!Object.prototype.hasOwnProperty.call(input, definition.ownerField))
    return;
  // Self, or an active member of a team the caller manages (Sales Manager).
  await assertCrmOwnerAssignable(client, context, input[definition.ownerField], "You do not have permission to assign this record to another user.", { resource: crmResourceName(definition) });
}



// Who may use the Lead assignment action at all: Lead managers. WHOM they
// may assign to is decided per target by assertCrmOwnerAssignable (self,
// own team, or anyone for view-all holders), and which Leads they can reach
// by recordScope.
export function canAssignLeadOwners(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.leads.manage"))
  );
}



export function canViewCustomField(context, visibleToRoles) {
  if (!Array.isArray(visibleToRoles) || !visibleToRoles.length) return true;
  if (context.roleSlugs?.includes("organization_owner")) return true;
  return Boolean(context.roleSlugs?.some((slug) => visibleToRoles.includes(slug)));
}



// F028 CAP-002: crm_custom_field_definitions.visible_to_roles restricts a
// custom field (definition and stored value) to specific role slugs. This
// redacts restricted keys from a custom-records row's `data` blob for a
// caller whose role isn't allowlisted, mirroring the sensitive-field
// redaction pattern already used for Leads/Contacts.
async function restrictedCustomFieldKeys(client, context, objectDefinitionIds) {
  const ids = [...new Set(objectDefinitionIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const result = await client.query(
    `SELECT object_definition_id, field_key, visible_to_roles
       FROM tenant.crm_custom_field_definitions
      WHERE organization_id=$1 AND object_definition_id=ANY($2::uuid[])
        AND visible_to_roles IS NOT NULL AND array_length(visible_to_roles,1) > 0`,
    [context.organizationId, ids],
  );
  const byObject = new Map();
  for (const row of result.rows) {
    if (canViewCustomField(context, row.visible_to_roles)) continue;
    const keys = byObject.get(row.object_definition_id) || new Set();
    keys.add(row.field_key);
    byObject.set(row.object_definition_id, keys);
  }
  return byObject;
}



export function redactCustomRecordData(record, restrictedKeys) {
  if (!restrictedKeys || !restrictedKeys.size || !record?.data || typeof record.data !== "object")
    return record;
  const data = { ...record.data };
  let removed = false;
  for (const key of restrictedKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      delete data[key];
      removed = true;
    }
  }
  return removed ? { ...record, data, restrictedFieldsHidden: true } : record;
}



export async function projectCrmRecord(client, context, resource, record) {
  if (resource === "leads") return projectLeadForContext(context, record);
  if (resource === "custom-records" && record?.objectDefinitionId) {
    const restricted = await restrictedCustomFieldKeys(client, context, [record.objectDefinitionId]);
    return redactCustomRecordData(record, restricted.get(record.objectDefinitionId));
  }
  // The generic CRM resource route (and mobile's
  // generic [resource]/[id] route, which falls through to this SAME
  // getCrmRecord/listCrmRecords pair for "communications") is one of the
  // five surfaces the canonical communication projector must cover.
  // recordScope's audience predicate (team/private/participant) already
  // let this row through by the time projectCrmRecord runs — this is
  // purely the CONTENT decision (full vs metadata-only). Sender-only
  // (not full participant lookup) here deliberately, to keep the generic
  // list route to one query per page rather than N+1 — a caller who
  // merely received (not sent) a team-visible email sees full content via
  // the dedicated Communications-tab/Timeline/shared-inbox surfaces
  // (which do resolve full participant membership) but metadata-only via
  // this generic route; documented, not a silent gap.
  if (resource === "communications") return projectCrmCommunication(record, context, { isParticipant: false });
  return record;
}



export async function projectCrmRecords(client, context, resource, records) {
  if (resource !== "custom-records") {
    return Promise.all(records.map((record) => projectCrmRecord(client, context, resource, record)));
  }
  const restrictedByObject = await restrictedCustomFieldKeys(
    client,
    context,
    records.map((record) => record.objectDefinitionId),
  );
  return records.map((record) =>
    redactCustomRecordData(record, restrictedByObject.get(record.objectDefinitionId)),
  );
}



export function assertSensitiveLeadMutationAllowed(context, input) {
  // Server-owned ingestion contexts (public capture/webhooks) predate the
  // interactive permission vector and are constructed internally, not from
  // caller input. Interactive workspace contexts always carry permissions.
  if (!Array.isArray(context.permissions) && !Array.isArray(context.roleSlugs))
    return;
  if (canViewSensitiveLeadContent(context)) return;
  const field = firstSensitiveLeadInputField(input);
  if (!field) return;
  throw new CrmError(
    403,
    "You do not have permission to change sensitive Lead content.",
    "CRM_LEAD_SENSITIVE_FIELD_FORBIDDEN",
    { field },
  );
}



export function assertLeadLinkedContentAllowed(context, resource, input, before = null) {
  if (canViewSensitiveLeadContent(context)) return;
  const leadLinked =
    (resource === "communications" && Boolean(input?.leadId ?? before?.leadId)) ||
    (resource === "activities" &&
      String(input?.entityType ?? before?.entityType ?? "").toLowerCase() === "lead");
  if (!leadLinked) return;
  throw new CrmError(
    403,
    "You do not have permission to access Lead-linked CRM content.",
    "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
}



export const LEAD_LINKED_GENERIC_RESOURCES = new Set([
  "data-quality-scores",
  "enrichment-jobs",
  "ai-predictions",
]);



export function assertLifecycleUpdate(resource, before, input, context = {}) {
  if (
    resource === "leads" &&
    ["qualified", "unqualified"].includes(String(input.status || ""))
  ) {
    throw new CrmError(
      409,
      "Use the governed Lead Qualification action to change this decision.",
      "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
    );
  }
  // F022 CAP-002: a converted Lead is a closed historical record. Its
  // recordStatus/stage/qualification are already separately governed, but
  // ordinary fields (name, email, company, ...) were still editable through
  // this generic path after conversion, silently rewriting what the
  // conversion decision was actually based on.
  if (resource === "leads" && before.recordStatus === "converted") {
    throw new CrmError(
      409,
      "Converted Leads are read-only. Edit the resulting Account, Contact or Opportunity instead.",
      "CRM_LEAD_CONVERTED_READ_ONLY",
    );
  }
  if (resource === "consent-events") {
    throw new CrmError(
      409,
      "Consent evidence is immutable. Record a new consent event instead.",
      "CRM_CONSENT_IMMUTABLE",
    );
  }
  if (resource === "forecast-submissions" && input.status !== undefined) {
    const transitions = {
      draft: new Set(["draft", "submitted", "superseded"]),
      submitted: new Set(["submitted", "approved", "rejected", "superseded"]),
      approved: new Set(["approved", "superseded"]),
      rejected: new Set(["rejected", "draft", "superseded"]),
      superseded: new Set(["superseded"]),
    };
    if (!transitions[before.status]?.has(input.status)) {
      throw new CrmError(
        409,
        `Forecast submission cannot move from ${before.status} to ${input.status}.`,
        "CRM_FORECAST_TRANSITION_INVALID",
      );
    }
    // F025 — a rep may draft/submit/revise their own
    // forecast, but only a reviewer (a caller who is NOT the submission's
    // own owner — in practice, per the recordScope change above, their
    // Sales Team's manager or a crm.records.view_all holder, since anyone
    // else can't even see the row to PATCH it) may move it into
    // approved/rejected. Without this, a rep could self-approve their own
    // number through the same generic PATCH that lets them edit it.
    if (
      ["approved", "rejected"].includes(input.status) &&
      before.ownerUserId &&
      context.userId &&
      before.ownerUserId === context.userId
    ) {
      throw new CrmError(
        403,
        "You cannot approve or reject your own forecast submission.",
        "CRM_FORECAST_SELF_REVIEW_FORBIDDEN",
      );
    }
  }
  // F025 — managerAdjustment is a reviewer's override recorded ALONGSIDE
  // a rep's own submitted numbers (never the Opportunity's amount/
  // probability, which this field never touches), so a rep editing their
  // own draft must not also be able to set it on themselves. Independent
  // of the status-change guard above — a plain field edit that never
  // touches status must still be blocked.
  if (
    resource === "forecast-submissions" &&
    Object.prototype.hasOwnProperty.call(input, "managerAdjustment") &&
    before.ownerUserId &&
    context.userId &&
    before.ownerUserId === context.userId
  ) {
    throw new CrmError(
      403,
      "You cannot set a manager adjustment on your own forecast submission.",
      "CRM_FORECAST_SELF_ADJUSTMENT_FORBIDDEN",
    );
  }
  if (
    resource === "privacy-requests" &&
    before.status === "completed" &&
    input.status !== undefined &&
    input.status !== "completed"
  ) {
    throw new CrmError(
      409,
      "Completed privacy requests cannot be reopened. Create a new request.",
      "CRM_PRIVACY_REQUEST_CLOSED",
    );
  }
  const controlledFields =
    resource === "opportunities"
      ? [
          "pipelineId",
          "stageId",
          "probability",
          "forecastCategory",
          "status",
          "actualCloseDate",
          "lostReasonId",
          "lossNotes",
          "outcomeReasonId",
          "outcomeNotes",
        ]
      : [];
  for (const field of controlledFields) {
    if (
      input[field] !== undefined &&
      comparable(input[field]) !== comparable(before[field])
    ) {
      throw new CrmError(
        409,
        "Use governed Opportunity actions for pipeline, stage, probability, forecast, status and outcome changes.",
      );
    }
  }
  if (
    resource === "leads" &&
    input.status === "converted" &&
    before.status !== "converted"
  ) {
    throw new CrmError(409, "Use the governed lead conversion action.");
  }
  if (
    resource === "activities" &&
    input.status === "completed" &&
    before.status !== "completed"
  ) {
    throw new CrmError(409, "Use the governed activity completion action.");
  }
}

// Child-record scope for Account/Contact 360. Being allowed to open an
// Account is NOT permission to see every record hanging off it: each child
// applies its OWN canonical rule (recordScope — owner/team/unassigned/
// view-all), and every count, total and timeline row is computed from
// those same scoped rows, so a rep who sees 2 of 5 deals is told "2", never
// "5". Sales and Accounting documents are shown only to callers who hold
// that module's view permission. Customer-service events are Account-level
// (no owner). One parameter array per statement.
export function crmHasPermission(context, key) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(key));
}

export function crmChildScopes(context, parameters) {
  const bind = (value) => { parameters.push(value); return `$${parameters.length}`; };

  return {
    opportunity: (alias = "opportunity") => recordScope(resources.opportunities, context, parameters, alias),
    activity: (alias = "activity") => recordScope(resources.activities, context, parameters, alias),
    communication: (alias = "communication") => recordScope(resources.communications, context, parameters, alias),
    // Sales/Accounting documents: those modules' OWN canonical rules — CRM
    // never re-derives (or bypasses) another module's authorization.
    sales: (alias) => salesDocumentVisibilitySql(context, bind, alias),
    accounting: (alias) => receivablesDocumentVisibilitySql(context, bind, alias),
  };
}

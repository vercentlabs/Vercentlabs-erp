import { canViewSensitiveLeadContent, projectLeadForContext } from "../leads/access.js";
import { CrmError } from "./errors.js";
import { comparable } from "./condition-matching.js";
import { resources } from "./resource-registry.js";
import { addParameter } from "./record-utils.js";
import { assertCrmOwnerAssignable, canViewAllCrmRecords, canViewAllCrmResource, crmOwnerScopeSql } from "./crm-access-scope.js";

export { canViewAllCrmRecords };


// A caller may see every record in the organization ("crm.records
// .view_all" — granted to CRM/sales manager and administrator roles) or,
// lacking that permission, only records they own/are assigned (definition.
// ownerField, currently set for leads, opportunities and activities). Records with
// no owner yet (owner_user_id/assigned_to IS NULL, e.g. a freshly captured
// lead awaiting assignment) remain visible to anyone who can otherwise see
// the resource.
// (canViewAllCrmRecords now lives in crm-access-scope.js with the team rule.)


// Registry key of a resource definition ("leads", "opportunities", …) —
// what resource-specific view-all and relationship grants are keyed on.
export function crmResourceName(definition) {
  return Object.keys(resources).find((key) => resources[key] === definition) ?? null;
}

export function recordScope(definition, context, parameters, alias = "record") {
  let sql = "";
  if (!canViewSensitiveLeadContent(context)) {
    if (definition.table === "tenant.crm_activities")
      sql += ` AND COALESCE(${alias}.entity_type,'general') <> 'lead'`;
  }
  if (definition.ownerField) {
    // One rule for every owner-scoped resource (leads, opportunities,
    // activities): own + managed-team members +
    // unassigned queue, unless the caller can view all — crm-access-scope.js.
    const column = definition.fields[definition.ownerField];
    sql += crmOwnerScopeSql(context, (value) => addParameter(parameters, value), `${alias}.${column}`, `${alias}.organization_id`, { resource: crmResourceName(definition), alias });
  }
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



export async function projectCrmRecord(client, context, resource, record) {
  if (resource === "leads") return projectLeadForContext(context, record);
  return record;
}


export async function projectCrmRecords(client, context, resource, records) {
  return Promise.all(records.map((record) => projectCrmRecord(client, context, resource, record)));
}



export function assertLeadLinkedContentAllowed(context, resource, input, before = null) {
  if (canViewSensitiveLeadContent(context)) return;
  const leadLinked = resource === "activities" &&
    String(input?.entityType ?? before?.entityType ?? "").toLowerCase() === "lead";
  if (!leadLinked) return;
  throw new CrmError(
    403,
    "You do not have permission to access Lead-linked CRM content.",
    "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
}




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

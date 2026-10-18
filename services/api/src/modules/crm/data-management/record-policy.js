import { canViewSensitiveLeadContent } from "../leads/access.js";
import { resources } from "./resource-registry.js";
import { addParameter } from "./record-utils.js";
import { canViewAllCrmRecords, crmOwnerScopeSql } from "./crm-access-scope.js";

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

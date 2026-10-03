// Who may do what to a lead, and which leads a caller can see.
//
// Visibility is Own / Team / All:
//   All  — organization owner, crm.records.view_all or crm.leads.view_all;
//   Team — leads owned by members of a sales team the caller manages, and
//          leads assigned to a team the caller belongs to or manages;
//   Own  — leads the caller owns, plus the shared unassigned queue.
import { canViewAllCrmResource, crmOwnerScopeSql } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { LEAD_PERMISSIONS } from "./constants.js";

const SENSITIVE_LEAD_FIELDS = Object.freeze(["email", "phone", "mobile"]);

function isOwner(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner"));
}

export function leadCan(context, permission) {
  return isOwner(context) || Boolean(context.permissions?.includes(permission));
}

export function requireLeadPermission(context, permission, message = "You do not have permission to do this.") {
  if (!leadCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllLeadRecords(context) {
  return canViewAllCrmResource(context, "leads");
}

export function canViewSensitiveLeadContent(context) {
  return leadCan(context, LEAD_PERMISSIONS.viewSensitive);
}

// " AND (…)" restricting `alias` to the leads the caller can see; "" for
// view-all callers. Adds its parameters to `values`.
export function leadScopeSql(context, values, alias = "lead") {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const ownerScope = crmOwnerScopeSql(context, bind, `${alias}.owner_user_id`, `${alias}.organization_id`, { resource: "leads", alias });
  if (!ownerScope || context.ownRecordsOnly) return ownerScope;
  const me = bind(context.userId);
  const teamScope = `${alias}.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team
      WHERE team.organization_id=${alias}.organization_id AND team.status='active'
        AND (team.manager_user_id=${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id=team.organization_id AND member.team_id=team.id AND member.user_id=${me} AND member.status='active'
                AND member.effective_from<=current_date AND (member.effective_to IS NULL OR member.effective_to>=current_date))))`;
  return ` AND (${ownerScope.slice(" AND (".length, -1)} OR ${teamScope})`;
}

// Contact details are hidden from callers without crm.leads.view_sensitive.
export function projectLeadForContext(context, record) {
  if (!record || canViewSensitiveLeadContent(context)) return record;
  const projected = { ...record };
  for (const field of SENSITIVE_LEAD_FIELDS) delete projected[field];
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function firstSensitiveLeadInputField(input = {}) {
  return Object.keys(input || {}).find((key) => SENSITIVE_LEAD_FIELDS.includes(key));
}

// What the caller may do with leads, for the UI to hide what would be refused.
export function leadCapabilities(context) {
  return Object.fromEntries(Object.entries(LEAD_PERMISSIONS).map(([name, permission]) => [name, leadCan(context, permission)]));
}

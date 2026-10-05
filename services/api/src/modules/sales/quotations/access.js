// Who may do what with quotations, and which quotations a caller sees.
//
// Visibility is Own / Team / All:
//   All  — organization owner or sales.quotation.view_all;
//   Team — with sales.quotation.view_team: quotations owned by members of a
//          sales team the caller manages or belongs to;
//   Own  — quotations the caller owns or created.
import { QUOTATION_PERMISSIONS, QuotationError } from "./constants.js";

export function quotationCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requireQuotationPermission(context, permission, message = "You do not have permission to do this.") {
  if (!quotationCan(context, permission)) throw new QuotationError(403, message, "PERMISSION_DENIED");
}

export function requireQuotationAccess(context) {
  if (!quotationCan(context, QUOTATION_PERMISSIONS.view) && !quotationCan(context, QUOTATION_PERMISSIONS.viewAll))
    throw new QuotationError(403, "You do not have permission to view quotations.", "PERMISSION_DENIED");
}

const MY_TEAMS = (me) => `(SELECT team.id FROM tenant.crm_sales_teams team
   WHERE team.organization_id = $1 AND team.status = 'active'
     AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
           WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'
             AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))))`;
const TEAM_OWNERS = (me) => `(SELECT member.user_id FROM tenant.crm_sales_team_members member
   WHERE member.organization_id = $1 AND member.status = 'active' AND member.team_id IN ${MY_TEAMS(me)})`;

// " AND (…)" restricting `alias` to the quotations the caller can see; ""
// for view-all callers. $1 must be the organization id.
export function quotationScopeSql(context, values, alias = "quotation") {
  if (quotationCan(context, QUOTATION_PERMISSIONS.viewAll)) return "";
  values.push(context.userId ?? null);
  const me = `$${values.length}`;
  const own = `${alias}.owner_user_id = ${me} OR ${alias}.created_by = ${me}`;
  if (!quotationCan(context, QUOTATION_PERMISSIONS.viewTeam)) return ` AND (${own})`;
  return ` AND (${own} OR ${alias}.owner_user_id IN ${TEAM_OWNERS(me)})`;
}

// Team view: quotations owned by the caller's team members (not the caller's own).
export const teamOwnersSql = (me) => TEAM_OWNERS(me);

export function quotationCapabilities(context) {
  return Object.fromEntries(Object.entries(QUOTATION_PERMISSIONS).map(([name, permission]) => [name, quotationCan(context, permission)]));
}

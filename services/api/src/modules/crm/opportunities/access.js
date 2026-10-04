// Who may do what to an opportunity, and which opportunities a caller can see.
//
// Visibility is Own / Team / All:
//   All  — organization owner, crm.records.view_all or crm.opportunities.view_all;
//   Team — opportunities owned by members of a sales team the caller manages,
//          and opportunities assigned to a team the caller belongs to or manages;
//   Own  — opportunities the caller owns, plus unowned ones.
import { crmOwnerScopeSql } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";

// crm.opportunities.manage is the permission opportunities had before they
// were split up; it still stands for the day-to-day ones.
const LEGACY_MANAGE = "crm.opportunities.manage";
const COVERED_BY_MANAGE = new Set([
  OPPORTUNITY_PERMISSIONS.view, OPPORTUNITY_PERMISSIONS.create, OPPORTUNITY_PERMISSIONS.edit, OPPORTUNITY_PERMISSIONS.assign,
  OPPORTUNITY_PERMISSIONS.changeStage, OPPORTUNITY_PERMISSIONS.createQuotation, OPPORTUNITY_PERMISSIONS.markWon, OPPORTUNITY_PERMISSIONS.markLost,
  OPPORTUNITY_PERMISSIONS.changeProbability,
]);

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));
const holds = (context, permission) => Boolean(context.permissions?.includes(permission));

export function opportunityCan(context, permission) {
  if (isOwner(context) || holds(context, permission)) return true;
  if (permission === OPPORTUNITY_PERMISSIONS.view && (holds(context, "crm.view") || holds(context, OPPORTUNITY_PERMISSIONS.viewAll))) return true;
  // Whoever manages CRM settings can configure the sales stages.
  if (permission === OPPORTUNITY_PERMISSIONS.manageStages && holds(context, "crm.settings.manage")) return true;
  return COVERED_BY_MANAGE.has(permission) && holds(context, LEGACY_MANAGE);
}

export function requireOpportunityPermission(context, permission, message = "You do not have permission to do this.") {
  if (!opportunityCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllOpportunities(context) {
  return isOwner(context) || holds(context, OPPORTUNITY_PERMISSIONS.viewAll) || holds(context, "crm.records.view_all");
}

// " AND (…)" restricting `alias` to the opportunities the caller can see; ""
// for view-all callers. Adds its parameters to `values`.
export function opportunityScopeSql(context, values, alias = "opportunity") {
  if (canViewAllOpportunities(context) && !context.ownRecordsOnly) return "";
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const ownerScope = crmOwnerScopeSql(context, bind, `${alias}.owner_user_id`, `${alias}.organization_id`, { resource: "opportunities", alias });
  if (!ownerScope || context.ownRecordsOnly) return ownerScope;
  const me = bind(context.userId);
  const teamScope = `${alias}.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team
      WHERE team.organization_id = ${alias}.organization_id AND team.status = 'active'
        AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'
                AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))))`;
  return ` AND (${ownerScope.slice(" AND (".length, -1)} OR ${teamScope})`;
}

// What the caller may do with opportunities, for the UI to hide what would be refused.
export function opportunityCapabilities(context) {
  return Object.fromEntries(Object.entries(OPPORTUNITY_PERMISSIONS).map(([name, permission]) => [name, opportunityCan(context, permission)]));
}

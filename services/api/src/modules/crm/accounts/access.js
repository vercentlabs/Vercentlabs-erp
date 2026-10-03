// Who may do what to an account, and which accounts a caller can see.
//
// Visibility is Own / Team / All:
//   All  — organization owner, crm.records.view_all or crm.accounts.view_all;
//   Team — accounts owned by members of a sales team the caller manages,
//          accounts assigned to a team the caller belongs to or manages, and
//          accounts where the caller (or their team) owns an opportunity;
//   Own  — accounts the caller owns, plus unowned (shared) accounts.
import { crmAccountAccessSql } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { ACCOUNT_PERMISSIONS } from "./constants.js";

const SENSITIVE_FIELDS = Object.freeze(["email", "phone", "secondaryPhone"]);

export function accountCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requireAccountPermission(context, permission, message = "You do not have permission to do this.") {
  if (!accountCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllAccounts(context) {
  return accountCan(context, ACCOUNT_PERMISSIONS.viewAll) || accountCan(context, "crm.records.view_all");
}

export function canViewSensitiveAccountContent(context) {
  return accountCan(context, ACCOUNT_PERMISSIONS.viewSensitive);
}

// " AND (…)" restricting `alias` to the accounts the caller can see; "" for
// view-all callers. Adds its parameters to `values`.
export function accountScopeSql(context, values, alias = "account") {
  return accountScopeBind(context, (value) => { values.push(value); return `$${values.length}`; }, alias);
}

// The same, for callers that add parameters through a bind(value) function.
export function accountScopeBind(context, bind, alias = "account") {
  if (canViewAllAccounts(context)) return "";
  const ownerScope = crmAccountAccessSql(context, bind, alias);
  if (!ownerScope) return "";
  const me = bind(context.userId);
  const teamScope = `${alias}.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team
      WHERE team.organization_id=${alias}.organization_id AND team.status='active'
        AND (team.manager_user_id=${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id=team.organization_id AND member.team_id=team.id AND member.user_id=${me} AND member.status='active'
                AND member.effective_from<=current_date AND (member.effective_to IS NULL OR member.effective_to>=current_date))))`;
  return ` AND (${ownerScope.slice(" AND (".length, -1)} OR ${teamScope})`;
}

// Email and phone numbers are hidden from callers without view-sensitive.
export function projectAccountForContext(context, record) {
  if (!record || canViewSensitiveAccountContent(context)) return record;
  const projected = { ...record };
  for (const field of SENSITIVE_FIELDS) delete projected[field];
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function accountCapabilities(context) {
  return Object.fromEntries(Object.entries(ACCOUNT_PERMISSIONS).map(([name, permission]) => [name, accountCan(context, permission)]));
}

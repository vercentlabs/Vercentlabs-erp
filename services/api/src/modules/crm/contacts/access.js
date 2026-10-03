// Who may do what to a contact, and which contacts a caller can see.
//
// Visibility is Own / Team / All:
//   All  — organization owner, crm.records.view_all or crm.contacts.view_all;
//   Team — contacts owned by members of a sales team the caller manages, and
//          contacts assigned to a team the caller belongs to or manages;
//   Own  — contacts the caller owns, plus unowned (shared) contacts.
// A caller who can see a contact's company also sees the people at it, so an
// account's Contacts tab and the contact list always agree.
import { accountScopeBind } from "../accounts/access.js";
import { managedTeamMemberSql } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { CONTACT_PERMISSIONS } from "./constants.js";

const SENSITIVE_FIELDS = Object.freeze(["email", "secondaryEmail", "phone", "mobile", "alternatePhone"]);

export function contactCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requireContactPermission(context, permission, message = "You do not have permission to do this.") {
  if (!contactCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllContacts(context) {
  return contactCan(context, CONTACT_PERMISSIONS.viewAll) || contactCan(context, "crm.records.view_all");
}

export function canViewSensitiveContactContent(context) {
  return contactCan(context, CONTACT_PERMISSIONS.viewSensitive);
}

// " AND (…)" restricting `alias` (a tenant.contacts row) to the contacts the
// caller can see; "" for view-all callers. bind(value) adds a parameter and
// returns its placeholder.
export function contactScopeSql(context, bind, alias = "contact") {
  if (canViewAllContacts(context)) return "";
  const me = bind(context.userId);
  const organization = `${alias}.organization_id`;
  const accountScope = accountScopeBind(context, bind, "scope_account");
  return ` AND (${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${me}
    OR ${managedTeamMemberSql(bind, context, `${alias}.owner_user_id`, organization, me)}
    OR ${alias}.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team
      WHERE team.organization_id = ${organization} AND team.status = 'active'
        AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'
                AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))))
    OR EXISTS (SELECT 1 FROM tenant.business_parties scope_account
      WHERE scope_account.organization_id = ${organization} AND scope_account.id = ${alias}.party_id${accountScope}))`;
}

// For callers that keep a values array instead of a bind function.
export function contactScopeValues(context, values, alias = "contact") {
  return contactScopeSql(context, (value) => { values.push(value); return `$${values.length}`; }, alias);
}

// Email and phone numbers are hidden from callers without view-sensitive.
export function projectContactForContext(context, record) {
  if (!record || canViewSensitiveContactContent(context)) return record;
  const projected = { ...record };
  for (const field of SENSITIVE_FIELDS) delete projected[field];
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function contactCapabilities(context) {
  return Object.fromEntries(Object.entries(CONTACT_PERMISSIONS).map(([name, permission]) => [name, contactCan(context, permission)]));
}

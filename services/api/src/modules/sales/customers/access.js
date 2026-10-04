// Who may do what to a customer, and which customers a caller can see.
//
// Visibility is Own / Team / All:
//   All  — organization owner or sales.customers.view_all;
//   Team — with sales.customers.view_team: customers owned by members of a
//          sales team the caller manages or belongs to, and customers
//          assigned to such a team;
//   Own  — customers the caller is the salesperson of or created, and
//          customers with no salesperson.
import { CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));

export function customerCan(context, permission) {
  return isOwner(context) || Boolean(context.permissions?.includes(permission));
}

export function requireCustomerPermission(context, permission, message = "You do not have permission to do this.") {
  if (!customerCan(context, permission)) throw new CustomerError(403, message, "PERMISSION_DENIED");
}

export const canViewAllCustomers = (context) => customerCan(context, CUSTOMER_PERMISSIONS.viewAll);
export const canViewCustomerFinancials = (context) => customerCan(context, CUSTOMER_PERMISSIONS.viewFinancials);

const MY_TEAMS = (me) => `(SELECT team.id FROM tenant.crm_sales_teams team
   WHERE team.organization_id = $1 AND team.status = 'active'
     AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
           WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'
             AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))))`;

// " AND (…)" restricting `alias` to the customers the caller can see; "" for
// view-all callers. $1 must be the organization id; adds its own parameter.
export function customerScopeSql(context, values, alias = "customer") {
  if (canViewAllCustomers(context)) return "";
  values.push(context.userId ?? null);
  const me = `$${values.length}`;
  const own = `${alias}.owner_user_id = ${me} OR ${alias}.owner_user_id IS NULL OR ${alias}.customer_created_by = ${me}`;
  if (!customerCan(context, CUSTOMER_PERMISSIONS.viewTeam)) return ` AND (${own})`;
  return ` AND (${own} OR ${alias}.team_id IN ${MY_TEAMS(me)}
    OR ${alias}.owner_user_id IN (SELECT member.user_id FROM tenant.crm_sales_team_members member
          WHERE member.organization_id = $1 AND member.status = 'active' AND member.team_id IN ${MY_TEAMS(me)}))`;
}

export function customerCapabilities(context) {
  return Object.fromEntries(Object.entries(CUSTOMER_PERMISSIONS).map(([name, permission]) => [name, customerCan(context, permission)]));
}

// The CRM operations the Customer Master reuses (contacts, the shared
// duplicate matcher, the account timeline) check CRM permissions. The
// Customer Master has already checked its own, so it calls them with a
// context that carries the matching CRM rights.
export function crmContext(context, { overrideDuplicate = false } = {}) {
  const extra = [
    "crm.accounts.view", "crm.accounts.view_all", "crm.accounts.view_sensitive", "crm.accounts.edit", "crm.accounts.create_customer", "crm.records.view_all",
    "crm.contacts.view", "crm.contacts.view_sensitive", "crm.contacts.create", "crm.contacts.edit",
    ...(overrideDuplicate ? ["crm.duplicates.override"] : []),
  ];
  return { ...context, permissions: [...new Set([...(context.permissions ?? []), ...extra])] };
}

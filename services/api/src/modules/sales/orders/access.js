// Who may do what with sales orders, and which orders a caller sees.
//
// Visibility is Own / Team / All:
//   All  — organization owner or sales.order.view_all;
//   Team — with sales.order.view_team: orders owned by members of a sales
//          team the caller manages or belongs to;
//   Own  — orders the caller owns or created.
// Access to a delivery, an invoice or a warehouse never opens an order.
import { ORDER_PERMISSIONS, OrderError } from "./constants.js";

export function orderCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requireOrderPermission(context, permission, message = "You do not have permission to do this.") {
  if (!orderCan(context, permission)) throw new OrderError(403, message, "PERMISSION_DENIED");
}

export function requireOrderAccess(context) {
  if (!orderCan(context, ORDER_PERMISSIONS.view) && !orderCan(context, ORDER_PERMISSIONS.viewAll))
    throw new OrderError(403, "You do not have permission to view sales orders.", "PERMISSION_DENIED");
}

const MY_TEAMS = (me) => `(SELECT team.id FROM tenant.crm_sales_teams team
   WHERE team.organization_id = $1 AND team.status = 'active'
     AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
           WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'
             AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))))`;
export const teamOwnersSql = (me) => `(SELECT member.user_id FROM tenant.crm_sales_team_members member
   WHERE member.organization_id = $1 AND member.status = 'active' AND member.team_id IN ${MY_TEAMS(me)})`;

// " AND (…)" restricting `alias` to the orders the caller can see; "" for
// view-all callers. $1 must be the organization id.
export function orderScopeSql(context, values, alias = "sales_order") {
  if (orderCan(context, ORDER_PERMISSIONS.viewAll)) return "";
  values.push(context.userId ?? null);
  const me = `$${values.length}`;
  const own = `${alias}.owner_user_id = ${me} OR ${alias}.created_by = ${me}`;
  if (!orderCan(context, ORDER_PERMISSIONS.viewTeam)) return ` AND (${own})`;
  return ` AND (${own} OR ${alias}.owner_user_id IN ${teamOwnersSql(me)})`;
}

export function orderCapabilities(context) {
  return Object.fromEntries(Object.entries(ORDER_PERMISSIONS).map(([name, permission]) => [name, orderCan(context, permission)]));
}

export async function assertOrderVisible(client, context, orderId) {
  requireOrderAccess(context);
  const values = [context.organizationId, orderId];
  const scope = orderScopeSql(context, values, "sales_order");
  if (!scope) return;
  const { rows } = await client.query(`SELECT 1 FROM tenant.sales_orders sales_order WHERE sales_order.organization_id = $1 AND sales_order.id = $2${scope}`, values);
  if (!rows[0]) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
}

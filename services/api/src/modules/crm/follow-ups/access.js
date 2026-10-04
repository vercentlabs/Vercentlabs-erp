// Who may do what with a follow-up, and which follow-ups a caller can see.
//
// A follow-up is seen by the person it is assigned to and the person who
// scheduled it; by the managers of the assignee's sales team (View team
// follow-ups); or by everyone (View all follow-ups). In every case the caller
// must also be able to see the record it is about: a reminder never opens a
// confidential opportunity or contact to anyone.
import { CrmError } from "../data-management/errors.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { taskRelatedScopeSql } from "../tasks/access.js";
import { FOLLOW_UP_PERMISSIONS } from "./constants.js";

// crm.activities.manage is the permission follow-ups had before they were
// split up; it still stands for the day-to-day ones.
const LEGACY_MANAGE = "crm.activities.manage";
const COVERED_BY_MANAGE = new Set([
  FOLLOW_UP_PERMISSIONS.view, FOLLOW_UP_PERMISSIONS.create, FOLLOW_UP_PERMISSIONS.edit, FOLLOW_UP_PERMISSIONS.complete,
  FOLLOW_UP_PERMISSIONS.reschedule, FOLLOW_UP_PERMISSIONS.cancel,
]);

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));
const holds = (context, permission) => Boolean(context.permissions?.includes(permission));

export function followUpCan(context, permission) {
  if (isOwner(context) || holds(context, permission)) return true;
  if (permission === FOLLOW_UP_PERMISSIONS.view && (holds(context, "crm.view") || holds(context, FOLLOW_UP_PERMISSIONS.viewAll) || holds(context, FOLLOW_UP_PERMISSIONS.viewTeam))) return true;
  return COVERED_BY_MANAGE.has(permission) && holds(context, LEGACY_MANAGE);
}

export function requireFollowUpPermission(context, permission, message = "You do not have permission to do this.") {
  if (!followUpCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllFollowUps(context) {
  return isOwner(context) || holds(context, FOLLOW_UP_PERMISSIONS.viewAll) || holds(context, "crm.records.view_all");
}

// The record a follow-up is about must be visible: the same rule as tasks.
export const followUpRelatedScopeSql = (context, values, alias = "follow_up") => taskRelatedScopeSql(context, values, alias);

// " AND (…)" restricting `alias` to the follow-ups the caller can see. Adds its parameters to `values`.
export function followUpScopeSql(context, values, alias = "follow_up") {
  let own = "";
  if (!canViewAllFollowUps(context)) {
    values.push(context.userId);
    const me = `$${values.length}`;
    const team = followUpCan(context, FOLLOW_UP_PERMISSIONS.viewTeam) ? ` OR ${alias}.assigned_to IN (${managedTeamMembersSql(`${alias}.organization_id`, me)})` : "";
    own = ` AND (${alias}.assigned_to = ${me} OR ${alias}.created_by = ${me}${team})`;
  }
  return own + followUpRelatedScopeSql(context, values, alias);
}

export function followUpCapabilities(context) {
  return Object.fromEntries(Object.entries(FOLLOW_UP_PERMISSIONS).map(([name, permission]) => [name, followUpCan(context, permission)]));
}

// Who may do what with a task, and which tasks a caller can see.
//
// A task is seen by the person it is assigned to and the person who created
// it; by the managers of the assignee's sales team (View team tasks); or by
// everyone (View all tasks). In every case the caller must also be able to
// see the record the task is about: linking a task to a confidential
// opportunity never opens that opportunity to anyone.
import { accountScopeSql } from "../accounts/access.js";
import { contactScopeSql } from "../contacts/access.js";
import { CrmError } from "../data-management/errors.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { leadScopeSql } from "../leads/access.js";
import { opportunityScopeSql } from "../opportunities/access.js";
import { TASK_PERMISSIONS } from "./constants.js";

// crm.activities.manage is the permission tasks had before they were split
// up; it still stands for the day-to-day ones.
const LEGACY_MANAGE = "crm.activities.manage";
const COVERED_BY_MANAGE = new Set([
  TASK_PERMISSIONS.view, TASK_PERMISSIONS.create, TASK_PERMISSIONS.edit, TASK_PERMISSIONS.complete, TASK_PERMISSIONS.reopen,
  TASK_PERMISSIONS.cancel, TASK_PERMISSIONS.assign,
]);

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));
const holds = (context, permission) => Boolean(context.permissions?.includes(permission));

export function taskCan(context, permission) {
  if (isOwner(context) || holds(context, permission)) return true;
  if (permission === TASK_PERMISSIONS.view && (holds(context, "crm.view") || holds(context, TASK_PERMISSIONS.viewAll) || holds(context, TASK_PERMISSIONS.viewTeam))) return true;
  return COVERED_BY_MANAGE.has(permission) && holds(context, LEGACY_MANAGE);
}

export function requireTaskPermission(context, permission, message = "You do not have permission to do this.") {
  if (!taskCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function canViewAllTasks(context) {
  return isOwner(context) || holds(context, TASK_PERMISSIONS.viewAll) || holds(context, "crm.records.view_all");
}

// " AND (…)" restricting `alias` (a task row) to the record the task is about being visible.
export function taskRelatedScopeSql(context, values, alias = "task") {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const exists = (table, row, scope) =>
    `EXISTS (SELECT 1 FROM ${table} ${row} WHERE ${row}.organization_id = ${alias}.organization_id AND ${row}.id = ${alias}.entity_id${scope})`;
  return ` AND (${alias}.entity_id IS NULL
    OR (${alias}.entity_type = 'lead' AND ${exists("tenant.crm_leads", "scope_lead", leadScopeSql(context, values, "scope_lead"))})
    OR (${alias}.entity_type = 'opportunity' AND ${exists("tenant.crm_opportunities", "scope_opportunity", opportunityScopeSql(context, values, "scope_opportunity"))})
    OR (${alias}.entity_type = 'party' AND ${exists("tenant.business_parties", "scope_account", accountScopeSql(context, values, "scope_account"))})
    OR (${alias}.entity_type = 'contact' AND ${exists("tenant.contacts", "scope_contact", contactScopeSql(context, bind, "scope_contact"))})
    OR (${alias}.entity_type = 'campaign' AND ${exists("tenant.crm_campaigns", "scope_campaign", "")}))`;
}

// " AND (…)" restricting `alias` to the tasks the caller can see. Adds its parameters to `values`.
export function taskScopeSql(context, values, alias = "task") {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let own = "";
  if (!canViewAllTasks(context)) {
    const me = bind(context.userId);
    const team = taskCan(context, TASK_PERMISSIONS.viewTeam) ? ` OR ${alias}.assigned_to IN (${managedTeamMembersSql(`${alias}.organization_id`, me)})` : "";
    own = ` AND (${alias}.assigned_to = ${me} OR ${alias}.created_by = ${me}${team})`;
  }
  return own + taskRelatedScopeSql(context, values, alias);
}

// What the caller may do with tasks, for the UI to hide what would be refused.
export function taskCapabilities(context) {
  return Object.fromEntries(Object.entries(TASK_PERMISSIONS).map(([name, permission]) => [name, taskCan(context, permission)]));
}

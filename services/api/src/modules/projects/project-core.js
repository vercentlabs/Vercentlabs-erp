// Projects — the shared core: permissions and the access rules that combine them with project membership, errors, the company's project
// policy and types, loaders, the history every command writes (status events, the activity timeline, domain events for automation) and the
// notifications a project sends.
import { publishDomainEvent } from "../../core/platform/events/index.js";
import { createNotification } from "../../core/platform/notifications/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";

export const PROJECT = Object.freeze({
  view: "projects.view", viewAll: "projects.view_all", create: "projects.create", edit: "projects.edit", approve: "projects.approve", members: "projects.members.manage",
  links: "projects.links.manage", start: "projects.start", hold: "projects.hold", resume: "projects.resume", complete: "projects.complete", reopen: "projects.reopen",
  cancel: "projects.cancel", archive: "projects.archive", financialView: "projects.financial_view", export: "projects.export", reports: "projects.reports.view",
  settings: "projects.settings.manage",
  customerView: "projects.customer.view", customerAssign: "projects.customer.assign", customerChange: "projects.customer.change", customerContacts: "projects.customer.contacts.manage",
  customerSalesLink: "projects.customer.sales_link", customerSites: "projects.customer.address.manage", customerHistory: "projects.customer.history.view", customerExport: "projects.customer.export",
  milestoneView: "projects.milestones.view", milestoneCreate: "projects.milestones.create", milestoneEdit: "projects.milestones.edit", milestoneAssign: "projects.milestones.assign",
  milestoneLinks: "projects.milestones.links.manage", milestoneSubmit: "projects.milestones.submit", milestoneApprove: "projects.milestones.approve",
  milestoneCustomer: "projects.milestones.customer_acceptance", milestoneWaive: "projects.milestones.waive", milestoneComplete: "projects.milestones.complete",
  milestoneReopen: "projects.milestones.reopen", milestoneCancel: "projects.milestones.cancel", milestoneBilling: "projects.milestones.billing.view",
  milestoneExport: "projects.milestones.export",
  taskView: "projects.tasks.view", taskCreate: "projects.tasks.create", taskEdit: "projects.tasks.edit", taskAssign: "projects.tasks.assign", taskStart: "projects.tasks.start",
  taskBlock: "projects.tasks.block", taskComplete: "projects.tasks.complete", taskSubmit: "projects.tasks.submit_review", taskApprove: "projects.tasks.approve",
  taskRequestChanges: "projects.tasks.request_changes", taskReopen: "projects.tasks.reopen", taskCancel: "projects.tasks.cancel", taskBulk: "projects.tasks.bulk_manage",
  taskExport: "projects.tasks.export",
});
export const STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PLANNED: "Planned", IN_PROGRESS: "In progress", ON_HOLD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled" });
export const PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const ROLES = Object.freeze({ MANAGER: "Project Manager", MEMBER: "Project Member", VIEWER: "Project Viewer", FINANCIAL_VIEWER: "Project Financial Viewer" });
export const ACTIVE_STATUSES = Object.freeze(["PLANNED", "IN_PROGRESS", "ON_HOLD"]);

const MESSAGES = Object.freeze({
  PROJECT_NAME_REQUIRED: "Enter a project name.",
  PROJECT_CUSTOMER_REQUIRED: "Select a customer before activating this project.",
  PROJECT_CUSTOMER_NOT_FOUND: "The selected customer could not be found.",
  PROJECT_CUSTOMER_INACTIVE: "This customer is inactive. Choose an eligible customer or request authorization.",
  PROJECT_CUSTOMER_COMPANY_MISMATCH: "This customer belongs to a different Company.",
  PROJECT_CUSTOMER_CONTACT_INVALID: "This contact is not associated with the selected customer.",
  PROJECT_CUSTOMER_PRIMARY_DUPLICATE: "Only one primary contact is allowed.",
  PROJECT_CUSTOMER_SALES_MISMATCH: "The Sales document belongs to a different customer.",
  PROJECT_CUSTOMER_CHANGE_BLOCKED: "Resolve linked financial or delivery obligations before changing the customer.",
  PROJECT_CUSTOMER_APPROVAL_REQUIRED: "A manager must approve this customer change.",
  PROJECT_CUSTOMER_MAPPING_UNRESOLVED: "The CRM Account must be linked to a valid Customer record.",
  PROJECT_CUSTOMER_MERGE_REVIEW: "This customer merge requires review before updating the project.",
  PROJECT_CUSTOMER_VERSION_CONFLICT: "Project details changed. Refresh and review.",
  PROJECT_CUSTOMER_PERMISSION_DENIED: "You do not have permission for this action.",
  PROJECT_MANAGER_REQUIRED: "Assign a Project Manager before starting.",
  PROJECT_MANAGER_INVALID: "Select an active, authorized team member.",
  PROJECT_DATE_INVALID: "The target date cannot be before the start date.",
  PROJECT_STATUS_INVALID: "This action is not allowed in the project's current status.",
  PROJECT_ACTIVE_HOLD: "Resolve the project Hold before continuing.",
  PROJECT_COMPLETION_BLOCKED: "Some required work or approvals are still outstanding.",
  PROJECT_DEPENDENCIES_EXIST: "Review linked work and business records before cancelling.",
  PROJECT_LINK_INVALID: "This record cannot be linked to the selected project.",
  PROJECT_PERMISSION_DENIED: "You do not have permission for this action.",
  PROJECT_VERSION_CONFLICT: "Someone updated this project. Refresh before saving.",
  PROJECT_ALREADY_ARCHIVED: "This project is already archived.",
  PROJECT_OPERATION_UNKNOWN: "Checking whether the previous action succeeded. Do not submit it again.",
  PROJECT_NOT_FOUND: "The project could not be found.",
  PROJECT_INPUT_INVALID: "Check the highlighted information.",
  PROJECT_REASON_REQUIRED: "Give a reason.",
  PROJECT_TYPE_REQUIRED: "Choose the project type.",
  // Milestones (0128).
  MILESTONE_PROJECT_INVALID: "Select a valid Project.",
  MILESTONE_NOT_FOUND: "The milestone could not be found.",
  MILESTONE_NAME_REQUIRED: "Enter a milestone name.",
  MILESTONE_OWNER_INVALID: "Select an authorized project member.",
  MILESTONE_DATE_INVALID: "Review the milestone dates.",
  MILESTONE_INPUT_INVALID: "Check the highlighted information.",
  MILESTONE_DEPENDENCY_CYCLE: "This dependency would create a circular sequence.",
  MILESTONE_DEPENDENCY_INVALID: "This milestone cannot depend on that one.",
  MILESTONE_DEPENDENCY_OPEN: "Complete the prerequisite milestones first.",
  MILESTONE_DEPENDENTS_EXIST: "Review the milestones that depend on this one first.",
  MILESTONE_REQUIRED_TASKS_OPEN: "Complete or resolve required tasks first.",
  MILESTONE_TASKS_NOT_AVAILABLE: "Project tasks are not available yet.",
  MILESTONE_TASK_INVALID: "Link a task of the same project that is not counted toward another milestone.",
  MILESTONE_CRITERIA_INCOMPLETE: "Complete the required deliverables.",
  MILESTONE_CRITERIA_REQUIRED: "Add at least one completion criterion first.",
  MILESTONE_EVIDENCE_MISSING: "Add the required completion evidence.",
  MILESTONE_BLOCKED: "Resolve the open blockers first.",
  MILESTONE_APPROVAL_REQUIRED: "The milestone requires approval.",
  MILESTONE_APPROVAL_NOT_NEEDED: "This milestone needs no approval: complete it directly.",
  MILESTONE_CUSTOMER_ACCEPTANCE_REQUIRED: "Record the required customer acceptance.",
  MILESTONE_CUSTOMER_CONTACT_INVALID: "Choose one of the project's active customer contacts.",
  MILESTONE_APPROVAL_STALE: "Milestone details changed. Submit them for approval again.",
  MILESTONE_SELF_APPROVAL: "Someone other than the submitter must approve this milestone.",
  MILESTONE_ALREADY_DECIDED: "This submission already has that decision.",
  MILESTONE_ALREADY_COMPLETED: "This milestone has already been completed.",
  MILESTONE_SUBMITTED_LOCKED: "This milestone is under review. Withdraw the submission to change it.",
  MILESTONE_STATUS_INVALID: "This action is not allowed in the milestone's current status.",
  MILESTONE_BILLING_ALREADY_REQUESTED: "A billing request already exists for this milestone.",
  MILESTONE_BILLING_BLOCKED: "Review the linked Sales Order and billing stage.",
  MILESTONE_BILLING_REQUESTED: "This milestone has a billing request. Acknowledge that it stays with Sales.",
  MILESTONE_PROJECT_ON_HOLD: "Project work is on Hold.",
  MILESTONE_PROJECT_CLOSED: "The project is closed: its milestones are read-only.",
  MILESTONE_VERSION_CONFLICT: "Another user changed this milestone. Refresh and review.",
  MILESTONE_PERMISSION_DENIED: "You do not have permission for this action.",
  MILESTONE_REASON_REQUIRED: "Give a reason.",
  TASK_TITLE_REQUIRED: "Enter a Task name.",
  TASK_PROJECT_INVALID: "This Project is not available.",
  TASK_NOT_FOUND: "The task could not be found.",
  TASK_ASSIGNEE_INVALID: "Select an authorized Project member.",
  TASK_REVIEWER_INVALID: "Select a reviewer who works on this Project.",
  TASK_DUE_DATE_INVALID: "Enter a valid due date.",
  TASK_MILESTONE_INVALID: "Select a milestone from this Project.",
  TASK_INPUT_INVALID: "Check the task details.",
  TASK_DEPENDENCY_CYCLE: "This dependency would create a circular sequence.",
  TASK_DEPENDENCY_INVALID: "Choose another task of this Project as the prerequisite.",
  TASK_DEPENDENCY_OPEN: "Complete the required earlier Task first.",
  TASK_DEPENDENTS_EXIST: "Other tasks depend on this task. Review them first.",
  TASK_CHECKLIST_INCOMPLETE: "Complete the required checklist items.",
  TASK_EVIDENCE_REQUIRED: "Add the completion evidence: a note, a file or a document reference.",
  TASK_REVIEW_REQUIRED: "Submit this Task for review.",
  TASK_REVIEW_NOT_REQUIRED: "This task needs no review: complete it directly.",
  TASK_REVIEW_STALE: "The Task changed. Submit it for review again.",
  TASK_SELF_REVIEW: "Someone other than the person who submitted it must review this task.",
  TASK_ALREADY_DECIDED: "This submission has already been decided.",
  TASK_IN_REVIEW: "This task is under review. Withdraw it from review to change it.",
  TASK_BLOCKER_ACTIVE: "Resolve the Task blocker before continuing.",
  TASK_PROJECT_ON_HOLD: "This Project is on Hold.",
  TASK_PROJECT_NOT_STARTED: "Start the Project before working on its tasks.",
  TASK_PROJECT_CLOSED: "This Project is closed: its tasks are read-only.",
  TASK_ALREADY_COMPLETED: "This Task is already completed.",
  TASK_STATUS_INVALID: "This task cannot do that in its current status.",
  TASK_REOPEN_APPROVAL_REQUIRED: "Reopening requires authorization.",
  TASK_MILESTONE_REVIEW: "Its milestone is under review or complete. Confirm you have reviewed the impact on the milestone.",
  TASK_RECURRENCE_UNSUPPORTED: "Recurring tasks are not available yet. Create the task once.",
  TASK_VERSION_CONFLICT: "This Task was updated by someone else. Refresh and review.",
  TASK_PERMISSION_DENIED: "You do not have permission for this action.",
  TASK_REASON_REQUIRED: "Give a reason.",
  ASSIGNEE_TASK_STATUS_INVALID: "This Task cannot be reassigned in its current status.",
  ASSIGNEE_PROJECT_STATUS_INVALID: "Assignment changes are not allowed in this Project state.",
  ASSIGNEE_REASON_REQUIRED: "Explain why this Task is being reassigned.",
  ASSIGNEE_VERSION_CONFLICT: "The Task has changed. Refresh before assigning it.",
  ASSIGNEE_MEMBER_HAS_OPEN_WORK: "Reassign open Tasks before removing this team member.",
  ASSIGNEE_TASK_ALREADY_ASSIGNED: "This Task is already assigned to the selected person.",
  ASSIGNEE_REVIEWER_CONFLICT: "The reviewer cannot also be the assignee.",
  PROJECT_STATUS_INVALID_TRANSITION: "This action is not allowed in the project's current status.",
  PROJECT_STATUS_ACTIVATION_INCOMPLETE: "Complete the required project details before activating.",
  PROJECT_STATUS_MANAGER_REQUIRED: "Assign an active Project Manager.",
  PROJECT_STATUS_HOLD_ALREADY_ACTIVE: "This project is already on Hold.",
  PROJECT_STATUS_HOLD_REASON_REQUIRED: "Explain why the project must be paused.",
  PROJECT_STATUS_HOLD_UNRESOLVED: "Resolve the outstanding Hold reasons before resuming.",
  PROJECT_STATUS_REQUIRED_TASKS_OPEN: "Required Tasks are still incomplete.",
  PROJECT_STATUS_MILESTONES_OPEN: "Required Milestones are not yet completed.",
  PROJECT_STATUS_CUSTOMER_ACCEPTANCE: "Customer acceptance is still required.",
  PROJECT_STATUS_COMPLETION_CHECKS: "Complete the closing checks before completing the project.",
  PROJECT_STATUS_COMPLETION_APPROVAL: "A Project Manager or authorized approver must approve completion.",
  PROJECT_STATUS_CANCEL_DEPENDENCIES: "Review outstanding work and linked business obligations before cancelling.",
  PROJECT_STATUS_REOPEN_NOT_ALLOWED: "This project cannot be reopened using the ordinary workflow.",
  PROJECT_STATUS_VERSION_CONFLICT: "The project changed. Refresh and review before proceeding.",
  PROJECT_STATUS_PERMISSION_DENIED: "You do not have permission for this action.",
  PROJECT_STATUS_OPERATION_UNKNOWN: "Checking the previous request. Do not submit again.",
  PRIORITY_INVALID: "Select Low, Normal, High or Urgent.",
  PRIORITY_RECORD_NOT_FOUND: "This Project, Milestone or Task could not be found.",
  PRIORITY_REASON_REQUIRED: "Explain why this work is being marked Urgent or reduced from Urgent.",
  PRIORITY_PERMISSION_DENIED: "You do not have permission to change this priority.",
  PRIORITY_RECORD_COMPLETED: "Reopen this completed work through the authorized workflow before making this change.",
  PRIORITY_RECORD_CANCELLED: "Cancelled work cannot be reprioritized.",
  PRIORITY_VERSION_CONFLICT: "Someone changed this record. Refresh before continuing.",
  PRIORITY_BULK_PARTIAL_FAILURE: "Some priorities could not be updated. Review the results.",
  PRIORITY_OPERATION_UNKNOWN: "Checking whether the previous update succeeded. Do not submit it again.",
});
export class ProjectError extends Error {
  constructor(status, code, message, details) {
    super(message ?? MESSAGES[code] ?? "The project action failed.");
    this.name = "ProjectError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const projectError = (status, code, message, details) => new ProjectError(status, code, message, details);

export function projectsContext(session) {
  return { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw projectError(400, "PROJECT_INPUT_INVALID", `${label} is invalid.`);
  return String(value);
};
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const isOwner = (c) => Boolean(c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator"));
export const has = (c, permission) => isOwner(c) || Boolean(c.permissions?.includes(permission));
export const need = (c, permission) => { if (!has(c, permission)) throw projectError(403, "PROJECT_PERMISSION_DENIED"); };
export const seesAll = (c) => has(c, PROJECT.viewAll);
export const canView = (c) => has(c, PROJECT.view) || has(c, PROJECT.viewAll);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isoDay = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const day = String(value).slice(0, 10);
  // A real calendar day (2026-02-31 is not one, though Date would roll it over).
  const parsed = DAY.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw projectError(400, "PROJECT_DATE_INVALID", "Enter a valid date.");
  return day;
};
export const today = async (client) => (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;

// ------------------------------------------------------------------ policy and types
export async function projectSettings(client, c) {
  const row = (await client.query(`SELECT * FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { activationApprovalRequired: Boolean(row.activation_approval_required), selfApprovalAllowed: Boolean(row.self_approval_allowed),
    dueSoonDays: Number(row.due_soon_days ?? 7), customerAcceptanceRequired: Boolean(row.customer_acceptance_required),
    // Customer Association: a customer change past the draft needs someone else's approval; activation needs a primary contact; an inactive
    // customer may be chosen for a new association.
    customerChangeApprovalRequired: row.customer_change_approval_required ?? true, primaryContactRequired: Boolean(row.primary_contact_required),
    inactiveCustomerAllowed: Boolean(row.inactive_customer_allowed),
    // Milestones: whoever submitted may also approve; a new milestone needs internal approval unless the form says otherwise.
    milestoneSelfApprovalAllowed: Boolean(row.milestone_self_approval_allowed), milestoneInternalApprovalDefault: row.milestone_internal_approval_default ?? true,
    // Tasks: whoever submitted may also approve; a new task needs review by default; the due-soon reminder's lead time.
    taskSelfReviewAllowed: Boolean(row.task_self_review_allowed), taskReviewDefault: Boolean(row.task_review_default), taskReminderDays: Number(row.task_reminder_days ?? 1) };
}
const STANDARD_TYPES = [["IMPLEMENTATION", "Customer implementation", 10], ["SOFTWARE", "Software development", 20], ["DESIGN", "Design", 30], ["CONSTRUCTION", "Construction or installation", 40],
  ["MARKETING", "Marketing campaign", 50], ["CONSULTING", "Consulting engagement", 60], ["SERVICE_DELIVERY", "Service delivery", 70], ["INTERNAL", "Internal initiative", 80], ["OTHER", "Other", 90]];
// A company created after the migration gets the standard types the first time it uses Projects.
export async function ensureProjectTypes(client, c) {
  if ((await client.query(`SELECT 1 FROM tenant.project_types WHERE organization_id = $1 LIMIT 1`, [c.organizationId])).rows[0]) return;
  for (const [code, name, order] of STANDARD_TYPES) {
    await client.query(`INSERT INTO tenant.project_types (organization_id, code, name, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.organizationId, code, name, order]);
  }
}
export const nextProjectCode = (client, c) => nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "project" });

// ------------------------------------------------------------------ loading and access
export async function loadProject(client, c, projectId, { lock = false, includeDeleted = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(projectId, "Project")])).rows[0];
  if (!row || (row.deleted_at && !includeDeleted)) throw projectError(404, "PROJECT_NOT_FOUND");
  return row;
}
export async function membershipOf(client, c, projectId, userId = c.userId) {
  if (!userId) return null;
  return (await client.query(`SELECT * FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL`,
    [c.organizationId, projectId, userId])).rows[0] ?? null;
}
// What the person may do on this project: the company permission, and — unless they see every project — being its manager (or, to
// contribute, a member). A project role never grants what the company role denies.
export async function accessOf(client, c, project) {
  const member = await membershipOf(client, c, project.id);
  const all = seesAll(c);
  const manager = Boolean(c.userId) && project.manager_user_id === c.userId;
  const visible = canView(c) && (all || manager || Boolean(member));
  const role = manager ? "MANAGER" : member?.role ?? null;
  const steer = (permission) => visible && has(c, permission) && (all || manager);
  return {
    visible, all, manager, role,
    can: {
      edit: steer(PROJECT.edit), members: steer(PROJECT.members), links: steer(PROJECT.links), start: steer(PROJECT.start), hold: steer(PROJECT.hold),
      resume: steer(PROJECT.resume), complete: steer(PROJECT.complete), reopen: steer(PROJECT.reopen), cancel: steer(PROJECT.cancel), archive: steer(PROJECT.archive),
      approve: visible && has(c, PROJECT.approve),
      contribute: visible && (all || manager || ["MANAGER", "MEMBER"].includes(member?.role)),
      financials: visible && has(c, PROJECT.financialView) && (all || ["MANAGER", "FINANCIAL_VIEWER"].includes(role)),
    },
  };
}
export async function visibleProject(client, c, projectId, options = {}) {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const project = await loadProject(client, c, projectId, options);
  const access = await accessOf(client, c, project);
  // Someone who may not see it learns nothing about it.
  if (!access.visible) throw projectError(404, "PROJECT_NOT_FOUND");
  return { project, access };
}
export const requireAccess = (access, key) => { if (!access.can[key]) throw projectError(403, "PROJECT_PERMISSION_DENIED"); };
// The SQL condition limiting a list to the projects the person may see ($n is the user id).
// (Someone who sees every project still names the parameter, so the statement's parameters stay the same.)
export const visibilitySql = (c, alias, userParam) => (seesAll(c) ? `(${userParam}::uuid IS NULL OR TRUE)`
  : `(${alias}.manager_user_id = ${userParam} OR EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = ${alias}.id AND member.user_id = ${userParam} AND member.left_at IS NULL))`);
export const versionCheck = (project, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(project.row_version)) throw projectError(409, "PROJECT_VERSION_CONFLICT");
};

// Someone who can be on a project: an active member of the company whose role lets them see projects.
export async function eligibleUsers(client, c, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = (await client.query(
    `SELECT DISTINCT membership.user_id FROM public.organization_memberships membership
       JOIN public.users person ON person.id = membership.user_id
       JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
        AND (assignment.starts_at IS NULL OR assignment.starts_at <= now()) AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND person.status = 'active' AND membership.user_id = ANY($2::uuid[])
        AND (role.slug IN ('organization_owner', 'system_administrator')
             OR EXISTS (SELECT 1 FROM public.role_permissions grant_row WHERE grant_row.role_id = role.id AND grant_row.permission_key IN ('projects.view', 'projects.view_all')))`,
    [c.organizationId, ids])).rows;
  return new Set(rows.map((row) => row.user_id));
}
export async function userNames(client, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
}

// ------------------------------------------------------------------ history
export async function projectEvent(client, c, projectId, action, summary = null, details = {}) {
  await client.query(`INSERT INTO tenant.project_events (organization_id, project_id, action, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [c.organizationId, projectId, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
export async function statusEvent(client, c, project, action, toStatus, reason = null, key = null) {
  await client.query(`INSERT INTO tenant.project_status_events (organization_id, project_id, action, from_status, to_status, reason, actor_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.organizationId, project.id, action, project.status, toStatus, reason, c.userId ?? null, key]);
}
// The outbox event automation and webhooks consume (committed with the change, or not at all).
export async function publishProjectEvent(client, c, project, type, payload = {}) {
  await publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: `projects.project.${type}`, entityType: "projects.project", entityId: project.id,
    payload: { projectCode: project.project_code, status: payload.status ?? project.status, managerUserId: payload.managerUserId ?? project.manager_user_id ?? null, ...payload } });
}

// ------------------------------------------------------------------ notifications
// To the given people (never the actor), linked to the project.
export async function notifyProject(client, c, project, userIds, { category = "project_update", title, message }) {
  const users = new Set(userIds.filter(Boolean));
  users.delete(c.userId);
  for (const userId of users) {
    await createNotification(client, { organizationId: c.organizationId, userId, category, title, message, href: `/projects/${project.id}`, entityType: "projects.project", entityId: project.id });
  }
}
export async function activeMemberIds(client, c, projectId) {
  return (await client.query(`SELECT user_id FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND left_at IS NULL`, [c.organizationId, projectId])).rows.map((row) => row.user_id);
}
// Checks run before someone leaves a project team (Tasks: open tasks are reassigned, or kept by an authorized exception).
const MEMBER_LEAVE_HOOKS = [];
export function registerMemberLeaveHook(hook) { if (typeof hook === "function" && !MEMBER_LEAVE_HOOKS.includes(hook)) MEMBER_LEAVE_HOOKS.push(hook); }
export async function beforeMemberLeaves(client, c, project, userId, input = {}) { for (const hook of MEMBER_LEAVE_HOOKS) await hook(client, c, project, userId, input); }
// Progress Tracking listens to every change of scope or state (a task added, done, reopened or cancelled; a milestone completed, reopened,
// cancelled or waived; the project's lifecycle) and records how progress moved, in the same transaction.
const PROGRESS_LISTENERS = [];
export function registerProgressListener(listener) { if (typeof listener === "function" && !PROGRESS_LISTENERS.includes(listener)) PROGRESS_LISTENERS.push(listener); }
export async function progressChanged(client, c, projectId, cause) { for (const listener of PROGRESS_LISTENERS) await listener(client, c, projectId, cause); }
export const label = (project) => `${project.project_code}${project.name ? ` · ${project.name}` : ""}`;

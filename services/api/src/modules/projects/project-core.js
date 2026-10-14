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
});
export const STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PLANNED: "Planned", IN_PROGRESS: "In progress", ON_HOLD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled" });
export const PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const ROLES = Object.freeze({ MANAGER: "Project Manager", MEMBER: "Project Member", VIEWER: "Project Viewer", FINANCIAL_VIEWER: "Project Financial Viewer" });
export const ACTIVE_STATUSES = Object.freeze(["PLANNED", "IN_PROGRESS", "ON_HOLD"]);

const MESSAGES = Object.freeze({
  PROJECT_NAME_REQUIRED: "Enter a project name.",
  PROJECT_CUSTOMER_REQUIRED: "Select a customer for this project.",
  PROJECT_CUSTOMER_INVALID: "The selected customer is not available to your Company.",
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
    dueSoonDays: Number(row.due_soon_days ?? 7), customerAcceptanceRequired: Boolean(row.customer_acceptance_required) };
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
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND membership.user_id = ANY($2::uuid[])
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
export const label = (project) => `${project.project_code}${project.name ? ` · ${project.name}` : ""}`;

// Projects — Comments and Collaboration, the rules: the errors, the company's comment policy, safe text, and the one question every read,
// write, mention, notification, file and search result asks — who may see this discussion, and this comment in it. Access is always the
// parent record's (the project, task or milestone, as their own features decide it), narrowed by the comment's visibility; a comment,
// mention or notification never grants access.
import { has, isOwner, projectError, seesAll, text, uuid, visibleProject } from "../project-core.js";
import { milestoneScope } from "../project-milestone-read.js";
import { taskScope } from "../project-task-read.js";

export const COMMENT = Object.freeze({
  view: "projects.comments.view", create: "projects.comments.create", reply: "projects.comments.reply", editOwn: "projects.comments.edit_own",
  deleteOwn: "projects.comments.delete_own", moderate: "projects.comments.moderate", history: "projects.comments.view_history",
  restrictedView: "projects.comments.restricted_view", restrictedCreate: "projects.comments.restricted_create", attach: "projects.comments.attach",
  mention: "projects.comments.mention", export: "projects.comments.export",
});
export const PARENT_TYPES = Object.freeze(["PROJECT", "TASK", "MILESTONE"]);
export const PARENT_LABEL = Object.freeze({ PROJECT: "Project", TASK: "Task", MILESTONE: "Milestone" });

const MESSAGES = Object.freeze({
  COMMENT_BODY_REQUIRED: "Write a comment before posting.",
  COMMENT_TOO_LONG: "This comment exceeds the allowed length.",
  COMMENT_PARENT_NOT_FOUND: "The selected Project, Task or Milestone is unavailable.",
  COMMENT_PARENT_ACCESS_DENIED: "You do not have permission to discuss this record.",
  COMMENT_MENTION_INVALID: "One or more mentioned users are not available for this discussion.",
  COMMENT_REPLY_INVALID: "This reply cannot be added to that discussion.",
  COMMENT_EDIT_NOT_ALLOWED: "You cannot edit this comment.",
  COMMENT_ALREADY_DELETED: "This comment has already been removed.",
  COMMENT_RESTRICTED_ACCESS: "You cannot access this restricted discussion.",
  COMMENT_ATTACHMENT_INVALID: "This attachment is unavailable or not permitted.",
  COMMENT_RECORD_READ_ONLY: "New comments are restricted for this completed record.",
  COMMENT_VERSION_CONFLICT: "This comment changed. Refresh before editing.",
  COMMENT_OPERATION_UNKNOWN: "Checking whether your comment was saved. Please do not post it again yet.",
  COMMENT_NOT_FOUND: "The comment could not be found.",
  COMMENT_PERMISSION_DENIED: "You do not have permission for this action.",
});
export const commentError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);
export const COMMENT_MESSAGES = MESSAGES;
export const keyOf = (input) => text(input?.idempotencyKey, 200) || null;

// ------------------------------------------------------------------ policy
export async function commentPolicy(client, c) {
  const row = (await client.query(`SELECT comment_edit_window_minutes, comment_max_length FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { editWindowMinutes: Number(row.comment_edit_window_minutes ?? 1440), maxLength: Number(row.comment_max_length ?? 5000) };
}

// The text as typed, made safe to keep: line breaks normalized, control characters removed, trailing spaces trimmed. It is stored and shown
// as text (never as HTML): formatting is a small markdown subset the screen renders, and links are made safe there.
export function cleanBody(value, policy) {
  const raw = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n");
  const body = raw.replace(/^\n+|\s+$/g, "");
  if (!body.trim()) throw commentError(400, "COMMENT_BODY_REQUIRED");
  if (body.length > policy.maxLength) throw commentError(400, "COMMENT_TOO_LONG", `This comment is ${body.length} characters; the limit is ${policy.maxLength}.`, { length: body.length, max: policy.maxLength });
  return body;
}

// ------------------------------------------------------------------ the parent record
const parentType = (value) => {
  const type = String(value ?? "").toUpperCase();
  if (!PARENT_TYPES.includes(type)) throw commentError(400, "COMMENT_PARENT_NOT_FOUND");
  return type;
};
// The project, task or milestone the discussion belongs to — through its own feature's access rules, so someone who may not see it learns
// nothing about it. Returns what this person may do in its discussion, and why new comments are closed when they are.
export async function parentAccess(client, c, type, id) {
  const kind = parentType(type);
  let parentId;
  try { parentId = uuid(id, "Record"); } catch { throw commentError(404, "COMMENT_PARENT_NOT_FOUND"); }
  if (!has(c, COMMENT.view)) throw commentError(403, "COMMENT_PARENT_ACCESS_DENIED");
  let project; let access; let parent; let contribute; let label; let owners = [];
  try {
    if (kind === "PROJECT") {
      ({ project, access } = await visibleProject(client, c, parentId));
      parent = project;
      contribute = access.can.contribute;
      label = `${project.project_code}${project.name ? ` · ${project.name}` : ""}`;
      owners = [project.manager_user_id];
    } else if (kind === "TASK") {
      const scope = await taskScope(client, c, parentId);
      ({ project, access } = scope);
      parent = scope.task;
      contribute = Boolean(scope.can.comment ?? access.can.contribute);
      label = `${parent.task_code} · ${parent.title}`;
      owners = [parent.assignee_user_id];
    } else {
      const scope = await milestoneScope(client, c, parentId);
      ({ project, access } = scope);
      parent = scope.milestone;
      contribute = access.can.contribute;
      label = `${parent.milestone_code} · ${parent.name}`;
      owners = [parent.owner_user_id];
    }
  } catch (failure) {
    if (failure?.status === 404) throw commentError(404, "COMMENT_PARENT_NOT_FOUND");
    if (failure?.status === 403) throw commentError(403, "COMMENT_PARENT_ACCESS_DENIED");
    throw failure;
  }
  const manager = Boolean(c.userId) && (project.manager_user_id === c.userId || access.role === "MANAGER");
  const restricted = has(c, COMMENT.restrictedView) && (seesAll(c) || manager || isOwner(c));
  // A closed project keeps its discussion; new comments there are a moderator's controlled follow-up.
  const closed = ["COMPLETED", "CANCELLED"].includes(project.status) || Boolean(project.archived_at) || Boolean(project.deleted_at);
  const moderator = has(c, COMMENT.moderate) && (seesAll(c) || manager);
  const readOnly = closed && !moderator;
  const write = has(c, COMMENT.create) && (contribute || moderator);
  return {
    type: kind, id: parent.id, project, parent, label, access, owners: owners.filter(Boolean),
    can: { read: true, write: write && !readOnly, readOnly, restricted, restrictedCreate: write && !readOnly && has(c, COMMENT.restrictedCreate) && (seesAll(c) || manager || isOwner(c)),
      moderate: moderator, history: has(c, COMMENT.history) && (seesAll(c) || manager), attach: has(c, COMMENT.attach), mention: has(c, COMMENT.mention), reply: has(c, COMMENT.reply) },
    readOnlyReason: readOnly ? (project.archived_at ? "This project is archived: its discussion is read-only." : `This project is ${project.status === "COMPLETED" ? "completed" : "cancelled"}: its discussion is read-only.`) : null,
  };
}
export const parentHref = (type, id, projectId) => (type === "TASK" ? `/projects/tasks/${id}?tab=comments` : type === "MILESTONE" ? `/projects/milestones/${id}?tab=comments` : `/projects/${projectId ?? id}?tab=comments`);

// ------------------------------------------------------------------ who else may read it
// Each candidate's company permissions, from their active roles (owners and system administrators hold everything).
export async function permissionsOf(client, c, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await client.query(`SELECT assignment.user_id, role.slug, grant_row.permission_key FROM public.user_role_assignments assignment
      JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      JOIN public.organization_memberships membership ON membership.organization_id = assignment.organization_id AND membership.user_id = assignment.user_id AND membership.status = 'active'
      JOIN public.users person ON person.id = assignment.user_id AND person.status = 'active'
      LEFT JOIN public.role_permissions grant_row ON grant_row.role_id = role.id
     WHERE assignment.organization_id = $1 AND assignment.user_id = ANY($2::uuid[]) AND assignment.status = 'active'
       AND (assignment.starts_at IS NULL OR assignment.starts_at <= now()) AND (assignment.expires_at IS NULL OR assignment.expires_at > now())`, [c.organizationId, ids])).rows;
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.user_id) ?? { owner: false, keys: new Set() };
    if (["organization_owner", "system_administrator"].includes(row.slug)) entry.owner = true;
    if (row.permission_key) entry.keys.add(row.permission_key);
    map.set(row.user_id, entry);
  }
  return map;
}
// Of these people, the ones who may read a comment of this visibility on this record now: an active account in the company, the record's
// own view permission, on the project's team (its manager or an active member) or able to see every project, and — for a restricted
// comment — the restricted permission as its manager or a portfolio reader. Used for mentions, notifications and followers alike.
export async function readersOf(client, c, scope, userIds, visibility = "INHERIT") {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const perms = await permissionsOf(client, c, ids);
  const members = new Map((await client.query(`SELECT user_id, role FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND left_at IS NULL AND user_id = ANY($3::uuid[])`,
    [c.organizationId, scope.project.id, ids])).rows.map((row) => [row.user_id, row.role]));
  const recordView = scope.type === "TASK" ? "projects.tasks.view" : scope.type === "MILESTONE" ? "projects.milestones.view" : null;
  const result = new Set();
  for (const id of ids) {
    const entry = perms.get(id);
    if (!entry) continue;
    const can = (key) => entry.owner || entry.keys.has(key);
    const all = can("projects.view_all");
    const manager = scope.project.manager_user_id === id || members.get(id) === "MANAGER";
    if (!(can("projects.view") || all)) continue;
    if (!(all || manager || members.has(id))) continue;
    if (!can(COMMENT.view) || (recordView && !can(recordView))) continue;
    if (visibility === "RESTRICTED" && !(can(COMMENT.restrictedView) && (all || manager || entry.owner))) continue;
    result.add(id);
  }
  return result;
}
// The people who follow a discussion: whoever chose to, plus its natural owner (the task's assignee, the milestone's owner, the project's
// manager) and everyone who commented in it — minus those who muted it.
export async function followersOf(client, c, scope) {
  const rows = (await client.query(`SELECT user_id, status FROM tenant.project_comment_subscriptions WHERE organization_id = $1 AND parent_type = $2 AND parent_id = $3`,
    [c.organizationId, scope.type, scope.id])).rows;
  const muted = new Set(rows.filter((row) => row.status === "MUTED").map((row) => row.user_id));
  const following = new Set([...rows.filter((row) => row.status === "FOLLOWING").map((row) => row.user_id), ...scope.owners]);
  return [...following].filter((id) => !muted.has(id));
}
export function canSeeComment(scope, comment) {
  return comment.visibility !== "RESTRICTED" || scope.can.restricted;
}

// Collaboration (F227): comments with mentions on a project, task or milestone.
import {
  has,
  isMember,
  loadProject,
  need,
  oneOf,
  ProjectError,
  qx,
  recordEvent,
  requiredText,
  uuid,
} from "./common.js";

const isPm = (c, p) => p.project_manager_id === c.userId || has(c, "projects.manage") || has(c, "projects.approve");
async function requireContributor(client, c, p) {
  need(c, "projects.view");
  if (has(c, "projects.manage") || has(c, "projects.tasks.manage") || p.project_manager_id === c.userId) return;
  if (!(await isMember(client, c, p.id))) throw new ProjectError(403, "Only the project team can add to it.", "PROJECT_FORBIDDEN");
}

// ------------------------------------------------------------------ comments (F227)
const ENTITY_TABLE = { project: "projects", task: "project_tasks", milestone: "project_milestones" };

export async function listProjectComments(client, c, input) {
  need(c, "projects.view");
  const type = oneOf(input.entityType, Object.keys(ENTITY_TABLE), "Entity type");
  const id = uuid(input.entityId, "Entity");
  const row = (await client.query(`SELECT ${type === "project" ? "id AS project_id" : "project_id"} FROM tenant.${ENTITY_TABLE[type]} WHERE organization_id=$1 AND id=$2`, [c.organizationId, id])).rows[0];
  if (!row) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND");
  await loadProject(client, c, row.project_id);
  const res = await qx(client, `SELECT cm.*,u.full_name AS author_name FROM tenant.project_comments cm LEFT JOIN public.users u ON u.id=cm.author_user_id WHERE cm.organization_id=$1 AND cm.entity_type=$2 AND cm.entity_id=$3 AND cm.deleted_at IS NULL ORDER BY cm.created_at`, [c.organizationId, type, id]);
  return res.rows;
}

export async function addProjectComment(client, c, input) {
  need(c, "projects.view");
  const type = oneOf(input.entityType, Object.keys(ENTITY_TABLE), "Entity type");
  const id = uuid(input.entityId, "Entity");
  const row = (await client.query(`SELECT ${type === "project" ? "id AS project_id" : "project_id"} FROM tenant.${ENTITY_TABLE[type]} WHERE organization_id=$1 AND id=$2`, [c.organizationId, id])).rows[0];
  if (!row) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, row.project_id, { lock: true });
  await requireContributor(client, c, p);
  const mentions = [...new Set((input.mentions || []).map((m) => uuid(m, "Mention")))];
  for (const m of mentions) if (!(await isMember(client, c, p.id, m))) throw new ProjectError(409, "You can only mention people on the project team.", "PROJECT_MENTION_INVALID");
  const res = await qx(client, `INSERT INTO tenant.project_comments(organization_id,project_id,entity_type,entity_id,body,mentions,internal,author_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, p.id, type, id, requiredText(input.body, "Comment", 4000), mentions, input.internal !== false, c.userId]);
  await recordEvent(client, c, "comment", res.rows[0].id, "project.comment.added", { entity: type, mentions: mentions.length });
  return res.rows[0];
}

export async function deleteProjectComment(client, c, commentId) {
  need(c, "projects.view");
  const cm = (await qx(client, `SELECT * FROM tenant.project_comments WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [c.organizationId, uuid(commentId, "Comment")])).rows[0];
  if (!cm) throw new ProjectError(404, "Comment was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, cm.project_id);
  if (cm.author_user_id !== c.userId && !isPm(c, p)) throw new ProjectError(403, "Only the author or a project manager can remove a comment.", "PROJECT_FORBIDDEN");
  await client.query(`UPDATE tenant.project_comments SET deleted_at=now() WHERE id=$1`, [cm.id]);
  return { ok: true };
}

// The comments that mention the caller (the "inbox" behind a mention).
export async function listMyMentions(client, c) {
  need(c, "projects.view");
  const res = await qx(client, `SELECT cm.id,cm.entity_type,cm.entity_id,cm.body,cm.created_at,p.project_number,u.full_name AS author_name FROM tenant.project_comments cm JOIN tenant.projects p ON p.id=cm.project_id LEFT JOIN public.users u ON u.id=cm.author_user_id WHERE cm.organization_id=$1 AND $2::uuid = ANY(cm.mentions) AND cm.deleted_at IS NULL ORDER BY cm.created_at DESC LIMIT 100`, [c.organizationId, c.userId]);
  return res.rows;
}

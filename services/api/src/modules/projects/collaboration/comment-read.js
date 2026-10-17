// Projects — Comments and Collaboration, the reads: a record's discussion (paged, with one level of replies and tombstones), a comment's
// edit history, who may be mentioned, My Work's discussion queues (mentions, unread, followed, recent), search, counts for badges, file
// downloads, the reports and the project timeline that merges conversation with recorded activity. Every result is filtered by the
// reader's current access to the record and the comment's visibility — nothing is shown because a comment, mention or link says so.
import { readFileContent } from "../../../core/platform/files/index.js";
import { has, seesAll, text, uuid, visibilitySql } from "../project-core.js";
import { COMMENT_ENTITY, PARENT_ENTITY, commentRights, commentScope } from "./comment-commands.js";
import { COMMENT, PARENT_LABEL, canSeeComment, commentError, commentPolicy, parentAccess, parentHref, readersOf } from "./comment-rules.js";

// ------------------------------------------------------------------ people and presentation
// Names stay on historical comments after someone leaves the company; the screen marks them as former members.
async function peopleOf(client, c, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = (await client.query(`SELECT person.id, COALESCE(NULLIF(person.full_name, ''), person.email) AS name,
      (person.status = 'active' AND EXISTS (SELECT 1 FROM public.organization_memberships membership WHERE membership.organization_id = $1 AND membership.user_id = person.id AND membership.status = 'active')) AS active
     FROM public.users person WHERE person.id = ANY($2::uuid[])`, [c.organizationId, list])).rows;
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, active: Boolean(row.active) }]));
}
const person = (people, id) => (id ? people.get(id) ?? { id, name: "Former user", active: false } : null);
async function decorations(client, c, rows) {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { mentions: new Map(), files: new Map() };
  const mentionRows = (await client.query(`SELECT comment_id, mentioned_user_id FROM tenant.project_comment_mentions WHERE organization_id = $1 AND comment_id = ANY($2::uuid[]) AND removed_at IS NULL ORDER BY created_at`,
    [c.organizationId, ids])).rows;
  const fileRows = (await client.query(`SELECT link.comment_id, link.attachment_id, link.source, file.file_name, file.mime_type, file.size_bytes FROM tenant.project_comment_attachments link
      JOIN public.attachments file ON file.id = link.attachment_id AND file.organization_id = link.organization_id AND file.lifecycle_status <> 'archived'
     WHERE link.organization_id = $1 AND link.comment_id = ANY($2::uuid[]) AND link.removed_at IS NULL ORDER BY link.added_at`, [c.organizationId, ids])).rows;
  const group = (list, key) => list.reduce((map, row) => map.set(row[key], [...(map.get(row[key]) ?? []), row]), new Map());
  return { mentions: group(mentionRows, "comment_id"), files: group(fileRows, "comment_id") };
}
function present(c, scope, policy, row, people, extra) {
  const deleted = row.status === "DELETED";
  const rights = commentRights(c, scope, row, policy);
  return {
    id: row.id, sequence: Number(row.sequence), replyToId: row.reply_to_id, visibility: row.visibility, deleted, version: row.version,
    // A removed comment keeps its place in the thread, not its words.
    body: deleted ? null : row.body,
    author: person(people, row.author_user_id), mine: Boolean(c.userId) && row.author_user_id === c.userId,
    createdAt: row.created_at, editedAt: deleted ? null : row.edited_at, deletedAt: row.deleted_at, deletedBy: deleted ? person(people, row.deleted_by)?.name ?? null : null,
    moderated: deleted && row.deleted_by !== row.author_user_id,
    mentions: deleted ? [] : (extra.mentions.get(row.id) ?? []).map((mention) => person(people, mention.mentioned_user_id)),
    attachments: deleted ? [] : (extra.files.get(row.id) ?? []).map((file) => ({ id: file.attachment_id, fileName: file.file_name, mimeType: file.mime_type, sizeBytes: Number(file.size_bytes ?? 0), source: file.source })),
    can: rights,
  };
}
const discussionInfo = (scope, policy) => ({
  parentType: scope.type, parentId: scope.id, projectId: scope.project.id, label: scope.label, kind: PARENT_LABEL[scope.type],
  can: { comment: scope.can.write, reply: scope.can.write && scope.can.reply, restricted: scope.can.restrictedCreate, attach: scope.can.attach, mention: scope.can.mention, moderate: scope.can.moderate },
  readOnly: scope.can.readOnly, readOnlyReason: scope.readOnlyReason, policy,
});
async function readerState(client, c, scope) {
  const marker = c.userId ? (await client.query(`SELECT last_sequence FROM tenant.project_comment_read_markers WHERE organization_id = $1 AND user_id = $2 AND parent_type = $3 AND parent_id = $4`,
    [c.organizationId, c.userId, scope.type, scope.id])).rows[0] : null;
  const subscription = c.userId ? (await client.query(`SELECT status FROM tenant.project_comment_subscriptions WHERE organization_id = $1 AND user_id = $2 AND parent_type = $3 AND parent_id = $4`,
    [c.organizationId, c.userId, scope.type, scope.id])).rows[0] : null;
  const counts = (await client.query(`SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS total,
      count(*) FILTER (WHERE status = 'ACTIVE' AND sequence > $5 AND author_user_id IS DISTINCT FROM $6)::int AS unread, COALESCE(max(sequence), 0) AS newest
     FROM tenant.project_comments WHERE organization_id = $1 AND parent_type = $2 AND parent_id = $3 AND ($4 OR visibility <> 'RESTRICTED')`,
  [c.organizationId, scope.type, scope.id, scope.can.restricted, Number(marker?.last_sequence ?? 0), c.userId ?? null])).rows[0];
  const implicit = scope.owners.includes(c.userId);
  const following = subscription ? subscription.status === "FOLLOWING" : implicit;
  return { total: counts.total, unread: counts.unread, newestSequence: Number(counts.newest), lastReadSequence: Number(marker?.last_sequence ?? 0), following, muted: subscription?.status === "MUTED" };
}

// ------------------------------------------------------------------ a record's discussion
// filters: { parentType, parentId, before? (a top-level sequence: older page), limit? (top-level comments, default 30), summary? }
export async function getCommentsForRecord(client, c, filters = {}) {
  const scope = await parentAccess(client, c, filters.parentType, filters.parentId);
  const policy = await commentPolicy(client, c);
  const state = await readerState(client, c, scope);
  if (filters.summary) return { discussion: discussionInfo(scope, policy), ...state };
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
  const before = filters.before ? Number(filters.before) : null;
  const top = (await client.query(`SELECT * FROM tenant.project_comments WHERE organization_id = $1 AND parent_type = $2 AND parent_id = $3 AND reply_to_id IS NULL
      AND ($4 OR visibility <> 'RESTRICTED') AND ($5::bigint IS NULL OR sequence < $5) ORDER BY sequence DESC LIMIT $6`,
  [c.organizationId, scope.type, scope.id, scope.can.restricted, before, limit + 1])).rows;
  const hasMore = top.length > limit;
  const page = top.slice(0, limit).reverse();
  const replies = page.length ? (await client.query(`SELECT * FROM tenant.project_comments WHERE organization_id = $1 AND reply_to_id = ANY($2::uuid[]) AND ($3 OR visibility <> 'RESTRICTED') ORDER BY sequence`,
    [c.organizationId, page.map((row) => row.id), scope.can.restricted])).rows : [];
  const all = [...page, ...replies];
  const extra = await decorations(client, c, all);
  const people = await peopleOf(client, c, all.flatMap((row) => [row.author_user_id, row.deleted_by, ...(extra.mentions.get(row.id) ?? []).map((m) => m.mentioned_user_id)]));
  const byParent = new Map();
  for (const reply of replies) byParent.set(reply.reply_to_id, [...(byParent.get(reply.reply_to_id) ?? []), present(c, scope, policy, reply, people, extra)]);
  const comments = page
    // A removed comment with no remaining replies is just a gap; it is shown only to keep its replies in context.
    .filter((row) => row.status === "ACTIVE" || byParent.has(row.id))
    .map((row) => ({ ...present(c, scope, policy, row, people, extra), replies: byParent.get(row.id) ?? [] }));
  return { discussion: discussionInfo(scope, policy), ...state, comments, hasMore, nextBefore: hasMore ? Number(page[0].sequence) : null };
}

// Edit history: the author's own, or with the history permission as the project's lead. A restricted comment's history stays restricted.
export async function getCommentHistory(client, c, commentId) {
  const { comment, scope } = await commentScope(client, c, commentId);
  const mine = comment.author_user_id === c.userId;
  if (!mine && !scope.can.history) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const versions = (await client.query(`SELECT * FROM tenant.project_comment_versions WHERE organization_id = $1 AND comment_id = $2 ORDER BY version_number`, [c.organizationId, comment.id])).rows;
  const people = await peopleOf(client, c, [comment.author_user_id, comment.deleted_by, ...versions.flatMap((row) => [row.edited_by, ...(row.mention_user_ids ?? [])])]);
  return {
    commentId: comment.id, status: comment.status, author: person(people, comment.author_user_id), createdAt: comment.created_at,
    deleted: comment.status === "DELETED" ? { at: comment.deleted_at, by: person(people, comment.deleted_by), reason: scope.can.history || mine ? comment.delete_reason : null } : null,
    versions: versions.map((row) => ({ version: row.version_number, body: row.body_snapshot, editedBy: person(people, row.edited_by), editedAt: row.edited_at, reason: row.change_reason,
      mentions: (row.mention_user_ids ?? []).map((id) => person(people, id)), attachmentCount: (row.attachment_ids ?? []).length })),
  };
}

// The people who may be mentioned here: active company members who can already read this discussion (and, for a restricted comment, its
// restricted part). filters: { parentType, parentId, search?, visibility? }
export async function resolveEligibleMentions(client, c, filters = {}) {
  const scope = await parentAccess(client, c, filters.parentType, filters.parentId);
  if (!scope.can.mention) return { people: [] };
  const search = text(filters.search, 80);
  const rows = (await client.query(`SELECT person.id, COALESCE(NULLIF(person.full_name, ''), person.email) AS name, person.email FROM public.organization_memberships membership
      JOIN public.users person ON person.id = membership.user_id AND person.status = 'active'
     WHERE membership.organization_id = $1 AND membership.status = 'active' AND person.id IS DISTINCT FROM $2
       AND ($3 = '' OR person.full_name ILIKE '%' || $3 || '%' OR person.email ILIKE '%' || $3 || '%')
     ORDER BY (person.id = $4) DESC, (EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = $5 AND member.user_id = person.id AND member.left_at IS NULL)) DESC, name LIMIT 200`,
  [c.organizationId, c.userId ?? null, search.replace(/[%_\\]/g, (ch) => `\\${ch}`), scope.project.manager_user_id, scope.project.id])).rows;
  const visibility = String(filters.visibility ?? "").toUpperCase() === "RESTRICTED" ? "RESTRICTED" : "INHERIT";
  const readers = await readersOf(client, c, scope, rows.map((row) => row.id), visibility);
  return { people: rows.filter((row) => readers.has(row.id)).slice(0, 12).map((row) => ({ id: row.id, name: row.name, email: row.email })) };
}

// ------------------------------------------------------------------ the access cache every cross-record read uses
function accessCache(client, c) {
  const scopes = new Map();
  return async (type, id) => {
    const key = `${type}:${id}`;
    if (!scopes.has(key)) scopes.set(key, await parentAccess(client, c, type, id).catch(() => null));
    return scopes.get(key);
  };
}
// Rows from any discussions, keeping only those this person may read now.
async function permitted(client, c, rows) {
  const scopeOf = accessCache(client, c);
  const kept = [];
  for (const row of rows) {
    const scope = await scopeOf(row.parent_type, row.parent_id);
    if (scope && canSeeComment(scope, row)) kept.push({ row, scope });
  }
  return kept;
}
const pageOf = (filters, fallback = 25) => {
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || fallback));
  return { page: Math.max(1, Number(filters.page) || 1), pageSize };
};
async function listItems(client, c, kept, { full = false } = {}) {
  const rows = kept.map((entry) => entry.row);
  const extra = await decorations(client, c, rows);
  const people = await peopleOf(client, c, rows.flatMap((row) => [row.author_user_id, ...(extra.mentions.get(row.id) ?? []).map((m) => m.mentioned_user_id)]));
  return kept.map(({ row, scope }) => ({
    id: row.id, sequence: Number(row.sequence), parentType: row.parent_type, parentId: row.parent_id, kind: PARENT_LABEL[row.parent_type], parentLabel: scope.label,
    projectId: scope.project.id, projectLabel: `${scope.project.project_code}${scope.project.name ? ` · ${scope.project.name}` : ""}`,
    href: `${parentHref(row.parent_type, row.parent_id, scope.project.id)}&comment=${row.id}`, visibility: row.visibility, isReply: Boolean(row.reply_to_id),
    excerpt: row.body.replace(/\s+/g, " ").slice(0, 240), author: person(people, row.author_user_id), createdAt: row.created_at, editedAt: row.edited_at,
    ...(full ? { body: row.body } : {}), attachmentCount: (extra.files.get(row.id) ?? []).length, unread: row.unread === undefined ? undefined : Boolean(row.unread),
  }));
}

// ------------------------------------------------------------------ My Work: mentions, discussions
// Comments that mention me, newest first; unread ones are those past my read marker for that discussion.
export async function getMyMentions(client, c, filters = {}) {
  if (!has(c, COMMENT.view) || !c.userId) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const { page, pageSize } = pageOf(filters);
  const rows = (await client.query(`SELECT comment.*, (comment.sequence > COALESCE(marker.last_sequence, 0)) AS unread FROM tenant.project_comment_mentions mention
      JOIN tenant.project_comments comment ON comment.id = mention.comment_id AND comment.status = 'ACTIVE'
      LEFT JOIN tenant.project_comment_read_markers marker ON marker.organization_id = comment.organization_id AND marker.user_id = $2 AND marker.parent_type = comment.parent_type AND marker.parent_id = comment.parent_id
     WHERE mention.organization_id = $1 AND mention.mentioned_user_id = $2 AND mention.removed_at IS NULL AND ($3::boolean IS NOT TRUE OR comment.sequence > COALESCE(marker.last_sequence, 0))
     ORDER BY comment.sequence DESC LIMIT 500`, [c.organizationId, c.userId, filters.unread === true || filters.unread === "true"])).rows;
  const kept = await permitted(client, c, rows);
  return { total: kept.length, unread: kept.filter((entry) => entry.row.unread).length, page, pageSize, items: await listItems(client, c, kept.slice((page - 1) * pageSize, page * pageSize)) };
}
// The discussions I take part in: ones I follow (explicitly, as the task's assignee, the milestone's owner or the project's manager, or by
// having commented), unless muted. filters: { view: unread | followed, page, pageSize }
async function myDiscussions(client, c, filters = {}) {
  if (!has(c, COMMENT.view) || !c.userId) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const unreadOnly = filters.view === "unread";
  const rows = (await client.query(`WITH mine AS (
        SELECT parent_type, parent_id FROM tenant.project_comment_subscriptions WHERE organization_id = $1 AND user_id = $2 AND status = 'FOLLOWING'
        UNION SELECT 'TASK', id FROM tenant.project_tasks WHERE organization_id = $1 AND assignee_user_id = $2
        UNION SELECT 'MILESTONE', id FROM tenant.project_milestones WHERE organization_id = $1 AND owner_user_id = $2
        UNION SELECT 'PROJECT', id FROM tenant.projects WHERE organization_id = $1 AND manager_user_id = $2 AND deleted_at IS NULL
      ), followed AS (
        SELECT mine.* FROM mine WHERE NOT EXISTS (SELECT 1 FROM tenant.project_comment_subscriptions muted WHERE muted.organization_id = $1 AND muted.user_id = $2
          AND muted.parent_type = mine.parent_type AND muted.parent_id = mine.parent_id AND muted.status = 'MUTED')
      )
      SELECT followed.parent_type, followed.parent_id, COALESCE(marker.last_sequence, 0) AS last_read FROM followed
        LEFT JOIN tenant.project_comment_read_markers marker ON marker.organization_id = $1 AND marker.user_id = $2 AND marker.parent_type = followed.parent_type AND marker.parent_id = followed.parent_id
       WHERE EXISTS (SELECT 1 FROM tenant.project_comments comment WHERE comment.organization_id = $1 AND comment.parent_type = followed.parent_type AND comment.parent_id = followed.parent_id
         AND comment.status = 'ACTIVE' AND ($3::boolean IS NOT TRUE OR (comment.sequence > COALESCE(marker.last_sequence, 0) AND comment.author_user_id IS DISTINCT FROM $2)))
       LIMIT 500`, [c.organizationId, c.userId, unreadOnly])).rows;
  const scopeOf = accessCache(client, c);
  const items = [];
  for (const row of rows) {
    const scope = await scopeOf(row.parent_type, row.parent_id);
    if (!scope) continue;
    const stats = (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE sequence > $5 AND author_user_id IS DISTINCT FROM $6)::int AS unread, max(created_at) AS last_at,
        (array_agg(id ORDER BY sequence DESC))[1] AS last_id
       FROM tenant.project_comments WHERE organization_id = $1 AND parent_type = $2 AND parent_id = $3 AND status = 'ACTIVE' AND ($4 OR visibility <> 'RESTRICTED')`,
    [c.organizationId, row.parent_type, row.parent_id, scope.can.restricted, Number(row.last_read), c.userId])).rows[0];
    if (!stats.total || (unreadOnly && !stats.unread)) continue;
    const last = (await client.query(`SELECT body, author_user_id, visibility FROM tenant.project_comments WHERE id = $1`, [stats.last_id])).rows[0];
    items.push({ parentType: row.parent_type, parentId: row.parent_id, kind: PARENT_LABEL[row.parent_type], label: scope.label, projectId: scope.project.id,
      projectLabel: `${scope.project.project_code}${scope.project.name ? ` · ${scope.project.name}` : ""}`, href: parentHref(row.parent_type, row.parent_id, scope.project.id),
      total: stats.total, unread: stats.unread, lastAt: stats.last_at, lastExcerpt: last.body.replace(/\s+/g, " ").slice(0, 160), lastAuthorId: last.author_user_id });
  }
  const people = await peopleOf(client, c, items.map((item) => item.lastAuthorId));
  items.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  const { page, pageSize } = pageOf(filters);
  return { total: items.length, unread: items.reduce((sum, item) => sum + item.unread, 0), page, pageSize,
    items: items.slice((page - 1) * pageSize, page * pageSize).map(({ lastAuthorId, ...item }) => ({ ...item, lastAuthor: person(people, lastAuthorId)?.name ?? null })) };
}
export const getUnreadDiscussions = (client, c, filters = {}) => myDiscussions(client, c, { ...filters, view: "unread" });
export const getFollowedDiscussions = (client, c, filters = {}) => myDiscussions(client, c, { ...filters, view: "followed" });
// The latest comments across the projects I can see.
export async function getRecentDiscussions(client, c, filters = {}) {
  return searchAuthorizedComments(client, c, { ...filters, q: "" });
}
// My Work's counters: unread mentions and unread discussions.
export async function getCollaborationInbox(client, c) {
  if (!has(c, COMMENT.view) || !c.userId) return { mentions: 0, unreadDiscussions: 0, unreadComments: 0 };
  const mentions = await getMyMentions(client, c, { unread: true, pageSize: 1 });
  const unread = await getUnreadDiscussions(client, c, { pageSize: 1 });
  return { mentions: mentions.total, unreadDiscussions: unread.total, unreadComments: unread.unread };
}

// ------------------------------------------------------------------ search
// filters: { q?, projectId?, parentType?, authorId?, mentionedId?, from?, to?, hasAttachments?, page?, pageSize? }. Only comments this person
// may read now — no snippet, file name or record of a restricted or inaccessible discussion is returned.
export async function searchAuthorizedComments(client, c, filters = {}) {
  if (!has(c, COMMENT.view) || !(has(c, "projects.view") || seesAll(c))) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["comment.organization_id = $1", "comment.status = 'ACTIVE'", "project.deleted_at IS NULL", visibilitySql(c, "project", "$2")];
  const q = text(filters.q, 200);
  if (q) {
    const term = bind(q);
    where.push(`(comment.search @@ websearch_to_tsquery('simple', ${term}) OR comment.body ILIKE '%' || replace(replace(replace(${term}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`);
  }
  if (filters.projectId) where.push(`comment.project_id = ${bind(uuid(filters.projectId, "Project"))}`);
  if (filters.parentType && PARENT_LABEL[String(filters.parentType).toUpperCase()]) where.push(`comment.parent_type = ${bind(String(filters.parentType).toUpperCase())}`);
  if (filters.parentId) where.push(`comment.parent_id = ${bind(uuid(filters.parentId, "Record"))}`);
  if (filters.authorId) where.push(`comment.author_user_id = ${bind(uuid(filters.authorId, "Author"))}`);
  if (filters.mentionedId) where.push(`EXISTS (SELECT 1 FROM tenant.project_comment_mentions mention WHERE mention.comment_id = comment.id AND mention.removed_at IS NULL AND mention.mentioned_user_id = ${bind(uuid(filters.mentionedId, "Person"))})`);
  if (filters.from) where.push(`comment.created_at >= ${bind(String(filters.from).slice(0, 10))}::date`);
  if (filters.to) where.push(`comment.created_at < ${bind(String(filters.to).slice(0, 10))}::date + 1`);
  if (filters.hasAttachments === true || filters.hasAttachments === "true") where.push(`EXISTS (SELECT 1 FROM tenant.project_comment_attachments link WHERE link.comment_id = comment.id AND link.removed_at IS NULL)`);
  if (filters.visibility === "RESTRICTED") where.push(`comment.visibility = 'RESTRICTED'`);
  const rows = (await client.query(`SELECT comment.* FROM tenant.project_comments comment JOIN tenant.projects project ON project.id = comment.project_id
     WHERE ${where.join(" AND ")} ORDER BY comment.sequence DESC LIMIT 1000`, values)).rows;
  const kept = await permitted(client, c, rows);
  const { page, pageSize } = pageOf(filters);
  return { total: kept.length, page, pageSize, items: await listItems(client, c, kept.slice((page - 1) * pageSize, page * pageSize), { full: Boolean(filters.full) }) };
}

// ------------------------------------------------------------------ counts for badges
// input: { parentType, parentIds } — per record, the comments this person can see and how many are unread.
export async function getDiscussionCounts(client, c, input = {}) {
  const type = String(input.parentType ?? "").toUpperCase();
  if (!PARENT_LABEL[type] || !has(c, COMMENT.view)) return { counts: {} };
  const ids = [...new Set((Array.isArray(input.parentIds) ? input.parentIds : String(input.parentIds ?? "").split(",")).filter(Boolean))].slice(0, 200);
  const scopeOf = accessCache(client, c);
  const counts = {};
  for (const id of ids) {
    const scope = await scopeOf(type, id);
    if (!scope) continue;
    const state = await readerState(client, c, scope);
    counts[id] = { total: state.total, unread: state.unread };
  }
  return { counts };
}

// ------------------------------------------------------------------ files
// A comment's file, through the comment's record: only while the comment is visible and not removed.
export async function readCommentAttachment(client, c, commentId, attachmentId, options = {}) {
  const { comment, scope } = await commentScope(client, c, commentId);
  if (comment.status === "DELETED") throw commentError(404, "COMMENT_ATTACHMENT_INVALID");
  let id;
  try { id = uuid(attachmentId, "File"); } catch { throw commentError(404, "COMMENT_ATTACHMENT_INVALID"); }
  const link = (await client.query(`SELECT * FROM tenant.project_comment_attachments WHERE organization_id = $1 AND comment_id = $2 AND attachment_id = $3 AND removed_at IS NULL`,
    [c.organizationId, comment.id, id])).rows[0];
  if (!link) throw commentError(404, "COMMENT_ATTACHMENT_INVALID");
  const entityType = link.source === "UPLOADED" ? COMMENT_ENTITY : PARENT_ENTITY[scope.type];
  const entityId = link.source === "UPLOADED" ? comment.id : scope.id;
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND lifecycle_status <> 'archived'`,
    [c.organizationId, entityType, String(entityId), id])).rows[0];
  if (!row) throw commentError(404, "COMMENT_ATTACHMENT_INVALID");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType, entityId, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}
// The record's own files that a new comment may reference.
export async function getReferenceableFiles(client, c, filters = {}) {
  const scope = await parentAccess(client, c, filters.parentType, filters.parentId);
  if (!scope.can.attach) return { files: [] };
  const rows = (await client.query(`SELECT id, file_name, size_bytes, created_at FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND is_current AND lifecycle_status <> 'archived'
      ORDER BY created_at DESC LIMIT 100`, [c.organizationId, PARENT_ENTITY[scope.type], String(scope.id)])).rows;
  return { files: rows.map((row) => ({ id: row.id, fileName: row.file_name, sizeBytes: Number(row.size_bytes ?? 0), createdAt: row.created_at })) };
}

// ------------------------------------------------------------------ the project timeline: conversation and recorded activity, told apart
export async function getProjectCollaborationTimeline(client, c, projectId, filters = {}) {
  const scope = await parentAccess(client, c, "PROJECT", projectId);
  const limit = Math.min(500, Math.max(10, Number(filters.limit) || 200));
  const events = (await client.query(`SELECT id, action, summary, actor_user_id, occurred_at FROM tenant.project_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at DESC LIMIT $3`,
    [c.organizationId, scope.project.id, limit])).rows;
  const comments = await permitted(client, c, (await client.query(`SELECT * FROM tenant.project_comments WHERE organization_id = $1 AND project_id = $2 AND status = 'ACTIVE' ORDER BY sequence DESC LIMIT $3`,
    [c.organizationId, scope.project.id, limit])).rows);
  const people = await peopleOf(client, c, [...events.map((row) => row.actor_user_id), ...comments.map((entry) => entry.row.author_user_id)]);
  const items = [
    ...events.map((row) => ({ id: row.id, source: "ACTIVITY", sourceLabel: "Activity", action: row.action, summary: row.summary, actor: person(people, row.actor_user_id)?.name ?? "System", at: row.occurred_at, href: null })),
    ...comments.map(({ row, scope: parent }) => ({ id: row.id, source: "COMMENT", sourceLabel: "Comment", action: row.reply_to_id ? "REPLIED" : "COMMENTED",
      summary: `${PARENT_LABEL[row.parent_type]} ${parent.label}: ${row.body.replace(/\s+/g, " ").slice(0, 200)}`, restricted: row.visibility === "RESTRICTED",
      actor: person(people, row.author_user_id)?.name ?? "Former user", at: row.created_at, href: `${parentHref(row.parent_type, row.parent_id, scope.project.id)}&comment=${row.id}` })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
  return { projectId: scope.project.id, items };
}

// ------------------------------------------------------------------ reports
// Collaboration reports describe conversation, never people's performance: no ranking by comment volume.
export const COLLABORATION_REPORTS = Object.freeze(["recent", "by-project", "task-discussions", "milestone-discussions", "unread-mentions", "with-attachments", "restricted-audit", "edited-deleted"]);
export async function getCollaborationReport(client, c, kind = "recent", filters = {}) {
  if (!COLLABORATION_REPORTS.includes(kind)) throw commentError(400, "COMMENT_PERMISSION_DENIED", "Unknown report.");
  if (!has(c, COMMENT.view)) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const base = { projectId: filters.projectId, from: filters.from, to: filters.to, pageSize: 100, page: 1 };
  if (kind === "recent") return { kind, rows: (await searchAuthorizedComments(client, c, base)).items };
  if (kind === "unread-mentions") return { kind, rows: (await getMyMentions(client, c, { unread: true, pageSize: 100 })).items };
  if (kind === "with-attachments") return { kind, rows: (await searchAuthorizedComments(client, c, { ...base, hasAttachments: true })).items };
  if (kind === "restricted-audit") {
    if (!has(c, COMMENT.restrictedView)) throw commentError(403, "COMMENT_RESTRICTED_ACCESS");
    return { kind, rows: (await searchAuthorizedComments(client, c, { ...base, visibility: "RESTRICTED" })).items };
  }
  if (kind === "edited-deleted") {
    if (!has(c, COMMENT.history) && !has(c, COMMENT.moderate)) throw commentError(403, "COMMENT_PERMISSION_DENIED");
    const rows = (await client.query(`SELECT comment.* FROM tenant.project_comments comment JOIN tenant.projects project ON project.id = comment.project_id
       WHERE comment.organization_id = $1 AND ${visibilitySql(c, "project", "$2")} AND (comment.edited_at IS NOT NULL OR comment.status = 'DELETED') AND ($3::uuid IS NULL OR comment.project_id = $3)
       ORDER BY COALESCE(comment.deleted_at, comment.edited_at) DESC LIMIT 500`, [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
    const kept = (await permitted(client, c, rows)).filter((entry) => entry.scope.can.history);
    const people = await peopleOf(client, c, kept.flatMap(({ row }) => [row.author_user_id, row.edited_by, row.deleted_by]));
    return { kind, rows: kept.slice(0, 200).map(({ row, scope }) => ({ id: row.id, parentLabel: scope.label, kind: PARENT_LABEL[row.parent_type], href: `${parentHref(row.parent_type, row.parent_id, scope.project.id)}&comment=${row.id}`,
      author: person(people, row.author_user_id)?.name ?? null, change: row.status === "DELETED" ? (row.deleted_by === row.author_user_id ? "Removed by author" : "Removed by moderator") : "Edited",
      by: person(people, row.status === "DELETED" ? row.deleted_by : row.edited_by)?.name ?? null, at: row.status === "DELETED" ? row.deleted_at : row.edited_at, versions: row.version, reason: row.delete_reason })) };
  }
  // Discussion totals per project, task or milestone (the visible comments only).
  const type = kind === "by-project" ? null : kind === "task-discussions" ? "TASK" : "MILESTONE";
  const rows = (await client.query(`SELECT comment.* FROM tenant.project_comments comment JOIN tenant.projects project ON project.id = comment.project_id
     WHERE comment.organization_id = $1 AND comment.status = 'ACTIVE' AND project.deleted_at IS NULL AND ${visibilitySql(c, "project", "$2")} AND ($3::text IS NULL OR comment.parent_type = $3)
       AND ($4::uuid IS NULL OR comment.project_id = $4) ORDER BY comment.sequence DESC LIMIT 5000`, [c.organizationId, c.userId ?? null, type, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
  const kept = await permitted(client, c, rows);
  const groups = new Map();
  for (const { row, scope } of kept) {
    const key = type ? `${row.parent_type}:${row.parent_id}` : scope.project.id;
    const group = groups.get(key) ?? { key, label: type ? scope.label : `${scope.project.project_code}${scope.project.name ? ` · ${scope.project.name}` : ""}`,
      href: type ? parentHref(row.parent_type, row.parent_id, scope.project.id) : `/projects/${scope.project.id}?tab=comments`, project: `${scope.project.project_code}`, comments: 0, discussions: new Set(), participants: new Set(), lastAt: row.created_at };
    group.comments += 1;
    group.discussions.add(`${row.parent_type}:${row.parent_id}`);
    if (row.author_user_id) group.participants.add(row.author_user_id);
    if (new Date(row.created_at) > new Date(group.lastAt)) group.lastAt = row.created_at;
    groups.set(key, group);
  }
  return { kind, rows: [...groups.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
    .map((group) => ({ key: group.key, label: group.label, href: group.href, project: group.project, comments: group.comments, discussions: group.discussions.size, participants: group.participants.size, lastAt: group.lastAt })) };
}
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
// A project's (or one record's) visible conversation as CSV, with the export permission.
export async function exportCollaboration(client, c, filters = {}) {
  if (!has(c, COMMENT.export)) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const found = await searchAuthorizedComments(client, c, { ...filters, full: true, pageSize: 100, page: 1 });
  const all = [found.items];
  for (let page = 2; (page - 1) * 100 < found.total && page <= 50; page += 1) all.push((await searchAuthorizedComments(client, c, { ...filters, full: true, pageSize: 100, page })).items);
  const items = all.flat();
  const header = ["Posted", "Author", "Project", "Record", "Type", "Reply", "Visibility", "Edited", "Attachments", "Comment"];
  const lines = items.map((item) => [new Date(item.createdAt).toISOString(), item.author?.name ?? "", item.projectLabel, item.parentLabel, item.kind, item.isReply ? "Yes" : "No",
    item.visibility === "RESTRICTED" ? "Restricted" : "Record access", item.editedAt ? "Yes" : "No", item.attachmentCount, item.body]);
  return { fileName: "project-discussions.csv", csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: items.length };
}

// ------------------------------------------------------------------ settings
export async function getCommentSettings(client, c) {
  return { ...(await commentPolicy(client, c)), can: { manage: has(c, "projects.settings.manage") } };
}

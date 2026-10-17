// Projects — Comments and Collaboration, the commands: post a comment or a one-level reply, edit one's own comment within the company's
// window (every version kept), remove it (one's own, or a moderator with a reason — a tombstone stays), attach files, follow or mute a
// discussion, mark it read. A comment is conversation only: it never approves, completes or changes the record it is about.
import { archiveFile, storeFile } from "../../../core/platform/files/index.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, projectEvent, userNames, uuid } from "../project-core.js";
import { MILESTONE_ENTITY } from "../project-milestone-rules.js";
import { TASK_ENTITY } from "../project-task-rules.js";
import { COMMENT, canSeeComment, cleanBody, commentError, commentPolicy, followersOf, keyOf, parentAccess, parentHref, readersOf } from "./comment-rules.js";

export const COMMENT_ENTITY = "projects.comment";
export const PARENT_ENTITY = Object.freeze({ PROJECT: "projects.project", TASK: TASK_ENTITY, MILESTONE: MILESTONE_ENTITY });
const MAX_MENTIONS = 20;
const MAX_ATTACHMENTS = 10;

// ------------------------------------------------------------------ loading
export async function loadComment(client, c, commentId, { lock = false } = {}) {
  let id;
  try { id = uuid(commentId, "Comment"); } catch { throw commentError(404, "COMMENT_NOT_FOUND"); }
  const row = (await client.query(`SELECT * FROM tenant.project_comments WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!row) throw commentError(404, "COMMENT_NOT_FOUND");
  return row;
}
// The comment and its discussion, as this person may see them. A restricted comment someone may not read is not found.
export async function commentScope(client, c, commentId, options = {}) {
  const comment = await loadComment(client, c, commentId, options);
  const scope = await parentAccess(client, c, comment.parent_type, comment.parent_id);
  if (!canSeeComment(scope, comment)) throw commentError(404, "COMMENT_NOT_FOUND");
  return { comment, scope };
}
const withinWindow = (comment, policy) => Date.now() - new Date(comment.created_at).getTime() <= policy.editWindowMinutes * 60000;
export function commentRights(c, scope, comment, policy) {
  const mine = Boolean(c.userId) && comment.author_user_id === c.userId;
  const active = comment.status === "ACTIVE";
  const open = !scope.can.readOnly;
  return {
    edit: active && open && mine && has(c, COMMENT.editOwn) && scope.can.write && withinWindow(comment, policy),
    delete: active && ((mine && has(c, COMMENT.deleteOwn) && open) || scope.can.moderate),
    moderate: active && !mine && scope.can.moderate,
    reply: active && !comment.reply_to_id && scope.can.write && scope.can.reply,
    attach: active && open && mine && scope.can.attach && withinWindow(comment, policy),
    history: scope.can.history || mine,
  };
}

// ------------------------------------------------------------------ mentions and files
async function checkMentions(client, c, scope, ids, visibility) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
  if (!list.length) return [];
  if (!scope.can.mention) throw commentError(403, "COMMENT_MENTION_INVALID", "You cannot mention people in this discussion.");
  if (list.length > MAX_MENTIONS) throw commentError(400, "COMMENT_MENTION_INVALID", `Mention at most ${MAX_MENTIONS} people in one comment.`);
  for (const id of list) { try { uuid(id, "Mentioned person"); } catch { throw commentError(400, "COMMENT_MENTION_INVALID"); } }
  // Only people who may already read this comment: a mention never grants access to the record.
  const readers = await readersOf(client, c, scope, list, visibility);
  const missing = list.filter((id) => !readers.has(id));
  if (missing.length) throw commentError(400, "COMMENT_MENTION_INVALID", undefined, { userIds: missing });
  return list;
}
// Files already on the discussed record, referenced from the comment (never copied): the record's own access rules keep applying.
async function checkReferencedFiles(client, c, scope, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
  if (!list.length) return [];
  if (!scope.can.attach) throw commentError(403, "COMMENT_ATTACHMENT_INVALID", "You cannot attach files in this discussion.");
  if (list.length > MAX_ATTACHMENTS) throw commentError(400, "COMMENT_ATTACHMENT_INVALID", `Attach at most ${MAX_ATTACHMENTS} files to one comment.`);
  for (const id of list) { try { uuid(id, "File"); } catch { throw commentError(400, "COMMENT_ATTACHMENT_INVALID"); } }
  const found = new Set((await client.query(`SELECT id FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = ANY($4::uuid[])
      AND is_current AND lifecycle_status <> 'archived'`, [c.organizationId, PARENT_ENTITY[scope.type], String(scope.id), list])).rows.map((row) => row.id));
  if (list.some((id) => !found.has(id))) throw commentError(400, "COMMENT_ATTACHMENT_INVALID");
  return list;
}
const activeMentionIds = async (client, c, commentId) => (await client.query(
  `SELECT mentioned_user_id FROM tenant.project_comment_mentions WHERE organization_id = $1 AND comment_id = $2 AND removed_at IS NULL ORDER BY created_at`, [c.organizationId, commentId])).rows.map((row) => row.mentioned_user_id);
const activeAttachmentIds = async (client, c, commentId) => (await client.query(
  `SELECT attachment_id FROM tenant.project_comment_attachments WHERE organization_id = $1 AND comment_id = $2 AND removed_at IS NULL ORDER BY added_at`, [c.organizationId, commentId])).rows.map((row) => row.attachment_id);
async function snapshot(client, c, comment, reason = null) {
  await client.query(`INSERT INTO tenant.project_comment_versions (organization_id, comment_id, version_number, body_snapshot, mention_user_ids, attachment_ids, edited_by, change_reason)
      VALUES ($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8)`,
  [c.organizationId, comment.id, comment.version, comment.body, await activeMentionIds(client, c, comment.id), await activeAttachmentIds(client, c, comment.id), c.userId ?? null, reason]);
}

// ------------------------------------------------------------------ notifications
// Each person is told once per comment, for the strongest reason (mentioned, then replied to, then following); never the author, and
// only people who may read the comment now. A restricted comment's notification carries no preview.
const REASON_RANK = { MENTION: 3, REPLY: 2, FOLLOWING: 1 };
async function publishCommentNotification(client, c, scope, comment, { mentions = [], replyAuthor = null, followers = true } = {}) {
  const reasons = new Map();
  const offer = (id, reason) => { if (id && id !== c.userId && (REASON_RANK[reason] > (REASON_RANK[reasons.get(id)] ?? 0))) reasons.set(id, reason); };
  if (followers) for (const id of await followersOf(client, c, scope)) offer(id, "FOLLOWING");
  if (replyAuthor) offer(replyAuthor, "REPLY");
  for (const id of mentions) offer(id, "MENTION");
  if (!reasons.size) return 0;
  const readers = await readersOf(client, c, scope, [...reasons.keys()], comment.visibility);
  const actor = (await userNames(client, [c.userId])).get(c.userId) ?? "Someone";
  const restricted = comment.visibility === "RESTRICTED";
  const preview = restricted ? "A restricted comment — open the discussion to read it." : comment.body.replace(/\s+/g, " ").slice(0, 180);
  let sent = 0;
  for (const [userId, reason] of reasons) {
    if (!readers.has(userId)) continue;
    const fresh = (await client.query(`INSERT INTO tenant.project_comment_notifications (organization_id, comment_id, user_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id`,
      [c.organizationId, comment.id, userId, reason])).rows[0];
    if (!fresh) continue;
    const title = reason === "MENTION" ? `${actor} mentioned you on ${scope.label}` : reason === "REPLY" ? `${actor} replied to your comment on ${scope.label}` : `${actor} commented on ${scope.label}`;
    await createNotification(client, { organizationId: c.organizationId, userId, category: reason === "MENTION" ? "project_comment_mention" : "project_comment", title, message: preview,
      href: `${parentHref(scope.type, scope.id, scope.project.id)}&comment=${comment.id}`, entityType: COMMENT_ENTITY, entityId: comment.id });
    sent += 1;
  }
  return sent;
}
async function follow(client, c, scope, status = "FOLLOWING", { keepMuted = true } = {}) {
  if (!c.userId) return;
  await client.query(`INSERT INTO tenant.project_comment_subscriptions (organization_id, user_id, project_id, parent_type, parent_id, status) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (organization_id, user_id, parent_type, parent_id) DO UPDATE SET status = EXCLUDED.status, updated_at = clock_timestamp()
      ${keepMuted ? "WHERE tenant.project_comment_subscriptions.status <> 'MUTED'" : ""}`, [c.organizationId, c.userId, scope.project.id, scope.type, scope.id, status]);
}
async function readUpTo(client, c, scope, sequence) {
  if (!c.userId) return;
  await client.query(`INSERT INTO tenant.project_comment_read_markers (organization_id, user_id, parent_type, parent_id, last_sequence) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (organization_id, user_id, parent_type, parent_id) DO UPDATE SET last_sequence = GREATEST(tenant.project_comment_read_markers.last_sequence, EXCLUDED.last_sequence), read_at = clock_timestamp()`,
  [c.organizationId, c.userId, scope.type, scope.id, sequence]);
}

// ------------------------------------------------------------------ post a comment or a reply
// input: { parentType, parentId, body, replyToId?, mentionUserIds?, attachmentIds? (files on the record), visibility? INHERIT | RESTRICTED, idempotencyKey? }
export async function createComment(client, c, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT * FROM tenant.project_comments WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) {
      if (existing.author_user_id !== c.userId) throw commentError(409, "COMMENT_OPERATION_UNKNOWN");
      return { commentId: existing.id, sequence: Number(existing.sequence), parentType: existing.parent_type, parentId: existing.parent_id, replayed: true };
    }
  }
  const scope = await parentAccess(client, c, input.parentType, input.parentId);
  if (scope.can.readOnly && has(c, COMMENT.create)) throw commentError(409, "COMMENT_RECORD_READ_ONLY", scope.readOnlyReason ?? undefined);
  if (!scope.can.write) throw commentError(403, "COMMENT_PARENT_ACCESS_DENIED");
  let visibility = String(input.visibility ?? "INHERIT").toUpperCase() === "RESTRICTED" ? "RESTRICTED" : "INHERIT";
  let replyTo = null;
  if (input.replyToId) {
    if (!scope.can.reply) throw commentError(403, "COMMENT_REPLY_INVALID", "You cannot reply in this discussion.");
    try { replyTo = await loadComment(client, c, input.replyToId); } catch { throw commentError(400, "COMMENT_REPLY_INVALID"); }
    // Same discussion, one level deep, and a comment this person can read; a reply to a restricted comment stays restricted.
    if (replyTo.parent_type !== scope.type || replyTo.parent_id !== scope.id || replyTo.reply_to_id || replyTo.status !== "ACTIVE" || !canSeeComment(scope, replyTo)) {
      throw commentError(400, "COMMENT_REPLY_INVALID");
    }
    if (replyTo.visibility === "RESTRICTED") visibility = "RESTRICTED";
  }
  if (visibility === "RESTRICTED" && !scope.can.restrictedCreate) throw commentError(403, "COMMENT_RESTRICTED_ACCESS");
  const policy = await commentPolicy(client, c);
  const body = cleanBody(input.body, policy);
  const mentions = await checkMentions(client, c, scope, input.mentionUserIds, visibility);
  const files = await checkReferencedFiles(client, c, scope, input.attachmentIds);
  const comment = (await client.query(`INSERT INTO tenant.project_comments (organization_id, project_id, parent_type, parent_id, reply_to_id, body, visibility, author_user_id, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
  [c.organizationId, scope.project.id, scope.type, scope.id, replyTo?.id ?? null, body, visibility, c.userId ?? null, key])).rows[0];
  if (!comment) throw commentError(409, "COMMENT_OPERATION_UNKNOWN");
  for (const id of mentions) {
    await client.query(`INSERT INTO tenant.project_comment_mentions (organization_id, comment_id, mentioned_user_id, comment_version) VALUES ($1,$2,$3,1)`, [c.organizationId, comment.id, id]);
  }
  for (const id of files) {
    await client.query(`INSERT INTO tenant.project_comment_attachments (organization_id, comment_id, attachment_id, source, added_by) VALUES ($1,$2,$3,'REFERENCED',$4)`, [c.organizationId, comment.id, id, c.userId ?? null]);
  }
  await snapshot(client, c, comment);
  // The author follows the discussion they joined (unless they muted it), and has read up to their own comment.
  await follow(client, c, scope);
  await readUpTo(client, c, scope, Number(comment.sequence));
  const notified = await publishCommentNotification(client, c, scope, comment, { mentions, replyAuthor: replyTo?.author_user_id ?? null });
  return { commentId: comment.id, sequence: Number(comment.sequence), parentType: scope.type, parentId: scope.id, visibility, notified };
}
export const replyToComment = (client, c, commentId, input = {}) => loadComment(client, c, commentId)
  .catch(() => { throw commentError(400, "COMMENT_REPLY_INVALID"); })
  .then((target) => createComment(client, c, { ...input, parentType: target.parent_type, parentId: target.parent_id, replyToId: target.id }));

// ------------------------------------------------------------------ edit
// input: { body, mentionUserIds? (the full list after the edit), expectedVersion, reason? }. Only the author, within the edit window; the
// previous text is kept as a version. Only people newly mentioned by the edit are told.
export async function editComment(client, c, commentId, input = {}) {
  const { comment, scope } = await commentScope(client, c, commentId, { lock: true });
  if (comment.status === "DELETED") throw commentError(409, "COMMENT_ALREADY_DELETED");
  const policy = await commentPolicy(client, c);
  if (comment.author_user_id !== c.userId || !has(c, COMMENT.editOwn)) throw commentError(403, "COMMENT_EDIT_NOT_ALLOWED");
  if (scope.can.readOnly) throw commentError(409, "COMMENT_RECORD_READ_ONLY", scope.readOnlyReason ?? undefined);
  if (!scope.can.write) throw commentError(403, "COMMENT_EDIT_NOT_ALLOWED");
  if (!withinWindow(comment, policy)) throw commentError(409, "COMMENT_EDIT_NOT_ALLOWED", "The time to edit this comment has passed.");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(comment.version)) throw commentError(409, "COMMENT_VERSION_CONFLICT");
  const body = cleanBody(input.body, policy);
  const current = await activeMentionIds(client, c, comment.id);
  const wanted = input.mentionUserIds === undefined ? current : [...new Set((input.mentionUserIds ?? []).map(String))];
  const added = wanted.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !wanted.includes(id));
  await checkMentions(client, c, scope, added, comment.visibility);
  if (body === comment.body && !added.length && !removed.length) return { commentId: comment.id, version: comment.version, unchanged: true };
  const version = comment.version + 1;
  for (const id of removed) {
    await client.query(`UPDATE tenant.project_comment_mentions SET removed_at = clock_timestamp() WHERE organization_id = $1 AND comment_id = $2 AND mentioned_user_id = $3`, [c.organizationId, comment.id, id]);
  }
  for (const id of added) {
    await client.query(`INSERT INTO tenant.project_comment_mentions (organization_id, comment_id, mentioned_user_id, comment_version) VALUES ($1,$2,$3,$4)
        ON CONFLICT (comment_id, mentioned_user_id) DO UPDATE SET removed_at = NULL, comment_version = EXCLUDED.comment_version`, [c.organizationId, comment.id, id, version]);
  }
  const updated = (await client.query(`UPDATE tenant.project_comments SET body = $3, version = $4, edited_at = clock_timestamp(), edited_by = $5 WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, comment.id, body, version, c.userId ?? null])).rows[0];
  await snapshot(client, c, updated, String(input.reason ?? "").trim().slice(0, 500) || null);
  const notified = await publishCommentNotification(client, c, scope, updated, { mentions: added, followers: false });
  return { commentId: comment.id, version, notified };
}

// ------------------------------------------------------------------ remove
// input: { reason?, expectedVersion? }. The author removes their own comment; a moderator (with the permission, leading the project) removes
// anyone's, giving a reason. The text stays in the audit; the discussion shows "Comment removed", and its replies stay.
export async function softDeleteComment(client, c, commentId, input = {}) {
  const { comment, scope } = await commentScope(client, c, commentId, { lock: true });
  if (comment.status === "DELETED") {
    if (comment.deleted_by === c.userId) return { commentId: comment.id, deleted: true, replayed: true };
    throw commentError(409, "COMMENT_ALREADY_DELETED");
  }
  const mine = comment.author_user_id === c.userId;
  const own = mine && has(c, COMMENT.deleteOwn) && !scope.can.readOnly;
  if (!own && !scope.can.moderate) {
    if (mine && scope.can.readOnly) throw commentError(409, "COMMENT_RECORD_READ_ONLY", scope.readOnlyReason ?? undefined);
    throw commentError(403, "COMMENT_PERMISSION_DENIED");
  }
  const reason = String(input.reason ?? "").trim().slice(0, 500) || null;
  if (!own && !reason) throw commentError(400, "COMMENT_PERMISSION_DENIED", "Give a reason for removing someone else's comment.", { field: "reason" });
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(comment.version)) throw commentError(409, "COMMENT_VERSION_CONFLICT");
  await client.query(`UPDATE tenant.project_comments SET status = 'DELETED', deleted_at = clock_timestamp(), deleted_by = $3, delete_reason = $4, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, comment.id, c.userId ?? null, reason]);
  if (!own) await projectEvent(client, c, scope.project.id, "COMMENT_MODERATED", `A comment on ${scope.label} was removed by a moderator`, { commentId: comment.id, parentType: scope.type, parentId: scope.id, reason });
  return { commentId: comment.id, deleted: true, moderated: !own };
}

// ------------------------------------------------------------------ attachments
// An upload belongs to the comment (the comment's record decides who may read it); only its author adds one, within the edit window.
export async function uploadCommentAttachment(client, c, commentId, input = {}, options = {}) {
  const { comment, scope } = await commentScope(client, c, commentId, { lock: true });
  if (comment.status === "DELETED") throw commentError(409, "COMMENT_ALREADY_DELETED");
  const policy = await commentPolicy(client, c);
  if (scope.can.readOnly) throw commentError(409, "COMMENT_RECORD_READ_ONLY", scope.readOnlyReason ?? undefined);
  if (!commentRights(c, scope, comment, policy).attach) throw commentError(403, "COMMENT_ATTACHMENT_INVALID", "You cannot attach files to this comment.");
  const count = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_comment_attachments WHERE organization_id = $1 AND comment_id = $2 AND removed_at IS NULL`, [c.organizationId, comment.id])).rows[0].n);
  if (count >= MAX_ATTACHMENTS) throw commentError(400, "COMMENT_ATTACHMENT_INVALID", `Attach at most ${MAX_ATTACHMENTS} files to one comment.`);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: COMMENT_ENTITY, entityId: comment.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await client.query(`INSERT INTO tenant.project_comment_attachments (organization_id, comment_id, attachment_id, source, added_by) VALUES ($1,$2,$3,'UPLOADED',$4)`, [c.organizationId, comment.id, file.id, c.userId ?? null]);
  return { commentId: comment.id, id: file.id, fileName: file.fileName ?? file.file_name };
}
// input: { attachmentIds } — files already on the discussed record, referenced from the comment.
export async function attachFileToComment(client, c, commentId, input = {}) {
  const { comment, scope } = await commentScope(client, c, commentId, { lock: true });
  if (comment.status === "DELETED") throw commentError(409, "COMMENT_ALREADY_DELETED");
  const policy = await commentPolicy(client, c);
  if (!commentRights(c, scope, comment, policy).attach) throw commentError(403, "COMMENT_ATTACHMENT_INVALID", "You cannot attach files to this comment.");
  const ids = await checkReferencedFiles(client, c, scope, input.attachmentIds);
  for (const id of ids) {
    await client.query(`INSERT INTO tenant.project_comment_attachments (organization_id, comment_id, attachment_id, source, added_by) VALUES ($1,$2,$3,'REFERENCED',$4)
        ON CONFLICT (comment_id, attachment_id) DO UPDATE SET removed_at = NULL, removed_by = NULL`, [c.organizationId, comment.id, id, c.userId ?? null]);
  }
  return { commentId: comment.id, attached: ids.length };
}
export async function removeCommentAttachment(client, c, commentId, attachmentId) {
  const { comment, scope } = await commentScope(client, c, commentId, { lock: true });
  const policy = await commentPolicy(client, c);
  let id;
  try { id = uuid(attachmentId, "File"); } catch { throw commentError(404, "COMMENT_ATTACHMENT_INVALID"); }
  const link = (await client.query(`SELECT * FROM tenant.project_comment_attachments WHERE organization_id = $1 AND comment_id = $2 AND attachment_id = $3`, [c.organizationId, comment.id, id])).rows[0];
  if (!link) throw commentError(404, "COMMENT_ATTACHMENT_INVALID");
  if (link.removed_at) return { commentId: comment.id, removed: true, replayed: true };
  if (!commentRights(c, scope, comment, policy).attach && !scope.can.moderate) throw commentError(403, "COMMENT_ATTACHMENT_INVALID", "You cannot remove this file.");
  await client.query(`UPDATE tenant.project_comment_attachments SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, link.id, c.userId ?? null]);
  if (link.source === "UPLOADED") await archiveFile(client, { organizationId: c.organizationId, entityType: COMMENT_ENTITY, entityId: comment.id, fileId: id, actorUserId: c.userId ?? null });
  return { commentId: comment.id, removed: true };
}

// ------------------------------------------------------------------ follow and read
// input: { parentType, parentId, status: FOLLOWING | MUTED }. Muting stops notifications from a discussion one would otherwise follow.
export async function subscribeToDiscussion(client, c, input = {}) {
  const scope = await parentAccess(client, c, input.parentType, input.parentId);
  const status = String(input.status ?? "FOLLOWING").toUpperCase() === "MUTED" ? "MUTED" : "FOLLOWING";
  await follow(client, c, scope, status, { keepMuted: false });
  return { parentType: scope.type, parentId: scope.id, status };
}
// input: { parentType, parentId, upToSequence? } — up to the newest comment this person can see (never past it).
export async function markDiscussionRead(client, c, input = {}) {
  const scope = await parentAccess(client, c, input.parentType, input.parentId);
  const newest = Number((await client.query(`SELECT COALESCE(max(sequence), 0) AS n FROM tenant.project_comments WHERE organization_id = $1 AND parent_type = $2 AND parent_id = $3
      AND ($4 OR visibility <> 'RESTRICTED')`, [c.organizationId, scope.type, scope.id, scope.can.restricted])).rows[0].n);
  const wanted = input.upToSequence === undefined || input.upToSequence === null ? newest : Math.min(newest, Math.max(0, Number(input.upToSequence) || 0));
  await readUpTo(client, c, scope, wanted);
  return { parentType: scope.type, parentId: scope.id, lastReadSequence: wanted };
}

// ------------------------------------------------------------------ company comment settings
// input: { editWindowMinutes?, maxLength? }
export async function saveCommentSettings(client, c, input = {}) {
  if (!has(c, "projects.settings.manage")) throw commentError(403, "COMMENT_PERMISSION_DENIED");
  const current = await commentPolicy(client, c);
  const int = (value, fallback, min, max, label) => {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw commentError(400, "COMMENT_PERMISSION_DENIED", `${label} must be between ${min} and ${max}.`);
    return n;
  };
  const editWindowMinutes = int(input.editWindowMinutes, current.editWindowMinutes, 0, 43200, "The edit window");
  const maxLength = int(input.maxLength, current.maxLength, 200, 20000, "The comment length limit");
  await client.query(`INSERT INTO tenant.project_settings (organization_id, comment_edit_window_minutes, comment_max_length) VALUES ($1,$2,$3)
      ON CONFLICT (organization_id) DO UPDATE SET comment_edit_window_minutes = EXCLUDED.comment_edit_window_minutes, comment_max_length = EXCLUDED.comment_max_length`, [c.organizationId, editWindowMinutes, maxLength]);
  return { editWindowMinutes, maxLength };
}

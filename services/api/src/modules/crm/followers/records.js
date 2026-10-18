// Followers and @mentions on CRM records (CRM plan 4.6).
//
// Anyone who can see a lead, deal, company or contact may follow it; its owner always counts as a follower. Followers are told when a note
// is added, when an email or WhatsApp message arrives, and when an automation says so. A note that mentions someone — written as
// @[Name](user-id) by the note editor — tells them, and makes them a follower (if they may see the record). Private notes tell nobody.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CrmError } from "../data-management/errors.js";
import { recordVisible } from "../notes/access.js";

export const FOLLOWABLE = Object.freeze(["lead", "opportunity", "party", "contact"]);
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
const HREF = Object.freeze({ lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// @[Ravi Rep](0b8e1b3e-…) in a note's text or HTML.
const MENTION = /@\[([^\]]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

function requireFollowable(type) {
  if (!FOLLOWABLE.includes(type)) throw new CrmError(400, "Only leads, deals, companies and contacts can be followed.", "CRM_FOLLOW_INVALID");
}

// The people who follow a record, its owner included.
export async function recordFollowerIds(client, organizationId, type, id) {
  const { rows } = await client.query(
    `SELECT user_id FROM tenant.crm_followers WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3
     UNION SELECT owner_user_id FROM tenant.${TABLE[type]} WHERE organization_id = $1 AND id = $3 AND owner_user_id IS NOT NULL`, [organizationId, type, id]);
  return rows.map((row) => row.user_id);
}

export async function listFollowers(client, context, type, id) {
  requireFollowable(type);
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_FOLLOW_RECORD");
  const { rows } = await client.query(
    `SELECT follower.user_id, follower.reason, follower.created_at, member.full_name FROM tenant.crm_followers follower JOIN users member ON member.id = follower.user_id
      WHERE follower.organization_id = $1 AND follower.entity_type = $2 AND follower.entity_id = $3 ORDER BY lower(member.full_name)`, [context.organizationId, type, id]);
  const owner = (await client.query(`SELECT owner.id, owner.full_name FROM tenant.${TABLE[type]} record JOIN users owner ON owner.id = record.owner_user_id WHERE record.organization_id = $1 AND record.id = $2`,
    [context.organizationId, id])).rows[0];
  const followers = rows.map((row) => ({ userId: row.user_id, name: row.full_name, reason: row.reason, since: row.created_at, isOwner: owner?.id === row.user_id }));
  if (owner && !followers.some((entry) => entry.userId === owner.id)) followers.unshift({ userId: owner.id, name: owner.full_name, reason: "owner", since: null, isOwner: true });
  return { followers, following: followers.some((entry) => entry.userId === context.userId), youOwn: owner?.id === context.userId };
}

// Follow (or, with follow = false, stop following) a record yourself.
export async function setFollowing(client, context, type, id, follow = true) {
  requireFollowable(type);
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_FOLLOW_RECORD");
  if (follow)
    await client.query(`INSERT INTO tenant.crm_followers (organization_id, entity_type, entity_id, user_id, reason) VALUES ($1, $2, $3, $4, 'followed') ON CONFLICT DO NOTHING`,
      [context.organizationId, type, id, context.userId]);
  else
    await client.query("DELETE FROM tenant.crm_followers WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND user_id = $4", [context.organizationId, type, id, context.userId]);
  return listFollowers(client, context, type, id);
}

export async function addFollower(client, organizationId, type, id, userId, reason = "automation") {
  if (!FOLLOWABLE.includes(type) || !UUID.test(String(userId ?? ""))) return false;
  const { rowCount } = await client.query(
    `INSERT INTO tenant.crm_followers (organization_id, entity_type, entity_id, user_id, reason)
     SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $4 AND status = 'active') ON CONFLICT DO NOTHING`,
    [organizationId, type, id, userId, reason]);
  return rowCount > 0;
}

// Tells the record's followers (except `exceptUserId`, usually whoever caused it, and `exceptUserIds`). Returns how many were told.
export async function notifyFollowers(client, organizationId, type, id, { title, message, exceptUserId = null, exceptUserIds = [], category = "crm_followed_record" }) {
  if (!FOLLOWABLE.includes(type)) return 0;
  const skip = new Set([exceptUserId, ...exceptUserIds].filter(Boolean));
  let told = 0;
  for (const userId of await recordFollowerIds(client, organizationId, type, id)) {
    if (skip.has(userId)) continue;
    if (await createNotification(client, { organizationId, userId, category, title: String(title).slice(0, 200), message: String(message ?? "").slice(0, 1000),
      href: `${HREF[type]}${id}`, entityType: `crm.${type}`, entityId: id })) told += 1;
  }
  return told;
}

// The people a note mentions (@[Name](user-id)), without repeats.
export function mentionedUserIds(text) {
  return [...new Set([...String(text ?? "").matchAll(MENTION)].map((match) => match[2].toLowerCase()))];
}

// After a note is written: mentioned people are told (and follow the record, if they may see it); the other followers hear of the note.
export async function announceNote(client, context, { type, id, text, isNew = true, isPrivate = false, previousText = "" }) {
  // A private note is its author's alone: nobody is told of it, mentioned or not.
  if (!FOLLOWABLE.includes(type) || isPrivate) return { mentioned: 0, followersTold: 0 };
  const author = (await client.query("SELECT full_name FROM users WHERE id = $1", [context.userId])).rows[0]?.full_name ?? "Someone";
  const label = (await client.query(`SELECT ${type === "contact" ? "COALESCE(display_name, contact_number)" : type === "party" ? "display_name" : type === "lead" ? "COALESCE(NULLIF(full_name, ''), company_name, code)" : "name"} AS label
      FROM tenant.${TABLE[type]} WHERE organization_id = $1 AND id = $2`, [context.organizationId, id])).rows[0]?.label ?? "a record";
  const plain = String(text ?? "").replace(MENTION, "@$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  let mentioned = 0;
  const toldOfMention = [];
  // On an edit, only people newly mentioned are told.
  const before = new Set(mentionedUserIds(previousText));
  const mentionedIds = mentionedUserIds(text).filter((userId) => userId !== context.userId && !before.has(userId));
  for (const userId of mentionedIds) {
    // Only someone who may see the record is told what it says.
    const sees = await recordVisible(client, { ...(await memberContext(client, context.organizationId, userId)) }, type, id).catch(() => false);
    if (!sees) continue;
    await addFollower(client, context.organizationId, type, id, userId, "mentioned");
    if (await createNotification(client, { organizationId: context.organizationId, userId, category: "crm_mention", title: `${author} mentioned you on ${label}`,
      message: plain.slice(0, 300), href: `${HREF[type]}${id}`, entityType: `crm.${type}`, entityId: id })) {
      mentioned += 1;
      toldOfMention.push(userId);
    }
  }
  // Followers hear of new notes, not of edits.
  const followersTold = !isNew ? 0 : await notifyFollowers(client, context.organizationId, type, id, {
    // (someone just told of their mention is not told twice)
    title: `${author} added a note on ${label}`, message: plain.slice(0, 300), exceptUserId: context.userId, exceptUserIds: toldOfMention,
  });
  return { mentioned, followersTold };
}

// A member's current CRM authority (for "may they see this record").
async function memberContext(client, organizationId, userId) {
  const { rows } = await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM organization_memberships membership
       LEFT JOIN user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
       LEFT JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
      GROUP BY membership.user_id`, [organizationId, userId]);
  if (!rows[0]) throw new CrmError(404, "Not a member.", "CRM_FOLLOW_MEMBER");
  return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
}

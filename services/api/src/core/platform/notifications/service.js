// The one notification service. Writers call createNotification(); readers
// call listNotifications()/getUnreadNotificationCount(); the viewer's CURRENT
// access is applied at read time by projectNotificationsForViewer(). Nothing
// else writes the notifications table.
import { getNotificationCategory, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "./categories.js";

export class NotificationError extends Error {
  constructor(status, message, code = "NOTIFICATION_ERROR") {
    super(message);
    this.name = "NotificationError";
    this.status = status;
    this.code = code;
  }
}
// Kept as a distinct name for existing callers/tests.
export { NotificationError as NotificationPreferenceError };

const clip = (value, max) => (value === null || value === undefined ? null : String(value).slice(0, max));
const HREF = /^\/[A-Za-z0-9/_?=&.%-]*$/;

// Writes one in-app notification for an active member, unless they turned the
// category off. Returns true when a row was written.
export async function createNotification(client, { organizationId, userId, category, title, message, href = null, entityType = null, entityId = null }) {
  const written = await writeInAppNotification(client, { organizationId, userId, category, title, message, href, entityType, entityId });
  await emailNotificationIfWanted(client, { organizationId, userId, category, title, message, href }).catch(() => undefined);
  return written;
}

// Tells the person responsible for a record that something happened to it, unless they did it themselves. Never fails the action.
export async function notifyRecordOwner(client, context, { userId, ...notification }) {
  if (!userId || userId === context?.userId) return false;
  return createNotification(client, { organizationId: context.organizationId, userId, ...notification }).catch(() => false);
}

// Everyone active in the company who holds `permission` (and the owner), except `exceptUserId`.
export async function permissionHolders(client, organizationId, permission, exceptUserId = null) {
  return (await client.query(
    `SELECT DISTINCT membership.user_id FROM organization_memberships membership
       JOIN user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
            AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM role_permissions grant_row WHERE grant_row.role_id = role.id AND grant_row.permission_key = $2))`,
    [organizationId, permission])).rows.map((row) => row.user_id).filter((userId) => userId !== exceptUserId);
}

export async function notifyPermissionHolders(client, context, permission, notification) {
  let told = 0;
  for (const userId of await permissionHolders(client, context.organizationId, permission, context.userId ?? null).catch(() => []))
    if (await createNotification(client, { organizationId: context.organizationId, userId, ...notification }).catch(() => false)) told += 1;
  return told;
}

// Email for a notification the person chose to get by email (Settings › Notifications), queued in the same transaction and sent by
// the worker (core/platform/mail/outbox.js).
async function emailNotificationIfWanted(client, { organizationId, userId, category, title, message, href }) {
  const definition = getNotificationCategory(category);
  if (!definition || !organizationId || !userId) return false;
  const row = (await client.query(
    `SELECT app_user.email, organization.name AS organization_name,
            (SELECT enabled FROM notification_preferences WHERE organization_id = $1 AND user_id = $2 AND channel = 'email' AND category = $3) AS chosen
       FROM users app_user JOIN organization_memberships membership ON membership.user_id = app_user.id AND membership.organization_id = $1 AND membership.status = 'active'
       JOIN organizations organization ON organization.id = $1
      WHERE app_user.id = $2`, [organizationId, userId, definition.key])).rows[0];
  if (!row?.email) return false;
  const wanted = row.chosen ?? Boolean(definition.defaultEmailEnabled);
  if (!wanted) return false;
  const { queueMail } = await import("../mail/outbox.js");
  await queueMail(client, { type: "notification", email: row.email, organizationId, organizationName: row.organization_name, subject: clip(title, 200) || definition.displayName, title: clip(title, 200), message: clip(message, 1000), href });
  return true;
}

async function writeInAppNotification(client, { organizationId, userId, category, title, message, href = null, entityType = null, entityId = null }) {
  const definition = getNotificationCategory(category);
  if (!definition) throw new NotificationError(500, `Unknown notification category "${category}". Register it in core/platform/notifications/categories.js.`, "NOTIFICATION_CATEGORY_UNKNOWN");
  if (!organizationId || !userId) return false;
  if (href !== null && !HREF.test(String(href))) throw new NotificationError(500, "Notification links must be application paths.", "NOTIFICATION_HREF_INVALID");
  const result = await client.query(
    `INSERT INTO notifications (organization_id, user_id, type, category, module_key, title, message, href, entity_type, entity_id)
     SELECT $1, $2, $3, $3, $4, $5, $6, $7, $8, $9
      WHERE EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active')
        AND COALESCE((SELECT enabled FROM notification_preferences
                       WHERE organization_id = $1 AND user_id = $2 AND channel = 'in_app' AND category = $3), $10)
     RETURNING id`,
    [organizationId, userId, definition.key, definition.moduleKey, clip(title, 200) || definition.displayName, clip(message, 1000) || "", href, clip(entityType, 60), clip(entityId, 100), definition.defaultInAppEnabled],
  );
  return Boolean(result.rows[0]);
}

export async function listNotifications(client, session, { status = "all", limit = 50 } = {}) {
  if (!["all", "unread", "read"].includes(status)) throw new NotificationError(400, "Unsupported notification filter.", "NOTIFICATION_FILTER_INVALID");
  const bounded = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await client.query(
    `SELECT id, category, module_key, entity_type, entity_id, title, message, href, read_at, created_at
       FROM notifications
      WHERE organization_id = $1 AND user_id = $2
        AND ($3 = 'all' OR ($3 = 'unread' AND read_at IS NULL) OR ($3 = 'read' AND read_at IS NOT NULL))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [session.organizationId, session.userId, status, bounded],
  );
  return result.rows;
}

// Counts every unread notification, including ones shown redacted, so the
// badge and the list always agree.
export async function getUnreadNotificationCount(client, session) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM notifications WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [session.organizationId, session.userId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function markNotificationRead(client, session, notificationId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(notificationId || ""))) throw new NotificationError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  const result = await client.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND organization_id = $2 AND user_id = $3
      RETURNING id, read_at`,
    [notificationId, session.organizationId, session.userId],
  );
  if (!result.rows[0]) throw new NotificationError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  return result.rows[0];
}

export async function markAllNotificationsRead(client, session) {
  const result = await client.query(
    `UPDATE notifications SET read_at = now() WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id`,
    [session.organizationId, session.userId],
  );
  return { updated: result.rows.length };
}

// ------------------------------------------------------------------ read-time projection
export const REDACTED_NOTIFICATION = Object.freeze({ title: "Notification unavailable", message: "You no longer have access to this item." });

// Stored notification text is history; what is SHOWN respects current access.
// 1. A notification from a module the viewer can no longer use loses its link
//    and record details.
// 2. A module may register a record-visibility adapter (moduleKey -> async
//    (notifications) => notifications) that re-checks each target and returns
//    neutral stubs for anything no longer visible. Domain adapters own record
//    checks; this service never guesses.
export async function projectNotificationsForViewer(notifications, { accessibleModules, adapters = {} }) {
  const modules = new Set(accessibleModules || []);
  const out = notifications.map((notification) =>
    // Platform notices (billing, approvals, record threads, automations) belong to no app and are never hidden.
    notification.module_key && notification.module_key !== "platform" && !modules.has(notification.module_key)
      ? { ...notification, ...REDACTED_NOTIFICATION, href: null, entity_type: null, entity_id: null, redacted: true }
      : notification,
  );
  for (const [moduleKey, adapter] of Object.entries(adapters)) {
    const indexes = out.map((notification, index) => (notification.module_key === moduleKey && !notification.redacted ? index : -1)).filter((index) => index >= 0);
    if (!indexes.length) continue;
    const projected = await adapter(indexes.map((index) => out[index]));
    indexes.forEach((index, position) => {
      out[index] = projected[position];
    });
  }
  return out.map(({ entity_type: _type, entity_id: _id, ...rest }) => rest);
}

// ------------------------------------------------------------------ preferences (in-app and email)
export async function listNotificationPreferences(client, session) {
  const rows = (
    await client.query(`SELECT category, channel, enabled FROM notification_preferences WHERE organization_id = $1 AND user_id = $2 AND channel IN ('in_app', 'email')`, [
      session.organizationId,
      session.userId,
    ])
  ).rows;
  const saved = new Map(rows.map((row) => [`${row.channel}:${row.category}`, row.enabled]));
  return NOTIFICATION_CATEGORIES.filter((category) => category.userConfigurable).map((category) => ({
    category: category.key,
    displayName: category.displayName,
    description: category.description,
    moduleKey: category.moduleKey,
    channel: "in_app",
    enabled: saved.has(`in_app:${category.key}`) ? saved.get(`in_app:${category.key}`) : category.defaultInAppEnabled,
    emailEnabled: saved.has(`email:${category.key}`) ? saved.get(`email:${category.key}`) : Boolean(category.defaultEmailEnabled),
  }));
}

// The daily digest: one email a day of what the person has not read yet.
export async function getNotificationDigest(client, session) {
  const row = (await client.query(`SELECT digest_enabled FROM user_preferences WHERE organization_id = $1 AND user_id = $2`, [session.organizationId, session.userId])).rows[0];
  return { enabled: Boolean(row?.digest_enabled) };
}
export async function setNotificationDigest(client, session, enabled) {
  await client.query(
    `INSERT INTO user_preferences (organization_id, user_id, digest_enabled) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET digest_enabled = EXCLUDED.digest_enabled, updated_at = now()`,
    [session.organizationId, session.userId, Boolean(enabled)]);
  return { enabled: Boolean(enabled) };
}

// Worker (daily, in the company's transaction): each person with the digest on, not sent today, with unread notifications from the
// last day, gets one email listing them.
export async function sendNotificationDigests(client, organizationId) {
  const people = (await client.query(
    `SELECT preference.user_id, app_user.email, organization.name AS organization_name
       FROM user_preferences preference
       JOIN users app_user ON app_user.id = preference.user_id
       JOIN organization_memberships membership ON membership.organization_id = preference.organization_id AND membership.user_id = preference.user_id AND membership.status = 'active'
       JOIN organizations organization ON organization.id = preference.organization_id
      WHERE preference.organization_id = $1 AND preference.digest_enabled
        AND (preference.digest_sent_on IS NULL OR preference.digest_sent_on < (now() AT TIME ZONE COALESCE(organization.timezone, 'Asia/Kolkata'))::date)`,
    [organizationId])).rows;
  const { queueMail } = await import("../mail/outbox.js");
  let sent = 0;
  for (const person of people) {
    const unread = (await client.query(
      `SELECT title, message, href FROM notifications WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL AND created_at > now() - interval '1 day'
        ORDER BY created_at DESC LIMIT 30`, [organizationId, person.user_id])).rows;
    await client.query(`UPDATE user_preferences SET digest_sent_on = (now() AT TIME ZONE COALESCE((SELECT timezone FROM organizations WHERE id = $1), 'Asia/Kolkata'))::date WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, person.user_id]);
    if (!unread.length) continue;
    await queueMail(client, { type: "digest", email: person.email, organizationId, organizationName: person.organization_name, subject: `Your day on Vercentlabs ERP: ${unread.length} update${unread.length === 1 ? "" : "s"}`,
      items: unread.map((row) => ({ title: clip(row.title, 200), message: clip(row.message, 300), href: row.href })) });
    sent += 1;
  }
  return sent;
}

export async function setNotificationPreference(client, session, input) {
  const channel = String(input?.channel ?? "in_app");
  if (!NOTIFICATION_CHANNELS.includes(channel)) throw new NotificationError(400, "Choose in-app or email.", "NOTIFICATION_CHANNEL_UNSUPPORTED");
  const definition = getNotificationCategory(input?.category);
  if (!definition || !definition.userConfigurable) throw new NotificationError(400, "That notification category does not exist.", "NOTIFICATION_CATEGORY_UNKNOWN");
  const enabled = input.enabled !== false;
  await client.query(
    `INSERT INTO notification_preferences (organization_id, user_id, channel, category, enabled)
     VALUES ($1, $2, $5, $3, $4)
     ON CONFLICT (organization_id, user_id, channel, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [session.organizationId, session.userId, definition.key, enabled, channel],
  );
  return { category: definition.key, channel, enabled };
}

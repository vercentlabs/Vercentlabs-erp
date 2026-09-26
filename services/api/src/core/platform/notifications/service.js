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
    notification.module_key && !modules.has(notification.module_key)
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

// ------------------------------------------------------------------ preferences (in-app only)
export async function listNotificationPreferences(client, session) {
  const rows = (
    await client.query(`SELECT category, enabled FROM notification_preferences WHERE organization_id = $1 AND user_id = $2 AND channel = 'in_app'`, [
      session.organizationId,
      session.userId,
    ])
  ).rows;
  const saved = new Map(rows.map((row) => [row.category, row.enabled]));
  return NOTIFICATION_CATEGORIES.filter((category) => category.userConfigurable).map((category) => ({
    category: category.key,
    displayName: category.displayName,
    description: category.description,
    moduleKey: category.moduleKey,
    channel: "in_app",
    enabled: saved.has(category.key) ? saved.get(category.key) : category.defaultInAppEnabled,
  }));
}

export async function setNotificationPreference(client, session, input) {
  const channel = String(input?.channel ?? "in_app");
  if (!NOTIFICATION_CHANNELS.includes(channel)) throw new NotificationError(400, "Only in-app notification preferences can be changed.", "NOTIFICATION_CHANNEL_UNSUPPORTED");
  const definition = getNotificationCategory(input?.category);
  if (!definition || !definition.userConfigurable) throw new NotificationError(400, "That notification category does not exist.", "NOTIFICATION_CATEGORY_UNKNOWN");
  const enabled = input.enabled !== false;
  await client.query(
    `INSERT INTO notification_preferences (organization_id, user_id, channel, category, enabled)
     VALUES ($1, $2, 'in_app', $3, $4)
     ON CONFLICT (organization_id, user_id, channel, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [session.organizationId, session.userId, definition.key, enabled],
  );
  return { category: definition.key, channel: "in_app", enabled };
}

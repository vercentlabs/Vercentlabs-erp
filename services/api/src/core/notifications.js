// Global notification center (Prompt 2B Phase 8). The `notifications`
// table (organization_id, user_id, type, title, message, href, read_at,
// created_at) already exists live with real rows — this module only adds
// the read/list/unread-count surface that was missing; no schema change.
export class NotificationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "NotificationError";
    this.status = status;
  }
}

export async function listNotifications(client, session, { status = "all", limit = 50 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await client.query(
    `SELECT id, type, title, message, href, read_at, created_at
       FROM notifications
      WHERE organization_id = $1 AND user_id = $2
        AND ($3 = 'all' OR ($3 = 'unread' AND read_at IS NULL) OR ($3 = 'read' AND read_at IS NOT NULL))
      ORDER BY created_at DESC
      LIMIT $4`,
    [session.organizationId, session.userId, status, bounded],
  );
  return result.rows;
}

export async function getUnreadNotificationCount(client, session) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM notifications WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [session.organizationId, session.userId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function markNotificationRead(client, session, notificationId) {
  const result = await client.query(
    `UPDATE notifications SET read_at = now()
      WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND read_at IS NULL
      RETURNING id, read_at`,
    [notificationId, session.organizationId, session.userId],
  );
  if (!result.rows[0]) {
    const existing = await client.query(
      `SELECT id, read_at FROM notifications WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [notificationId, session.organizationId, session.userId],
    );
    if (!existing.rows[0]) throw new NotificationError(404, "Notification not found.");
    return existing.rows[0];
  }
  return result.rows[0];
}

export async function markAllNotificationsRead(client, session) {
  const result = await client.query(
    `UPDATE notifications SET read_at = now()
      WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL
      RETURNING id`,
    [session.organizationId, session.userId],
  );
  return { updated: result.rows.length };
}

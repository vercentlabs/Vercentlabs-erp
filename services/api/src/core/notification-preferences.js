// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (notification-preference slice).
export class NotificationPreferenceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "NotificationPreferenceError";
    this.status = status;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new NotificationPreferenceError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new NotificationPreferenceError(400, `${name} is too long.`);
  return normalized;
}

export async function setNotificationPreference(client, session, input) {
  const channel = text(input.channel, "Notification channel", 30);
  if (!["in_app", "email", "push"].includes(channel)) {
    throw new NotificationPreferenceError(400, "Notification channel is invalid.");
  }
  const category = text(input.category, "Notification category", 120);
  const enabled = input.enabled !== false;
  await client.query(
    `INSERT INTO notification_preferences(
       organization_id,user_id,channel,category,enabled,quiet_hours_start,quiet_hours_end
     ) VALUES($1,$2,$3,$4,$5,$6::time,$7::time)
     ON CONFLICT (organization_id,user_id,channel,category) DO UPDATE SET
       enabled=EXCLUDED.enabled,quiet_hours_start=EXCLUDED.quiet_hours_start,
       quiet_hours_end=EXCLUDED.quiet_hours_end,updated_at=now()`,
    [
      session.organizationId,
      session.userId,
      channel,
      category,
      enabled,
      input.quietHoursStart ? String(input.quietHoursStart) : null,
      input.quietHoursEnd ? String(input.quietHoursEnd) : null,
    ],
  );
}

export async function listNotificationPreferences(client, session) {
  const result = await client.query(
    `SELECT channel,category,enabled,quiet_hours_start::text,quiet_hours_end::text,updated_at
       FROM notification_preferences
      WHERE organization_id=$1 AND user_id=$2
      ORDER BY category,channel`,
    [session.organizationId, session.userId],
  );
  return result.rows;
}

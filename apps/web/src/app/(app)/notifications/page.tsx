import NotificationList from "@/core/components/notification-list";
import { NotificationPreferences } from "@/core/components/notification-preferences";
import { requireWorkspace } from "@/core/auth";
import { query } from "@/core/db";
import { listNotificationPreferences } from "@/core/shared-platform";

export const metadata = { title: "Notifications" };
export default async function NotificationsPage() {
  const session = await requireWorkspace();
  const [rows, preferences] = await Promise.all([query<{
    id: string;
    title: string;
    message: string;
    href: string | null;
    read_at: Date | null;
    created_at: Date;
  }>(
    `
    SELECT id,title,message,href,read_at,created_at FROM notifications
    WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100
  `,
    [session.organizationId, session.userId],
  ), listNotificationPreferences(session)]);
  const notifications = rows.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    href: row.href,
    readAt: row.read_at?.toISOString() || null,
    createdAt: row.created_at.toISOString(),
  }));
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>Your workspace inbox</h1>
          <p>
            Assigned actions, access changes and business alerts are collected
            here.
          </p>
        </div>
      </section>
      <NotificationList notifications={notifications} />
      <NotificationPreferences
        preferences={preferences.map(({ channel, category, enabled, quiet_hours_start, quiet_hours_end }) => ({
          channel,
          category,
          enabled,
          quiet_hours_start,
          quiet_hours_end,
        }))}
      />
    </>
  );
}

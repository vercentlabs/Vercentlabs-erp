// Shared notifications read path (Prompt 8, Part 9). The same query
// apps/web/src/app/api/notifications/route.ts's GET already ran inline —
// moved here so My Work/Home can reuse it instead of hitting the API route
// over HTTP from a server component. Scoping unchanged: always the
// caller's own (organization_id, user_id) rows.
import type { WorkspaceSessionContext } from "@/core/auth";
import { query } from "@/core/db";

export type NotificationRow = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  read_at: Date | null;
  created_at: Date;
};

export async function listMyNotifications(
  session: WorkspaceSessionContext,
  limit = 8,
): Promise<NotificationRow[]> {
  return query<NotificationRow>(
    `SELECT id,title,message,href,read_at,created_at FROM notifications
     WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 8, 1), 100)}`,
    [session.organizationId, session.userId],
  );
}

export async function countUnreadNotifications(
  session: WorkspaceSessionContext,
): Promise<number> {
  const [row] = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL`,
    [session.organizationId, session.userId],
  );
  return row?.count || 0;
}

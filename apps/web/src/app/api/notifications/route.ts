import { getUnreadNotificationCount, listNotificationsForViewer, markAllNotificationsRead } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Stored notification text is history; what is SHOWN is projected against the
// viewer's CURRENT module and record access (tenant transaction: record
// adapters read tenant tables). Redacted items stay in the list and in the
// unread count, so the badge and the list always agree. Never billing-gated.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "notifications.list" }, async ({ client, session, snapshot }) => {
    const raw = new URL(request.url).searchParams.get("status");
    const status = raw === "unread" || raw === "read" ? raw : "all";
    const notifications = await listNotificationsForViewer(client, session, { status, accessibleModules: snapshot?.accessibleModules ?? [] });
    return ok({ notifications, unreadCount: await getUnreadNotificationCount(client, session) });
  });
}

// Mark every notification read: the caller's own rows only.
export async function PATCH(request: Request) {
  return workspaceRoute(request, { action: "notifications.mark_all_read" }, async ({ client, session }) =>
    ok(await markAllNotificationsRead(client, session)),
  );
}

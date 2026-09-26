import { markNotificationRead } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Mark one of the caller's own notifications read (another user's or another
// organisation's id answers "not found"). Never billing-gated.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { action: "notifications.mark_read" }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok({ notification: await markNotificationRead(client, session, id) });
  });
}

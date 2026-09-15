import { listNotifications, markAllNotificationsRead } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status =
      (url.searchParams.get("status") as "all" | "unread" | "read" | null) ||
      "all";
    const notifications = await withClient((client) =>
      listNotifications(client, session, { status }),
    );
    return ok({ notifications });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH() {
  try {
    const session = await requireWorkspace();
    const result = await withClient((client) =>
      markAllNotificationsRead(client, session),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

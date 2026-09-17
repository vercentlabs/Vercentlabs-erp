import { listSessionsForUser } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

// SESSION-DEVICE-UI. Self-service — a user lists only their own sessions,
// no permission check beyond being authenticated (see listSessionsForUser's
// own comment: ownership of the row IS the authorization here).
export async function GET() {
  try {
    const session = await requireWorkspace();
    const sessions = await withClient((client) => listSessionsForUser(client, session.userId));
    return ok({
      sessions: sessions.map((row) => ({ ...row, isCurrent: row.id === session.sessionId })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

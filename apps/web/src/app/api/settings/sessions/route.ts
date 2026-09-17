import { assertSameOriginOrMobile, listSessionsForUser, revokeOtherSessions } from "@vercentlabs/api";

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

// "Sign out all other sessions" (SP006/Phase 3) — the caller's own
// session (already proven via the cookie requireWorkspace() resolves) is
// always excluded, so this can never end with the caller locking
// themselves out.
export async function DELETE(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const revokedCount = await withClient((client) => revokeOtherSessions(client, session.userId, session.sessionId));
    return ok({ revokedCount });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getSessionContext } from "@/core/auth";
import { query } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { sessionActionSchema } from "@/core/validation";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) throw new HttpError(401, "Sign in to continue.");
    const input = sessionActionSchema.parse(await readJson(request));

    if (input.action === "revoke-others") {
      await query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'user_revoked_other_sessions' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [session.userId, session.sessionId],
      );
    } else {
      if (!input.sessionId || input.sessionId === session.sessionId)
        throw new HttpError(400, "Use sign out to end the current session.");
      await query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'user_revoked_session' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [input.sessionId, session.userId],
      );
    }

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "auth.session_revoked",
      entityType: "session",
      entityId: input.sessionId || "others",
      request,
    });
    return ok({ message: "Session access updated." });
  } catch (error) {
    return errorResponse(error);
  }
}

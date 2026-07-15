import { randomUUID } from "node:crypto";
import {
  createSession,
  getSessionContext,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit, enforceRateLimit } from "@/lib/security";
import { changePasswordSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) throw new HttpError(401, "Sign in to continue.");
    await enforceRateLimit("change-password:" + session.userId, 5, 900);
    const input = changePasswordSchema.parse(await readJson(request));
    const users = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [session.userId],
    );
    if (
      !users[0] ||
      !(await verifyPassword(input.currentPassword, users[0].password_hash))
    )
      throw new HttpError(401, "The current password is incorrect.");

    const nextHash = await hashPassword(input.password);
    await transaction(async (client) => {
      const history = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5",
        [session.userId],
      );
      for (const previous of history.rows) {
        if (await verifyPassword(input.password, previous.password_hash))
          throw new HttpError(
            400,
            "Choose a password you have not recently used.",
          );
      }
      await client.query(
        "UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2",
        [nextHash, session.userId],
      );
      await client.query(
        "INSERT INTO password_history (id, user_id, password_hash) VALUES ($1,$2,$3)",
        [randomUUID(), session.userId, nextHash],
      );
      await client.query(
        "UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_change' WHERE user_id = $1 AND revoked_at IS NULL",
        [session.userId],
      );
    });

    const nextSession = await createSession(session.userId, request);
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "auth.password_changed",
      entityType: "user",
      entityId: session.userId,
      request,
    });
    const response = ok({
      message: "Password changed and other sessions were signed out.",
      next: "/security",
    });
    setSessionCookie(response, nextSession);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

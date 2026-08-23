import { randomUUID } from "node:crypto";
import { hashPassword, tokenHash, verifyPassword } from "@/core/auth";
import { transaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
} from "@/core/security";
import { resetPasswordSchema } from "@/core/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("reset:" + clientIp(request), 8, 900);
    const input = resetPasswordSchema.parse(await readJson(request));
    const passwordHash = await hashPassword(input.password);

    const userId = await transaction(async (client) => {
      const tokenResult = await client.query<{ user_id: string }>(
        `
        SELECT user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE
      `,
        [tokenHash(input.token)],
      );
      const row = tokenResult.rows[0];
      if (!row)
        throw new HttpError(
          400,
          "This password-reset link is invalid or expired.",
        );

      const history = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5",
        [row.user_id],
      );
      for (const previous of history.rows) {
        if (await verifyPassword(input.password, previous.password_hash))
          throw new HttpError(
            400,
            "Choose a password you have not recently used.",
          );
      }

      await client.query(
        "UPDATE users SET password_hash = $1, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $2",
        [passwordHash, row.user_id],
      );
      await client.query(
        "INSERT INTO password_history (id, user_id, password_hash) VALUES ($1, $2, $3)",
        [randomUUID(), row.user_id, passwordHash],
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [row.user_id],
      );
      await client.query(
        "UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL",
        [row.user_id],
      );
      return row.user_id;
    });

    await audit({
      actorUserId: userId,
      eventType: "auth.password_reset",
      entityType: "user",
      entityId: userId,
      request,
    });
    return ok({
      message: "Password changed. Sign in again with your new password.",
      next: "/login?reset=success",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

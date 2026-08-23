import { randomUUID } from "node:crypto";
import { createOpaqueToken, tokenHash } from "@/core/auth";
import { query, transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { deliverAuthMessage } from "@/core/mailer";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
} from "@/core/security";
import { forgotPasswordSchema } from "@/core/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("forgot:" + clientIp(request), 8, 900);
    const input = forgotPasswordSchema.parse(await readJson(request));
    const users = await query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND status = 'active'",
      [input.email],
    );
    let developmentUrl = "";
    if (users[0]) {
      const rawToken = createOpaqueToken();
      await transaction(async (client) => {
        await client.query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
          [users[0].id],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval '1 hour')`,
          [randomUUID(), users[0].id, tokenHash(rawToken)],
        );
      });
      const url =
        (process.env.APP_URL || "http://localhost:3001") +
        "/reset-password?token=" +
        encodeURIComponent(rawToken);
      await deliverAuthMessage({
        type: "reset-password",
        email: input.email,
        url,
      });
      if (process.env.NODE_ENV !== "production") developmentUrl = url;
      await audit({
        actorUserId: users[0].id,
        eventType: "auth.password_reset_requested",
        entityType: "user",
        entityId: users[0].id,
        request,
      });
    }
    return ok({
      message: "When an active account exists, reset instructions are sent.",
      ...(developmentUrl ? { developmentUrl } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

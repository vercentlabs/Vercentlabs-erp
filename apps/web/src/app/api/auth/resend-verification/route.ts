import { randomUUID } from "node:crypto";

import { createOpaqueToken, tokenHash } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { deliverAuthMessage } from "@/lib/mailer";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
} from "@/lib/security";
import { resendVerificationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("verify-resend:" + clientIp(request), 5, 900);
    const input = resendVerificationSchema.parse(await readJson(request));
    const users = await query<{ id: string; email_verified_at: Date | null }>(
      "SELECT id, email_verified_at FROM users WHERE email = $1",
      [input.email],
    );
    const user = users[0];

    let developmentUrl = "";
    if (user && !user.email_verified_at) {
      const recent = await query<{ created_at: Date }>(
        "SELECT created_at FROM email_verification_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [user.id],
      );
      if (
        recent[0] &&
        Date.now() - new Date(recent[0].created_at).getTime() < 60_000
      ) {
        throw new HttpError(
          429,
          "Wait one minute before requesting another verification link.",
        );
      }

      const rawToken = createOpaqueToken();
      await transaction(async (client) => {
        await client.query(
          "UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
          [user.id],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '24 hours')`,
          [randomUUID(), user.id, tokenHash(rawToken)],
        );
      });
      const url =
        (process.env.APP_URL || "http://localhost:3001") +
        "/verify-email?token=" +
        encodeURIComponent(rawToken);
      await deliverAuthMessage({
        type: "verify-email",
        email: input.email,
        url,
      });
      if (process.env.NODE_ENV !== "production") developmentUrl = url;
      await audit({
        actorUserId: user.id,
        eventType: "auth.verification_resent",
        entityType: "user",
        entityId: user.id,
        request,
      });
    }

    return ok({
      message:
        "When an unverified account exists, a new verification link is sent.",
      ...(developmentUrl ? { developmentUrl } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

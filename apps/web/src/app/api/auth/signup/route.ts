import { randomUUID } from "node:crypto";

import { createOpaqueToken, hashPassword, tokenHash } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { deliverAuthMessage } from "@/lib/mailer";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
} from "@/lib/security";
import { signupSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("signup:" + clientIp(request), 6, 900);
    const input = signupSchema.parse(await readJson(request));

    if (
      process.env.NODE_ENV === "production" &&
      !(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.AUTH_EMAIL_FROM
      ) &&
      !process.env.AUTH_EMAIL_WEBHOOK_URL
    ) {
      throw new HttpError(
        503,
        "Account registration is temporarily unavailable.",
      );
    }

    const existing = await query<{
      id: string;
      email_verified_at: Date | null;
    }>("SELECT id, email_verified_at FROM users WHERE email = $1", [
      input.email,
    ]);

    let userId = existing[0]?.id;
    let rawToken = "";

    if (!existing[0]) {
      userId = randomUUID();
      rawToken = createOpaqueToken();
      const passwordHash = await hashPassword(input.password);
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, email, full_name, password_hash, password_changed_at)
           VALUES ($1, $2, $3, $4, now())`,
          [userId, input.email, input.fullName, passwordHash],
        );
        await client.query(
          "INSERT INTO password_history (id, user_id, password_hash) VALUES ($1, $2, $3)",
          [randomUUID(), userId, passwordHash],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '24 hours')`,
          [randomUUID(), userId, tokenHash(rawToken)],
        );
      });
      await audit({
        actorUserId: userId,
        eventType: "auth.user_registered",
        entityType: "user",
        entityId: userId,
        request,
      });
    } else if (!existing[0].email_verified_at) {
      rawToken = createOpaqueToken();
      await transaction(async (client) => {
        await client.query(
          "UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
          [userId],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '24 hours')`,
          [randomUUID(), userId, tokenHash(rawToken)],
        );
      });
    }

    let developmentUrl = "";
    if (rawToken) {
      const appUrl = process.env.APP_URL || "http://localhost:3001";
      const verificationUrl =
        appUrl + "/verify-email?token=" + encodeURIComponent(rawToken);
      await deliverAuthMessage({
        type: "verify-email",
        email: input.email,
        url: verificationUrl,
      });
      if (process.env.NODE_ENV !== "production")
        developmentUrl = verificationUrl;
    }

    return ok(
      {
        message:
          "Check your email for the verification link. Existing accounts are not changed.",
        next: "/verify-email?email=" + encodeURIComponent(input.email),
        ...(developmentUrl ? { developmentUrl } : {}),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

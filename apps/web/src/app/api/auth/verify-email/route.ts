import { createSession, setSessionCookie, tokenHash } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { verifyEmailSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = verifyEmailSchema.parse(await readJson(request));

    const result = await transaction(async (client) => {
      const tokenResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM email_verification_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash(input.token)],
      );
      const row = tokenResult.rows[0];
      if (!row)
        throw new HttpError(
          400,
          "This verification link is invalid or expired.",
        );

      await client.query(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1",
        [row.user_id],
      );
      await client.query(
        "UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [row.user_id],
      );
      const memberships = await client.query<{ organization_id: string }>(
        "SELECT organization_id FROM organization_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1",
        [row.user_id],
      );
      return {
        userId: row.user_id,
        hasOrganization: Boolean(memberships.rows[0]),
      };
    });

    const session = await createSession(result.userId, request);
    await audit({
      actorUserId: result.userId,
      eventType: "auth.email_verified",
      entityType: "user",
      entityId: result.userId,
      request,
    });
    const response = ok({
      message: "Email verified successfully.",
      next: result.hasOrganization ? "/dashboard" : "/onboarding",
    });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

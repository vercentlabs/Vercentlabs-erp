import {
  createSession,
  nextPath,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
  recordLoginEvent,
} from "@/lib/security";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = loginSchema.parse(await readJson(request));
    await enforceRateLimit("login-ip:" + clientIp(request), 20, 900);
    await enforceRateLimit("login-email:" + input.email, 10, 900);

    const rows = await query<{
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      email_verified_at: Date | null;
      status: string;
      locked_until: Date | null;
      organization_id: string | null;
      organization_name: string | null;
      role: "owner" | "admin" | "member" | null;
    }>(
      `
      SELECT u.id, u.email, u.full_name, u.password_hash, u.email_verified_at, u.status, u.locked_until,
        m.organization_id, o.name AS organization_name, m.role
      FROM users u
      LEFT JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'active'
      LEFT JOIN organizations o ON o.id = m.organization_id
      WHERE u.email = $1
      ORDER BY m.created_at ASC NULLS LAST
      LIMIT 1
    `,
      [input.email],
    );

    const user = rows[0];
    const generic = "The email or password is incorrect.";
    if (!user) {
      await recordLoginEvent({
        request,
        email: input.email,
        succeeded: false,
        reason: "unknown_account",
      });
      throw new HttpError(401, generic);
    }
    if (user.status !== "active") {
      await recordLoginEvent({
        request,
        email: input.email,
        userId: user.id,
        succeeded: false,
        reason: "account_disabled",
      });
      throw new HttpError(
        403,
        "This account is not active. Contact an organisation administrator.",
      );
    }
    if (
      user.locked_until &&
      new Date(user.locked_until).getTime() > Date.now()
    ) {
      throw new HttpError(
        429,
        "This account is temporarily locked. Try again later.",
      );
    }

    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      await query(
        `
        UPDATE users SET
          failed_login_attempts = failed_login_attempts + 1,
          locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
          updated_at = now()
        WHERE id = $1
      `,
        [user.id],
      );
      await recordLoginEvent({
        request,
        email: input.email,
        userId: user.id,
        succeeded: false,
        reason: "invalid_password",
      });
      throw new HttpError(401, generic);
    }

    if (!user.email_verified_at) {
      await recordLoginEvent({
        request,
        email: input.email,
        userId: user.id,
        succeeded: false,
        reason: "email_unverified",
      });
      throw new HttpError(403, "Verify your email before signing in.");
    }

    await query(
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1",
      [user.id],
    );
    const session = await createSession(user.id, request);
    const context = {
      sessionId: session.sessionId,
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      emailVerified: true,
      organizationId: user.organization_id,
      organizationName: user.organization_name,
      membershipRole: user.role,
      roleSlugs: [],
      permissions: [],
      activeCompanyId: null,
      companyName: null,
      activeBranchId: null,
      branchName: null,
    };
    await recordLoginEvent({
      request,
      email: input.email,
      userId: user.id,
      succeeded: true,
    });
    await audit({
      organizationId: user.organization_id,
      actorUserId: user.id,
      eventType: "auth.login_succeeded",
      entityType: "user",
      entityId: user.id,
      request,
    });
    const response = ok({
      message: "Signed in successfully.",
      next: nextPath(context),
    });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

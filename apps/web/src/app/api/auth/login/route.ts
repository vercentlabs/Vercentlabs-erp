import {
  createSession,
  nextPath,
  setSessionCookie,
  verifyPasswordOrDummy,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit, recordLoginEvent } from "@/lib/security";
import {
  enforceLoginRateLimits,
  GENERIC_LOGIN_FAILURE,
  isAccountLocked,
  isLoginUsable,
  loginFailureReason,
  recordFailedPasswordAttempt,
  recordSuccessfulLogin,
} from "@/lib/login-policy";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = loginSchema.parse(await readJson(request));
    await enforceLoginRateLimits(request, input.email);

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
      SELECT
        app_user.id,
        app_user.email,
        app_user.full_name,
        app_user.password_hash,
        app_user.email_verified_at,
        app_user.status,
        app_user.locked_until,
        membership.organization_id,
        organization.name AS organization_name,
        membership.role
      FROM users AS app_user
      LEFT JOIN LATERAL (
        SELECT organization_membership.organization_id,
          organization_membership.role,
          organization_membership.created_at
        FROM organization_memberships AS organization_membership
        JOIN organizations AS active_organization
          ON active_organization.id = organization_membership.organization_id
         AND active_organization.status = 'active'
        WHERE organization_membership.user_id = app_user.id
          AND organization_membership.status = 'active'
        ORDER BY organization_membership.created_at ASC,
          organization_membership.organization_id ASC
        LIMIT 1
      ) AS membership ON true
      LEFT JOIN organizations AS organization
        ON organization.id = membership.organization_id
      WHERE app_user.email = $1
      LIMIT 1
    `,
      [input.email],
    );

    const user = rows[0];
    const passwordValid = await verifyPasswordOrDummy(
      input.password,
      user?.password_hash,
    );
    const locked = isAccountLocked(user);
    const accountUsable = isLoginUsable(user, passwordValid);

    if (!accountUsable) {
      const reason = loginFailureReason(user, passwordValid);

      if (user && !passwordValid && !locked) {
        await recordFailedPasswordAttempt(user.id);
      }

      await recordLoginEvent({
        request,
        email: input.email,
        userId: user?.id,
        succeeded: false,
        reason,
      });
      throw new HttpError(401, GENERIC_LOGIN_FAILURE);
    }

    await recordSuccessfulLogin(user.id);

    const session = await createSession(user.id, request, user.organization_id);
    const context = {
      sessionId: session.sessionId,
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      locale: "en-IN",
      timezone: "UTC",
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
    response.headers.set("Cache-Control", "private, no-store");
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

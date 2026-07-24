import { z } from "zod";

import { getMobileSessionContext, verifyPasswordOrDummy } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { createMobileSession } from "@/lib/mobile-session";
import {
  audit,
  clientIp,
  enforceRateLimit,
  recordLoginEvent,
} from "@/lib/security";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  device: z.object({
    deviceId: z.string().uuid(),
    platform: z.enum(["android", "ios"]),
    deviceName: z.string().trim().min(1).max(120),
    appVersion: z.string().trim().min(1).max(40),
  }),
});

const genericFailure = "The email or password is incorrect.";

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await readJson(request));
    await enforceRateLimit(`mobile-login-ip:${clientIp(request)}`, 20, 900);
    await enforceRateLimit(`mobile-login-email:${input.email}`, 10, 900);

    const rows = await query<{
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      email_verified_at: Date | null;
      status: string;
      locked_until: Date | null;
      organization_id: string | null;
    }>(
      `SELECT app_user.id, app_user.email, app_user.full_name,
              app_user.password_hash, app_user.email_verified_at,
              app_user.status, app_user.locked_until,
              membership.organization_id
         FROM users AS app_user
         LEFT JOIN LATERAL (
           SELECT organization_membership.organization_id
             FROM organization_memberships AS organization_membership
             JOIN organizations AS organization
               ON organization.id = organization_membership.organization_id
              AND organization.status = 'active'
            WHERE organization_membership.user_id = app_user.id
              AND organization_membership.status = 'active'
            ORDER BY organization_membership.created_at,
                     organization_membership.organization_id
            LIMIT 1
         ) AS membership ON true
        WHERE app_user.email = $1
        LIMIT 1`,
      [input.email],
    );

    const user = rows[0];
    const passwordValid = await verifyPasswordOrDummy(
      input.password,
      user?.password_hash,
    );
    const locked = Boolean(
      user?.locked_until && new Date(user.locked_until).getTime() > Date.now(),
    );
    const usable = Boolean(
      user &&
      passwordValid &&
      user.status === "active" &&
      user.email_verified_at &&
      !locked,
    );

    if (!usable) {
      let reason = "unknown_account";
      if (user) {
        if (!passwordValid) reason = "invalid_password";
        else if (user.status !== "active") reason = "account_disabled";
        else if (!user.email_verified_at) reason = "email_unverified";
        else if (locked) reason = "account_locked";
      }
      if (user && !passwordValid && !locked) {
        await query(
          `UPDATE users SET
             failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE
               WHEN failed_login_attempts + 1 >= 5
               THEN now() + interval '15 minutes'
               ELSE locked_until
             END,
             updated_at = now()
           WHERE id = $1`,
          [user.id],
        );
      }
      await recordLoginEvent({
        request,
        email: input.email,
        userId: user?.id,
        succeeded: false,
        reason,
      });
      throw new HttpError(401, genericFailure);
    }

    if (!user.organization_id) {
      await recordLoginEvent({
        request,
        email: input.email,
        userId: user.id,
        succeeded: false,
        reason: "workspace_not_configured",
      });
      throw new HttpError(
        409,
        "Complete organisation setup in the web application before using the mobile app.",
      );
    }

    await query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
                        last_login_at = now(), updated_at = now()
        WHERE id = $1`,
      [user.id],
    );
    const created = await createMobileSession({
      userId: user.id,
      organizationId: user.organization_id,
      request,
      device: input.device,
    });
    const context = await getMobileSessionContext(created.accessToken);
    if (!context)
      throw new HttpError(500, "The mobile session could not be created.");

    await recordLoginEvent({
      request,
      email: input.email,
      userId: user.id,
      succeeded: true,
    });
    await audit({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      eventType: "auth.mobile_login_succeeded",
      entityType: "session",
      entityId: created.sessionId,
      metadata: {
        platform: input.device.platform,
        appVersion: input.device.appVersion,
      },
      request,
    });

    return mobileOk(request, {
      accessToken: created.accessToken,
      refreshToken: created.refreshToken,
      accessExpiresAt: created.accessExpiresAt.toISOString(),
      refreshExpiresAt: created.refreshExpiresAt.toISOString(),
      session: {
        user: {
          id: context.userId,
          email: context.email,
          fullName: context.fullName,
          locale: context.locale,
          timezone: context.timezone,
        },
        workspace: {
          organizationId: context.organizationId,
          organizationName: context.organizationName,
          membershipRole: context.membershipRole,
          activeCompanyId: context.activeCompanyId,
          companyName: context.companyName,
          activeBranchId: context.activeBranchId,
          branchName: context.branchName,
        },
        access: {
          roleSlugs: context.roleSlugs,
          permissions: context.permissions,
        },
      },
    });
  } catch (error) {
    return mobileError(request, error);
  }
}

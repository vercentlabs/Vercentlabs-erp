import { randomUUID } from "node:crypto";

import {
  createOpaqueToken,
  getMobileSessionContext,
  tokenHash,
  type SessionContext,
} from "@/core/auth";
import { transaction } from "@/core/db";
import { HttpError } from "@/core/http";
import { clientIp } from "@/core/security";

export type MobilePlatform = "android" | "ios";

export type MobileDevice = {
  deviceId: string;
  platform: MobilePlatform;
  deviceName: string;
  appVersion: string;
};

export type MobileTokenPair = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

function boundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export function mobileSessionDurations(now = Date.now()) {
  const accessMinutes = boundedNumber(
    process.env.MOBILE_ACCESS_TOKEN_MINUTES,
    15,
    5,
    60,
  );
  const refreshDays = boundedNumber(
    process.env.MOBILE_REFRESH_TOKEN_DAYS,
    30,
    1,
    90,
  );
  const idleDays = boundedNumber(
    process.env.MOBILE_SESSION_IDLE_DAYS,
    7,
    1,
    refreshDays,
  );

  return {
    accessExpiresAt: new Date(now + accessMinutes * 60_000),
    refreshExpiresAt: new Date(now + refreshDays * 86_400_000),
    idleExpiresAt: new Date(now + idleDays * 86_400_000),
  };
}

function tokenPair(
  refreshExpiresAt?: Date,
): MobileTokenPair & { idleExpiresAt: Date } {
  const durations = mobileSessionDurations();
  return {
    accessToken: createOpaqueToken(),
    refreshToken: createOpaqueToken(),
    accessExpiresAt: durations.accessExpiresAt,
    refreshExpiresAt: refreshExpiresAt || durations.refreshExpiresAt,
    idleExpiresAt: new Date(
      Math.min(
        durations.idleExpiresAt.getTime(),
        (refreshExpiresAt || durations.refreshExpiresAt).getTime(),
      ),
    ),
  };
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,200})$/);
  if (!match)
    throw new HttpError(401, "A valid mobile access token is required.");
  return match[1];
}

export async function requireMobileSession(
  request: Request,
): Promise<SessionContext> {
  const context = await getMobileSessionContext(bearerToken(request));
  if (!context) throw new HttpError(401, "Your mobile session has expired.");
  return context;
}

export async function createMobileSession(input: {
  userId: string;
  organizationId: string | null;
  request: Request;
  device: MobileDevice;
}) {
  const sessionId = randomUUID();
  const familyId = randomUUID();
  const tokens = tokenPair();
  const userAgent =
    input.request.headers.get("user-agent")?.slice(0, 500) || null;

  await transaction(async (client) => {
    await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = 'device_reauthenticated'
        WHERE user_id = $1 AND device_id = $2 AND session_type = 'mobile'
          AND revoked_at IS NULL`,
      [input.userId, input.device.deviceId],
    );
    await client.query(
      `INSERT INTO sessions (
         id, user_id, token_hash, expires_at, idle_expires_at,
         refresh_token_hash, refresh_expires_at, refresh_family_id,
         session_type, device_id, device_platform, device_name, app_version,
         ip_address, user_agent, last_seen_at, active_organization_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,'mobile',$9,$10,$11,$12,$13,$14,now(),$15
       )`,
      [
        sessionId,
        input.userId,
        tokenHash(tokens.accessToken),
        tokens.accessExpiresAt,
        tokens.idleExpiresAt,
        tokenHash(tokens.refreshToken),
        tokens.refreshExpiresAt,
        familyId,
        input.device.deviceId,
        input.device.platform,
        input.device.deviceName.slice(0, 120),
        input.device.appVersion.slice(0, 40),
        clientIp(input.request),
        userAgent,
        input.organizationId,
      ],
    );
  });

  return { sessionId, ...tokens };
}

type RefreshResult =
  | { kind: "ok"; sessionId: string; tokens: MobileTokenPair }
  | { kind: "invalid" }
  | { kind: "reused" };

export async function rotateMobileSession(
  refreshToken: string,
  request: Request,
) {
  const currentHash = tokenHash(refreshToken);
  const result = await transaction<RefreshResult>(async (client) => {
    const current = await client.query<{
      id: string;
      refresh_expires_at: Date;
    }>(
      `SELECT session.id, session.refresh_expires_at
         FROM sessions AS session
         JOIN users AS app_user ON app_user.id = session.user_id
        WHERE session.refresh_token_hash = $1
          AND session.session_type = 'mobile'
          AND session.revoked_at IS NULL
          AND session.refresh_expires_at > now()
          AND session.idle_expires_at > now()
          AND app_user.status = 'active'
        FOR UPDATE OF session`,
      [currentHash],
    );

    const active = current.rows[0];
    if (!active) {
      const consumed = await client.query<{ session_id: string }>(
        `SELECT history.session_id
           FROM mobile_refresh_token_history AS history
           JOIN sessions AS session ON session.id = history.session_id
          WHERE history.token_hash = $1 AND history.expires_at > now()
          FOR UPDATE OF session`,
        [currentHash],
      );
      if (!consumed.rows[0]) return { kind: "invalid" };
      await client.query(
        `UPDATE sessions
            SET revoked_at = COALESCE(revoked_at, now()),
                revoked_reason = COALESCE(revoked_reason, 'refresh_token_reuse')
          WHERE id = $1`,
        [consumed.rows[0].session_id],
      );
      return { kind: "reused" };
    }

    const tokens = tokenPair(new Date(active.refresh_expires_at));
    await client.query(
      `INSERT INTO mobile_refresh_token_history (
         token_hash, session_id, consumed_at, expires_at
       ) VALUES ($1,$2,now(),$3)`,
      [currentHash, active.id, active.refresh_expires_at],
    );
    await client.query(
      `UPDATE sessions SET
         token_hash = $2,
         refresh_token_hash = $3,
         expires_at = $4,
         idle_expires_at = $5,
         last_seen_at = now(),
         ip_address = $6,
         user_agent = $7
       WHERE id = $1`,
      [
        active.id,
        tokenHash(tokens.accessToken),
        tokenHash(tokens.refreshToken),
        tokens.accessExpiresAt,
        tokens.idleExpiresAt,
        clientIp(request),
        request.headers.get("user-agent")?.slice(0, 500) || null,
      ],
    );
    return { kind: "ok", sessionId: active.id, tokens };
  });

  if (result.kind === "reused") {
    throw new HttpError(
      401,
      "This session was revoked because a refresh token was reused.",
    );
  }
  if (result.kind === "invalid") {
    throw new HttpError(401, "Your mobile session has expired.");
  }
  return result;
}

export async function revokeMobileSession(
  request: Request,
  reason = "mobile_logout",
) {
  const hash = tokenHash(bearerToken(request));
  await transaction(async (client) => {
    await client.query(
      `UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, now()),
              revoked_reason = COALESCE(revoked_reason, $2)
        WHERE token_hash = $1 AND session_type = 'mobile'`,
      [hash, reason],
    );
  });
}

export function publicSession(context: SessionContext) {
  return {
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
  };
}

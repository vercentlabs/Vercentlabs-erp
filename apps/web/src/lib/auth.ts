import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { clientIp } from "@/lib/security";

const scrypt = promisify(scryptCallback);
const cookieName = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";
const dummyPasswordHash =
  "scrypt$3f6d7a91c2e4b5d60718293a4b5c6d7e$e78bc2155bbb458a223654263afbeef216218ad55fc88b54324bbd96d96bbf618faa72c8b71fd17d2d50dc818e454ee849fa6bfb26d129a34cd7c9cb9f5cfd80";

export type SessionContext = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  locale: string;
  timezone: string;
  emailVerified: boolean;
  organizationId: string | null;
  organizationName: string | null;
  membershipRole: "owner" | "admin" | "member" | null;
  roleSlugs: string[];
  permissions: string[];
  activeCompanyId: string | null;
  companyName: string | null;
  activeBranchId: string | null;
  branchName: string | null;
};

export type WorkspaceSessionContext = SessionContext & {
  organizationId: string;
};

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return "scrypt$" + salt.toString("hex") + "$" + derived.toString("hex");
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(
    password,
    Buffer.from(saltHex, "hex"),
    64,
  )) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function verifyPasswordOrDummy(
  password: string,
  stored?: string | null,
) {
  return verifyPassword(password, stored || dummyPasswordHash);
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function sessionDurations() {
  const absoluteDays = boundedInteger(
    process.env.SESSION_ABSOLUTE_DAYS,
    30,
    1,
    365,
  );
  const idleMinutes = boundedInteger(
    process.env.SESSION_IDLE_MINUTES,
    480,
    15,
    43_200,
  );
  const expiresAt = new Date(Date.now() + absoluteDays * 86_400_000);
  const idleExpiresAt = new Date(
    Math.min(expiresAt.getTime(), Date.now() + idleMinutes * 60_000),
  );
  return { expiresAt, idleExpiresAt, idleMinutes };
}

function deviceName(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Mac OS/i.test(userAgent)
      ? "macOS"
      : /Android/i.test(userAgent)
        ? "Android"
        : /iPhone|iPad/i.test(userAgent)
          ? "iOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Device";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : "Browser";
  return `${browser} on ${os}`;
}

export async function createSession(
  userId: string,
  request: Request,
  organizationId: string | null = null,
) {
  const token = createOpaqueToken();
  const { expiresAt, idleExpiresAt } = sessionDurations();
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  const sessionId = randomUUID();

  await query(
    `
    INSERT INTO sessions (
      id, user_id, token_hash, expires_at, idle_expires_at,
      ip_address, user_agent, device_name, last_seen_at,
      active_organization_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
  `,
    [
      sessionId,
      userId,
      tokenHash(token),
      expiresAt,
      idleExpiresAt,
      clientIp(request),
      userAgent,
      deviceName(userAgent),
      organizationId,
    ],
  );

  return { sessionId, token, expiresAt };
}

export async function setSessionOrganization(
  sessionId: string,
  userId: string,
  organizationId: string,
) {
  const rows = await query<{ id: string }>(
    `
      UPDATE sessions AS session
      SET active_organization_id = membership.organization_id
      FROM organization_memberships AS membership
      JOIN organizations AS organization
        ON organization.id = membership.organization_id
       AND organization.status = 'active'
      WHERE session.id = $1
        AND session.user_id = $2
        AND membership.user_id = session.user_id
        AND membership.organization_id = $3
        AND membership.status = 'active'
        AND session.revoked_at IS NULL
      RETURNING session.id
    `,
    [sessionId, userId, organizationId],
  );
  return Boolean(rows[0]);
}

export function setSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: Date },
) {
  response.cookies.set(cookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function currentSessionTokenHash() {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  return token ? tokenHash(token) : null;
}

export async function revokeCurrentSession(reason = "logout") {
  const hash = await currentSessionTokenHash();
  if (hash) {
    await query(
      "UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
      [hash, reason],
    );
  }
}

async function resolveSessionContext(
  token: string,
  sessionType: "browser" | "mobile",
): Promise<SessionContext | null> {
  const hash = tokenHash(token);
  const rows = await query<{
    session_id: string;
    session_organization_id: string | null;
    user_id: string;
    email: string;
    full_name: string;
    locale: string;
    timezone: string;
    email_verified_at: Date | null;
    organization_id: string | null;
    organization_name: string | null;
    membership_role: "owner" | "admin" | "member" | null;
    role_slugs: string[] | null;
    permissions: string[] | null;
    stored_company_id: string | null;
    active_company_id: string | null;
    company_name: string | null;
    stored_branch_id: string | null;
    active_branch_id: string | null;
    branch_name: string | null;
  }>(
    `
    SELECT
      session.id AS session_id,
      session.active_organization_id AS session_organization_id,
      app_user.id AS user_id,
      app_user.email,
      app_user.full_name,
      COALESCE(preference.locale, 'en-IN') AS locale,
      COALESCE(preference.timezone, membership.organization_timezone, 'UTC') AS timezone,
      app_user.email_verified_at,
      membership.organization_id,
      membership.organization_name,
      membership.role AS membership_role,
      COALESCE(access_context.role_slugs, ARRAY[]::text[]) AS role_slugs,
      COALESCE(access_context.permissions, ARRAY[]::text[]) AS permissions,
      preference.active_company_id AS stored_company_id,
      active_company.id AS active_company_id,
      active_company.name AS company_name,
      preference.active_branch_id AS stored_branch_id,
      active_branch.id AS active_branch_id,
      active_branch.name AS branch_name
    FROM sessions AS session
    JOIN users AS app_user ON app_user.id = session.user_id
    LEFT JOIN LATERAL (
      SELECT
        organization_membership.organization_id,
        organization_membership.role,
        organization.name AS organization_name,
        organization.timezone AS organization_timezone,
        organization_membership.created_at
      FROM organization_memberships AS organization_membership
      JOIN organizations AS organization
        ON organization.id = organization_membership.organization_id
       AND organization.status = 'active'
      WHERE organization_membership.user_id = app_user.id
        AND organization_membership.status = 'active'
      ORDER BY
        CASE
          WHEN organization_membership.organization_id = session.active_organization_id
          THEN 0 ELSE 1
        END,
        organization_membership.created_at ASC,
        organization_membership.organization_id ASC
      LIMIT 1
    ) AS membership ON true
    LEFT JOIN user_preferences AS preference
      ON preference.organization_id = membership.organization_id
     AND preference.user_id = app_user.id
    LEFT JOIN LATERAL (
      SELECT company.id, company.name
      FROM companies AS company
      WHERE company.organization_id = membership.organization_id
        AND company.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM user_role_assignments AS unrestricted_assignment
            JOIN roles AS unrestricted_role
              ON unrestricted_role.id = unrestricted_assignment.role_id
             AND unrestricted_role.organization_id = membership.organization_id
             AND unrestricted_role.slug IN ('organization_owner', 'system_administrator')
             AND unrestricted_role.status = 'active'
            WHERE unrestricted_assignment.organization_id = membership.organization_id
              AND unrestricted_assignment.user_id = app_user.id
              AND unrestricted_assignment.status = 'active'
              AND unrestricted_assignment.starts_at <= now()
              AND (unrestricted_assignment.expires_at IS NULL OR unrestricted_assignment.expires_at > now())
          )
          OR EXISTS (
            SELECT 1
            FROM membership_company_access AS company_access
            WHERE company_access.organization_id = membership.organization_id
              AND company_access.user_id = app_user.id
              AND company_access.company_id = company.id
          )
        )
      ORDER BY
        CASE WHEN company.id = preference.active_company_id THEN 0 ELSE 1 END,
        company.is_primary DESC,
        company.created_at ASC,
        company.id ASC
      LIMIT 1
    ) AS active_company ON true
    LEFT JOIN LATERAL (
      SELECT branch.id, branch.name
      FROM branches AS branch
      WHERE branch.organization_id = membership.organization_id
        AND branch.company_id = active_company.id
        AND branch.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM user_role_assignments AS unrestricted_assignment
            JOIN roles AS unrestricted_role
              ON unrestricted_role.id = unrestricted_assignment.role_id
             AND unrestricted_role.organization_id = membership.organization_id
             AND unrestricted_role.slug IN ('organization_owner', 'system_administrator')
             AND unrestricted_role.status = 'active'
            WHERE unrestricted_assignment.organization_id = membership.organization_id
              AND unrestricted_assignment.user_id = app_user.id
              AND unrestricted_assignment.status = 'active'
              AND unrestricted_assignment.starts_at <= now()
              AND (unrestricted_assignment.expires_at IS NULL OR unrestricted_assignment.expires_at > now())
          )
          OR EXISTS (
            SELECT 1
            FROM membership_branch_access AS branch_access
            WHERE branch_access.organization_id = membership.organization_id
              AND branch_access.user_id = app_user.id
              AND branch_access.branch_id = branch.id
          )
        )
      ORDER BY
        CASE WHEN branch.id = preference.active_branch_id THEN 0 ELSE 1 END,
        branch.is_primary DESC,
        branch.created_at ASC,
        branch.id ASC
      LIMIT 1
    ) AS active_branch ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          array_agg(DISTINCT role.slug)
            FILTER (WHERE role.slug IS NOT NULL),
          ARRAY[]::text[]
        ) AS role_slugs,
        COALESCE(
          array_agg(DISTINCT role_permission.permission_key)
            FILTER (WHERE role_permission.permission_key IS NOT NULL),
          ARRAY[]::text[]
        ) AS permissions
      FROM user_role_assignments AS assignment
      JOIN roles AS role
        ON role.id = assignment.role_id
       AND role.organization_id = membership.organization_id
       AND role.status = 'active'
      LEFT JOIN role_permissions AS role_permission
        ON role_permission.role_id = role.id
      WHERE assignment.organization_id = membership.organization_id
        AND assignment.user_id = app_user.id
        AND assignment.status = 'active'
        AND assignment.starts_at <= now()
        AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
    ) AS access_context ON true
    WHERE session.token_hash = $1
      AND session.session_type = $2
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
      AND session.idle_expires_at > now()
      AND app_user.status = 'active'
    LIMIT 1
  `,
    [hash, sessionType],
  );

  const row = rows[0];
  if (!row) return null;

  const idleMinutes =
    sessionType === "mobile"
      ? Math.max(
          1_440,
          Number(process.env.MOBILE_SESSION_IDLE_DAYS || "7") * 1_440,
        )
      : Math.max(15, Number(process.env.SESSION_IDLE_MINUTES || "480"));
  await query(
    `
    UPDATE sessions
    SET
      last_seen_at = now(),
      idle_expires_at = CASE
        WHEN session_type = 'mobile'
          THEN LEAST(refresh_expires_at, now() + ($2 * interval '1 minute'))
        ELSE LEAST(expires_at, now() + ($2 * interval '1 minute'))
      END,
      active_organization_id = $3
    WHERE id = $1
      AND (
        last_seen_at < now() - interval '5 minutes'
        OR active_organization_id IS DISTINCT FROM $3
      )
  `,
    [row.session_id, idleMinutes, row.organization_id],
  );

  if (
    row.organization_id &&
    (row.stored_company_id !== row.active_company_id ||
      row.stored_branch_id !== row.active_branch_id)
  ) {
    await query(
      `
      INSERT INTO user_preferences (
        organization_id, user_id, active_company_id, active_branch_id
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        active_company_id = EXCLUDED.active_company_id,
        active_branch_id = EXCLUDED.active_branch_id,
        updated_at = now()
    `,
      [
        row.organization_id,
        row.user_id,
        row.active_company_id,
        row.active_branch_id,
      ],
    );
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    locale: row.locale,
    timezone: row.timezone,
    emailVerified: Boolean(row.email_verified_at),
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipRole: row.membership_role,
    roleSlugs: row.role_slugs || [],
    permissions: row.permissions || [],
    activeCompanyId: row.active_company_id,
    companyName: row.company_name,
    activeBranchId: row.active_branch_id,
    branchName: row.branch_name,
  };
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization") || "";
  const bearer = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,200})$/)?.[1];
  if (bearer) return resolveSessionContext(bearer, "mobile");
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  return token ? resolveSessionContext(token, "browser") : null;
}

export async function getMobileSessionContext(
  accessToken: string,
): Promise<SessionContext | null> {
  return accessToken
    ? resolveSessionContext(accessToken, "mobile")
    : Promise.resolve(null);
}

export async function requireUser() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  return session;
}

export async function requireVerifiedUser() {
  const session = await requireUser();
  if (!session.emailVerified)
    redirect("/verify-email?email=" + encodeURIComponent(session.email));
  return session;
}

export async function requireWorkspace(): Promise<WorkspaceSessionContext> {
  const session = await requireVerifiedUser();
  if (!session.organizationId) redirect("/onboarding");
  return session as WorkspaceSessionContext;
}

export function nextPath(session: SessionContext) {
  if (!session.emailVerified)
    return "/verify-email?email=" + encodeURIComponent(session.email);
  if (!session.organizationId) return "/onboarding";
  return "/dashboard";
}

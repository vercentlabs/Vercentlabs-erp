import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { query } from "@/lib/db";

const scrypt = promisify(scryptCallback);
const cookieName = process.env.SESSION_COOKIE_NAME || "vercent_session";

export type SessionContext = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
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

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionDurations() {
  const absoluteDays = Math.max(
    1,
    Number(process.env.SESSION_ABSOLUTE_DAYS || "30"),
  );
  const idleMinutes = Math.max(
    15,
    Number(process.env.SESSION_IDLE_MINUTES || "480"),
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

export async function createSession(userId: string, request: Request) {
  const token = createOpaqueToken();
  const { expiresAt, idleExpiresAt } = sessionDurations();
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  const sessionId = randomUUID();

  await query(
    `
    INSERT INTO sessions (
      id, user_id, token_hash, expires_at, idle_expires_at,
      ip_address, user_agent, device_name, last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
  `,
    [
      sessionId,
      userId,
      tokenHash(token),
      expiresAt,
      idleExpiresAt,
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent,
      deviceName(userAgent),
    ],
  );

  return { sessionId, token, expiresAt };
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

export async function getSessionContext(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (!token) return null;

  const hash = tokenHash(token);
  const rows = await query<{
    session_id: string;
    user_id: string;
    email: string;
    full_name: string;
    email_verified_at: Date | null;
    organization_id: string | null;
    organization_name: string | null;
    membership_role: "owner" | "admin" | "member" | null;
    role_slugs: string[] | null;
    permissions: string[] | null;
    active_company_id: string | null;
    company_name: string | null;
    active_branch_id: string | null;
    branch_name: string | null;
  }>(
    `
    SELECT
      s.id AS session_id,
      u.id AS user_id,
      u.email,
      u.full_name,
      u.email_verified_at,
      m.organization_id,
      o.name AS organization_name,
      m.role AS membership_role,
      COALESCE(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
      COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions,
      COALESCE(pref.active_company_id, pc.id) AS active_company_id,
      COALESCE(ac.name, pc.name) AS company_name,
      COALESCE(pref.active_branch_id, pb.id) AS active_branch_id,
      COALESCE(ab.name, pb.name) AS branch_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT om.organization_id, om.role, om.created_at
      FROM organization_memberships om
      WHERE om.user_id = u.id AND om.status = 'active'
      ORDER BY om.created_at ASC
      LIMIT 1
    ) m ON true
    LEFT JOIN organizations o ON o.id = m.organization_id AND o.status = 'active'
    LEFT JOIN user_preferences pref ON pref.organization_id = m.organization_id AND pref.user_id = u.id
    LEFT JOIN companies pc ON pc.organization_id = m.organization_id AND pc.is_primary = true AND pc.status = 'active'
    LEFT JOIN branches pb ON pb.organization_id = m.organization_id AND pb.is_primary = true AND pb.status = 'active'
    LEFT JOIN companies ac ON ac.id = pref.active_company_id AND ac.organization_id = m.organization_id AND ac.status = 'active'
    LEFT JOIN branches ab ON ab.id = pref.active_branch_id AND ab.organization_id = m.organization_id AND ab.status = 'active'
    LEFT JOIN user_role_assignments ura ON ura.organization_id = m.organization_id AND ura.user_id = u.id
    LEFT JOIN roles r ON r.id = ura.role_id AND r.status = 'active'
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.idle_expires_at > now()
      AND u.status = 'active'
    GROUP BY s.id, u.id, m.organization_id, o.name, m.role, pref.active_company_id,
      pc.id, pc.name, ac.name, pref.active_branch_id, pb.id, pb.name, ab.name
    LIMIT 1
  `,
    [hash],
  );

  const row = rows[0];
  if (!row) return null;

  const idleMinutes = Math.max(
    15,
    Number(process.env.SESSION_IDLE_MINUTES || "480"),
  );
  await query(
    `
    UPDATE sessions
    SET last_seen_at = now(), idle_expires_at = LEAST(expires_at, now() + ($2 * interval '1 minute'))
    WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'
  `,
    [row.session_id, idleMinutes],
  );

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
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

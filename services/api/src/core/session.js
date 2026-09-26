// Ported from the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/src/
// core/auth.ts. Split per PLATFORM_PORT_REGISTER.csv: this file keeps only
// the DB-facing, framework-agnostic session lifecycle (password hashing,
// opaque tokens, session CRUD, workspace/company/branch resolution). The
// Next.js-specific half (cookies/headers/redirect/cache()) is rebuilt
// separately in apps/web/src/core/session.ts, which calls these functions
// with a `client` it obtains from its own connection pool.
//
// Security properties preserved from the original (re-reviewed, not
// weakened): scrypt password hashing with a random 16-byte salt;
// constant-time hash comparison via timingSafeEqual; a dummy-hash
// comparison path for unknown users (verifyPasswordOrDummy) so that
// login-failure timing does not reveal whether an email is registered;
// idle + absolute session expiry; unrestricted-vs-scoped company/branch
// resolution driven by an EXISTS check against privileged roles.
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { setTenantContext, setUserContext } from "@vercentlabs/database";

const scrypt = promisify(scryptCallback);

const dummyPasswordHash =
  "scrypt$3f6d7a91c2e4b5d60718293a4b5c6d7e$e78bc2155bbb458a223654263afbeef216218ad55fc88b54324bbd96d96bbf618faa72c8b71fd17d2d50dc818e454ee849fa6bfb26d129a34cd7c9cb9f5cfd80";

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + derived.toString("hex");
}

export async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored || "").split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function verifyPasswordOrDummy(password, stored) {
  return verifyPassword(password, stored || dummyPasswordHash);
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function sessionDurations(env) {
  const absoluteDays = boundedInteger(env.SESSION_ABSOLUTE_DAYS, 30, 1, 365);
  const idleMinutes = boundedInteger(env.SESSION_IDLE_MINUTES, 480, 15, 43_200);
  const expiresAt = new Date(Date.now() + absoluteDays * 86_400_000);
  const idleExpiresAt = new Date(
    Math.min(expiresAt.getTime(), Date.now() + idleMinutes * 60_000),
  );
  return { expiresAt, idleExpiresAt, idleMinutes };
}

function deviceName(userAgent) {
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
  client,
  { userId, ipAddress, userAgent, organizationId = null, env = process.env },
) {
  const token = createOpaqueToken();
  const { expiresAt, idleExpiresAt } = sessionDurations(env);
  const trimmedUserAgent = userAgent ? userAgent.slice(0, 500) : null;
  const sessionId = randomUUID();

  await client.query(
    `INSERT INTO sessions (
      id, user_id, token_hash, expires_at, idle_expires_at,
      ip_address, user_agent, device_name, last_seen_at,
      active_organization_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
    [
      sessionId,
      userId,
      tokenHash(token),
      expiresAt,
      idleExpiresAt,
      ipAddress || null,
      trimmedUserAgent,
      deviceName(trimmedUserAgent),
      organizationId,
    ],
  );

  return { sessionId, token, expiresAt };
}

export async function setSessionOrganization(client, sessionId, userId, organizationId) {
  const rows = await client.query(
    `UPDATE sessions AS session
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
      RETURNING session.id`,
    [sessionId, userId, organizationId],
  );
  return Boolean(rows.rows[0]);
}

export async function revokeSessionByTokenHash(client, hash, reason = "logout") {
  await client.query(
    "UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
    [hash, reason],
  );
}

// Self-service session/device listing (SESSION-DEVICE-UI). Scoped to the
// caller's own userId only — this is a "manage your own devices" surface,
// not an admin tool, so there is no separate permission check: being the
// owner of the row IS the authorization.
export async function listSessionsForUser(client, userId) {
  const rows = await client.query(
    `SELECT id, device_name, ip_address, user_agent, session_type,
            created_at, last_seen_at, expires_at
       FROM sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name || "Unknown device",
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    sessionType: row.session_type,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }));
}

// Revoking by (userId, sessionId) rather than a bare sessionId is the
// entire access control here — a user can only ever revoke a row that is
// already theirs, so there's no cross-user revocation path to guard
// against separately.
export async function revokeSessionById(client, userId, sessionId, reason = "user_revoked") {
  const rows = await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $3
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [sessionId, userId, reason],
  );
  return Boolean(rows.rows[0]);
}

// "Sign out everywhere else" (SP006) — excludes currentSessionId so the
// caller's own live session survives; same ownership-is-authorization
// model as revokeSessionById, just scoped to "all but one" instead of one.
export async function revokeOtherSessions(client, userId, currentSessionId, reason = "user_revoked_others") {
  const rows = await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $3
      WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL
      RETURNING id`,
    [userId, currentSessionId, reason],
  );
  return rows.rows.length;
}

export class ContextSwitchError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ContextSwitchError";
    this.status = status;
    this.code = code;
  }
}

// The exact same "unrestricted role OR explicit membership grant" predicate
// resolveSessionContext's own company/branch lateral joins use — kept as
// one shared fragment so listing and switching can never drift from what
// session resolution itself considers accessible (Phase 4).
const UNRESTRICTED_ROLE_EXISTS = `
  EXISTS (
    SELECT 1
    FROM user_role_assignments AS unrestricted_assignment
    JOIN roles AS unrestricted_role
      ON unrestricted_role.id = unrestricted_assignment.role_id
     AND unrestricted_role.organization_id = $1
     AND unrestricted_role.slug IN ('organization_owner', 'system_administrator')
     AND unrestricted_role.status = 'active'
    WHERE unrestricted_assignment.organization_id = $1
      AND unrestricted_assignment.user_id = $2
      AND unrestricted_assignment.status = 'active'
      AND unrestricted_assignment.starts_at <= now()
      AND (unrestricted_assignment.expires_at IS NULL OR unrestricted_assignment.expires_at > now())
  )
`;

// Every company (and, for each, every branch) the user may legitimately
// switch to — the same access predicate session resolution uses, not a
// separate/looser one a context-switch route could accidentally trust
// instead.
export async function listAccessibleCompanies(client, organizationId, userId) {
  const companies = await client.query(
    `SELECT company.id, company.name
       FROM companies AS company
      WHERE company.organization_id = $1
        AND company.status = 'active'
        AND (
          ${UNRESTRICTED_ROLE_EXISTS}
          OR EXISTS (
            SELECT 1 FROM membership_company_access AS access
            WHERE access.organization_id = $1 AND access.user_id = $2 AND access.company_id = company.id
          )
        )
      ORDER BY company.is_primary DESC, company.created_at ASC, company.id ASC`,
    [organizationId, userId],
  );
  const branches = await client.query(
    `SELECT branch.id, branch.company_id, branch.name
       FROM branches AS branch
      WHERE branch.organization_id = $1
        AND branch.status = 'active'
        AND (
          ${UNRESTRICTED_ROLE_EXISTS}
          OR EXISTS (
            SELECT 1 FROM membership_branch_access AS access
            WHERE access.organization_id = $1 AND access.user_id = $2 AND access.branch_id = branch.id
          )
        )
      ORDER BY branch.is_primary DESC, branch.created_at ASC, branch.id ASC`,
    [organizationId, userId],
  );
  return companies.rows.map((company) => ({
    ...company,
    branches: branches.rows.filter((branch) => branch.company_id === company.id),
  }));
}

// Validates the requested company/branch against the SAME access predicate
// before persisting — never trusts an id from the browser. Never returns
// data from another company: on success, the caller must re-resolve the
// session (getSessionContext is request-scoped cache()'d, so a fresh
// request after this call sees the new context) and invalidate any
// client-side query cache keyed to the previous companyId.
export async function switchActiveCompany(client, session, companyId, branchId) {
  const accessible = await listAccessibleCompanies(client, session.organizationId, session.userId);
  const company = accessible.find((entry) => entry.id === companyId);
  if (!company) throw new ContextSwitchError(403, "You do not have access to this company.", "COMPANY_ACCESS_DENIED");

  let resolvedBranchId = null;
  if (branchId) {
    const branch = company.branches.find((entry) => entry.id === branchId);
    if (!branch) throw new ContextSwitchError(403, "You do not have access to this branch.", "BRANCH_ACCESS_DENIED");
    resolvedBranchId = branch.id;
  }

  await client.query(
    `INSERT INTO user_preferences (organization_id, user_id, active_company_id, active_branch_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET
       active_company_id = EXCLUDED.active_company_id,
       active_branch_id = EXCLUDED.active_branch_id,
       updated_at = now()`,
    [session.organizationId, session.userId, companyId, resolvedBranchId],
  );

  return { companyId, branchId: resolvedBranchId };
}

// The single query that resolves a session token into a full workspace
// context: user identity, active organization membership, role/permission
// composition, and (deliberately, per Part 10 of the original design) the
// user's active company/branch selection scoped to what they're actually
// allowed to see. Company/branch resolution intentionally never filters
// business-record queries itself — it only decides what a shell/nav layer
// may default to.
// Runs as ONE transaction on the caller's dedicated client, in three steps
// that line up with row-level security:
//   1. the session and its user (auth identity: no organisation needed);
//   2. app.current_user_id := that user, so RLS lets them read their OWN
//      memberships across organisations, and pick the active one;
//   3. app.current_organization_id := that organisation, then read the
//      workspace (companies, roles, preferences) under organisation RLS.
// Both settings are transaction-local and never taken from request input.
export async function resolveSessionContext(client, token, sessionType, env = process.env) {
  await client.query("BEGIN");
  try {
    const context = await resolveSessionContextInTransaction(client, token, sessionType, env);
    await client.query("COMMIT");
    return context;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function resolveSessionContextInTransaction(client, token, sessionType, env) {
  const hash = tokenHash(token);
  const identity = (
    await client.query(
      `SELECT session.user_id, session.active_organization_id
         FROM sessions AS session JOIN users AS app_user ON app_user.id = session.user_id
        WHERE session.token_hash = $1 AND session.session_type = $2 AND session.revoked_at IS NULL
          AND session.expires_at > now() AND session.idle_expires_at > now() AND app_user.status = 'active'
        LIMIT 1`,
      [hash, sessionType],
    )
  ).rows[0];
  if (!identity) return null;
  await setUserContext(client, identity.user_id);
  const chosen = (
    await client.query(
      `SELECT membership.organization_id
         FROM organization_memberships AS membership
         JOIN organizations AS organization ON organization.id = membership.organization_id AND organization.status = 'active'
        WHERE membership.user_id = $1 AND membership.status = 'active'
        ORDER BY CASE WHEN membership.organization_id = $2 THEN 0 ELSE 1 END, membership.created_at ASC, membership.organization_id ASC
        LIMIT 1`,
      [identity.user_id, identity.active_organization_id],
    )
  ).rows[0];
  if (chosen) await setTenantContext(client, chosen.organization_id);
  const result = await client.query(
    `SELECT
      session.id AS session_id,
      session.active_organization_id AS session_organization_id,
      app_user.id AS user_id,
      app_user.email,
      app_user.full_name,
      COALESCE(preference.locale, 'en-IN') AS locale,
      COALESCE(preference.timezone, membership.organization_timezone, 'UTC') AS timezone,
      app_user.email_verified_at,
      app_user.mfa_enrolled_at IS NOT NULL AS mfa_enrolled,
      app_user.mfa_required AS mfa_required_self,
      session.mfa_verified_at IS NOT NULL AS mfa_verified,
      membership.organization_id,
      membership.organization_name,
      membership.mfa_enforced AS organization_mfa_enforced,
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
        organization.mfa_enforced,
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
          array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL),
          ARRAY[]::text[]
        ) AS role_slugs,
        COALESCE(
          array_agg(DISTINCT role_permission.permission_key) FILTER (WHERE role_permission.permission_key IS NOT NULL),
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
    LIMIT 1`,
    [hash, sessionType],
  );

  const row = result.rows[0];
  if (!row) return null;

  const idleMinutes =
    sessionType === "mobile"
      ? Math.max(1_440, Number(env.MOBILE_SESSION_IDLE_DAYS || "7") * 1_440)
      : Math.max(15, Number(env.SESSION_IDLE_MINUTES || "480"));
  await client.query(
    `UPDATE sessions
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
        )`,
    [row.session_id, idleMinutes, row.organization_id],
  );

  if (
    row.organization_id &&
    (row.stored_company_id !== row.active_company_id ||
      row.stored_branch_id !== row.active_branch_id)
  ) {
    await client.query(
      `INSERT INTO user_preferences (
        organization_id, user_id, active_company_id, active_branch_id
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        active_company_id = EXCLUDED.active_company_id,
        active_branch_id = EXCLUDED.active_branch_id,
        updated_at = now()`,
      [row.organization_id, row.user_id, row.active_company_id, row.active_branch_id],
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
    // Has a working TOTP factor enrolled right now.
    mfaEnrolled: Boolean(row.mfa_enrolled),
    // Forced by policy (an admin targeting this one user, or this session's
    // active organization's own mfa_enforced toggle — SP007's
    // "Organization-enforced MFA") independent of whether they've actually
    // enrolled yet — this is what routes an unenrolled-but-required user to
    // enrollment instead of workspace access.
    mfaPolicyRequired: Boolean(row.mfa_required_self) || Boolean(row.organization_mfa_enforced),
    // Verified for THIS specific session already (the step-up gate itself
    // should check mfaEnrolled || mfaPolicyRequired, not this alone — a
    // voluntarily-enrolled user with no policy forcing it must still be
    // asked for a code every login, or self-service MFA would be theater).
    mfaVerified: Boolean(row.mfa_verified),
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

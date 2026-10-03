// Identity-lifecycle flows (SP004/SP005): email verification, password
// reset, and organization invitations. The schema for all three
// (email_verification_tokens, password_reset_tokens,
// organization_invitations) is in database/migrations/0001_baseline.sql and delivery goes
// through the mailer (auth-mailer.js, deliverAuthMessage). This module is
// the domain layer between them: it generates, stores, validates and
// consumes the tokens.
import { randomUUID } from "node:crypto";

import { setTenantContext, setUserContext } from "@vercentlabs/database";

import { audit } from "../security/request-security.js";
import { createOpaqueToken, createSession, hashPassword, setSessionOrganization, tokenHash } from "./session.js";
import { deliverAuthMessage } from "./mailer.js";
import {
  assertInvitationWithinAdministrationScope,
  hasUnrestrictedAccessAdministration,
  invitationWithinAdministrationScopeSql,
  validateInvitationRolesForAcceptance,
  validateRoleSelection,
} from "../access/index.js";
import { ACCESS_EVIDENCE_EVENTS, recordAccessAssignmentEvent } from "../access/index.js";
import { assertSeatAvailable, withSeatLock } from "../billing/index.js";

export class AuthLifecycleError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AuthLifecycleError";
    this.status = status;
    this.code = code;
  }
}

function tokenUrl(env, path, token) {
  const base = (env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

// Invitations are the one token flow whose frontend route takes the token
// as a path segment (apps/web/src/app/(auth)/invitations/[token]/page.tsx)
// rather than a query string like verify-email/reset-password
// (both real Next.js searchParams pages) — tokenUrl()'s ?token= format
// silently produced a dead /invitations?token=... link here until this was
// caught, since the app's own accept-invitation E2E test navigated to
// /invitations/${token} directly instead of following the mailer's actual
// generated URL. Named separately, not folded into tokenUrl(), so the two
// query-string flows can never regress the same way.
function pathTokenUrl(env, path, token) {
  const base = (env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
  return `${base}${path}/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------

const VERIFICATION_TOKEN_TTL_HOURS = 24;

export async function createEmailVerificationToken(client, userId, env = process.env) {
  const user = (await client.query(`SELECT id, email, email_verified_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) throw new AuthLifecycleError(404, "User not found.", "AUTH_USER_NOT_FOUND");
  if (user.email_verified_at) return { alreadyVerified: true };

  const token = createOpaqueToken();
  await client.query(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '${VERIFICATION_TOKEN_TTL_HOURS} hours')`,
    [randomUUID(), userId, tokenHash(token)],
  );
  const delivered = await deliverAuthMessage(
    { type: "verify-email", email: user.email, url: tokenUrl(env, "/verify-email", token) },
    env,
  );
  return { alreadyVerified: false, delivered };
}

export async function consumeEmailVerificationToken(client, token) {
  const hash = tokenHash(token);
  // A single atomic UPDATE...WHERE used_at IS NULL...RETURNING is the
  // claim itself — Postgres row-locking during the UPDATE guarantees only
  // one of two concurrent requests presenting the same still-valid token
  // can ever see a returned row, unlike the previous SELECT-then-UPDATE
  // (two concurrent SELECTs could both observe used_at IS NULL before
  // either UPDATE committed). The lookup below only fires to build an
  // accurate error message once the claim has already failed closed.
  const claimed = (
    await client.query(
      `UPDATE email_verification_tokens
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING id, user_id`,
      [hash],
    )
  ).rows[0];
  if (!claimed) {
    const existing = (
      await client.query(`SELECT used_at, expires_at FROM email_verification_tokens WHERE token_hash = $1`, [hash])
    ).rows[0];
    if (!existing) throw new AuthLifecycleError(400, "This verification link is invalid.", "AUTH_TOKEN_INVALID");
    if (existing.used_at) throw new AuthLifecycleError(400, "This verification link has already been used.", "AUTH_TOKEN_USED");
    throw new AuthLifecycleError(400, "This verification link has expired. Request a new one.", "AUTH_TOKEN_EXPIRED");
  }
  await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [claimed.user_id]);
  return { userId: claimed.user_id };
}

// ---------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------

const RESET_TOKEN_TTL_HOURS = 2;

// Always returns the same shape regardless of whether the email is
// registered — the caller must not branch on this to avoid account
// enumeration (mirrors verifyPasswordOrDummy's login-timing protection).
export async function requestPasswordReset(client, email, env = process.env) {
  const user = (await client.query(`SELECT id, email FROM users WHERE lower(email) = lower($1) AND status = 'active'`, [email])).rows[0];
  if (!user) return { requested: true };

  const token = createOpaqueToken();
  await client.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '${RESET_TOKEN_TTL_HOURS} hours')`,
    [randomUUID(), user.id, tokenHash(token)],
  );
  await deliverAuthMessage({ type: "reset-password", email: user.email, url: tokenUrl(env, "/reset-password", token) }, env);
  return { requested: true };
}

export async function resetPasswordWithToken(client, token, newPassword) {
  const hash = tokenHash(token);
  // Atomic claim — see consumeEmailVerificationToken's comment for why
  // this must be one UPDATE...WHERE used_at IS NULL...RETURNING rather
  // than a SELECT followed by a separate UPDATE.
  const claimed = (
    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING id, user_id`,
      [hash],
    )
  ).rows[0];
  if (!claimed) {
    const existing = (
      await client.query(`SELECT used_at, expires_at FROM password_reset_tokens WHERE token_hash = $1`, [hash])
    ).rows[0];
    if (!existing) throw new AuthLifecycleError(400, "This reset link is invalid.", "AUTH_TOKEN_INVALID");
    if (existing.used_at) throw new AuthLifecycleError(400, "This reset link has already been used.", "AUTH_TOKEN_USED");
    throw new AuthLifecycleError(400, "This reset link has expired. Request a new one.", "AUTH_TOKEN_EXPIRED");
  }
  const row = claimed;

  const passwordHash = await hashPassword(newPassword);
  await client.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $1`,
    [row.user_id, passwordHash],
  );
  // A password reset proves control of the mailbox a reset link was sent
  // to — the same proof email verification requires — so this also
  // verifies the email, consistent with acceptOrganizationInvitation
  // below. Every existing session for this user must not survive a
  // password change (SP005/SP006 credential-change session invalidation);
  // the DB trigger from migration 007 only fires on access/role changes,
  // not password_hash, so this is done explicitly here.
  await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id],
  );
  return { userId: row.user_id };
}

// ---------------------------------------------------------------------
// Organization invitations
//
// Canonical storage: organization_invitation_roles (multiple roles, exactly
// one primary). Access is role + permission based across the whole
// organization, so an invitation carries roles only. A user belongs to at
// most one organization: acceptance refuses anyone who already has one.
// ---------------------------------------------------------------------

const INVITATION_TOKEN_TTL_DAYS = 7;

function requireInvitationActor(actor, label) {
  if (!actor?.userId || !Array.isArray(actor.roleSlugs)) {
    throw new AuthLifecycleError(500, `${label} requires the administrator's identity and roles.`, "AUTH_INVITER_CONTEXT_MISSING");
  }
}

function uniqueIds(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

// Replace an invitation's normalized roles.
async function writeInvitationRoles(client, { organizationId, invitationId, roleIds, primaryRoleId }) {
  await client.query(`DELETE FROM organization_invitation_roles WHERE organization_id = $1 AND invitation_id = $2`, [organizationId, invitationId]);
  await client.query(
    `INSERT INTO organization_invitation_roles (invitation_id, organization_id, role_id, is_primary)
     SELECT $2, $1, role_id, role_id = $4 FROM unnest($3::uuid[]) AS role_id`,
    [organizationId, invitationId, roleIds, primaryRoleId],
  );
}

// Issue (or re-issue, for a still-pending email) an invitation.
// roleIds[] + primaryRoleId is the contract; a single legacy roleId is
// accepted and treated as [roleId] with itself as primary.
export async function createOrganizationInvitation(
  client,
  { organizationId, invitedByUserId, email, roleId, roleIds, primaryRoleId, inviter, acknowledgeWarningConflicts },
  env = process.env,
) {
  // `inviter` is required, never optional — the grant ceiling, SoD and
  // delegated-administration checks below must not be silently skippable.
  if (!inviter) throw new AuthLifecycleError(500, "Invitation issuance requires the inviter's role context.", "AUTH_INVITER_CONTEXT_MISSING");
  const actor = { userId: invitedByUserId, roleSlugs: inviter.roleSlugs || [], permissions: inviter.permissions || [] };
  const selectedRoleIds = uniqueIds(roleIds?.length ? roleIds : roleId ? [roleId] : []);
  const selectedPrimaryRoleId = primaryRoleId || roleId || selectedRoleIds[0];
  if (!selectedRoleIds.length) throw new AuthLifecycleError(422, "Select at least one role.", "AUTH_ROLE_NOT_FOUND");

  // Grant ceiling, assignability, SoD and the owner-role prohibition — the
  // same validation role assignment uses.
  await validateRoleSelection(client, {
    organizationId,
    roleIds: selectedRoleIds,
    primaryRoleId: selectedPrimaryRoleId,
    actor,
    acknowledgeWarningConflicts,
    allowOwnerRole: false,
  });

  const organization = (await client.query(`SELECT id, name FROM organizations WHERE id = $1`, [organizationId])).rows[0];
  if (!organization) throw new AuthLifecycleError(404, "Organization not found.", "AUTH_ORG_NOT_FOUND");

  const existingMember = (
    await client.query(
      `SELECT 1 FROM organization_memberships om JOIN users u ON u.id = om.user_id
        WHERE om.organization_id = $1 AND lower(u.email) = lower($2) AND om.status = 'active'`,
      [organizationId, email],
    )
  ).rows[0];
  if (existingMember) throw new AuthLifecycleError(409, "This person is already a member of the organization.", "AUTH_ALREADY_MEMBER");

  const pending = (
    await client.query(
      `SELECT id, organization_id FROM organization_invitations
        WHERE organization_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [organizationId, email],
    )
  ).rows[0];
  if (pending) {
    // Re-issuing overwrites the pending invitation: a delegated admin may
    // only do that to an invitation they may administer.
    await assertInvitationWithinAdministrationScope(client, { organizationId, actorRoleSlugs: actor.roleSlugs, invitationId: pending.id });
  }

  const token = createOpaqueToken();
  const hash = tokenHash(token);
  let invitationId;
  await withSeatLock(client, organizationId, async () => {
    await assertSeatAvailable(client, organizationId, { additional: pending ? 0 : 1, excludeInvitationId: pending?.id ?? null, env });
    if (pending) {
      invitationId = pending.id;
      await client.query(
        `UPDATE organization_invitations
            SET token_hash = $2, invited_by = $3,
                expires_at = now() + interval '${INVITATION_TOKEN_TTL_DAYS} days',
                last_sent_at = now(), send_count = send_count + 1
          WHERE id = $1`,
        [invitationId, hash, invitedByUserId],
      );
    } else {
      invitationId = randomUUID();
      await client.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, 'member', $4, $5, now() + interval '${INVITATION_TOKEN_TTL_DAYS} days')`,
        [invitationId, organizationId, email, hash, invitedByUserId],
      );
    }
    await writeInvitationRoles(client, {
      organizationId,
      invitationId,
      roleIds: selectedRoleIds,
      primaryRoleId: selectedPrimaryRoleId,
    });
  });

  const delivered = await deliverAuthMessage(
    { type: "organization-invitation", email, url: pathTokenUrl(env, "/invitations", token), organizationName: organization.name },
    env,
  );
  return { invitationId, delivered };
}

// Invitation links are opened before any organisation context exists: the
// organisation is resolved from the token hash alone (public.
// resolve_invitation_organization, migration 068), then everything else
// runs under that organisation's row-level security.
async function enterInvitationOrganization(client, hash) {
  const organizationId = (await client.query("SELECT public.resolve_invitation_organization($1) AS organization_id", [hash])).rows[0]?.organization_id;
  if (!organizationId) throw new AuthLifecycleError(404, "This invitation link is invalid.", "AUTH_INVITATION_NOT_FOUND");
  await setTenantContext(client, organizationId);
  return organizationId;
}

// Runs its own short transaction on the caller's dedicated client (the
// organisation context is transaction-local).
export async function getInvitationByToken(client, token) {
  await client.query("BEGIN");
  try {
    const invitation = await readInvitationByToken(client, token);
    await client.query("COMMIT");
    return invitation;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function readInvitationByToken(client, token) {
  const hash = tokenHash(token);
  await enterInvitationOrganization(client, hash);
  const row = (
    await client.query(
      `SELECT invitation.id, invitation.organization_id, invitation.email, invitation.expires_at,
              invitation.accepted_at, invitation.revoked_at, organization.name AS organization_name,
              primary_role.name AS role_name,
              (existing_user.password_hash IS NOT NULL) AS has_existing_account
         FROM organization_invitations AS invitation
         JOIN organizations AS organization ON organization.id = invitation.organization_id
         LEFT JOIN LATERAL (
           SELECT role.name FROM organization_invitation_roles invitation_role
             JOIN roles role ON role.id = invitation_role.role_id
            WHERE invitation_role.invitation_id = invitation.id AND invitation_role.is_primary
         ) AS primary_role ON true
         LEFT JOIN users AS existing_user ON lower(existing_user.email) = lower(invitation.email)
        WHERE invitation.token_hash = $1`,
      [hash],
    )
  ).rows[0];
  if (!row) throw new AuthLifecycleError(404, "This invitation link is invalid.", "AUTH_INVITATION_NOT_FOUND");
  if (row.revoked_at) throw new AuthLifecycleError(410, "This invitation has been revoked.", "AUTH_INVITATION_REVOKED");
  if (row.accepted_at) throw new AuthLifecycleError(409, "This invitation has already been accepted.", "AUTH_INVITATION_ACCEPTED");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AuthLifecycleError(410, "This invitation has expired. Ask the organization owner to resend it.", "AUTH_INVITATION_EXPIRED");
  }
  return row;
}

// Accepting an invitation both provisions access (organization_memberships
// + user_role_assignments) and creates the user
// record if this is their first invitation anywhere. Everything runs in the
// caller's single transaction (see the accept route), so a partial grant can
// never persist.
//
// Clicking the link proves mailbox control, which is enough ONLY for a
// brand-new account. For an EXISTING account the caller must already be
// authenticated as that exact account (`authenticatedUserId`, resolved
// server-side from their own session, never client-supplied); an existing
// user's password is never written here under any input.
export async function acceptOrganizationInvitation(client, token, { fullName, password }, authenticatedUserId = null) {
  const hash = tokenHash(token);
  await enterInvitationOrganization(client, hash);
  const invitation = (
    await client.query(
      `SELECT id, organization_id, email, invited_by, expires_at, accepted_at, revoked_at
         FROM organization_invitations WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    )
  ).rows[0];
  if (!invitation) throw new AuthLifecycleError(404, "This invitation link is invalid.", "AUTH_INVITATION_NOT_FOUND");
  if (invitation.revoked_at) throw new AuthLifecycleError(410, "This invitation has been revoked.", "AUTH_INVITATION_REVOKED");
  if (invitation.accepted_at) throw new AuthLifecycleError(409, "This invitation has already been accepted.", "AUTH_INVITATION_ACCEPTED");
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    throw new AuthLifecycleError(410, "This invitation has expired. Ask the organization owner to resend it.", "AUTH_INVITATION_EXPIRED");
  }

  // Re-validate the roles NOW (still active, assignable, module enabled,
  // exactly one primary, no blocking SoD) — they were validated at issue
  // time, but roles and modules can change while an invitation is pending.
  const invitationRoles = await validateInvitationRolesForAcceptance(client, { organizationId: invitation.organization_id, invitationId: invitation.id });

  const user = (await client.query(`SELECT id, password_hash FROM users WHERE lower(email) = lower($1)`, [invitation.email])).rows[0];
  let userId;
  let mintNewSession;
  if (user) {
    userId = user.id;
    if (authenticatedUserId !== userId) {
      throw new AuthLifecycleError(
        401,
        "Sign in to this existing account first, then open the invitation link again to accept it.",
        "AUTH_INVITATION_REQUIRES_SIGN_IN",
      );
    }
    mintNewSession = false;
  } else {
    if (!password) throw new AuthLifecycleError(422, "A password is required to create this account.", "AUTH_PASSWORD_REQUIRED");
    if (!fullName?.trim()) throw new AuthLifecycleError(422, "A name is required to create this account.", "AUTH_NAME_REQUIRED");
    userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO users (id, email, full_name, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, invitation.email, fullName.trim(), passwordHash],
    );
    mintNewSession = true;
  }

  // One organization per user: an existing account that already belongs to
  // any organization (this one included) cannot join another. The identity
  // context lets row-level security show the user's own memberships across
  // organizations.
  if (user) {
    await setUserContext(client, userId);
    const otherMembership = (
      await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`, [userId])
    ).rows[0];
    if (otherMembership) {
      throw new AuthLifecycleError(
        409,
        otherMembership.organization_id === invitation.organization_id
          ? "You are already a member of this organization."
          : "This account already belongs to an organization. An account can belong to only one organization.",
        "AUTH_ALREADY_IN_ORGANIZATION",
      );
    }
  }

  await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [userId]);

  const alreadyActive = (await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [invitation.organization_id, userId])).rows[0];
  await withSeatLock(client, invitation.organization_id, async () => {
    // The invitation itself already holds a seat, so it is excluded from the count.
    await assertSeatAvailable(client, invitation.organization_id, { additional: alreadyActive ? 0 : 1, excludeInvitationId: invitation.id, env: process.env });
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active'`,
      [invitation.organization_id, userId],
    );
  });

  // Every invitation role, exactly one primary. Demote any existing primary
  // first: the one-primary unique index is immediate, not deferrable.
  await client.query(
    `UPDATE user_role_assignments SET is_primary = false, updated_at = now()
      WHERE organization_id = $1 AND user_id = $2 AND status = 'active' AND is_primary = true`,
    [invitation.organization_id, userId],
  );
  for (const role of invitationRoles) {
    await client.query(
      `INSERT INTO user_role_assignments (organization_id, user_id, role_id, assigned_by, is_primary, status, starts_at)
       VALUES ($1, $2, $3, $4, $5, 'active', now())
       ON CONFLICT (organization_id, user_id, role_id) DO UPDATE
         SET status = 'active', revoked_at = NULL, revoked_by = NULL, is_primary = EXCLUDED.is_primary, updated_at = now()`,
      [invitation.organization_id, userId, role.role_id, invitation.invited_by, role.is_primary],
    );
  }
  await client.query(`UPDATE organization_invitations SET accepted_at = now() WHERE id = $1`, [invitation.id]);

  await recordAccessAssignmentEvent(client, {
    organizationId: invitation.organization_id,
    userId,
    actorUserId: invitation.invited_by,
    eventType: ACCESS_EVIDENCE_EVENTS.INVITATION_ACCEPTED,
    beforeState: null,
    afterState: {
      invitationId: invitation.id,
      roleIds: invitationRoles.map((role) => role.role_id).sort(),
      primaryRoleId: invitationRoles.find((role) => role.is_primary)?.role_id ?? null,
    },
  });

  return { userId, organizationId: invitation.organization_id, mintNewSession };
}

// The signed-in user's own pending invitations across organisations (the
// caller passes the email from the authenticated session). Answered by
// public.pending_invitations_for_email (migration 068): id, organisation
// name and expiry only.
export async function listPendingInvitationsForEmail(client, email) {
  const rows = await client.query("SELECT id, organization_name, expires_at FROM public.pending_invitations_for_email($1)", [email]);
  return rows.rows;
}

// Admin view (Settings > Invitations). Unrestricted administrators see every
// invitation; delegated administrators only invitations they may administer
// — filtered in PostgreSQL with the same predicate the resend/revoke
// assertions use.
export async function listOrganizationInvitations(client, organizationId, actor) {
  requireInvitationActor(actor, "Listing invitations");
  const scope = invitationWithinAdministrationScopeSql({ organizationId: "$1", invitationId: "invitation.id" });
  const rows = await client.query(
    `SELECT
        invitation.id, invitation.email,
        COALESCE(role_agg.roles, '[]'::jsonb) AS roles,
        role_agg.primary_role_id, role_agg.primary_role_name,
        invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
        invitation.last_sent_at, invitation.send_count, invitation.created_at,
        inviter.full_name AS invited_by_name
      FROM organization_invitations AS invitation
      JOIN users AS inviter ON inviter.id = invitation.invited_by
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', role.id, 'name', role.name, 'isPrimary', invitation_role.is_primary)
                         ORDER BY invitation_role.is_primary DESC, role.name) AS roles,
               (array_agg(role.id ORDER BY invitation_role.is_primary DESC))[1] AS primary_role_id,
               (array_agg(role.name ORDER BY invitation_role.is_primary DESC))[1] AS primary_role_name
          FROM organization_invitation_roles invitation_role
          JOIN roles role ON role.id = invitation_role.role_id
         WHERE invitation_role.invitation_id = invitation.id
      ) AS role_agg ON true
      WHERE invitation.organization_id = $1
        AND ($2::boolean OR ${scope})
      ORDER BY invitation.created_at DESC`,
    [organizationId, hasUnrestrictedAccessAdministration(actor.roleSlugs)],
  );
  return rows.rows.map((row) => ({
    ...row,
    status: row.revoked_at ? "revoked" : row.accepted_at ? "accepted" : new Date(row.expires_at) < new Date() ? "expired" : "pending",
  }));
}

export async function revokeOrganizationInvitation(client, { organizationId, invitationId, actor }) {
  requireInvitationActor(actor, "Revoking an invitation");
  await assertInvitationWithinAdministrationScope(client, { organizationId, actorRoleSlugs: actor.roleSlugs, invitationId });
  const revoked = await client.query(
    `UPDATE organization_invitations
        SET revoked_at = now()
      WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id`,
    [invitationId, organizationId],
  );
  if (!revoked.rows[0]) {
    throw new AuthLifecycleError(409, "This invitation cannot be revoked (already accepted, already revoked, or not found).", "AUTH_INVITATION_NOT_REVOCABLE");
  }
  return { revoked: true };
}

// Re-sends the SAME invitation (same roles) with a fresh token and
// expiry, so the admin does not have to re-fill the whole form.
export async function resendOrganizationInvitation(client, { organizationId, invitationId, actor }, env = process.env) {
  requireInvitationActor(actor, "Resending an invitation");
  await assertInvitationWithinAdministrationScope(client, { organizationId, actorRoleSlugs: actor.roleSlugs, invitationId });
  const invitation = (
    await client.query(
      `SELECT organization_invitations.*, organization.name AS organization_name
         FROM organization_invitations
         JOIN organizations AS organization ON organization.id = organization_invitations.organization_id
        WHERE organization_invitations.id = $1 AND organization_invitations.organization_id = $2
          AND accepted_at IS NULL AND revoked_at IS NULL`,
      [invitationId, organizationId],
    )
  ).rows[0];
  if (!invitation) throw new AuthLifecycleError(404, "This invitation cannot be resent (already accepted, revoked, or not found).", "AUTH_INVITATION_NOT_RESENDABLE");

  const token = createOpaqueToken();
  await client.query(
    `UPDATE organization_invitations
        SET token_hash = $2, expires_at = now() + interval '${INVITATION_TOKEN_TTL_DAYS} days',
            last_sent_at = now(), send_count = send_count + 1
      WHERE id = $1`,
    [invitationId, tokenHash(token)],
  );
  const delivered = await deliverAuthMessage(
    { type: "organization-invitation", email: invitation.email, url: pathTokenUrl(env, "/invitations", token), organizationName: invitation.organization_name },
    env,
  );
  return { delivered };
}

// ------------------------------------------------------------ password sign-in

/** The account for a sign-in attempt (auth identity; exact email match). */
export async function findUserForSignIn(client, email) {
  const { rows } = await client.query(`SELECT id, email, password_hash, status FROM users WHERE lower(email) = lower($1) LIMIT 1`, [String(email || "")]);
  return rows[0] ?? null;
}

/**
 * Creates the session for a user whose credentials were JUST verified. Runs in
 * the caller's identity transaction (app.current_user_id = userId): the
 * default organisation is the user's own earliest active membership, which
 * then becomes the transaction's organisation context for the audit event.
 * Session resolution re-picks and corrects the organisation on first use.
 */
export async function startUserSession(client, { userId, ipAddress, userAgent, request, env = process.env }) {
  const created = await createSession(client, { userId, ipAddress, userAgent, env });
  const membership = (
    await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`, [userId])
  ).rows[0];
  const organizationId = membership?.organization_id ?? null;
  if (organizationId) {
    await setTenantContext(client, organizationId);
    await setSessionOrganization(client, created.sessionId, userId, organizationId);
  }
  await audit(client, { organizationId, actorUserId: userId, eventType: "auth.session.created", entityType: "session", entityId: created.sessionId, request, env });
  return created;
}

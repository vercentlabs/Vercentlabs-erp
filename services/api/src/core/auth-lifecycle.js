// Identity-lifecycle flows (SP004/SP005): email verification, password
// reset, and organization invitations. The schema for all three
// (email_verification_tokens, password_reset_tokens,
// organization_invitations) already existed in
// database/platform/migrations/001_auth_and_onboarding.sql, and the
// mailer (auth-mailer.js, deliverAuthMessage) was already built and
// explicitly documented as "needed directly by Phase 4's verify-email /
// reset-password / invitation flows" — but nothing ever called either.
// This module is the missing domain layer connecting them: the tables and
// the mailer are real and untouched here, only the logic that generates,
// stores, validates and consumes tokens is new.
import { randomUUID } from "node:crypto";

import { hashPassword, createOpaqueToken, tokenHash } from "./session.js";
import { deliverAuthMessage } from "./auth-mailer.js";

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
  const row = (
    await client.query(
      `SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = $1`,
      [hash],
    )
  ).rows[0];
  if (!row) throw new AuthLifecycleError(400, "This verification link is invalid.", "AUTH_TOKEN_INVALID");
  if (row.used_at) throw new AuthLifecycleError(400, "This verification link has already been used.", "AUTH_TOKEN_USED");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AuthLifecycleError(400, "This verification link has expired. Request a new one.", "AUTH_TOKEN_EXPIRED");
  }
  await client.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [row.id]);
  await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [row.user_id]);
  return { userId: row.user_id };
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
  const row = (
    await client.query(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
      [hash],
    )
  ).rows[0];
  if (!row) throw new AuthLifecycleError(400, "This reset link is invalid.", "AUTH_TOKEN_INVALID");
  if (row.used_at) throw new AuthLifecycleError(400, "This reset link has already been used.", "AUTH_TOKEN_USED");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AuthLifecycleError(400, "This reset link has expired. Request a new one.", "AUTH_TOKEN_EXPIRED");
  }

  const passwordHash = await hashPassword(newPassword);
  await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [row.id]);
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
// ---------------------------------------------------------------------

const INVITATION_TOKEN_TTL_DAYS = 7;

export async function createOrganizationInvitation(client, { organizationId, invitedByUserId, email, roleId }, env = process.env) {
  const role = (
    await client.query(`SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2 AND status = 'active'`, [roleId, organizationId])
  ).rows[0];
  if (!role) throw new AuthLifecycleError(422, "That role does not exist in this organization.", "AUTH_ROLE_NOT_FOUND");

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
      `SELECT id FROM organization_invitations
        WHERE organization_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [organizationId, email],
    )
  ).rows[0];

  const token = createOpaqueToken();
  const hash = tokenHash(token);
  let invitationId;
  if (pending) {
    invitationId = pending.id;
    await client.query(
      `UPDATE organization_invitations
          SET token_hash = $2, role_id = $3, invited_by = $4,
              expires_at = now() + interval '${INVITATION_TOKEN_TTL_DAYS} days',
              last_sent_at = now(), send_count = send_count + 1
        WHERE id = $1`,
      [invitationId, hash, roleId, invitedByUserId],
    );
  } else {
    invitationId = randomUUID();
    await client.query(
      `INSERT INTO organization_invitations (id, organization_id, email, role, role_id, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, 'member', $4, $5, $6, now() + interval '${INVITATION_TOKEN_TTL_DAYS} days')`,
      [invitationId, organizationId, email, roleId, hash, invitedByUserId],
    );
  }

  await deliverAuthMessage(
    { type: "organization-invitation", email, url: tokenUrl(env, "/invitations", token), organizationName: organization.name },
    env,
  );
  return { invitationId };
}

export async function getInvitationByToken(client, token) {
  const hash = tokenHash(token);
  const row = (
    await client.query(
      `SELECT invitation.id, invitation.organization_id, invitation.email, invitation.expires_at,
              invitation.accepted_at, invitation.revoked_at, organization.name AS organization_name,
              role.name AS role_name,
              (existing_user.password_hash IS NOT NULL) AS has_existing_account
         FROM organization_invitations AS invitation
         JOIN organizations AS organization ON organization.id = invitation.organization_id
         LEFT JOIN roles AS role ON role.id = invitation.role_id
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
// + user_role_assignments — the two tables resolveSessionContext's
// role_slugs/permissions lateral join actually reads, see session.js) and
// creates the user record if this is their first invitation anywhere.
// Proving control of the invited mailbox by clicking the link is the same
// proof email verification requires, so acceptance verifies the email
// too — same reasoning as resetPasswordWithToken above.
export async function acceptOrganizationInvitation(client, token, { fullName, password }) {
  const hash = tokenHash(token);
  const invitation = (
    await client.query(
      `SELECT id, organization_id, email, role_id, expires_at, accepted_at, revoked_at
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

  let user = (await client.query(`SELECT id, password_hash FROM users WHERE lower(email) = lower($1)`, [invitation.email])).rows[0];
  let userId;
  if (user) {
    userId = user.id;
    // An existing account (already invited to a different organization
    // earlier) authenticates with their existing password — a bare
    // invitation link must not silently reset a real password, and a
    // brand-new account needs one supplied.
    if (!password && !user.password_hash) {
      throw new AuthLifecycleError(422, "A password is required to activate this account.", "AUTH_PASSWORD_REQUIRED");
    }
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
  }

  if (user && password) {
    const passwordHash = await hashPassword(password);
    await client.query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [userId, passwordHash]);
  }
  await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [userId]);

  await client.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, status)
     VALUES ($1, $2, 'member', 'active')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active'`,
    [invitation.organization_id, userId],
  );
  if (invitation.role_id) {
    // No separate id column — the primary key is the composite
    // (organization_id, user_id, role_id) itself (migration 002).
    await client.query(
      `INSERT INTO user_role_assignments (organization_id, user_id, role_id, status, starts_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT (organization_id, user_id, role_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
      [invitation.organization_id, userId, invitation.role_id],
    );
  }
  await client.query(`UPDATE organization_invitations SET accepted_at = now() WHERE id = $1`, [invitation.id]);

  return { userId, organizationId: invitation.organization_id };
}

export async function listPendingInvitationsForEmail(client, email) {
  const rows = await client.query(
    `SELECT invitation.id, organization.name AS organization_name, invitation.expires_at
       FROM organization_invitations AS invitation
       JOIN organizations AS organization ON organization.id = invitation.organization_id
      WHERE lower(invitation.email) = lower($1)
        AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > now()
      ORDER BY invitation.created_at DESC`,
    [email],
  );
  return rows.rows;
}

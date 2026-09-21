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
import { validateRoleSelection } from "./access-administration.js";
import { assertSeatAvailable, withSeatLock } from "./subscription-billing.js";

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
// ---------------------------------------------------------------------

const INVITATION_TOKEN_TTL_DAYS = 7;

export async function createOrganizationInvitation(
  client,
  { organizationId, invitedByUserId, email, roleId, companyIds = [], branchIds = [], inviter },
  env = process.env,
) {
  const role = (
    await client.query(`SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2 AND status = 'active'`, [roleId, organizationId])
  ).rows[0];
  if (!role) throw new AuthLifecycleError(422, "That role does not exist in this organization.", "AUTH_ROLE_NOT_FOUND");

  // SP001/SP004 real gap this closes: without this, an invitee with a
  // scoped (non-unrestricted) role joined the organization and saw zero
  // companies/branches — invited into a workplace they could not actually
  // access. Validated against this organization (never trusted blind) so
  // an invitation can never grant access to another tenant's company/branch.
  const uniqueCompanyIds = [...new Set(companyIds)];
  const uniqueBranchIds = [...new Set(branchIds)];
  if (uniqueCompanyIds.length) {
    const found = await client.query(`SELECT id FROM companies WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, uniqueCompanyIds]);
    if (found.rows.length !== uniqueCompanyIds.length) {
      throw new AuthLifecycleError(422, "One or more selected companies do not belong to this organization.", "AUTH_INVITATION_COMPANY_INVALID");
    }
  }
  if (uniqueBranchIds.length) {
    const found = await client.query(`SELECT id FROM branches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, uniqueBranchIds]);
    if (found.rows.length !== uniqueBranchIds.length) {
      throw new AuthLifecycleError(422, "One or more selected branches do not belong to this organization.", "AUTH_INVITATION_BRANCH_INVALID");
    }
  }

  // SP008 grant-ceiling/SoD enforcement (access-administration.js) already
  // exists and is used for role assignment, but this issuance path never
  // called it — an admin could invite someone into a role carrying
  // permissions beyond their own, bypassing the control entirely. Reusing
  // validateRoleSelection (built for multi-role assignment) with a single
  // roleId as both the selection and the primary role gets the same
  // ceiling + SoD checks for free, including its own organization_owner
  // exemption via allowOwnerRole (kept false here — owner transfer has its
  // own controlled flow, an invitation must never grant it). `inviter` is
  // required, not optional — this must never be silently skippable by a
  // caller that forgets to pass it.
  if (!inviter) throw new AuthLifecycleError(500, "Invitation issuance requires the inviter's role context.", "AUTH_INVITER_CONTEXT_MISSING");
  await validateRoleSelection(client, {
    organizationId,
    roleIds: [roleId],
    primaryRoleId: roleId,
    actor: inviter,
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
      `SELECT id FROM organization_invitations
        WHERE organization_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [organizationId, email],
    )
  ).rows[0];

  const token = createOpaqueToken();
  const hash = tokenHash(token);
  let invitationId;
  await withSeatLock(client, organizationId, async () => {
  await assertSeatAvailable(client, organizationId, { additional: pending ? 0 : 1, excludeInvitationId: pending?.id ?? null, env });
  if (pending) {
    invitationId = pending.id;
    await client.query(
      `UPDATE organization_invitations
          SET token_hash = $2, role_id = $3, invited_by = $4, company_ids = $5, branch_ids = $6,
              expires_at = now() + interval '${INVITATION_TOKEN_TTL_DAYS} days',
              last_sent_at = now(), send_count = send_count + 1
        WHERE id = $1`,
      [invitationId, hash, roleId, invitedByUserId, uniqueCompanyIds, uniqueBranchIds],
    );
  } else {
    invitationId = randomUUID();
    await client.query(
      `INSERT INTO organization_invitations (id, organization_id, email, role, role_id, company_ids, branch_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, 'member', $4, $5, $6, $7, $8, now() + interval '${INVITATION_TOKEN_TTL_DAYS} days')`,
      [invitationId, organizationId, email, roleId, uniqueCompanyIds, uniqueBranchIds, hash, invitedByUserId],
    );
  }
  });

  const delivered = await deliverAuthMessage(
    { type: "organization-invitation", email, url: pathTokenUrl(env, "/invitations", token), organizationName: organization.name },
    env,
  );
  return { invitationId, delivered };
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
//
// That reasoning holds ONLY for a brand-new account: there, "clicked the
// link" is the only identity claim being made, and it's the same bar
// email verification already clears. For an EXISTING account, clicking an
// invitation link is not equivalent to proving you control that account —
// an org admin who doesn't know the invitee's password can generate the
// link, so mailbox access to the invitation email is a weaker proof than
// the invited account's own password. `authenticatedUserId` is the
// caller's OWN already-established session identity (resolved server-side
// from their session cookie, never client-supplied) — an existing account
// is only ever joined to the new organization when that already-
// authenticated session already belongs to the invited account. This also
// closes the password-overwrite hole: an existing user's password_hash is
// never written by this function, under any input, full stop.
export async function acceptOrganizationInvitation(client, token, { fullName, password }, authenticatedUserId = null) {
  const hash = tokenHash(token);
  const invitation = (
    await client.query(
      `SELECT id, organization_id, email, role_id, company_ids, branch_ids, expires_at, accepted_at, revoked_at
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
  let mintNewSession;
  if (user) {
    userId = user.id;
    // Existing account: the invitation link alone is never sufficient
    // proof of ownership. The caller must already be authenticated AS
    // this exact account (a real login, which does check the password) —
    // if a password-less account somehow exists (e.g. a future SSO-only
    // user), the same "must already be this account's session" rule still
    // applies; there is no path here that sets or changes a password.
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
  // SP001/SP004 real gap this closes (migration 048): without this, a
  // scoped-role invitee joined the organization with membership + role but
  // NO company/branch access at all — invited into a workplace they
  // couldn't actually see. Same transaction as membership/role above (this
  // whole function always runs inside one — see the accept route), so a
  // partial grant (membership without workplace access) can never persist.
  for (const companyId of invitation.company_ids || []) {
    await client.query(
      `INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [invitation.organization_id, userId, companyId],
    );
  }
  for (const branchId of invitation.branch_ids || []) {
    await client.query(
      `INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [invitation.organization_id, userId, branchId],
    );
  }
  await client.query(`UPDATE organization_invitations SET accepted_at = now() WHERE id = $1`, [invitation.id]);

  return { userId, organizationId: invitation.organization_id, mintNewSession };
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

// Admin-facing view (Settings > People > Invitations) — every invitation
// ever issued for the organization, not just this caller's own pending
// ones (listPendingInvitationsForEmail above is the self-service "what am
// I invited to" list, a different audience/authorization entirely).
export async function listOrganizationInvitations(client, organizationId) {
  const rows = await client.query(
    `SELECT
        invitation.id, invitation.email, invitation.role_id, role.name AS role_name,
        invitation.company_ids, invitation.branch_ids,
        invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
        invitation.last_sent_at, invitation.send_count, invitation.created_at,
        inviter.full_name AS invited_by_name
      FROM organization_invitations AS invitation
      LEFT JOIN roles AS role ON role.id = invitation.role_id
      JOIN users AS inviter ON inviter.id = invitation.invited_by
      WHERE invitation.organization_id = $1
      ORDER BY invitation.created_at DESC`,
    [organizationId],
  );
  return rows.rows.map((row) => ({
    ...row,
    status: row.revoked_at ? "revoked" : row.accepted_at ? "accepted" : new Date(row.expires_at) < new Date() ? "expired" : "pending",
  }));
}

export async function revokeOrganizationInvitation(client, { organizationId, invitationId }) {
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

// Re-sends the SAME invitation as originally issued (same role/company/
// branch selections) rather than requiring the admin to re-fill the whole
// form — the one thing this changes is expiry (reset to a fresh TTL) and
// send_count/last_sent_at, matching createOrganizationInvitation's own
// "re-inviting a still-pending email updates the existing row" behavior,
// just reachable directly from an existing invitation instead of only via
// re-submitting the invite form with the same email.
export async function resendOrganizationInvitation(client, { organizationId, invitationId }, env = process.env) {
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

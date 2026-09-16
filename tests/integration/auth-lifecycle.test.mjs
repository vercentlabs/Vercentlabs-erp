// Real PostgreSQL integration test — not a mocked-client unit test.
// Proves the actual domain functions in services/api/src/core/
// auth-lifecycle.js against the real schema (email_verification_tokens,
// password_reset_tokens, organization_invitations, user_role_assignments)
// that already existed but was never wired to anything before this
// checkpoint (ERP completion gap audit, Checkpoint B).
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import {
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  requestPasswordReset,
  resetPasswordWithToken,
  createOrganizationInvitation,
  getInvitationByToken,
  acceptOrganizationInvitation,
  listPendingInvitationsForEmail,
  AuthLifecycleError,
} from "../../services/api/src/core/auth-lifecycle.js";
import { hashPassword, verifyPassword, createOpaqueToken, tokenHash, createSession } from "../../services/api/src/core/session.js";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

// deliverAuthMessage hits real SMTP/webhook config (absent in this test
// environment) and returns false when neither is configured — every
// assertion below checks DATABASE state (tokens, users, memberships), not
// email delivery, so that's expected and fine, not a workaround.

test("auth-lifecycle: email verification, password reset, and organization invitations against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const orgId = randomUUID();
  const inviterUserId = randomUUID();
  const roleId = randomUUID();
  const unverifiedUserId = randomUUID();
  const resetUserId = randomUUID();
  const inviteeEmail = `invitee-${randomUUID()}@test.invalid`;

  try {
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'Auth Lifecycle Inviter','not-a-real-hash','active',now())`,
      [inviterUserId, `inviter-${inviterUserId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by)
       VALUES($1,'Auth Lifecycle Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `auth-lifecycle-test-${orgId}`, inviterUserId],
    );
    await admin.query(
      `INSERT INTO roles(id,organization_id,slug,name,status)
       VALUES($1,$2,'auth_lifecycle_test_role','Auth Lifecycle Test Role','active')`,
      [roleId, orgId],
    );

    // --- Email verification ---
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status)
       VALUES($1,$2,'Unverified User','not-a-real-hash','active')`,
      [unverifiedUserId, `unverified-${unverifiedUserId}@test.invalid`],
    );
    const created = await createEmailVerificationToken(admin, unverifiedUserId);
    assert.equal(created.alreadyVerified, false);

    const rawTokenRow = await admin.query(
      `SELECT token_hash FROM email_verification_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [unverifiedUserId],
    );
    assert.ok(rawTokenRow.rows[0], "a real token row was inserted");

    // consumeEmailVerificationToken takes the raw token, not the hash —
    // reconstruct one whose hash matches what was stored, since the real
    // function never returns the raw token back out (correctly — it's
    // only ever supposed to leave the process via the mailer).
    const knownToken = createOpaqueToken();
    await admin.query(`UPDATE email_verification_tokens SET token_hash = $2 WHERE user_id = $1`, [unverifiedUserId, tokenHash(knownToken)]);

    const beforeVerify = await admin.query(`SELECT email_verified_at FROM users WHERE id = $1`, [unverifiedUserId]);
    assert.equal(beforeVerify.rows[0].email_verified_at, null);

    const consumed = await consumeEmailVerificationToken(admin, knownToken);
    assert.equal(consumed.userId, unverifiedUserId);
    const afterVerify = await admin.query(`SELECT email_verified_at FROM users WHERE id = $1`, [unverifiedUserId]);
    assert.ok(afterVerify.rows[0].email_verified_at, "email_verified_at is now set");

    await assert.rejects(
      consumeEmailVerificationToken(admin, knownToken),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_TOKEN_USED",
      "the same token cannot be consumed twice",
    );

    await assert.rejects(
      consumeEmailVerificationToken(admin, "not-a-real-token"),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_TOKEN_INVALID",
    );

    // --- Password reset ---
    const originalHash = await hashPassword("Original!Passw0rd");
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'Reset Test User',$3,'active',now())`,
      [resetUserId, `reset-${resetUserId}@test.invalid`, originalHash],
    );
    const resetUserEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [resetUserId])).rows[0].email;

    // A live session that must NOT survive the password reset.
    const { token: liveSessionToken } = await createSession(admin, { userId: resetUserId, ipAddress: "127.0.0.1", userAgent: "test" });
    const liveSessionHash = tokenHash(liveSessionToken);
    const sessionBefore = await admin.query(`SELECT revoked_at FROM sessions WHERE token_hash = $1`, [liveSessionHash]);
    assert.equal(sessionBefore.rows[0].revoked_at, null);

    const requestResultKnown = await requestPasswordReset(admin, resetUserEmail);
    assert.equal(requestResultKnown.requested, true);
    // Account-enumeration protection: an unknown email returns the exact
    // same shape, not a different error/status a client could branch on.
    const requestResultUnknown = await requestPasswordReset(admin, `nobody-${randomUUID()}@test.invalid`);
    assert.deepEqual(requestResultUnknown, requestResultKnown);

    const knownResetToken = createOpaqueToken();
    const latestResetToken = await admin.query(
      `SELECT id FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [resetUserId],
    );
    await admin.query(`UPDATE password_reset_tokens SET token_hash = $2 WHERE id = $1`, [latestResetToken.rows[0].id, tokenHash(knownResetToken)]);

    const resetResult = await resetPasswordWithToken(admin, knownResetToken, "BrandNew!Passw0rd");
    assert.equal(resetResult.userId, resetUserId);

    const newHash = (await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [resetUserId])).rows[0].password_hash;
    assert.ok(await verifyPassword("BrandNew!Passw0rd", newHash), "the new password actually verifies");
    assert.ok(!(await verifyPassword("Original!Passw0rd", newHash)), "the old password no longer verifies");

    const sessionAfter = await admin.query(`SELECT revoked_at, revoked_reason FROM sessions WHERE token_hash = $1`, [liveSessionHash]);
    assert.ok(sessionAfter.rows[0].revoked_at, "the pre-existing session was revoked by the password reset");
    assert.equal(sessionAfter.rows[0].revoked_reason, "password_reset");

    await assert.rejects(
      resetPasswordWithToken(admin, knownResetToken, "AnotherPassw0rd!"),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_TOKEN_USED",
    );

    // --- Organization invitations ---
    const { invitationId } = await createOrganizationInvitation(admin, {
      organizationId: orgId,
      invitedByUserId: inviterUserId,
      email: inviteeEmail,
      roleId,
    });
    assert.ok(invitationId);

    const pendingForEmail = await listPendingInvitationsForEmail(admin, inviteeEmail);
    assert.equal(pendingForEmail.length, 1);
    assert.equal(pendingForEmail[0].organization_name, "Auth Lifecycle Test Org");

    const inviteToken = createOpaqueToken();
    await admin.query(`UPDATE organization_invitations SET token_hash = $2 WHERE id = $1`, [invitationId, tokenHash(inviteToken)]);

    const invitationDetails = await getInvitationByToken(admin, inviteToken);
    assert.equal(invitationDetails.email, inviteeEmail);
    assert.equal(invitationDetails.organization_name, "Auth Lifecycle Test Org");

    const accepted = await acceptOrganizationInvitation(admin, inviteToken, { fullName: "New Invitee", password: "InviteeP@ssw0rd" });
    assert.equal(accepted.organizationId, orgId);

    const membership = await admin.query(
      `SELECT status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [orgId, accepted.userId],
    );
    assert.equal(membership.rows[0].status, "active");

    const roleAssignment = await admin.query(
      `SELECT status FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2 AND role_id = $3`,
      [orgId, accepted.userId, roleId],
    );
    assert.equal(roleAssignment.rows[0].status, "active", "the invited role was actually assigned, not just organization membership");

    const newUserVerified = await admin.query(`SELECT email_verified_at FROM users WHERE id = $1`, [accepted.userId]);
    assert.ok(newUserVerified.rows[0].email_verified_at, "accepting an invitation verifies the email — proof of mailbox control");

    await assert.rejects(
      acceptOrganizationInvitation(admin, inviteToken, { fullName: "New Invitee", password: "InviteeP@ssw0rd" }),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_INVITATION_ACCEPTED",
      "the same invitation cannot be accepted twice",
    );

    const pendingAfterAccept = await listPendingInvitationsForEmail(admin, inviteeEmail);
    assert.equal(pendingAfterAccept.length, 0, "an accepted invitation no longer shows as pending");

    // Duplicate invitation to an already-active member is rejected.
    await assert.rejects(
      createOrganizationInvitation(admin, { organizationId: orgId, invitedByUserId: inviterUserId, email: inviteeEmail, roleId }),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_ALREADY_MEMBER",
    );
  } finally {
    await admin.query(`DELETE FROM user_role_assignments WHERE organization_id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_memberships WHERE organization_id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_invitations WHERE organization_id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM sessions WHERE user_id = $1`, [resetUserId]).catch(() => undefined);
    await admin.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [resetUserId]).catch(() => undefined);
    await admin.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [unverifiedUserId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = $1`, [unverifiedUserId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = $1`, [resetUserId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE email = $1`, [inviteeEmail]).catch(() => undefined);
    await admin.query(`DELETE FROM roles WHERE id = $1`, [roleId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = $1`, [inviterUserId]).catch(() => undefined);
    await admin.end();
  }
});

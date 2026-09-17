// Real PostgreSQL integration test — not a mocked-client unit test.
// Proves the actual domain functions in services/api/src/core/
// auth-lifecycle.js against the real schema (email_verification_tokens,
// password_reset_tokens, organization_invitations, user_role_assignments)
// that already existed but was never wired to anything before this
// checkpoint (ERP completion gap audit, Checkpoint B).
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";

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
import { AccessAdministrationError } from "../../services/api/src/core/access-administration.js";
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
  const privilegedRoleId = randomUUID();
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
    // A privileged role (carries a real permission) to prove the
    // grant-ceiling check actually blocks an under-permissioned inviter,
    // not just accepts every invitation unconditionally.
    await admin.query(
      `INSERT INTO roles(id,organization_id,slug,name,status)
       VALUES($1,$2,'auth_lifecycle_privileged_role','Auth Lifecycle Privileged Role','active')`,
      [privilegedRoleId, orgId],
    );
    await admin.query(
      `INSERT INTO role_permissions(role_id,permission_key) VALUES($1,'crm.leads.manage')`,
      [privilegedRoleId],
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

    // --- Concurrent replay (2C) ---
    // Regression guard: the previous SELECT-then-UPDATE could let two
    // concurrent requests both observe used_at IS NULL before either
    // UPDATE committed. A second, genuinely separate DB connection (not
    // just a second call on the same client — true concurrency needs two
    // real connections racing) fires the exact same still-valid token at
    // consumeEmailVerificationToken via Promise.all. Exactly one must
    // succeed; the DB's own row-level locking during the atomic
    // UPDATE...WHERE used_at IS NULL is what's actually being proven here,
    // not just this test's sequencing.
    const secondConnection = await connectOrNull(adminConnectionString);
    assert.ok(secondConnection, "a second real Postgres connection is required to prove concurrency safety");
    try {
      const concurrentVerifyUserId = randomUUID();
      await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status)
         VALUES($1,$2,'Concurrent Verify User','not-a-real-hash','active')`,
        [concurrentVerifyUserId, `concurrent-verify-${concurrentVerifyUserId}@test.invalid`],
      );
      const concurrentToken = createOpaqueToken();
      await admin.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [randomUUID(), concurrentVerifyUserId, tokenHash(concurrentToken)],
      );

      const results = await Promise.allSettled([
        consumeEmailVerificationToken(admin, concurrentToken),
        consumeEmailVerificationToken(secondConnection, concurrentToken),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(fulfilled.length, 1, "exactly one of two simultaneous requests for the same token succeeds");
      assert.equal(rejected.length, 1, "the other is rejected, not silently double-applied");
      assert.equal(rejected[0].reason.code, "AUTH_TOKEN_USED");

      const usedRows = await admin.query(`SELECT used_at FROM email_verification_tokens WHERE user_id = $1`, [concurrentVerifyUserId]);
      assert.equal(usedRows.rows.length, 1, "no duplicate token row was created by the race");
      await admin.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [concurrentVerifyUserId]);
      await admin.query(`DELETE FROM users WHERE id = $1`, [concurrentVerifyUserId]);
    } finally {
      await secondConnection.end();
    }

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

    // --- Concurrent replay, password reset (2C) ---
    // Same race as email verification, proven against resetPasswordWithToken
    // specifically since it coordinates three writes (token claim, password
    // update, session revocation) — a second connection racing the same
    // still-valid reset token must not result in two different passwords
    // both momentarily "winning", or a password change with no
    // corresponding token claim.
    const secondResetConnection = await connectOrNull(adminConnectionString);
    assert.ok(secondResetConnection, "a second real Postgres connection is required to prove concurrency safety");
    try {
      const concurrentResetUserId = randomUUID();
      const concurrentOriginalHash = await hashPassword("ConcurrentOriginal1!");
      await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at)
         VALUES($1,$2,'Concurrent Reset User',$3,'active',now())`,
        [concurrentResetUserId, `concurrent-reset-${concurrentResetUserId}@test.invalid`, concurrentOriginalHash],
      );
      const concurrentResetToken = createOpaqueToken();
      await admin.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [randomUUID(), concurrentResetUserId, tokenHash(concurrentResetToken)],
      );

      const resetResults = await Promise.allSettled([
        resetPasswordWithToken(admin, concurrentResetToken, "RaceWinnerA1!"),
        resetPasswordWithToken(secondResetConnection, concurrentResetToken, "RaceWinnerB1!"),
      ]);
      const resetFulfilled = resetResults.filter((r) => r.status === "fulfilled");
      const resetRejected = resetResults.filter((r) => r.status === "rejected");
      assert.equal(resetFulfilled.length, 1, "exactly one of two simultaneous reset requests for the same token succeeds");
      assert.equal(resetRejected.length, 1);
      assert.equal(resetRejected[0].reason.code, "AUTH_TOKEN_USED");

      const finalHash = (await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [concurrentResetUserId])).rows[0].password_hash;
      const winnerIsA = await verifyPassword("RaceWinnerA1!", finalHash);
      const winnerIsB = await verifyPassword("RaceWinnerB1!", finalHash);
      assert.ok(winnerIsA !== winnerIsB, "the stored password matches exactly one of the two racing attempts, never neither and never a mix");
      assert.ok(!(await verifyPassword("ConcurrentOriginal1!", finalHash)), "the original password no longer verifies");

      await admin.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [concurrentResetUserId]);
      await admin.query(`DELETE FROM users WHERE id = $1`, [concurrentResetUserId]);
    } finally {
      await secondResetConnection.end();
    }

    // --- Invitation URL correctness (2A) ---
    // Regression guard for the broken invitation link defect: tokenUrl()
    // (query-string form, correct for verify-email/reset-password) was
    // also being used for invitations, whose real frontend route is a
    // path segment (apps/web/src/app/(auth)/invitations/[token]/page.tsx),
    // producing a dead /invitations?token=... link. This captures the
    // EXACT url createOrganizationInvitation hands to deliverAuthMessage
    // (via a real local HTTP server standing in for the webhook — no
    // reconstruction of the url in this test) under a production-style
    // HTTPS APP_URL, and asserts its shape directly.
    const capturedMessages = [];
    const captureServer = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        capturedMessages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((resolve) => captureServer.listen(0, "127.0.0.1", resolve));
    const captureServerUrl = `http://127.0.0.1:${captureServer.address().port}`;
    const prodStyleEnv = { APP_URL: "https://app.vercentlabs.example", AUTH_EMAIL_WEBHOOK_URL: captureServerUrl };
    const urlShapeInviteEmail = `url-shape-${randomUUID()}@test.invalid`;

    try {
      const urlShapeResult = await createOrganizationInvitation(
        admin,
        { organizationId: orgId, invitedByUserId: inviterUserId, email: urlShapeInviteEmail, roleId, inviter: { roleSlugs: ["organization_owner"], permissions: [] } },
        prodStyleEnv,
      );
      assert.equal(urlShapeResult.delivered, true, "the webhook capture server accepted delivery");
      assert.equal(capturedMessages.length, 1);
      const capturedUrl = capturedMessages[0].url;
      const match = capturedUrl.match(/^https:\/\/app\.vercentlabs\.example\/invitations\/([A-Za-z0-9_-]+)$/);
      assert.ok(match, `invitation url must be a path segment under a production HTTPS origin, got: ${capturedUrl}`);
      // Prove it's the SAME real token the invitation actually stores
      // (hashed), not a plausible-looking fabricated value.
      const capturedTokenHash = tokenHash(match[1]);
      const storedInvitation = await admin.query(`SELECT token_hash FROM organization_invitations WHERE id = $1`, [urlShapeResult.invitationId]);
      assert.equal(storedInvitation.rows[0].token_hash, capturedTokenHash, "the captured url's token matches the real stored token, not a reconstructed guess");
    } finally {
      captureServer.close();
      await admin.query(`DELETE FROM organization_invitations WHERE lower(email) = lower($1)`, [urlShapeInviteEmail]).catch(() => undefined);
    }

    // --- Organization invitations ---
    // inviter mirrors a real caller's session.roleSlugs/permissions —
    // createOrganizationInvitation now enforces the same SP008
    // grant-ceiling/SoD check as role assignment (validateRoleSelection),
    // and refuses to run at all without this context.
    const inviterActor = { roleSlugs: ["organization_owner"], permissions: [] };
    const { invitationId } = await createOrganizationInvitation(admin, {
      organizationId: orgId,
      invitedByUserId: inviterUserId,
      email: inviteeEmail,
      roleId,
      inviter: inviterActor,
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
    assert.equal(accepted.mintNewSession, true, "a brand-new account needs a fresh session minted");

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

    // --- Existing-account invitation acceptance (2D) ---
    // Regression guard: acceptOrganizationInvitation used to grant a live
    // session for ANY existing account whenever its invitation token was
    // presented, with no password check at all (unconditional
    // `if (user && password)` password_hash overwrite, no ownership
    // proof for session issuance). resetUserId already has a real,
    // known password (newHash, set by the password-reset test above) —
    // reused here as a stand-in "pre-existing account" being invited into
    // a second organization.
    const existingUserInviteToken = createOpaqueToken();
    const existingUserInvite = await createOrganizationInvitation(admin, {
      organizationId: orgId,
      invitedByUserId: inviterUserId,
      email: resetUserEmail,
      roleId,
      inviter: inviterActor,
    });
    await admin.query(`UPDATE organization_invitations SET token_hash = $2 WHERE id = $1`, [existingUserInvite.invitationId, tokenHash(existingUserInviteToken)]);

    // No authenticated session at all -> refused, not silently accepted.
    await assert.rejects(
      acceptOrganizationInvitation(admin, existingUserInviteToken, {}, null),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_INVITATION_REQUIRES_SIGN_IN",
      "an anonymous visitor cannot accept an existing account's invitation",
    );

    // Authenticated as a DIFFERENT account -> still refused.
    await assert.rejects(
      acceptOrganizationInvitation(admin, existingUserInviteToken, {}, inviterUserId),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_INVITATION_REQUIRES_SIGN_IN",
      "being signed in as someone else does not satisfy the ownership check",
    );

    // Supplying a password in the body, with no matching authenticated
    // session, must not be treated as proof of ownership either — this is
    // the exact bypass the old `if (user && password)` branch allowed.
    await assert.rejects(
      acceptOrganizationInvitation(admin, existingUserInviteToken, { password: "AttackerChosen1!" }, null),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_INVITATION_REQUIRES_SIGN_IN",
      "a password in the request body is not a substitute for an authenticated session",
    );
    const hashAfterBypassAttempts = (await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [resetUserId])).rows[0].password_hash;
    assert.equal(hashAfterBypassAttempts, newHash, "the rejected attempts must not have changed the real password_hash");

    // Authenticated as the correct, matching account -> succeeds, and
    // still never touches password_hash even though one is in the body.
    const existingUserAccepted = await acceptOrganizationInvitation(
      admin,
      existingUserInviteToken,
      { password: "IgnoredEvenThoughSupplied1!" },
      resetUserId,
    );
    assert.equal(existingUserAccepted.userId, resetUserId);
    assert.equal(existingUserAccepted.organizationId, orgId);
    assert.equal(existingUserAccepted.mintNewSession, false, "an existing, already-authenticated account reuses its own session");

    const hashAfterAcceptance = (await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [resetUserId])).rows[0].password_hash;
    assert.equal(hashAfterAcceptance, newHash, "accepting an invitation must never change an existing account's password");

    const existingUserMembership = await admin.query(
      `SELECT status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [orgId, resetUserId],
    );
    assert.equal(existingUserMembership.rows[0].status, "active", "the existing account still actually gets the membership once properly authenticated");

    // Duplicate invitation to an already-active member is rejected.
    await assert.rejects(
      createOrganizationInvitation(admin, { organizationId: orgId, invitedByUserId: inviterUserId, email: inviteeEmail, roleId, inviter: inviterActor }),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_ALREADY_MEMBER",
    );

    // Missing inviter context is refused outright, not silently skipped.
    await assert.rejects(
      createOrganizationInvitation(admin, {
        organizationId: orgId,
        invitedByUserId: inviterUserId,
        email: `no-inviter-${randomUUID()}@test.invalid`,
        roleId,
      }),
      (error) => error instanceof AuthLifecycleError && error.code === "AUTH_INVITER_CONTEXT_MISSING",
    );

    // SP008 grant-ceiling: an inviter who doesn't hold crm.leads.manage
    // themselves (and isn't organization_owner) cannot invite someone into
    // a role that carries it — proves this is enforced, not just present
    // in access-administration.js and never called from this path.
    await assert.rejects(
      createOrganizationInvitation(admin, {
        organizationId: orgId,
        invitedByUserId: inviterUserId,
        email: `ceiling-test-${randomUUID()}@test.invalid`,
        roleId: privilegedRoleId,
        inviter: { roleSlugs: ["member"], permissions: [] },
      }),
      (error) => error instanceof AccessAdministrationError && error.status === 403,
      "an under-permissioned inviter cannot grant a role carrying a permission they don't hold",
    );

    // The same invitation succeeds once the inviter actually holds (or is
    // organization_owner, exempted from) the ceiling.
    const privilegedInviteEmail = `ceiling-ok-${randomUUID()}@test.invalid`;
    const privilegedInvite = await createOrganizationInvitation(admin, {
      organizationId: orgId,
      invitedByUserId: inviterUserId,
      email: privilegedInviteEmail,
      roleId: privilegedRoleId,
      inviter: { roleSlugs: ["member"], permissions: ["crm.leads.manage"] },
    });
    assert.ok(privilegedInvite.invitationId, "an inviter who holds the permission themselves can grant it");
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
    await admin.query(`DELETE FROM roles WHERE id = $1`, [privilegedRoleId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = $1`, [inviterUserId]).catch(() => undefined);
    await admin.end();
  }
});

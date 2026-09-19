// Real PostgreSQL integration test — proves SP007 (MFA, account recovery
// and step-up authentication) against the real schema (migration
// 047_mfa_totp.sql) and the real services/api/src/core/mfa.js domain
// functions, not mocks. Covers: enrollment (start/confirm, wrong code,
// expiry, double-enrollment), login-time step-up verification via
// resolveSessionContext's mfaEnrolled/mfaPolicyRequired/mfaVerified fields,
// recovery-code single-use consumption, organization-enforced MFA, and
// disable/regenerate requiring a fresh code plus revoking every session.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync as fsReadFileSync } from "node:fs";
import { join as pathJoin, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfaForSession,
  disableMfa,
  regenerateRecoveryCodes,
  setOrganizationMfaEnforcement,
  MfaError,
  __internal,
} from "../../services/api/src/core/mfa.js";
import { PermissionDeniedError } from "../../services/api/src/core/access-control-runtime.js";
import { createSession, resolveSessionContext } from "../../services/api/src/core/session.js";

const repoRoot = pathJoin(pathDirname(fileURLToPath(import.meta.url)), "../..");
const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";
const env = { INTEGRATION_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex") };

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

function codeFor(secretBase32) {
  return __internal.totpAt(__internal.base32Decode(secretBase32), Math.floor(Date.now() / 1000));
}

// The replay-protection guard (mfa_last_used_step, migration 050) rejects
// reusing the same TOTP step twice for a given user -- correct in
// production, where two real verifications are always at least seconds
// apart, but this test suite calls codeFor() for the SAME secret several
// times in a row fast enough to land on the identical step every time.
// Resetting the guard between two otherwise-independent legitimate
// verifications simulates the real-world time gap a human would naturally
// have between them, without slowing the suite down with a real 30s sleep.
async function resetMfaReplayGuard(admin, userId) {
  await admin.query(`UPDATE users SET mfa_last_used_step = NULL WHERE id = $1`, [userId]);
}

test("SP007: MFA enrollment, login step-up, recovery codes and org enforcement against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const orgId = randomUUID();
  const userId = randomUUID();
  const secondUserId = randomUUID(); // for org-enforced coverage, never individually opted in
  let sessionToken;
  let sessionId;

  try {
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'MFA Test User','not-a-real-hash','active',now())`,
      [userId, `mfa-user-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'MFA Second User','not-a-real-hash','active',now())`,
      [secondUserId, `mfa-user2-${secondUserId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by)
       VALUES($1,'MFA Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `mfa-test-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`,
      [orgId, userId],
    );
    await admin.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`,
      [orgId, secondUserId],
    );

    await t.test("resolveSessionContext reports no MFA requirement before enrollment", async () => {
      const created = await createSession(admin, { userId, ipAddress: "127.0.0.1", userAgent: "test", env });
      sessionToken = created.token;
      sessionId = created.sessionId;
      const context = await resolveSessionContext(admin, sessionToken, "browser", env);
      assert.equal(context.mfaEnrolled, false);
      assert.equal(context.mfaPolicyRequired, false);
      assert.equal(context.mfaVerified, false);
    });

    let secretBase32;
    await t.test("beginMfaEnrollment returns a real secret and otpauth URI, stored only as pending", async () => {
      const result = await beginMfaEnrollment(admin, userId, env);
      secretBase32 = result.secretBase32;
      assert.ok(/^[A-Z2-7]{32}$/.test(secretBase32), "secret is base32, 160-bit");
      assert.ok(result.otpauthUri.startsWith("otpauth://totp/"));
      const row = (await admin.query(`SELECT mfa_secret_encrypted, mfa_pending_secret_encrypted, mfa_enrolled_at FROM users WHERE id=$1`, [userId])).rows[0];
      assert.equal(row.mfa_secret_encrypted, null, "not active yet");
      assert.ok(row.mfa_pending_secret_encrypted, "pending secret stored");
      assert.equal(row.mfa_enrolled_at, null);
    });

    await t.test("confirmMfaEnrollment rejects a wrong code and does not activate", async () => {
      await assert.rejects(
        () => confirmMfaEnrollment(admin, userId, "000000", env),
        (error) => error instanceof MfaError && error.code === "MFA_CODE_INVALID",
      );
      const row = (await admin.query(`SELECT mfa_enrolled_at FROM users WHERE id=$1`, [userId])).rows[0];
      assert.equal(row.mfa_enrolled_at, null, "still not enrolled after a wrong code");
    });

    let recoveryCodes;
    await t.test("confirmMfaEnrollment with the real current code activates MFA and issues recovery codes", async () => {
      const result = await confirmMfaEnrollment(admin, userId, codeFor(secretBase32), env);
      recoveryCodes = result.recoveryCodes;
      assert.equal(recoveryCodes.length, 10);
      assert.ok(new Set(recoveryCodes).size === 10, "all 10 recovery codes are distinct");
      const row = (await admin.query(`SELECT mfa_secret_encrypted, mfa_pending_secret_encrypted, mfa_enrolled_at FROM users WHERE id=$1`, [userId])).rows[0];
      assert.ok(row.mfa_secret_encrypted, "active secret now set");
      assert.equal(row.mfa_pending_secret_encrypted, null, "pending cleared");
      assert.ok(row.mfa_enrolled_at);
      const codesStored = (await admin.query(`SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL`, [userId])).rows[0];
      assert.equal(codesStored.n, 10);
    });

    await t.test("REPLAY PROTECTION: the exact code just used to confirm enrollment cannot be reused for a session verification", async () => {
      // codeFor() with no time offset reproduces the SAME step
      // confirmMfaEnrollment just claimed above -- migration 050's
      // mfa_last_used_step must reject it here even though the code is
      // still within its normal ±30s validity window.
      await assert.rejects(
        () => verifyMfaForSession(admin, { sessionId, userId, code: codeFor(secretBase32) }, env),
        (error) => error instanceof MfaError && error.code === "MFA_CODE_INVALID",
        "a TOTP code must be usable exactly once, even if it is still time-valid",
      );
    });

    await t.test("double-enrollment is rejected while already enrolled", async () => {
      await assert.rejects(
        () => beginMfaEnrollment(admin, userId, env),
        (error) => error instanceof MfaError && error.code === "MFA_ALREADY_ENROLLED",
      );
    });

    await t.test("resolveSessionContext now reports mfaEnrolled=true but mfaVerified=false for the EXISTING session (created before enrollment)", async () => {
      const context = await resolveSessionContext(admin, sessionToken, "browser", env);
      assert.equal(context.mfaEnrolled, true);
      assert.equal(context.mfaVerified, false, "enrolling does not retroactively verify an already-open session");
    });

    await t.test("verifyMfaForSession rejects an incorrect code", async () => {
      await assert.rejects(
        () => verifyMfaForSession(admin, { sessionId, userId, code: "111111" }, env),
        (error) => error instanceof MfaError && error.code === "MFA_CODE_INVALID",
      );
    });

    await t.test("verifyMfaForSession with the real current code marks this session MFA-verified", async () => {
      await resetMfaReplayGuard(admin, userId);
      await verifyMfaForSession(admin, { sessionId, userId, code: codeFor(secretBase32) }, env);
      const context = await resolveSessionContext(admin, sessionToken, "browser", env);
      assert.equal(context.mfaVerified, true);
    });

    let usedRecoveryCode;
    await t.test("a recovery code verifies once and is rejected on replay (single-use, no double-spend)", async () => {
      // Open a second session to prove recovery-code verification independently of the first.
      const created = await createSession(admin, { userId, ipAddress: "127.0.0.1", userAgent: "test-2", env });
      usedRecoveryCode = recoveryCodes[0];
      await verifyMfaForSession(admin, { sessionId: created.sessionId, userId, code: usedRecoveryCode }, env);
      const context = await resolveSessionContext(admin, created.token, "browser", env);
      assert.equal(context.mfaVerified, true);

      // Replay on a THIRD session must fail — the code was already consumed.
      const replaySession = await createSession(admin, { userId, ipAddress: "127.0.0.1", userAgent: "test-3", env });
      await assert.rejects(
        () => verifyMfaForSession(admin, { sessionId: replaySession.sessionId, userId, code: usedRecoveryCode }, env),
        (error) => error instanceof MfaError && error.code === "MFA_CODE_INVALID",
      );
      await admin.query(`DELETE FROM sessions WHERE id = ANY($1)`, [[created.sessionId, replaySession.sessionId]]);
    });

    await t.test("organization-enforced MFA makes mfaPolicyRequired true even for a member who never individually enrolled", async () => {
      const created = await createSession(admin, { userId: secondUserId, ipAddress: "127.0.0.1", userAgent: "test", env, organizationId: orgId });
      let context = await resolveSessionContext(admin, created.token, "browser", env);
      assert.equal(context.mfaPolicyRequired, false, "org has not enforced MFA yet");

      await admin.query(`UPDATE organizations SET mfa_enforced = true WHERE id = $1`, [orgId]);
      context = await resolveSessionContext(admin, created.token, "browser", env);
      assert.equal(context.mfaEnrolled, false, "still hasn't set up an authenticator");
      assert.equal(context.mfaPolicyRequired, true, "but the org now requires it — an EXISTING session is re-evaluated live, never stale");

      await admin.query(`UPDATE organizations SET mfa_enforced = false WHERE id = $1`, [orgId]);
      await admin.query(`DELETE FROM sessions WHERE id = $1`, [created.sessionId]);
    });

    await t.test("setOrganizationMfaEnforcement denies a caller without platform.security.manage", async () => {
      const unprivileged = { organizationId: orgId, roleSlugs: [], permissions: [] };
      await assert.rejects(
        () => setOrganizationMfaEnforcement(admin, unprivileged, true),
        (error) => error instanceof PermissionDeniedError,
      );
      const row = (await admin.query(`SELECT mfa_enforced FROM organizations WHERE id=$1`, [orgId])).rows[0];
      assert.equal(row.mfa_enforced, false, "denied call must not have any side effect");
    });

    await t.test("setOrganizationMfaEnforcement succeeds for organization_owner and is reflected live in resolveSessionContext for another member", async () => {
      const owner = { organizationId: orgId, roleSlugs: ["organization_owner"], permissions: [] };
      const result = await setOrganizationMfaEnforcement(admin, owner, true);
      assert.equal(result.mfaEnforced, true);

      const created = await createSession(admin, { userId: secondUserId, ipAddress: "127.0.0.1", userAgent: "test", env, organizationId: orgId });
      const context = await resolveSessionContext(admin, created.token, "browser", env);
      assert.equal(context.mfaPolicyRequired, true);

      const disabled = await setOrganizationMfaEnforcement(admin, owner, false);
      assert.equal(disabled.mfaEnforced, false);
      await admin.query(`DELETE FROM sessions WHERE id = $1`, [created.sessionId]);
    });

    await t.test("disableMfa rejects a stale/incorrect code and requires proof of the current factor", async () => {
      await assert.rejects(
        () => disableMfa(admin, userId, "222222", env),
        (error) => error instanceof MfaError && error.code === "MFA_CODE_INVALID",
      );
    });

    await t.test("regenerateRecoveryCodes with a real code replaces every prior code", async () => {
      await resetMfaReplayGuard(admin, userId);
      const result = await regenerateRecoveryCodes(admin, userId, codeFor(secretBase32), env);
      assert.equal(result.recoveryCodes.length, 10);
      assert.ok(!result.recoveryCodes.includes(recoveryCodes[1]), "new codes are freshly generated, not reused");
      const stillActive = (await admin.query(`SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL`, [userId])).rows[0];
      assert.equal(stillActive.n, 10, "exactly the new batch is active");
      const oldOneNoLongerWorks = await admin.query(`SELECT 1 FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2`, [
        userId,
        __internal.recoveryCodeHash(recoveryCodes[2]),
      ]);
      assert.equal(oldOneNoLongerWorks.rows.length, 0, "old recovery codes are gone entirely, not just consumed");
    });

    await t.test("disableMfa with the real current code disables MFA and revokes every session for this user", async () => {
      const beforeCount = (await admin.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL`, [userId])).rows[0].n;
      assert.ok(beforeCount > 0, "sanity: at least one active session exists before disabling");

      await resetMfaReplayGuard(admin, userId);
      await disableMfa(admin, userId, codeFor(secretBase32), env);

      const row = (await admin.query(`SELECT mfa_enrolled_at, mfa_secret_encrypted FROM users WHERE id=$1`, [userId])).rows[0];
      assert.equal(row.mfa_enrolled_at, null);
      assert.equal(row.mfa_secret_encrypted, null);
      const codesLeft = (await admin.query(`SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1`, [userId])).rows[0];
      assert.equal(codesLeft.n, 0, "recovery codes are deleted, not just left inactive");
      const activeAfter = (await admin.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL`, [userId])).rows[0].n;
      assert.equal(activeAfter, 0, "every session for this user was revoked, including the one that just disabled MFA");
    });

    await t.test("re-enrollment is possible after disabling, and starts from a clean slate", async () => {
      const result = await beginMfaEnrollment(admin, userId, env);
      assert.notEqual(result.secretBase32, secretBase32, "a fresh random secret, never reused");
      // Clean up the fresh pending attempt so it doesn't interfere with teardown assertions.
      await admin.query(`UPDATE users SET mfa_pending_secret_encrypted = NULL, mfa_pending_secret_expires_at = NULL WHERE id = $1`, [userId]);
    });

    await t.test("an expired pending enrollment cannot be confirmed and clears itself", async () => {
      await beginMfaEnrollment(admin, userId, env);
      await admin.query(`UPDATE users SET mfa_pending_secret_expires_at = now() - interval '1 minute' WHERE id = $1`, [userId]);
      await assert.rejects(
        () => confirmMfaEnrollment(admin, userId, "123456", env),
        (error) => error instanceof MfaError && error.code === "MFA_ENROLLMENT_EXPIRED",
      );
      const row = (await admin.query(`SELECT mfa_pending_secret_encrypted FROM users WHERE id=$1`, [userId])).rows[0];
      assert.equal(row.mfa_pending_secret_encrypted, null, "expired pending attempt is cleared, not left dangling");
    });

    await t.test("RATE LIMIT BYPASS CHECK: all four MFA code-checking routes share one rate-limit key per user, so switching routes cannot reset the budget", () => {
      // Structural regression guard, same technique as generate-route-
      // security-matrix.mjs: reads the actual route source rather than
      // exercising enforceRateLimit's own threshold logic again (already
      // unit-tested in services/api/tests/platform-security.test.mjs).
      // If a future edit ever gives one of these routes its own distinct
      // key (e.g. a typo, or a well-intentioned but wrong "make disable's
      // limit separate" change), an attacker could exhaust verify's budget
      // then continue guessing through disable/regenerate/enroll-confirm
      // with a fresh budget -- this test fails the instant that happens.
      const routes = [
        "apps/web/src/app/api/auth/mfa/verify/route.ts",
        "apps/web/src/app/api/auth/mfa/disable/route.ts",
        "apps/web/src/app/api/auth/mfa/recovery-codes/regenerate/route.ts",
        "apps/web/src/app/api/auth/mfa/enroll/confirm/route.ts",
      ];
      const keys = routes.map((route) => {
        const source = fsReadFileSync(pathJoin(repoRoot, route), "utf8")
          .split("\n")
          .filter((line) => !line.trim().startsWith("//"))
          .join("\n");
        const match = source.match(/enforceRateLimit\(client,\s*`([^`]+)`/);
        assert.ok(match, `${route} must call enforceRateLimit with a backtick-templated key`);
        return match[1];
      });
      assert.equal(new Set(keys).size, 1, `all four MFA routes must share the exact same rate-limit key template; found: ${JSON.stringify(keys)}`);
    });
  } finally {
    await admin.query(`DELETE FROM mfa_recovery_codes WHERE user_id = ANY($1)`, [[userId, secondUserId]]).catch(() => undefined);
    await admin.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [[userId, secondUserId]]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_memberships WHERE organization_id = $1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[userId, secondUserId]]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => undefined);
    await admin.end();
  }
});

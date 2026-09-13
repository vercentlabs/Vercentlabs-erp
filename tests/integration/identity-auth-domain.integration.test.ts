import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseConnection, type DatabaseConnection } from '@vercentlabs/database';
import { resetTestDatabase, setupTestDatabase } from '@vercentlabs/database/testing';
import {
  InvalidOrExpiredTokenError,
  AuthenticationFailedError,
  StepUpRequiredError,
  type PlatformOperatorScope,
} from '@vercentlabs/contracts';
import {
  acceptInvitation,
  changePassword,
  completeMfaLogin,
  completePasswordReset,
  confirmTotpEnrollment,
  createInvitation,
  generateRecoveryCodes,
  listSessions,
  login,
  logout,
  logoutAll,
  requestPasswordReset,
  resendVerification,
  revokeOtherSessions,
  revokeOwnSession,
  suspendUser,
  beginTotpEnrollment,
  validateResetToken,
  verifyEmail,
  InMemoryEmailProvider,
  resetTotpKeyProviderCache,
  completeStepUp,
  requireStepUp,
} from '@vercentlabs/platform-identity';
import { toRuntimeConnectionString, requireTestDatabaseUrl } from './lib/db-helpers.js';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

function operatorScope(): PlatformOperatorScope {
  return {
    kind: 'platform_operator',
    actor: { actorId: `operator-${randomUUID()}`, actorType: 'user' },
    roles: ['platform_operator'],
    correlationId: `corr-${randomUUID()}`,
    requestId: `req-${randomUUID()}`,
  };
}

const STRONG_PASSWORD = 'a genuinely long test passphrase 1';

describe('identity/auth domain (integration, requires PostgreSQL)', () => {
  let adminPool: Pool;
  let authPipeline: DatabaseConnection;
  let identityRuntime: DatabaseConnection;
  let emailProvider: InMemoryEmailProvider;

  beforeAll(async () => {
    process.env['TOTP_ENCRYPTION_KEYS'] = JSON.stringify({
      1: Buffer.alloc(32, 9).toString('base64'),
    });
    process.env['TOTP_ENCRYPTION_CURRENT_KEY_VERSION'] = '1';
    resetTotpKeyProviderCache();

    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;
    authPipeline = createDatabaseConnection(
      toRuntimeConnectionString(TEST_DATABASE_URL, {
        user: 'erp_auth_pipeline',
        password: 'erp_auth_pipeline_dev_password',
      }),
    );
    identityRuntime = createDatabaseConnection(
      toRuntimeConnectionString(TEST_DATABASE_URL, {
        user: 'erp_identity_runtime',
        password: 'erp_identity_runtime_dev_password',
      }),
    );
    emailProvider = new InMemoryEmailProvider();
  });

  afterAll(async () => {
    await authPipeline.close();
    await identityRuntime.close();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
    resetTotpKeyProviderCache();
  });

  async function acceptFreshInvitation(email = `user-${randomUUID().slice(0, 8)}@example.com`) {
    const created = await createInvitation(authPipeline.db, {
      scope: operatorScope(),
      organizationId: randomUUID(),
      email,
      idempotencyKey: randomUUID(),
    });
    const user = await acceptInvitation(authPipeline.db, {
      token: created.body.rawToken,
      displayName: 'Test User',
      password: STRONG_PASSWORD,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    // Invitation-accept already verifies the email (accepting via a
    // mailed token IS the verification event) - resend/verify-email flows
    // are exercised separately below via a fresh, deliberately-unverified path.
    return { email, userId: user.body.id };
  }

  it('accepts an invitation and creates an ACTIVE, verified user with a working password', async () => {
    const { userId } = await acceptFreshInvitation();
    const result = await login(authPipeline.db, {
      email: (await acceptFreshInvitationLookupEmail(userId)) ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(result.response.outcome).toBe('AUTHENTICATED');
  });

  async function acceptFreshInvitationLookupEmail(userId: string): Promise<string | undefined> {
    const { rows } = await adminPool.query(
      'SELECT email_original FROM identity.user_email_addresses WHERE user_id = $1',
      [userId],
    );
    return rows[0]?.email_original;
  }

  it('rejects accepting the same invitation token twice (concurrency-safe, single-use)', async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@example.com`;
    const created = await createInvitation(authPipeline.db, {
      scope: operatorScope(),
      organizationId: randomUUID(),
      email,
      idempotencyKey: randomUUID(),
    });
    await acceptInvitation(authPipeline.db, {
      token: created.body.rawToken,
      displayName: 'First',
      password: STRONG_PASSWORD,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    await expect(
      acceptInvitation(authPipeline.db, {
        token: created.body.rawToken,
        displayName: 'Second',
        password: STRONG_PASSWORD,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(InvalidOrExpiredTokenError);
  });

  it('lets two truly concurrent accept attempts for the SAME invitation result in exactly one accepted user', async () => {
    const email = `race-${randomUUID().slice(0, 8)}@example.com`;
    const created = await createInvitation(authPipeline.db, {
      scope: operatorScope(),
      organizationId: randomUUID(),
      email,
      idempotencyKey: randomUUID(),
    });
    const attempt = () =>
      acceptInvitation(authPipeline.db, {
        token: created.body.rawToken,
        displayName: 'Racer',
        password: STRONG_PASSWORD,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        requestId: randomUUID(),
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);

    const { rows } = await adminPool.query(
      'SELECT count(*)::int AS n FROM identity.users u JOIN identity.user_email_addresses e ON e.user_id = u.id WHERE e.email_normalized = $1',
      [email],
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects login for an unknown email with the generic AuthenticationFailedError', async () => {
    await expect(
      login(authPipeline.db, {
        email: `nobody-${randomUUID()}@example.com`,
        password: STRONG_PASSWORD,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
  });

  it('rejects login with a wrong password using the SAME generic error as an unknown account', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    await expect(
      login(authPipeline.db, {
        email: email ?? '',
        password: 'totally the wrong password value',
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
  });

  it('rejects login for a SUSPENDED user without revealing the reason', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const { rows } = await adminPool.query('SELECT version FROM identity.users WHERE id = $1', [
      userId,
    ]);
    await suspendUser(authPipeline.db, {
      scope: operatorScope(),
      userId,
      expectedVersion: rows[0].version,
      reason: 'integration test suspension',
      idempotencyKey: randomUUID(),
    });
    await expect(
      login(authPipeline.db, {
        email: email ?? '',
        password: STRONG_PASSWORD,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
  });

  it('suspending a user revokes their existing sessions', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const loginResult = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (loginResult.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');

    const { rows } = await adminPool.query('SELECT version FROM identity.users WHERE id = $1', [
      userId,
    ]);
    await suspendUser(authPipeline.db, {
      scope: operatorScope(),
      userId,
      expectedVersion: rows[0].version,
      reason: 'test',
      idempotencyKey: randomUUID(),
    });

    const { rows: sessionRows } = await adminPool.query(
      'SELECT revoked_at FROM auth.sessions WHERE id = $1',
      [loginResult.session.id],
    );
    expect(sessionRows[0].revoked_at).not.toBeNull();
  });

  it('changes password, revokes existing sessions, and the new password works for the next login', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const loginResult = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (loginResult.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');

    const newPassword = 'a different long passphrase value 2';
    await changePassword(identityRuntime.db, {
      userId,
      currentPassword: STRONG_PASSWORD,
      newPassword,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    const { rows } = await adminPool.query('SELECT revoked_at FROM auth.sessions WHERE id = $1', [
      loginResult.session.id,
    ]);
    expect(rows[0].revoked_at).not.toBeNull();

    await expect(
      login(authPipeline.db, {
        email: email ?? '',
        password: STRONG_PASSWORD,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
    const relogin = await login(authPipeline.db, {
      email: email ?? '',
      password: newPassword,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(relogin.response.outcome).toBe('AUTHENTICATED');
  });

  it('password reset: identical processing for existing and unknown accounts, real token works exactly once, and revokes sessions', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const loginResult = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (loginResult.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');

    await requestPasswordReset(authPipeline.db, {
      email: email ?? '',
      correlationId: randomUUID(),
      requestId: randomUUID(),
      emailProvider,
    });
    await requestPasswordReset(authPipeline.db, {
      email: `unknown-${randomUUID()}@example.com`,
      correlationId: randomUUID(),
      requestId: randomUUID(),
      emailProvider,
    });

    const sent = emailProvider.lastSentTo(email ?? '');
    expect(sent).toBeDefined();
    const rawToken = sent!.rawToken;

    expect((await validateResetToken(authPipeline.db, rawToken)).valid).toBe(true);

    const newPassword = 'reset flow long passphrase value 3';
    await completePasswordReset(authPipeline.db, {
      token: rawToken,
      newPassword,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    // Session created before the reset is revoked.
    const { rows } = await adminPool.query('SELECT revoked_at FROM auth.sessions WHERE id = $1', [
      loginResult.session.id,
    ]);
    expect(rows[0].revoked_at).not.toBeNull();

    // The token is single-use.
    await expect(
      completePasswordReset(authPipeline.db, {
        token: rawToken,
        newPassword: 'another long passphrase value 4',
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(InvalidOrExpiredTokenError);

    // The new password actually works.
    const relogin = await login(authPipeline.db, {
      email: email ?? '',
      password: newPassword,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(relogin.response.outcome).toBe('AUTHENTICATED');
  });

  it('requesting a second reset token invalidates the first', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);

    await requestPasswordReset(authPipeline.db, {
      email: email ?? '',
      correlationId: randomUUID(),
      requestId: randomUUID(),
      emailProvider,
    });
    const first = emailProvider.lastSentTo(email ?? '')!.rawToken;
    await requestPasswordReset(authPipeline.db, {
      email: email ?? '',
      correlationId: randomUUID(),
      requestId: randomUUID(),
      emailProvider,
    });
    const second = emailProvider.lastSentTo(email ?? '')!.rawToken;

    expect((await validateResetToken(authPipeline.db, first)).valid).toBe(false);
    expect((await validateResetToken(authPipeline.db, second)).valid).toBe(true);
  });

  it('enrolls TOTP, requires MFA on next login, and rejects a replayed code', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const initialLogin = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (initialLogin.response.outcome !== 'AUTHENTICATED')
      throw new Error('expected AUTHENTICATED');

    const enrollment = await beginTotpEnrollment(identityRuntime.db, userId, new Date());
    const { Secret, TOTP } = await import('otpauth');
    const secret = Secret.fromBase32(enrollment.manualEntryKey);
    const totp = new TOTP({
      issuer: 'Vercentlabs ERP',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    await confirmTotpEnrollment(identityRuntime.db, {
      userId,
      code: totp.generate(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    const mfaLogin = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(mfaLogin.response.outcome).toBe('MFA_REQUIRED');
    if (mfaLogin.response.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');

    const code = totp.generate();
    const completed = await completeMfaLogin(authPipeline.db, {
      mfaToken: mfaLogin.response.mfaToken,
      method: 'TOTP',
      code,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(completed.response.outcome).toBe('AUTHENTICATED');
    expect(completed.response.assuranceLevel).toBe('AAL2');

    // The exact same code, in a NEW mfa-login attempt, must be rejected (timestep replay).
    const secondMfaLogin = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (secondMfaLogin.response.outcome !== 'MFA_REQUIRED')
      throw new Error('expected MFA_REQUIRED');
    await expect(
      completeMfaLogin(authPipeline.db, {
        mfaToken: secondMfaLogin.response.mfaToken,
        method: 'TOTP',
        code,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
  });

  it('generates recovery codes and consumes exactly one on use; reuse is rejected', async () => {
    const { userId } = await acceptFreshInvitation();
    const generated = await generateRecoveryCodes(identityRuntime.db, {
      userId,
      sessionId: randomUUID(),
      isRegeneration: false,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(generated.codes).toHaveLength(10);

    const email = await acceptFreshInvitationLookupEmail(userId);
    // Recovery codes only matter once MFA is enabled - enroll TOTP quickly to exercise the real MFA_REQUIRED path.
    const enrollment = await beginTotpEnrollment(identityRuntime.db, userId, new Date());
    const { Secret, TOTP } = await import('otpauth');
    const secret = Secret.fromBase32(enrollment.manualEntryKey);
    const totp = new TOTP({
      issuer: 'Vercentlabs ERP',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    await confirmTotpEnrollment(identityRuntime.db, {
      userId,
      code: totp.generate(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    const mfaLogin = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (mfaLogin.response.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');

    const recoveryCode = generated.codes[0]!;
    const completed = await completeMfaLogin(authPipeline.db, {
      mfaToken: mfaLogin.response.mfaToken,
      method: 'RECOVERY_CODE',
      code: recoveryCode,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(completed.response.outcome).toBe('AUTHENTICATED');
    // Recovery-code-completed login is explicitly a lower/recovery assurance path.
    expect(completed.response.assuranceLevel).toBe('AAL1');

    const secondMfaLogin = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (secondMfaLogin.response.outcome !== 'MFA_REQUIRED')
      throw new Error('expected MFA_REQUIRED');
    await expect(
      completeMfaLogin(authPipeline.db, {
        mfaToken: secondMfaLogin.response.mfaToken,
        method: 'RECOVERY_CODE',
        code: recoveryCode,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);
  });

  it('lets two truly concurrent uses of the SAME recovery code succeed exactly once', async () => {
    const { userId } = await acceptFreshInvitation();
    const generated = await generateRecoveryCodes(identityRuntime.db, {
      userId,
      sessionId: randomUUID(),
      isRegeneration: false,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const email = await acceptFreshInvitationLookupEmail(userId);
    const enrollment = await beginTotpEnrollment(identityRuntime.db, userId, new Date());
    const { Secret, TOTP } = await import('otpauth');
    const secret = Secret.fromBase32(enrollment.manualEntryKey);
    const totp = new TOTP({
      issuer: 'Vercentlabs ERP',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    await confirmTotpEnrollment(identityRuntime.db, {
      userId,
      code: totp.generate(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    const attempt = async () => {
      const mfaLogin = await login(authPipeline.db, {
        email: email ?? '',
        password: STRONG_PASSWORD,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      });
      if (mfaLogin.response.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
      return completeMfaLogin(authPipeline.db, {
        mfaToken: mfaLogin.response.mfaToken,
        method: 'RECOVERY_CODE',
        code: generated.codes[0]!,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      });
    };
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);
  });

  it('lists sessions, revokes one, and revokes all others', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const first = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const second = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (first.response.outcome !== 'AUTHENTICATED' || second.response.outcome !== 'AUTHENTICATED')
      throw new Error('expected AUTHENTICATED');

    const sessions = await listSessions(identityRuntime.db, {
      userId,
      currentSessionId: second.session.id,
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    await revokeOwnSession(identityRuntime.db, {
      userId,
      sessionId: first.session.id,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const { rows } = await adminPool.query('SELECT revoked_at FROM auth.sessions WHERE id = $1', [
      first.session.id,
    ]);
    expect(rows[0].revoked_at).not.toBeNull();

    const third = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (third.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');
    await revokeOtherSessions(identityRuntime.db, {
      userId,
      currentSessionId: third.session.id,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const remaining = await listSessions(identityRuntime.db, {
      userId,
      currentSessionId: third.session.id,
    });
    expect(remaining.map((s) => s.id)).toEqual([third.session.id]);
  });

  it('logout revokes only the current session; logoutAll revokes every session', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const a = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const b = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (a.response.outcome !== 'AUTHENTICATED' || b.response.outcome !== 'AUTHENTICATED')
      throw new Error('expected AUTHENTICATED');

    await logout(identityRuntime.db, {
      userId,
      sessionId: a.session.id,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const stillActive = await listSessions(identityRuntime.db, {
      userId,
      currentSessionId: b.session.id,
    });
    expect(stillActive.map((s) => s.id)).toEqual([b.session.id]);

    await logoutAll(identityRuntime.db, {
      userId,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const afterAll_ = await listSessions(identityRuntime.db, {
      userId,
      currentSessionId: b.session.id,
    });
    expect(afterAll_).toHaveLength(0);
  });

  it('email verification and resend: unverified email cannot log in; verifying via the emailed token allows login', async () => {
    // Build a user with an UNVERIFIED email directly (bypassing invitation-accept's built-in verification) to exercise verify/resend for real.
    const email = `unverified-${randomUUID().slice(0, 8)}@example.com`;
    const created = await createInvitation(authPipeline.db, {
      scope: operatorScope(),
      organizationId: randomUUID(),
      email,
      idempotencyKey: randomUUID(),
    });
    await acceptInvitation(authPipeline.db, {
      token: created.body.rawToken,
      displayName: 'Unverified Flow',
      password: STRONG_PASSWORD,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    // Force the email back to unverified to exercise the resend/verify path independently of invitation-accept's own auto-verification.
    await adminPool.query(
      'UPDATE identity.user_email_addresses SET verified_at = NULL WHERE email_normalized = $1',
      [email],
    );

    await expect(
      login(authPipeline.db, {
        email,
        password: STRONG_PASSWORD,
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(AuthenticationFailedError);

    await resendVerification(authPipeline.db, {
      email,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
      emailProvider,
    });
    const sent = emailProvider.lastSentTo(email);
    expect(sent).toBeDefined();

    await verifyEmail(authPipeline.db, {
      token: sent!.rawToken,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    const afterVerify = await login(authPipeline.db, {
      email,
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(afterVerify.response.outcome).toBe('AUTHENTICATED');
  });

  it('requireStepUp rejects a session with no prior step-up grant', async () => {
    const { userId } = await acceptFreshInvitation();
    await expect(
      requireStepUp(identityRuntime.db, {
        userId,
        sessionId: randomUUID(),
        purpose: 'password_change',
      }),
    ).rejects.toThrow(StepUpRequiredError);
  });

  it('completeStepUp with PASSWORD_TOTP grants a short-lived elevation that requireStepUp then accepts (exercises the erp_identity_runtime TOTP/webauthn/recovery-code grants added for this shared path)', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const loginResult = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (loginResult.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');

    const enrollment = await beginTotpEnrollment(identityRuntime.db, userId, new Date());
    const { Secret, TOTP } = await import('otpauth');
    const secret = Secret.fromBase32(enrollment.manualEntryKey);
    const totp = new TOTP({
      issuer: 'Vercentlabs ERP',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    await confirmTotpEnrollment(identityRuntime.db, {
      userId,
      code: totp.generate(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    await expect(
      requireStepUp(identityRuntime.db, {
        userId,
        sessionId: loginResult.session.id,
        purpose: 'password_change',
      }),
    ).rejects.toThrow(StepUpRequiredError);

    await completeStepUp(identityRuntime.db, {
      userId,
      sessionId: loginResult.session.id,
      purpose: 'password_change',
      method: 'PASSWORD_TOTP',
      password: STRONG_PASSWORD,
      code: totp.generate(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
      webauthnRpId: 'localhost',
      webauthnExpectedOrigin: 'http://localhost:3000',
    });

    await expect(
      requireStepUp(identityRuntime.db, {
        userId,
        sessionId: loginResult.session.id,
        purpose: 'password_change',
      }),
    ).resolves.toBeUndefined();

    // A different purpose was never granted.
    await expect(
      requireStepUp(identityRuntime.db, {
        userId,
        sessionId: loginResult.session.id,
        purpose: 'mfa_removal_reset',
      }),
    ).rejects.toThrow(StepUpRequiredError);
  });

  it('completeStepUp with RECOVERY_CODE also works (exercises the erp_identity_runtime recovery_codes UPDATE grant added for this shared path)', async () => {
    const { userId } = await acceptFreshInvitation();
    const email = await acceptFreshInvitationLookupEmail(userId);
    const loginResult = await login(authPipeline.db, {
      email: email ?? '',
      password: STRONG_PASSWORD,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    if (loginResult.response.outcome !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');

    const generated = await generateRecoveryCodes(identityRuntime.db, {
      userId,
      sessionId: loginResult.session.id,
      isRegeneration: false,
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });

    await completeStepUp(identityRuntime.db, {
      userId,
      sessionId: loginResult.session.id,
      purpose: 'mfa_removal_reset',
      method: 'RECOVERY_CODE',
      code: generated.codes[0]!,
      correlationId: randomUUID(),
      requestId: randomUUID(),
      webauthnRpId: 'localhost',
      webauthnExpectedOrigin: 'http://localhost:3000',
    });

    await expect(
      requireStepUp(identityRuntime.db, {
        userId,
        sessionId: loginResult.session.id,
        purpose: 'mfa_removal_reset',
      }),
    ).resolves.toBeUndefined();
  });
});

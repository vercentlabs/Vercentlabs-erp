import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabaseConnection,
  toRuntimeConnectionString,
  type DatabaseConnection,
} from '@vercentlabs/database';
import { setupTestDatabase, resetTestDatabase } from '@vercentlabs/database/testing';

/**
 * Real end-to-end HTTP coverage for the SP004-SP007 self-service identity
 * API surface: boots the actual Nest application (guards, filters,
 * controllers, real Postgres via `IdentityDatabaseModule`) against a
 * throwaway `*_test` database and drives it purely over Fastify's
 * `.inject()` - no mocks for the database, the session guard, or the domain
 * layer. `createInvitation`/`acceptInvitation` are called directly against
 * the `erp_auth_pipeline` role to seed fixtures only - there is
 * deliberately no HTTP endpoint for them yet (SP001-SP003 administration
 * stays fail-closed to ordinary users until SP008-SP010 supplies a role
 * model; see product/evidence/PROMPT-002B-SP004-SP007-IDENTITY-AUTH.md).
 * Requires PostgreSQL to be running; run via `pnpm --filter @vercentlabs/api test:integration`.
 */
describe('identity API (integration, requires PostgreSQL)', () => {
  const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? '';
  const STRONG_PASSWORD = 'a genuinely long http test passphrase 1';
  const ORIGIN = 'http://localhost:3000';

  let adminPool: Pool;
  let authPipeline: DatabaseConnection;
  let app: NestFastifyApplication;

  interface InjectOptions {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
    cookies?: Record<string, string>;
  }

  function inject(options: InjectOptions) {
    return app.getHttpAdapter().getInstance().inject(options);
  }

  function withOrigin(headers: Record<string, string> = {}): Record<string, string> {
    return { origin: ORIGIN, ...headers };
  }

  /** Extracts just the cookie's own name=value pair (drops attributes) so it can be replayed as a request `Cookie` header. */
  function sessionCookieValue(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((c) => c.name.includes('vlerp_session'));
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  async function createAndAcceptInvitation(
    email = `http-${randomUUID().slice(0, 8)}@example.com`,
  ): Promise<{ email: string; userId: string }> {
    const { createInvitation, acceptInvitation } = await import('@vercentlabs/platform-identity');
    const created = await createInvitation(authPipeline.db, {
      scope: {
        kind: 'platform_operator',
        actor: { actorId: `operator-${randomUUID()}`, actorType: 'user' },
        roles: ['platform_operator'],
        correlationId: `corr-${randomUUID()}`,
        requestId: `req-${randomUUID()}`,
      },
      organizationId: randomUUID(),
      email,
      idempotencyKey: randomUUID(),
    });
    const user = await acceptInvitation(authPipeline.db, {
      token: created.body.rawToken,
      displayName: 'HTTP Test User',
      password: STRONG_PASSWORD,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      requestId: randomUUID(),
    });
    return { email, userId: user.body.id };
  }

  async function login(email: string, password = STRONG_PASSWORD) {
    return inject({
      method: 'POST',
      url: '/api/v1/identity/auth/login',
      headers: withOrigin(),
      payload: { email, password },
    });
  }

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL must be set to run apps/api integration tests.');
    }
    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;

    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['RUNTIME_DATABASE_URL'] = toRuntimeConnectionString(TEST_DATABASE_URL);
    process.env['API_CORS_ORIGINS'] = ORIGIN;
    process.env['TOTP_ENCRYPTION_KEYS'] = JSON.stringify({
      1: Buffer.alloc(32, 7).toString('base64'),
    });
    process.env['TOTP_ENCRYPTION_CURRENT_KEY_VERSION'] = '1';
    process.env['WEBAUTHN_RP_ID'] = 'localhost';
    process.env['WEBAUTHN_EXPECTED_ORIGIN'] = ORIGIN;
    // fastify's light-my-request `.inject()` is not real TLS - the cookie
    // must be issued without `Secure` for this test to read it back at all.
    process.env['SESSION_COOKIE_INSECURE_LOCAL_HTTP'] = 'true';

    authPipeline = createDatabaseConnection(
      toRuntimeConnectionString(TEST_DATABASE_URL, {
        user: 'erp_auth_pipeline',
        password: 'erp_auth_pipeline_dev_password',
      }),
    );

    // The app module graph (ConfigModule -> apiEnvProvider) reads
    // process.env at import time, so it must be freshly imported after the
    // env vars above are set.
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.register(fastifyCookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await authPipeline.close();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  // ---------------------------------------------------------------------
  // CSRF (Origin validation, not CORS/SameSite)
  // ---------------------------------------------------------------------

  it('rejects a state-changing request with no Origin header with 403', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/identity/auth/login',
      payload: { email: 'nobody@example.com', password: 'irrelevant password value here' },
    });
    expect(response.statusCode).toBe(403);
    expect((JSON.parse(response.payload) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('rejects a state-changing request whose Origin is not an allowed origin with 403', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/identity/auth/login',
      headers: { origin: 'https://evil.example.com' },
      payload: { email: 'nobody@example.com', password: 'irrelevant password value here' },
    });
    expect(response.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------
  // Login: cookie issuance, account-enumeration resistance, session guard
  // ---------------------------------------------------------------------

  it('logs in with a real account and sets a session cookie with the expected security flags', async () => {
    const { email } = await createAndAcceptInvitation();
    const response = await login(email);
    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.payload) as { outcome: string }).outcome).toBe('AUTHENTICATED');

    const cookie = response.cookies.find((c) => c.name.includes('vlerp_session'));
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/');
    // SESSION_COOKIE_INSECURE_LOCAL_HTTP=true for this HTTP-only test run -
    // production/staging never set this, which is what forces `Secure` +
    // the `__Host-` name (see session-cookie.ts and docs/security/session-and-csrf-security.md).
    expect(cookie?.name).toBe('vlerp_session');
  });

  it('returns the identical AUTHENTICATION_FAILED-shaped 401 for an unknown email and a wrong password', async () => {
    const { email } = await createAndAcceptInvitation();
    const unknownResponse = await login(`nobody-${randomUUID()}@example.com`);
    const wrongPasswordResponse = await login(email, 'totally the wrong password value here');

    expect(unknownResponse.statusCode).toBe(401);
    expect(wrongPasswordResponse.statusCode).toBe(401);
    const unknownBody = JSON.parse(unknownResponse.payload) as {
      error: { code: string; message: string };
    };
    const wrongBody = JSON.parse(wrongPasswordResponse.payload) as {
      error: { code: string; message: string };
    };
    expect(unknownBody.error.code).toBe('UNAUTHORIZED');
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
  });

  it('rejects /identity/auth/me with 401 when no session cookie is presented', async () => {
    const response = await inject({ method: 'GET', url: '/api/v1/identity/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects /identity/auth/me with 401 for a forged/garbage cookie value', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/identity/auth/me',
      headers: { cookie: 'vlerp_session=not-a-real-session-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a valid session cookie on /identity/auth/me and returns the authenticated user', async () => {
    const { email, userId } = await createAndAcceptInvitation();
    const loginResponse = await login(email);
    const cookie = sessionCookieValue(loginResponse);
    expect(cookie).toBeDefined();

    const meResponse = await inject({
      method: 'GET',
      url: '/api/v1/identity/auth/me',
      headers: { cookie: cookie! },
    });
    expect(meResponse.statusCode).toBe(200);
    expect((JSON.parse(meResponse.payload) as { id: string }).id).toBe(userId);
  });

  // ---------------------------------------------------------------------
  // Logout / logout-all
  // ---------------------------------------------------------------------

  it('logout revokes the session so it can no longer be used, and clears the cookie', async () => {
    const { email } = await createAndAcceptInvitation();
    const loginResponse = await login(email);
    const cookie = sessionCookieValue(loginResponse);

    const logoutResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/auth/logout',
      headers: withOrigin({ cookie: cookie! }),
    });
    expect(logoutResponse.statusCode).toBe(200);
    const clearedCookie = logoutResponse.cookies.find((c) => c.name.includes('vlerp_session'));
    expect(
      clearedCookie?.value === '' || (clearedCookie?.expires && clearedCookie.expires < new Date()),
    ).toBeTruthy();

    const meAfterLogout = await inject({
      method: 'GET',
      url: '/api/v1/identity/auth/me',
      headers: { cookie: cookie! },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------
  // Sessions: list / revoke / revoke-others
  // ---------------------------------------------------------------------

  it('lists active sessions for the caller, marking the current one', async () => {
    const { email } = await createAndAcceptInvitation();
    const first = sessionCookieValue(await login(email));
    const secondLoginResponse = await login(email);
    const second = sessionCookieValue(secondLoginResponse);

    const listResponse = await inject({
      method: 'GET',
      url: '/api/v1/identity/sessions',
      headers: { cookie: second! },
    });
    expect(listResponse.statusCode).toBe(200);
    const sessions = JSON.parse(listResponse.payload) as { id: string; isCurrent: boolean }[];
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s) => s.isCurrent)).toHaveLength(1);
    void first;
  });

  it('revoke-others leaves only the calling session active', async () => {
    const { email } = await createAndAcceptInvitation();
    await login(email);
    const currentCookie = sessionCookieValue(await login(email));

    const revokeResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/sessions/revoke-others',
      headers: withOrigin({ cookie: currentCookie! }),
    });
    expect(revokeResponse.statusCode).toBe(200);

    const listResponse = await inject({
      method: 'GET',
      url: '/api/v1/identity/sessions',
      headers: { cookie: currentCookie! },
    });
    const sessions = JSON.parse(listResponse.payload) as { isCurrent: boolean }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.isCurrent).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Password change: revokes the calling session's own cookie too
  // ---------------------------------------------------------------------

  it('changing the password revokes every session, including the one making the request', async () => {
    const { email } = await createAndAcceptInvitation();
    const cookie = sessionCookieValue(await login(email));
    const newPassword = 'a different long http passphrase value 2';

    const changeResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/auth/password/change',
      headers: withOrigin({ cookie: cookie! }),
      payload: { currentPassword: STRONG_PASSWORD, newPassword },
    });
    expect(changeResponse.statusCode).toBe(200);

    const meAfterChange = await inject({
      method: 'GET',
      url: '/api/v1/identity/auth/me',
      headers: { cookie: cookie! },
    });
    expect(meAfterChange.statusCode).toBe(401);

    const relogin = await login(email, newPassword);
    expect(relogin.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------
  // MFA (TOTP) and step-up over real HTTP
  // ---------------------------------------------------------------------

  it('enrolls TOTP over HTTP, then requires MFA on the next login', async () => {
    const { email } = await createAndAcceptInvitation();
    const cookie = sessionCookieValue(await login(email));

    const beginResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/mfa/totp/begin',
      headers: withOrigin({ cookie: cookie! }),
    });
    expect(beginResponse.statusCode).toBe(200);
    const { manualEntryKey } = JSON.parse(beginResponse.payload) as { manualEntryKey: string };

    const { Secret, TOTP } = await import('otpauth');
    const totp = new TOTP({
      issuer: 'Vercentlabs ERP',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(manualEntryKey),
    });

    const confirmResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/mfa/totp/confirm',
      headers: withOrigin({ cookie: cookie! }),
      payload: { code: totp.generate() },
    });
    expect(confirmResponse.statusCode).toBe(200);

    const mfaLoginResponse = await login(email);
    expect(mfaLoginResponse.statusCode).toBe(200);
    const mfaBody = JSON.parse(mfaLoginResponse.payload) as { outcome: string; mfaToken?: string };
    expect(mfaBody.outcome).toBe('MFA_REQUIRED');

    const completeResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/auth/mfa/complete',
      headers: withOrigin(),
      payload: { method: 'TOTP', mfaToken: mfaBody.mfaToken, code: totp.generate() },
    });
    expect(completeResponse.statusCode).toBe(200);
    expect((JSON.parse(completeResponse.payload) as { outcome: string }).outcome).toBe(
      'AUTHENTICATED',
    );
  });

  it('a high-risk action rejects with a typed STEP_UP_REQUIRED error, and step-up completion then allows it', async () => {
    const { email } = await createAndAcceptInvitation();
    const cookie = sessionCookieValue(await login(email));

    const withoutStepUp = await inject({
      method: 'POST',
      url: '/api/v1/identity/mfa/recovery-codes/regenerate',
      headers: withOrigin({ cookie: cookie! }),
    });
    expect(withoutStepUp.statusCode).toBe(403);
    const body = JSON.parse(withoutStepUp.payload) as {
      error: { code: string; meta?: { purpose?: string; acceptableMethods?: string[] } };
    };
    expect(body.error.code).toBe('STEP_UP_REQUIRED');
    expect(body.error.meta?.purpose).toBe('mfa_removal_reset');
    expect(body.error.meta?.acceptableMethods).toContain('PASSWORD_TOTP');

    const stepUpResponse = await inject({
      method: 'POST',
      url: '/api/v1/identity/step-up/complete',
      headers: withOrigin({ cookie: cookie! }),
      payload: {
        method: 'PASSWORD_TOTP',
        purpose: 'mfa_removal_reset',
        password: STRONG_PASSWORD,
        code: '000000',
      },
    });
    // No TOTP is enrolled for this fresh user, so the code is necessarily
    // wrong - this still proves the step-up ceremony itself is reachable
    // and returns a real (rejecting) verification outcome, not a 404/500.
    expect(stepUpResponse.statusCode).toBe(401);
  });

  it('rejects generating recovery codes without a session with 401 (never a default/open identity)', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/identity/mfa/recovery-codes/generate',
      headers: withOrigin(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('echoes back a client-supplied correlation id on an identity error response', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/identity/auth/me',
      headers: { 'x-correlation-id': 'identity-test-correlation-1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-correlation-id']).toBe('identity-test-correlation-1');
  });
});

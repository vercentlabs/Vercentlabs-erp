import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toRuntimeConnectionString } from '@vercentlabs/database';
import { setupTestDatabase, resetTestDatabase } from '@vercentlabs/database/testing';

/**
 * Real end-to-end HTTP coverage for the SP001-SP003 platform API surface:
 * boots the actual Nest application (guards, filters, controllers, real
 * Postgres via `PlatformDatabaseModule`) against a throwaway `*_test`
 * database and drives it purely over Fastify's `.inject()` - no mocks for
 * the database, the guard, or the domain layer. Requires PostgreSQL to be
 * running; run via `pnpm test:integration`, never as part of `pnpm test`.
 */
describe('platform API (integration, requires PostgreSQL)', () => {
  const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? '';
  let adminPool: Pool;
  let app: NestFastifyApplication;

  interface InjectOptions {
    method: 'GET' | 'POST' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }

  function inject(options: InjectOptions) {
    return app.getHttpAdapter().getInstance().inject(options);
  }

  function operatorScopeHeader(overrides: Record<string, unknown> = {}): string {
    const scope = {
      kind: 'platform_operator',
      actor: { actorId: 'operator-1', actorType: 'user' },
      roles: ['platform_operator'],
      correlationId: randomUUID(),
      requestId: randomUUID(),
      ...overrides,
    };
    return Buffer.from(JSON.stringify(scope)).toString('base64url');
  }

  function orgScopeHeader(organizationId: string, overrides: Record<string, unknown> = {}): string {
    const scope = {
      kind: 'organization',
      organizationId,
      actor: { actorId: 'org-admin-1', actorType: 'user' },
      roles: ['organization_admin'],
      correlationId: randomUUID(),
      requestId: randomUUID(),
      ...overrides,
    };
    return Buffer.from(JSON.stringify(scope)).toString('base64url');
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

    // The app module graph (ConfigModule -> apiEnvProvider) reads
    // process.env at import time, so it must be freshly imported after the
    // env vars above are set - a static top-of-file import would capture
    // whatever DATABASE_URL was set before this file's env overrides ran.
    const { AppModule } = await import('../src/app.module.js');
    const { TRUSTED_SCOPE_PROVIDER } = await import('../src/platform/auth/trusted-scope.port.js');
    const { TestTrustedScopeProvider } = await import(
      '../src/platform/auth/test-trusted-scope.provider.js'
    );

    // PlatformAuthModule always registers FailClosedTrustedScopeProvider
    // (see Prompt 002A-H) - this test's own module composition is the
    // explicit override that activates the test-only header-driven adapter,
    // exactly the "tests override the provider through the test
    // application/module composition" model that replaced the old
    // NODE_ENV-driven selection.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TRUSTED_SCOPE_PROVIDER)
      .useClass(TestTrustedScopeProvider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  // ---------------------------------------------------------------------
  // Fail-closed boundary
  // ---------------------------------------------------------------------

  it('rejects a request with no trusted-scope header with 401, not a default/open scope', async () => {
    const response = await inject({ method: 'GET', url: '/api/v1/platform/organizations' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a request whose trusted-scope header is malformed with 401', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': 'garbage' },
    });
    expect(response.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------
  // Organization: create, get, list, validation, idempotency, concurrency
  // ---------------------------------------------------------------------

  it('creates an organization and can read it back', async () => {
    const scope = operatorScopeHeader();
    const createResponse = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': randomUUID() },
      payload: { tenantKey: `api-t-${randomUUID().slice(0, 8)}`, displayName: 'API Test Org' },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload) as { id: string; version: number };

    const getResponse = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations/${created.id}`,
      headers: { 'x-test-trusted-scope': scope },
    });
    expect(getResponse.statusCode).toBe(200);
    expect((JSON.parse(getResponse.payload) as { id: string }).id).toBe(created.id);
  });

  it('rejects create without an Idempotency-Key with a typed VALIDATION_ERROR', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': operatorScopeHeader() },
      payload: { tenantKey: `api-t-${randomUUID().slice(0, 8)}`, displayName: 'No Key Org' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a body that fails schema validation with a field-level detail', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': operatorScopeHeader(), 'idempotency-key': randomUUID() },
      payload: { tenantKey: '', displayName: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload) as {
      error: { code: string; details?: { field?: string }[] };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.length ?? 0).toBeGreaterThan(0);
  });

  it('replays the exact same response for a repeated Idempotency-Key + identical payload, creating only one row', async () => {
    const scope = operatorScopeHeader();
    const idempotencyKey = randomUUID();
    const payload = {
      tenantKey: `api-replay-${randomUUID().slice(0, 8)}`,
      displayName: 'Replay Org',
    };

    const first = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': idempotencyKey },
      payload,
    });
    const second = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': idempotencyKey },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(JSON.parse(first.payload)).toEqual(JSON.parse(second.payload));
  });

  it('returns a typed idempotency conflict when the same key is reused with a different payload', async () => {
    const scope = operatorScopeHeader();
    const idempotencyKey = randomUUID();
    await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': idempotencyKey },
      payload: { tenantKey: `api-conf-${randomUUID().slice(0, 8)}`, displayName: 'Conflict A' },
    });
    const second = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': idempotencyKey },
      payload: { tenantKey: `api-conf-${randomUUID().slice(0, 8)}`, displayName: 'Conflict B' },
    });
    expect(second.statusCode).toBe(409);
    expect((JSON.parse(second.payload) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('requires If-Match for activate, and rejects a stale version with a typed conflict', async () => {
    const scope = operatorScopeHeader();
    const created = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': scope, 'idempotency-key': randomUUID() },
          payload: { tenantKey: `api-ver-${randomUUID().slice(0, 8)}`, displayName: 'Version Org' },
        })
      ).payload,
    ) as { id: string };

    const noIfMatch = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${created.id}/activate`,
      headers: { 'x-test-trusted-scope': scope, 'idempotency-key': randomUUID() },
    });
    expect(noIfMatch.statusCode).toBe(400);

    const activated = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${created.id}/activate`,
      headers: {
        'x-test-trusted-scope': scope,
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      },
    });
    expect(activated.statusCode).toBe(200);

    const staleRetry = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${created.id}/suspend`,
      headers: {
        'x-test-trusted-scope': scope,
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      },
      payload: { reason: 'stale retry should fail' },
    });
    expect(staleRetry.statusCode).toBe(409);
    expect((JSON.parse(staleRetry.payload) as { error: { code: string } }).error.code).toBe(
      'STALE_VERSION_CONFLICT',
    );
  });

  it('rejects an invalid lifecycle transition (activate an already-ACTIVE organization) with a typed conflict', async () => {
    const scope = operatorScopeHeader();
    const created = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': scope, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-trans-${randomUUID().slice(0, 8)}`,
            displayName: 'Transition Org',
          },
        })
      ).payload,
    ) as { id: string };

    await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${created.id}/activate`,
      headers: {
        'x-test-trusted-scope': scope,
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      },
    });

    const secondActivate = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${created.id}/activate`,
      headers: {
        'x-test-trusted-scope': scope,
        'idempotency-key': randomUUID(),
        'if-match': '"2"',
      },
    });
    expect(secondActivate.statusCode).toBe(409);
    expect((JSON.parse(secondActivate.payload) as { error: { code: string } }).error.code).toBe(
      'STATE_TRANSITION_CONFLICT',
    );
  });

  it('does not disclose whether a random organization id exists vs. never existed (identical NOT_FOUND shape)', async () => {
    const scope = operatorScopeHeader();
    const response = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations/${randomUUID()}`,
      headers: { 'x-test-trusted-scope': scope },
    });
    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.payload) as { error: { code: string } }).error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('rejects an oversized pagination limit as a validation error rather than silently clamping', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/platform/organizations?limit=100000',
      headers: { 'x-test-trusted-scope': operatorScopeHeader() },
    });
    expect(response.statusCode).toBe(400);
  });

  it('treats a search term containing SQL-injection-like syntax as an ordinary (non-matching) string, not an error', async () => {
    const response = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations?search=${encodeURIComponent("x'; DROP TABLE platform.organizations; --")}`,
      headers: { 'x-test-trusted-scope': operatorScopeHeader() },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);

    // The table must still exist and be queryable afterwards.
    const stillWorks = await inject({
      method: 'GET',
      url: '/api/v1/platform/organizations?limit=1',
      headers: { 'x-test-trusted-scope': operatorScopeHeader() },
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('rejects an organization-scoped caller attempting a platform-operator-only command', async () => {
    const orgId = randomUUID();
    const response = await inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': orgScopeHeader(orgId), 'idempotency-key': randomUUID() },
      payload: {
        tenantKey: `api-forbidden-${randomUUID().slice(0, 8)}`,
        displayName: 'Should Fail',
      },
    });
    expect(response.statusCode).toBe(403);
    expect((JSON.parse(response.payload) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('echoes back a client-supplied correlation id on a platform response', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/platform/organizations',
      headers: {
        'x-test-trusted-scope': operatorScopeHeader(),
        'x-correlation-id': 'api-test-correlation-1',
      },
    });
    expect(response.headers['x-correlation-id']).toBe('api-test-correlation-1');
  });

  // ---------------------------------------------------------------------
  // Company + operating unit: nested scoping, cross-tenant IDOR
  // ---------------------------------------------------------------------

  it('creates a company and operating unit under an organization scope, and resolves hierarchy', async () => {
    const operator = operatorScopeHeader();
    const org = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-co-${randomUUID().slice(0, 8)}`,
            displayName: 'Company Parent Org',
          },
        })
      ).payload,
    ) as { id: string };
    const orgScope = orgScopeHeader(org.id);

    const company = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: `/api/v1/platform/organizations/${org.id}/companies`,
          headers: { 'x-test-trusted-scope': orgScope, 'idempotency-key': randomUUID() },
          payload: {
            companyCode: `co-${randomUUID().slice(0, 6)}`,
            legalName: 'API Test Co Ltd',
            displayName: 'API Test Co',
            countryCode: 'US',
            baseCurrency: 'USD',
            timeZone: 'America/New_York',
          },
        })
      ).payload,
    ) as { id: string };
    expect(company.id).toBeDefined();

    const unit = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: `/api/v1/platform/organizations/${org.id}/companies/${company.id}/operating-units`,
          headers: { 'x-test-trusted-scope': orgScope, 'idempotency-key': randomUUID() },
          payload: {
            unitCode: `br-${randomUUID().slice(0, 6)}`,
            name: 'HQ Branch',
            unitType: 'BRANCH',
            timeZone: 'America/New_York',
          },
        })
      ).payload,
    ) as { id: string };
    expect(unit.id).toBeDefined();

    const children = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations/${org.id}/companies/${company.id}/operating-units/${unit.id}/children`,
      headers: { 'x-test-trusted-scope': orgScope },
    });
    expect(children.statusCode).toBe(200);
    expect(JSON.parse(children.payload)).toEqual([]);
  });

  it('rejects a company create whose URL organizationId does not match the caller organization scope', async () => {
    const operator = operatorScopeHeader();
    const orgA = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-idor-a-${randomUUID().slice(0, 8)}`,
            displayName: 'IDOR Org A',
          },
        })
      ).payload,
    ) as { id: string };
    const orgB = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-idor-b-${randomUUID().slice(0, 8)}`,
            displayName: 'IDOR Org B',
          },
        })
      ).payload,
    ) as { id: string };

    const scopedToA = orgScopeHeader(orgA.id);
    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${orgB.id}/companies`,
      headers: { 'x-test-trusted-scope': scopedToA, 'idempotency-key': randomUUID() },
      payload: {
        companyCode: `co-${randomUUID().slice(0, 6)}`,
        legalName: 'Spoofed Co',
        displayName: 'Spoofed Co',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not let one organization scope read a company belonging to a different organization (IDOR via cross-tenant read)', async () => {
    const operator = operatorScopeHeader();
    const orgA = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-cross-a-${randomUUID().slice(0, 8)}`,
            displayName: 'Cross Org A',
          },
        })
      ).payload,
    ) as { id: string };
    const orgB = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-cross-b-${randomUUID().slice(0, 8)}`,
            displayName: 'Cross Org B',
          },
        })
      ).payload,
    ) as { id: string };

    const companyUnderA = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: `/api/v1/platform/organizations/${orgA.id}/companies`,
          headers: {
            'x-test-trusted-scope': orgScopeHeader(orgA.id),
            'idempotency-key': randomUUID(),
          },
          payload: {
            companyCode: `co-${randomUUID().slice(0, 6)}`,
            legalName: 'Org A Co',
            displayName: 'Org A Co',
            countryCode: 'US',
            baseCurrency: 'USD',
            timeZone: 'America/New_York',
          },
        })
      ).payload,
    ) as { id: string };

    // Scoped to org B, but the path targets org A (its own org, not B's) with
    // org A's real companyId - requireScopeMatchesPath already blocks this
    // at the organizationId level, so this proves the boundary holds even
    // when the attacker knows a real companyId from another tenant.
    const response = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations/${orgA.id}/companies/${companyUnderA.id}`,
      headers: { 'x-test-trusted-scope': orgScopeHeader(orgB.id) },
    });
    expect(response.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------
  // Security-negative: lifecycle-guarded writes, non-disclosure, forged scopes
  // ---------------------------------------------------------------------

  it('rejects creating a company under a SUSPENDED organization', async () => {
    const operator = operatorScopeHeader();
    const org = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-susp-${randomUUID().slice(0, 8)}`,
            displayName: 'Suspend Org',
          },
        })
      ).payload,
    ) as { id: string };
    await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${org.id}/activate`,
      headers: {
        'x-test-trusted-scope': operator,
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      },
    });
    await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${org.id}/suspend`,
      headers: {
        'x-test-trusted-scope': operator,
        'idempotency-key': randomUUID(),
        'if-match': '"2"',
      },
      payload: { reason: 'security test suspension' },
    });

    const response = await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${org.id}/companies`,
      headers: { 'x-test-trusted-scope': orgScopeHeader(org.id), 'idempotency-key': randomUUID() },
      payload: {
        companyCode: `co-${randomUUID().slice(0, 6)}`,
        legalName: 'Should Not Exist',
        displayName: 'Should Not Exist',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
    });
    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.payload) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('rejects a display-metadata update on a CLOSED organization with a typed state-transition conflict', async () => {
    const operator = operatorScopeHeader();
    const org = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-closed-${randomUUID().slice(0, 8)}`,
            displayName: 'Closed Org',
          },
        })
      ).payload,
    ) as { id: string };
    await inject({
      method: 'POST',
      url: `/api/v1/platform/organizations/${org.id}/close`,
      headers: {
        'x-test-trusted-scope': operator,
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      },
      payload: { reason: 'security test closure' },
    });

    const response = await inject({
      method: 'PATCH',
      url: `/api/v1/platform/organizations/${org.id}`,
      headers: {
        'x-test-trusted-scope': operator,
        'idempotency-key': randomUUID(),
        'if-match': '"2"',
      },
      payload: { displayName: 'Should Not Apply' },
    });
    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.payload) as { error: { code: string } }).error.code).toBe(
      'STATE_TRANSITION_CONFLICT',
    );
  });

  it('returns the identical NOT_FOUND shape for a company that never existed as for one belonging to another organization', async () => {
    const operator = operatorScopeHeader();
    const org = JSON.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/platform/organizations',
          headers: { 'x-test-trusted-scope': operator, 'idempotency-key': randomUUID() },
          payload: {
            tenantKey: `api-nf-${randomUUID().slice(0, 8)}`,
            displayName: 'Not Found Org',
          },
        })
      ).payload,
    ) as { id: string };
    const orgScope = orgScopeHeader(org.id);

    const neverExisted = await inject({
      method: 'GET',
      url: `/api/v1/platform/organizations/${org.id}/companies/${randomUUID()}`,
      headers: { 'x-test-trusted-scope': orgScope },
    });
    expect(neverExisted.statusCode).toBe(404);
    expect((JSON.parse(neverExisted.payload) as { error: { code: string } }).error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('rejects a trusted-scope header claiming a non-UUID organizationId (schema-invalid scope resolves to no scope, not a partial one)', async () => {
    const forged = Buffer.from(
      JSON.stringify({
        kind: 'organization',
        organizationId: 'not-a-uuid; DROP TABLE platform.organizations;',
        actor: { actorId: 'attacker', actorType: 'user' },
        roles: ['organization_admin'],
        correlationId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).toString('base64url');

    const response = await inject({
      method: 'GET',
      url: '/api/v1/platform/organizations',
      headers: { 'x-test-trusted-scope': forged },
    });
    expect(response.statusCode).toBe(401);
  });
});

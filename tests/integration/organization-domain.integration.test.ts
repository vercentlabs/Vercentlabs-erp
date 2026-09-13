import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabaseConnection,
  IdempotencyInProgressError,
  type DatabaseConnection,
} from '@vercentlabs/database';
import { resetTestDatabase, setupTestDatabase } from '@vercentlabs/database/testing';
import {
  DomainNotFoundError,
  DomainValidationError,
  IdempotencyPayloadConflictError,
  StaleVersionConflictError,
  StateTransitionConflictError,
  type PlatformOperatorScope,
} from '@vercentlabs/contracts';
import {
  activateOrganization,
  closeOrganization,
  createOrganization,
  suspendOrganization,
} from '@vercentlabs/platform-tenancy';
import { requireTestDatabaseUrl, toRuntimeConnectionString } from './lib/db-helpers.js';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

function operatorScope(overrides: Partial<PlatformOperatorScope> = {}): PlatformOperatorScope {
  return {
    kind: 'platform_operator',
    actor: { actorId: `operator-${randomUUID()}`, actorType: 'user' },
    roles: ['platform_operator'],
    correlationId: `corr-${randomUUID()}`,
    requestId: `req-${randomUUID()}`,
    ...overrides,
  };
}

describe('organization domain (integration, requires PostgreSQL)', () => {
  let adminPool: Pool;
  let runtime: DatabaseConnection;

  beforeAll(async () => {
    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;
    runtime = createDatabaseConnection(toRuntimeConnectionString(TEST_DATABASE_URL));
  });

  afterAll(async () => {
    await runtime.close();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  it('creates an organization and writes audit + outbox evidence atomically', async () => {
    const scope = operatorScope();
    const tenantKey = `ACME-${randomUUID().slice(0, 8).toUpperCase()}`;

    const result = await createOrganization(runtime.db, {
      scope,
      request: { tenantKey, displayName: 'Acme Inc' },
      idempotencyKey: randomUUID(),
    });

    expect(result.status).toBe(201);
    expect(result.body.tenantKey).toBe(tenantKey);
    expect(result.body.status).toBe('DRAFT');
    expect(result.body.version).toBe(1);

    const { rows: auditRows } = await adminPool.query(
      `SELECT action, target_id, correlation_id FROM audit.audit_events WHERE target_id = $1`,
      [result.body.id],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('organization.create');
    expect(auditRows[0].correlation_id).toBe(scope.correlationId);

    const { rows: outboxRows } = await adminPool.query(
      `SELECT event_type, aggregate_id FROM integration.outbox_events WHERE aggregate_id = $1`,
      [result.body.id],
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].event_type).toBe('organization.created');
  });

  it('rejects a duplicate tenantKey without creating a second row', async () => {
    const scope = operatorScope();
    const tenantKey = `DUPE-${randomUUID().slice(0, 8).toUpperCase()}`;

    await createOrganization(runtime.db, {
      scope,
      request: { tenantKey, displayName: 'First' },
      idempotencyKey: randomUUID(),
    });

    await expect(
      createOrganization(runtime.db, {
        scope,
        request: { tenantKey, displayName: 'Second' },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(DomainValidationError);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM platform.organizations WHERE tenant_key = $1`,
      [tenantKey],
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects an invalid lifecycle transition before any side effect', async () => {
    const scope = operatorScope();
    const created = await createOrganization(runtime.db, {
      scope,
      request: {
        tenantKey: `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`,
        displayName: 'Still Draft',
      },
      idempotencyKey: randomUUID(),
    });

    // DRAFT cannot be suspended - only ACTIVE can.
    await expect(
      suspendOrganization(runtime.db, {
        scope,
        organizationId: created.body.id,
        expectedVersion: created.body.version,
        request: { reason: 'attempted invalid transition' },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(StateTransitionConflictError);

    const { rows } = await adminPool.query(
      `SELECT status, version FROM platform.organizations WHERE id = $1`,
      [created.body.id],
    );
    expect(rows[0].status).toBe('DRAFT');
    expect(rows[0].version).toBe(1);
  });

  it('returns a typed stale-version conflict and does not record a successful effect', async () => {
    const scope = operatorScope();
    const created = await createOrganization(runtime.db, {
      scope,
      request: {
        tenantKey: `STALE-${randomUUID().slice(0, 8).toUpperCase()}`,
        displayName: 'Stale Target',
      },
      idempotencyKey: randomUUID(),
    });

    await expect(
      activateOrganization(runtime.db, {
        scope,
        organizationId: created.body.id,
        expectedVersion: created.body.version + 1, // wrong on purpose
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(StaleVersionConflictError);

    const { rows } = await adminPool.query(
      `SELECT status, version FROM platform.organizations WHERE id = $1`,
      [created.body.id],
    );
    expect(rows[0].status).toBe('DRAFT');
    expect(rows[0].version).toBe(1);
  });

  it('reports not-found for a nonexistent organization id', async () => {
    await expect(
      activateOrganization(runtime.db, {
        scope: operatorScope(),
        organizationId: randomUUID(),
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(DomainNotFoundError);
  });

  it('replays the exact same result for a repeated Idempotency-Key and identical payload', async () => {
    const scope = operatorScope();
    const tenantKey = `IDEM-${randomUUID().slice(0, 8).toUpperCase()}`;
    const idempotencyKey = randomUUID();
    const request = { tenantKey, displayName: 'Idempotent Co' };

    const first = await createOrganization(runtime.db, { scope, request, idempotencyKey });
    const second = await createOrganization(runtime.db, { scope, request, idempotencyKey });

    expect(second).toEqual(first);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM platform.organizations WHERE tenant_key = $1`,
      [tenantKey],
    );
    expect(rows[0].n).toBe(1);
  });

  it('returns a typed conflict when the same Idempotency-Key is reused with a different payload', async () => {
    const scope = operatorScope();
    const idempotencyKey = randomUUID();

    await createOrganization(runtime.db, {
      scope,
      request: {
        tenantKey: `PAYLOAD-A-${randomUUID().slice(0, 6).toUpperCase()}`,
        displayName: 'A',
      },
      idempotencyKey,
    });

    await expect(
      createOrganization(runtime.db, {
        scope,
        request: {
          tenantKey: `PAYLOAD-B-${randomUUID().slice(0, 6).toUpperCase()}`,
          displayName: 'B',
        },
        idempotencyKey,
      }),
    ).rejects.toThrow(IdempotencyPayloadConflictError);
  });

  it('lets only one of two concurrent same-version lifecycle requests succeed', async () => {
    const scope = operatorScope();
    const created = await createOrganization(runtime.db, {
      scope,
      request: {
        tenantKey: `RACE-${randomUUID().slice(0, 8).toUpperCase()}`,
        displayName: 'Race Target',
      },
      idempotencyKey: randomUUID(),
    });

    const results = await Promise.allSettled([
      activateOrganization(runtime.db, {
        scope,
        organizationId: created.body.id,
        expectedVersion: created.body.version,
        idempotencyKey: randomUUID(),
      }),
      activateOrganization(runtime.db, {
        scope,
        organizationId: created.body.id,
        expectedVersion: created.body.version,
        idempotencyKey: randomUUID(),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleVersionConflictError);

    const { rows } = await adminPool.query(
      `SELECT status, version FROM platform.organizations WHERE id = $1`,
      [created.body.id],
    );
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].version).toBe(2);
  });

  it('produces exactly one effect for two truly concurrent requests sharing the same Idempotency-Key', async () => {
    const scope = operatorScope();
    const tenantKey = `CONCURRENT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const idempotencyKey = randomUUID();
    const request = { tenantKey, displayName: 'Concurrent Co' };

    const results = await Promise.allSettled([
      createOrganization(runtime.db, { scope, request, idempotencyKey }),
      createOrganization(runtime.db, { scope, request, idempotencyKey }),
    ]);

    const outcomes = results.map((r) =>
      r.status === 'fulfilled'
        ? { ok: true as const, value: r.value }
        : { ok: false as const, error: r.reason },
    );
    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);

    // Either both observe the same single successful creation, or one
    // succeeds and the other is told to retry - either way, exactly one
    // organization row must exist.
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    for (const outcome of failed) {
      expect((outcome as { error: unknown }).error).toBeInstanceOf(IdempotencyInProgressError);
    }

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM platform.organizations WHERE tenant_key = $1`,
      [tenantKey],
    );
    expect(rows[0].n).toBe(1);
  });

  it('closure preserves the row - no physical delete path exists', async () => {
    const scope = operatorScope();
    const created = await createOrganization(runtime.db, {
      scope,
      request: {
        tenantKey: `CLOSE-${randomUUID().slice(0, 8).toUpperCase()}`,
        displayName: 'To Be Closed',
      },
      idempotencyKey: randomUUID(),
    });

    const closed = await closeOrganization(runtime.db, {
      scope,
      organizationId: created.body.id,
      expectedVersion: created.body.version,
      request: { reason: 'end of life for this test fixture' },
      idempotencyKey: randomUUID(),
    });

    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.closedAt).not.toBeNull();

    const { rows } = await adminPool.query(
      `SELECT status FROM platform.organizations WHERE id = $1`,
      [created.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CLOSED');

    // CLOSED is terminal.
    await expect(
      activateOrganization(runtime.db, {
        scope,
        organizationId: created.body.id,
        expectedVersion: closed.body.version,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(StateTransitionConflictError);
  });
});

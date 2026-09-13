import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseConnection, type DatabaseConnection } from '@vercentlabs/database';
import { resetTestDatabase, setupTestDatabase } from '@vercentlabs/database/testing';
import {
  DomainNotFoundError,
  DomainValidationError,
  StateTransitionConflictError,
  type OrganizationScope,
  type PlatformOperatorScope,
} from '@vercentlabs/contracts';
import { createOrganization } from '@vercentlabs/platform-tenancy';
import {
  activateCompany,
  activateOperatingUnit,
  closeCompany,
  createCompany,
  createOperatingUnit,
  deactivateCompany,
  resolveOperatingUnitChildren,
} from '@vercentlabs/platform-organization';
import { requireTestDatabaseUrl, toRuntimeConnectionString } from './lib/db-helpers.js';

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

function orgScope(
  organizationId: string,
  overrides: Partial<OrganizationScope> = {},
): OrganizationScope {
  return {
    kind: 'organization',
    organizationId,
    actor: { actorId: `user-${randomUUID()}`, actorType: 'user' },
    roles: ['member'],
    correlationId: `corr-${randomUUID()}`,
    requestId: `req-${randomUUID()}`,
    ...overrides,
  };
}

describe('company/operating-unit domain (integration, requires PostgreSQL)', () => {
  let adminPool: Pool;
  let runtime: DatabaseConnection;
  let organizationId: string;

  beforeAll(async () => {
    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;
    runtime = createDatabaseConnection(toRuntimeConnectionString(TEST_DATABASE_URL));

    const created = await createOrganization(runtime.db, {
      scope: operatorScope(),
      request: {
        tenantKey: `HOST-${randomUUID().slice(0, 8).toUpperCase()}`,
        displayName: 'Host Org',
      },
      idempotencyKey: randomUUID(),
    });
    organizationId = created.body.id;
  });

  afterAll(async () => {
    await runtime.close();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  it('creates a company with validated ISO fields and writes audit + outbox evidence', async () => {
    const scope = orgScope(organizationId);
    const companyCode = `CO-${randomUUID().slice(0, 8).toUpperCase()}`;

    const result = await createCompany(runtime.db, {
      scope,
      request: {
        companyCode,
        legalName: 'Acme Trading LLC',
        displayName: 'Acme Trading',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
      idempotencyKey: randomUUID(),
    });

    expect(result.status).toBe(201);
    expect(result.body.companyCode).toBe(companyCode);
    expect(result.body.status).toBe('DRAFT');

    const { rows: auditRows } = await adminPool.query(
      `SELECT action FROM audit.audit_events WHERE target_id = $1`,
      [result.body.id],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('company.create');

    const { rows: outboxRows } = await adminPool.query(
      `SELECT event_type FROM integration.outbox_events WHERE aggregate_id = $1`,
      [result.body.id],
    );
    expect(outboxRows).toHaveLength(1);
  });

  it('rejects a company creation request scoped to a different organization', async () => {
    const wrongScope = orgScope(randomUUID());
    await expect(
      createCompany(runtime.db, {
        scope: wrongScope,
        request: {
          companyCode: `WRONG-${randomUUID().slice(0, 6).toUpperCase()}`,
          legalName: 'Should Not Exist',
          displayName: 'Should Not Exist',
          countryCode: 'US',
          baseCurrency: 'USD',
          timeZone: 'America/New_York',
        },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(DomainNotFoundError);
  });

  it('creates an operating unit under a company and resolves its parent/child hierarchy', async () => {
    const scope = orgScope(organizationId);
    const company = await createCompany(runtime.db, {
      scope,
      request: {
        companyCode: `HQ-${randomUUID().slice(0, 8).toUpperCase()}`,
        legalName: 'HQ Legal',
        displayName: 'HQ',
        countryCode: 'IN',
        baseCurrency: 'INR',
        timeZone: 'Asia/Kolkata',
      },
      idempotencyKey: randomUUID(),
    });

    const parentUnit = await createOperatingUnit(runtime.db, {
      scope,
      companyId: company.body.id,
      request: {
        unitCode: `HQ-BR-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Head Office',
        unitType: 'BRANCH',
        timeZone: 'Asia/Kolkata',
      },
      idempotencyKey: randomUUID(),
    });
    expect(parentUnit.status).toBe(201);
    expect(parentUnit.body.unitType).toBe('BRANCH');

    const childUnit = await createOperatingUnit(runtime.db, {
      scope,
      companyId: company.body.id,
      request: {
        unitCode: `HQ-DESK-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Sales Desk',
        unitType: 'OPERATING_UNIT',
        parentOperatingUnitId: parentUnit.body.id,
        timeZone: 'Asia/Kolkata',
      },
      idempotencyKey: randomUUID(),
    });
    expect(childUnit.body.parentOperatingUnitId).toBe(parentUnit.body.id);

    const children = await resolveOperatingUnitChildren(runtime.db, {
      scope,
      organizationId,
      operatingUnitId: parentUnit.body.id,
    });
    expect(children.map((c) => c.id)).toEqual([childUnit.body.id]);
  });

  it('rejects an operating unit whose parent belongs to a different company', async () => {
    const scope = orgScope(organizationId);
    const companyA = await createCompany(runtime.db, {
      scope,
      request: {
        companyCode: `A-${randomUUID().slice(0, 8).toUpperCase()}`,
        legalName: 'Company A',
        displayName: 'Company A',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
      idempotencyKey: randomUUID(),
    });
    const companyB = await createCompany(runtime.db, {
      scope,
      request: {
        companyCode: `B-${randomUUID().slice(0, 8).toUpperCase()}`,
        legalName: 'Company B',
        displayName: 'Company B',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
      idempotencyKey: randomUUID(),
    });

    const unitInA = await createOperatingUnit(runtime.db, {
      scope,
      companyId: companyA.body.id,
      request: {
        unitCode: `A-UNIT-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'A Unit',
        unitType: 'SITE',
        timeZone: 'America/New_York',
      },
      idempotencyKey: randomUUID(),
    });

    await expect(
      createOperatingUnit(runtime.db, {
        scope,
        companyId: companyB.body.id,
        request: {
          unitCode: `B-UNIT-${randomUUID().slice(0, 6).toUpperCase()}`,
          name: 'B Unit',
          unitType: 'SITE',
          parentOperatingUnitId: unitInA.body.id,
          timeZone: 'America/New_York',
        },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(DomainValidationError);
  });

  it('enforces the company lifecycle: cannot close directly from ACTIVE', async () => {
    const scope = orgScope(organizationId);
    const company = await createCompany(runtime.db, {
      scope,
      request: {
        companyCode: `LIFE-${randomUUID().slice(0, 8).toUpperCase()}`,
        legalName: 'Lifecycle Co',
        displayName: 'Lifecycle Co',
        countryCode: 'US',
        baseCurrency: 'USD',
        timeZone: 'America/New_York',
      },
      idempotencyKey: randomUUID(),
    });

    const activated = await activateCompany(runtime.db, {
      scope,
      organizationId,
      companyId: company.body.id,
      expectedVersion: company.body.version,
      idempotencyKey: randomUUID(),
    });
    expect(activated.body.status).toBe('ACTIVE');

    await expect(
      closeCompany(runtime.db, {
        scope,
        organizationId,
        companyId: company.body.id,
        expectedVersion: activated.body.version,
        request: { reason: 'attempted direct close from ACTIVE' },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(StateTransitionConflictError);

    const deactivated = await deactivateCompany(runtime.db, {
      scope,
      organizationId,
      companyId: company.body.id,
      expectedVersion: activated.body.version,
      request: { reason: 'preparing for closure' },
      idempotencyKey: randomUUID(),
    });
    expect(deactivated.body.status).toBe('INACTIVE');

    const closed = await closeCompany(runtime.db, {
      scope,
      organizationId,
      companyId: company.body.id,
      expectedVersion: deactivated.body.version,
      request: { reason: 'end of life' },
      idempotencyKey: randomUUID(),
    });
    expect(closed.body.status).toBe('CLOSED');
  });

  it('rejects activating an operating unit that does not exist', async () => {
    await expect(
      activateOperatingUnit(runtime.db, {
        scope: orgScope(organizationId),
        organizationId,
        operatingUnitId: randomUUID(),
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(DomainNotFoundError);
  });
});

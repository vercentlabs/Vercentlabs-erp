import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetTestDatabase, setupTestDatabase } from '@vercentlabs/database/testing';
import { requireTestDatabaseUrl, toRuntimeConnectionString } from './lib/db-helpers.js';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

async function withScope<T>(
  pool: Pool,
  organizationId: string | null,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (organizationId) {
      await client.query(`SET LOCAL app.current_organization_id = '${organizationId}'`);
    } else {
      await client.query(`SET LOCAL app.current_organization_id = ''`);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('tenant isolation via PostgreSQL RLS (integration, requires real PostgreSQL)', () => {
  let adminPool: Pool;
  let runtimePool: Pool;
  let platformAdminPool: Pool;
  let orgA: string;
  let orgB: string;
  let companyInA: string;

  beforeAll(async () => {
    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;
    runtimePool = new Pool({ connectionString: toRuntimeConnectionString(TEST_DATABASE_URL) });
    platformAdminPool = new Pool({
      connectionString: toRuntimeConnectionString(TEST_DATABASE_URL, {
        user: 'erp_platform_admin',
        password: 'erp_platform_admin_dev_password',
      }),
    });

    const insertOrg = async (tenantKey: string) => {
      const { rows } = await adminPool.query(
        `INSERT INTO platform.organizations (tenant_key, display_name, status, created_by, updated_by)
         VALUES ($1, $2, 'ACTIVE', 'test-admin', 'test-admin') RETURNING id`,
        [tenantKey, tenantKey],
      );
      return rows[0].id as string;
    };
    orgA = await insertOrg(`RLS-A-${randomUUID().slice(0, 8).toUpperCase()}`);
    orgB = await insertOrg(`RLS-B-${randomUUID().slice(0, 8).toUpperCase()}`);

    const { rows } = await adminPool.query(
      `INSERT INTO platform.companies (organization_id, company_code, legal_name, display_name, country_code, base_currency, time_zone, created_by, updated_by)
       VALUES ($1, 'CO1', 'Company In A', 'Company In A', 'US', 'USD', 'America/New_York', 'test-admin', 'test-admin') RETURNING id`,
      [orgA],
    );
    companyInA = rows[0].id as string;
  });

  afterAll(async () => {
    await runtimePool.end();
    await platformAdminPool.end();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  it('org A can see its own company under its own context', async () => {
    const rows = await withScope(runtimePool, orgA, (client) =>
      client
        .query('SELECT id FROM platform.companies WHERE id = $1', [companyInA])
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);
  });

  it('org B cannot see a company that belongs to org A (cross-tenant read denied)', async () => {
    const rows = await withScope(runtimePool, orgB, (client) =>
      client
        .query('SELECT id FROM platform.companies WHERE id = $1', [companyInA])
        .then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);

    const all = await withScope(runtimePool, orgB, (client) =>
      client.query('SELECT id FROM platform.companies').then((r) => r.rows),
    );
    expect(all).toHaveLength(0);
  });

  it('org B cannot write to a company row owned by org A (cross-tenant write denied)', async () => {
    await expect(
      withScope(runtimePool, orgB, (client) =>
        client.query(`UPDATE platform.companies SET display_name = 'hacked' WHERE id = $1`, [
          companyInA,
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 }); // RLS filters the row out of the UPDATE's WHERE match entirely

    const { rows } = await adminPool.query(
      'SELECT display_name FROM platform.companies WHERE id = $1',
      [companyInA],
    );
    expect(rows[0].display_name).toBe('Company In A');
  });

  it('a completely missing tenant context sees no organization-scoped rows (fails closed, not open)', async () => {
    const client = await runtimePool.connect();
    try {
      // No SET LOCAL at all in this transaction.
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id FROM platform.companies');
      expect(rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('a malformed tenant context is rejected rather than silently bypassed', async () => {
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_organization_id = 'not-a-uuid'`);
      await expect(client.query('SELECT id FROM platform.companies')).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('tenant context set via SET LOCAL does not survive past the transaction on a pooled connection reused by another org', async () => {
    // Acquire a single physical connection and reuse it across two
    // back-to-back transactions with different org contexts, the same way
    // pnpm's pool would hand the same socket to two unrelated requests.
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_organization_id = '${orgA}'`);
      const scopedToA = await client.query('SELECT id FROM platform.companies');
      expect(scopedToA.rows).toHaveLength(1);
      await client.query('COMMIT');

      // New transaction, same physical connection/socket, no SET LOCAL yet.
      await client.query('BEGIN');
      const beforeAnySet = await client.query('SELECT id FROM platform.companies');
      expect(beforeAnySet.rows).toHaveLength(0); // org A's context did NOT leak forward
      await client.query(`SET LOCAL app.current_organization_id = '${orgB}'`);
      const scopedToB = await client.query('SELECT id FROM platform.companies');
      expect(scopedToB.rows).toHaveLength(0); // org B genuinely has none
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('two organizations interleaved across the pool never observe each other, including under concurrent load', async () => {
    const attempts = Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? orgA : orgB));
    const results = await Promise.all(
      attempts.map((organizationId) =>
        withScope(runtimePool, organizationId, (client) =>
          client.query('SELECT organization_id FROM platform.companies').then((r) => r.rows),
        ),
      ),
    );

    results.forEach((rows, index) => {
      const expectedOrg = attempts[index];
      for (const row of rows) {
        expect(row.organization_id).toBe(expectedOrg);
      }
      if (expectedOrg === orgB) {
        expect(rows).toHaveLength(0);
      }
    });
  });

  it('the runtime role cannot delete or bypass append-only audit rows via direct SQL', async () => {
    await adminPool.query(
      `INSERT INTO audit.audit_events (organization_id, actor_id, actor_type, action, target_type, target_id, correlation_id, request_id)
       VALUES ($1, 'test-admin', 'system', 'test.seed', 'Test', 'seed-1', 'corr-seed', 'req-seed')`,
      [orgA],
    );

    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(`DELETE FROM audit.audit_events WHERE organization_id = $1`, [orgA]),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(
          `UPDATE audit.audit_events SET action = 'tampered' WHERE organization_id = $1`,
          [orgA],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the runtime role cannot mutate the immutable company_code column via direct SQL', async () => {
    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(`UPDATE platform.companies SET company_code = 'HACKED' WHERE id = $1`, [
          companyInA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

/**
 * Prompt 002A-H: platform.organizations hardening. These prove the exact
 * findings recorded in product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md -
 * before database/migrations/platform/0007_harden_organizations_tenant_boundary.sql,
 * every one of the "cannot" assertions below actually succeeded.
 */
describe('platform.organizations tenant-boundary hardening (integration, requires real PostgreSQL)', () => {
  let adminPool: Pool;
  let runtimePool: Pool;
  let platformAdminPool: Pool;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const handle = await setupTestDatabase(TEST_DATABASE_URL);
    adminPool = handle.pool;
    runtimePool = new Pool({ connectionString: toRuntimeConnectionString(TEST_DATABASE_URL) });
    platformAdminPool = new Pool({
      connectionString: toRuntimeConnectionString(TEST_DATABASE_URL, {
        user: 'erp_platform_admin',
        password: 'erp_platform_admin_dev_password',
      }),
    });

    const insertOrg = async (tenantKey: string) => {
      const { rows } = await adminPool.query(
        `INSERT INTO platform.organizations (tenant_key, display_name, status, created_by, updated_by)
         VALUES ($1, $2, 'ACTIVE', 'test-admin', 'test-admin') RETURNING id`,
        [tenantKey, tenantKey],
      );
      return rows[0].id as string;
    };
    orgA = await insertOrg(`ORG-RLS-A-${randomUUID().slice(0, 8).toUpperCase()}`);
    orgB = await insertOrg(`ORG-RLS-B-${randomUUID().slice(0, 8).toUpperCase()}`);
  });

  afterAll(async () => {
    await runtimePool.end();
    await platformAdminPool.end();
    await resetTestDatabase(adminPool, TEST_DATABASE_URL);
    await adminPool.end();
  });

  it('erp_runtime with no organization context sees zero organizations (fails closed, not open)', async () => {
    const rows = await withScope(runtimePool, null, (client) =>
      client.query('SELECT id FROM platform.organizations').then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it('erp_runtime scoped to A cannot read organization B by id, and can read its own row', async () => {
    const readsB = await withScope(runtimePool, orgA, (client) =>
      client
        .query('SELECT id FROM platform.organizations WHERE id = $1', [orgB])
        .then((r) => r.rows),
    );
    expect(readsB).toHaveLength(0);

    const readsOwn = await withScope(runtimePool, orgA, (client) =>
      client
        .query('SELECT id FROM platform.organizations WHERE id = $1', [orgA])
        .then((r) => r.rows),
    );
    expect(readsOwn).toHaveLength(1);
  });

  it('erp_runtime scoped to A cannot update organization B (RLS + revoked write grants both apply)', async () => {
    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(`UPDATE platform.organizations SET display_name = 'hacked' WHERE id = $1`, [
          orgB,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);

    const { rows } = await adminPool.query(
      'SELECT display_name FROM platform.organizations WHERE id = $1',
      [orgB],
    );
    expect(rows[0].display_name).not.toBe('hacked');
  });

  it('erp_runtime cannot insert an organization directly, scoped or not (direct-table attack fails)', async () => {
    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(
          `INSERT INTO platform.organizations (tenant_key, display_name, status, created_by, updated_by)
           VALUES ('DIRECT-ATTACK', 'Direct Attack', 'DRAFT', 'attacker', 'attacker')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('erp_runtime cannot change tenant_key even for its own scoped organization (immutable identity)', async () => {
    await expect(
      withScope(runtimePool, orgA, (client) =>
        client.query(`UPDATE platform.organizations SET tenant_key = 'HACKED-KEY' WHERE id = $1`, [
          orgA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('erp_platform_admin can read and update organizations across tenants (its intended cross-tenant operation)', async () => {
    const client = await platformAdminPool.connect();
    try {
      await client.query('BEGIN');
      const all = await client.query('SELECT id FROM platform.organizations WHERE id IN ($1, $2)', [
        orgA,
        orgB,
      ]);
      expect(all.rows).toHaveLength(2);
      const updated = await client.query(
        `UPDATE platform.organizations SET display_name = 'Updated By Admin' WHERE id = $1`,
        [orgB],
      );
      expect(updated.rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('erp_platform_admin cannot change tenant_key (immutable identity holds for the admin role too)', async () => {
    const client = await platformAdminPool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(
          `UPDATE platform.organizations SET tenant_key = 'ADMIN-HACKED' WHERE id = $1`,
          [orgA],
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('erp_platform_admin has no grant at all on platform.companies or platform.operating_units (tenant/platform pools cannot be confused)', async () => {
    // Two separate transactions: a permission-denied error aborts whatever
    // transaction it happened in, so a second statement in that same
    // transaction would fail with "current transaction is aborted" instead
    // of its own real error - each check needs its own transaction.
    await expect(
      (async () => {
        const client = await platformAdminPool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT id FROM platform.companies LIMIT 1');
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
      })(),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      (async () => {
        const client = await platformAdminPool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT id FROM platform.operating_units LIMIT 1');
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
      })(),
    ).rejects.toThrow(/permission denied/i);
  });

  it("erp_runtime has no INSERT/UPDATE grant on platform.organizations at all (tenant pool cannot perform the platform pool's job)", async () => {
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_organization_id = '${orgA}'`);
      await expect(
        client.query(`UPDATE platform.organizations SET display_name = 'x' WHERE id = $1`, [orgA]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('scope set via SET LOCAL on the platform-admin connection does not affect its (unconditional) visibility, and does not leak to the next transaction on a reused connection', async () => {
    const client = await platformAdminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_organization_id = '${orgA}'`);
      const withScopeSet = await client.query(
        'SELECT id FROM platform.organizations WHERE id = $1',
        [orgB],
      );
      expect(withScopeSet.rows).toHaveLength(1); // admin policy is USING(true), unaffected by this setting
      await client.query('COMMIT');

      // New transaction, same physical connection, no SET LOCAL this time -
      // still sees everything, proving no lingering per-connection state
      // from the previous transaction was required or leaked.
      await client.query('BEGIN');
      const withoutScope = await client.query(
        'SELECT id FROM platform.organizations WHERE id = $1',
        [orgB],
      );
      expect(withoutScope.rows).toHaveLength(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});

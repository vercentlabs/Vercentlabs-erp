import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetTestDatabase, setupTestDatabase } from '@vercentlabs/database/testing';

/**
 * Requires PostgreSQL to actually be running (see infrastructure/docker-compose.yml)
 * with a `vercentlabs_erp_test` database available. Run via `pnpm test:integration`.
 */
describe('platform/tenant migration bootstrap (integration, requires PostgreSQL)', () => {
  const connectionString = process.env['TEST_DATABASE_URL'] ?? '';
  let pool: Pool;

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error('TEST_DATABASE_URL must be set to run tests/integration.');
    }
    const handle = await setupTestDatabase(connectionString);
    pool = handle.pool;
  });

  afterAll(async () => {
    await resetTestDatabase(pool, connectionString);
    await pool.end();
  });

  it('creates the platform and tenant schemas', async () => {
    const { rows } = await pool.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('platform', 'tenant')`,
    );
    expect(rows.map((row) => row.schema_name).sort()).toEqual(['platform', 'tenant']);
  });

  it('records applied bootstrap migrations in each schema bookkeeping table', async () => {
    const platform = await pool.query<{ id: string }>(`SELECT id FROM platform._migrations`);
    const tenant = await pool.query<{ id: string }>(`SELECT id FROM tenant._migrations`);
    expect(platform.rows.map((row) => row.id)).toContain('0000_bootstrap_platform_schema.sql');
    expect(tenant.rows.map((row) => row.id)).toContain('0000_bootstrap_tenant_schema.sql');
  });

  it('creates no business-module tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema IN ('platform', 'tenant')`,
    );
    const nonBookkeepingTables = rows.filter((row) => row.table_name !== '_migrations');
    expect(nonBookkeepingTables).toEqual([]);
  });
});

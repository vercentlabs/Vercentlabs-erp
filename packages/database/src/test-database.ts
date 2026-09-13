import pg from 'pg';
import type { Pool } from 'pg';
import { runMigrations } from './migration-runner.js';
import { PLATFORM_MIGRATIONS_DIR, TENANT_MIGRATIONS_DIR } from './migration-paths.js';

// See packages/database/src/connection.ts for why this isn't a named import.
const { Pool: PoolCtor } = pg;

export interface TestDatabaseHandle {
  pool: Pool;
  close(): Promise<void>;
}

/**
 * Refuses to operate against anything whose database name does not contain
 * "test", so a typo'd connection string can never point this helper's
 * schema-dropping behavior at a real database.
 */
export function assertTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\//, '');
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run test-database operations against database "${databaseName}". ` +
        'The database name must contain "test" to prevent accidental use of a real database.',
    );
  }
}

export async function setupTestDatabase(connectionString: string): Promise<TestDatabaseHandle> {
  assertTestDatabase(connectionString);
  const pool = new PoolCtor({ connectionString });
  await runMigrations(pool, {
    scope: 'platform',
    directory: PLATFORM_MIGRATIONS_DIR,
    schema: 'platform',
  });
  await runMigrations(pool, {
    scope: 'tenant',
    directory: TENANT_MIGRATIONS_DIR,
    schema: 'tenant',
  });
  return { pool, close: () => pool.end() };
}

/**
 * Drops every schema a migration file can create, so the next test suite
 * starts clean. `platform._migrations` (the bookkeeping table for every
 * migration under database/migrations/platform, including the ones that
 * create the `audit`/`integration` schemas) lives inside the `platform`
 * schema - dropping `platform` without also dropping `audit`/`integration`
 * would wipe that bookkeeping while leaving their tables behind, so a later
 * `setupTestDatabase` call would fail replaying migrations against
 * already-existing objects. Keep this list in sync with every schema a
 * platform migration creates.
 */
export async function resetTestDatabase(pool: Pool, connectionString: string): Promise<void> {
  assertTestDatabase(connectionString);
  await pool.query('DROP SCHEMA IF EXISTS platform CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS tenant CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS audit CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS integration CASCADE');
}

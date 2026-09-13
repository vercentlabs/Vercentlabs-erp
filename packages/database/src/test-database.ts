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

/** Drops and recreates the platform/tenant schemas so the next test suite starts clean. */
export async function resetTestDatabase(pool: Pool, connectionString: string): Promise<void> {
  assertTestDatabase(connectionString);
  await pool.query('DROP SCHEMA IF EXISTS platform CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS tenant CASCADE');
}

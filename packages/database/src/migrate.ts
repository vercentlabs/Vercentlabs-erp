import pg from 'pg';
import { runMigrations, type MigrationTarget } from './migration-runner.js';

// See packages/database/src/connection.ts for why this isn't a named import.
const { Pool } = pg;
import { PLATFORM_MIGRATIONS_DIR, TENANT_MIGRATIONS_DIR } from './migration-paths.js';

type Scope = 'platform' | 'tenant' | 'all';

function parseScope(argv: string[]): Scope {
  const arg = argv.find((entry) => entry.startsWith('--scope='));
  const value = arg?.split('=')[1] ?? 'all';
  if (value !== 'platform' && value !== 'tenant' && value !== 'all') {
    throw new Error(`Unknown --scope value: "${value}". Expected platform, tenant or all.`);
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const scope = parseScope(process.argv.slice(2));
  const pool = new Pool({ connectionString });

  try {
    const targets: MigrationTarget[] = [];
    if (scope === 'platform' || scope === 'all') {
      targets.push({
        scope: 'platform',
        directory: PLATFORM_MIGRATIONS_DIR,
        schema: process.env['PLATFORM_DATABASE_SCHEMA'] ?? 'platform',
      });
    }
    if (scope === 'tenant' || scope === 'all') {
      targets.push({
        scope: 'tenant',
        directory: TENANT_MIGRATIONS_DIR,
        schema: process.env['TENANT_DATABASE_SCHEMA'] ?? 'tenant',
      });
    }

    for (const target of targets) {
      const result = await runMigrations(pool, target);
      // eslint-disable-next-line no-console
      console.log(
        `[migrate] ${result.scope}: applied=${result.applied.length} skipped=${result.skipped.length}`,
      );
      if (result.applied.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[migrate] ${result.scope} applied: ${result.applied.join(', ')}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] failed:', error);
  process.exitCode = 1;
});

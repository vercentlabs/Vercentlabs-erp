import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export interface MigrationTarget {
  scope: 'platform' | 'tenant';
  directory: string;
  schema: string;
}

export interface MigrationResult {
  scope: string;
  applied: string[];
  skipped: string[];
}

function assertSafeIdentifier(identifier: string, kind: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe ${kind} identifier: "${identifier}"`);
  }
}

async function ensureBookkeepingTable(pool: Pool, schema: string): Promise<void> {
  assertSafeIdentifier(schema, 'schema');
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."_migrations" (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

/**
 * Applies pending `.sql` files from `target.directory` in lexical order,
 * recording each applied file in a `<schema>._migrations` bookkeeping table
 * so re-runs are idempotent. Each file runs inside its own transaction.
 */
export async function runMigrations(pool: Pool, target: MigrationTarget): Promise<MigrationResult> {
  await ensureBookkeepingTable(pool, target.schema);

  const entries = (await readdir(target.directory)).filter((file) => file.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM "${target.schema}"."_migrations"`,
  );
  const appliedIds = new Set(rows.map((row) => row.id));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const fileName of entries) {
    if (appliedIds.has(fileName)) {
      skipped.push(fileName);
      continue;
    }

    const sql = await readFile(path.join(target.directory, fileName), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO "${target.schema}"."_migrations" (id) VALUES ($1)`, [
        fileName,
      ]);
      await client.query('COMMIT');
      applied.push(fileName);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration failed: ${fileName}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  return { scope: target.scope, applied, skipped };
}

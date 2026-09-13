import pg from 'pg';
import type { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

// pg is CommonJS without a statically-analyzable named export, so Node's ESM
// loader cannot do `import { Pool } from 'pg'` at runtime - only the default
// (whole-module) import is reliable. See
// https://nodejs.org/api/esm.html#commonjs-namespaces.
const { Pool: PoolCtor } = pg;

export interface DatabaseConnection {
  pool: Pool;
  db: NodePgDatabase;
  close(): Promise<void>;
}

export function createDatabaseConnection(connectionString: string): DatabaseConnection {
  const pool = new PoolCtor({ connectionString });
  const db = drizzle(pool);
  return {
    pool,
    db,
    close: () => pool.end(),
  };
}

export async function checkDatabaseReady(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

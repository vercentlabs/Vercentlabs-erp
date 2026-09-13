import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Runs `fn` inside a single database transaction, committing on success and
 * rolling back on any thrown error. Every write that must be atomic with an
 * audit record, outbox event or idempotency record must go through this
 * helper rather than issuing ad hoc queries. See root governance rules 7-9.
 */
export async function withTransaction<T>(
  db: NodePgDatabase,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}

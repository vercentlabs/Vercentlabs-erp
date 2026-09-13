import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assertValidUuid } from './uuid.js';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Runs `fn` inside a transaction with `app.current_organization_id` set via
 * `SET LOCAL` for the RLS policies on organization-scoped tables (see
 * database/migrations/platform/0006_create_runtime_role_and_rls.sql).
 *
 * `SET LOCAL` - not `SET` - is what makes this safe under connection
 * pooling: the setting is scoped to this transaction only and is
 * automatically discarded at COMMIT/ROLLBACK, before the underlying
 * connection can be handed back to the pool and reused by an unrelated
 * request. Never replace this with a session-level `SET`.
 *
 * `organizationId` is validated as a strict UUID before being interpolated
 * into the `SET LOCAL` statement, since PostgreSQL does not support bound
 * parameters for `SET`/`SET LOCAL` - this is the injection guard for that
 * interpolation, not optional input hygiene.
 *
 * Pass `null` for platform-operator (cross-tenant) operations that have no
 * organization to scope to; the RLS policies then only expose rows whose
 * `organization_id` is itself NULL.
 */
export async function withOrganizationScope<T>(
  db: NodePgDatabase,
  organizationId: string | null,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  if (organizationId !== null) {
    assertValidUuid(organizationId, 'organizationId');
  }

  return db.transaction(async (tx) => {
    if (organizationId === null) {
      await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = ''`));
    } else {
      await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = '${organizationId}'`));
    }
    return fn(tx);
  });
}

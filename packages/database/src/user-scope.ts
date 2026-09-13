import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assertValidUuid } from './uuid.js';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Same pattern as {@link import('./organization-scope.js').withOrganizationScope},
 * scoped to `app.current_user_id` instead of `app.current_organization_id` -
 * the RLS boundary for SP004-SP007 identity/auth tables (see
 * database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql).
 * `SET LOCAL` again, for the identical connection-pooling reason: the
 * setting cannot outlive the transaction or leak to the next pooled
 * request.
 *
 * Pass `null` for `erp_auth_pipeline` operations that act before any user
 * is scoped yet (looking a user up by email, resolving a possessed token) -
 * those tables' RLS policies for that role are unconditional, so the empty
 * scope has no effect on them, but this keeps every identity/auth
 * transaction going through one consistent helper.
 */
export async function withUserScope<T>(
  db: NodePgDatabase,
  userId: string | null,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  if (userId !== null) {
    assertValidUuid(userId, 'userId');
  }

  return db.transaction(async (tx) => {
    if (userId === null) {
      await tx.execute(sql.raw(`SET LOCAL app.current_user_id = ''`));
    } else {
      await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${userId}'`));
    }
    return fn(tx);
  });
}

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  assertValidUuid,
  beginIdempotentOperation,
  completeIdempotentOperation,
  computeRequestHash,
  withUserScope,
  type IdempotencyScope,
} from '@vercentlabs/database';
import type { TransactionClient } from './tx.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CommandResponse<T> {
  status: number;
  body: T;
}

/**
 * Same shape as platform/tenancy's `runIdempotentCommand`, scoped to
 * `app.current_user_id` instead of (or alongside) `app.current_organization_id`
 * - reuses the SAME generic `platform.idempotency_records` table (see
 * database/migrations/platform/0012's comment on why), always with
 * `organizationId: null` in the *idempotency* scope so its RLS policy's
 * "NULL-scoped" branch matches, since identity/auth commands are never
 * organization-scoped in the tenancy sense.
 *
 * `auditOrganizationId` is a SEPARATE concern from the idempotency scope
 * above: a handful of identity commands (invitation create/accept) write
 * an `audit.audit_events`/`integration.outbox_events` row that legitimately
 * carries a real `organization_id` - and those shared tables' RLS policies
 * (written for SP001-SP003) key on `app.current_organization_id`, which
 * `withUserScope` never sets. Passing it here sets BOTH session variables
 * for the duration of this transaction, so such a write's `WITH CHECK`
 * actually matches instead of failing RLS with "new row violates row-level
 * security policy" - a real bug this test suite caught, not a hypothetical
 * one. Commands with no organization to attribute (login, sessions, MFA)
 * pass `null`, matching every audit/outbox row they write.
 *
 * Pass `userId: null` for `erp_auth_pipeline` operations that act before
 * any user is known yet (login's initial email lookup, invitation/
 * verification/reset token lookups) - the effect callback itself is
 * responsible for switching to a real user scope once one becomes known,
 * by calling `withUserScope` again for the rest of its work if needed.
 */
export async function runIdempotentCommand<T>(
  db: NodePgDatabase,
  userId: string | null,
  actorId: string,
  operationName: string,
  idempotencyKey: string,
  requestPayload: unknown,
  effect: (tx: TransactionClient) => Promise<CommandResponse<T>>,
  auditOrganizationId: string | null = null,
): Promise<CommandResponse<T>> {
  const requestHash = computeRequestHash(requestPayload);
  const idempotencyScope: IdempotencyScope = {
    organizationId: null,
    actorId,
    operationName,
    idempotencyKey,
  };
  if (auditOrganizationId !== null) {
    assertValidUuid(auditOrganizationId, 'auditOrganizationId');
  }

  return withUserScope(db, userId, async (tx) => {
    // platform.idempotency_records is written with organizationId: null
    // (see above), so its own RLS policy needs app.current_organization_id
    // UNSET/empty for both the claim below AND the completion at the
    // bottom - `auditOrganizationId` is only set in between, around the
    // effect itself, never around the idempotency bookkeeping.
    const replay = await beginIdempotentOperation(
      tx,
      idempotencyScope,
      requestHash,
      IDEMPOTENCY_TTL_MS,
    );
    if (replay) {
      return { status: replay.responseStatus, body: replay.responseBody as T };
    }

    if (auditOrganizationId !== null) {
      await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = '${auditOrganizationId}'`));
    }
    const response = await effect(tx);
    // Reset unconditionally, not just when `auditOrganizationId` was passed
    // up front - `acceptInvitation` sets this itself mid-effect (it only
    // learns the organization id after resolving the invitation token), so
    // this must undo that too before the idempotency-record completion
    // write below, which needs the NULL-scoped branch to match.
    await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = ''`));

    await completeIdempotentOperation(tx, idempotencyScope, {
      responseStatus: response.status,
      responseBody: response.body as object,
    });
    return response;
  });
}

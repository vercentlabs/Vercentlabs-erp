import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { idempotencyRecords } from './idempotency-schema.js';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export interface IdempotencyScope {
  organizationId: string | null;
  actorId: string;
  operationName: string;
  idempotencyKey: string;
}

export interface StoredIdempotentResponse {
  responseStatus: number;
  responseBody: unknown;
}

/** Same key, different request payload - a genuine client error, not a race. */
export class IdempotencyPayloadConflictError extends Error {
  constructor(scope: IdempotencyScope) {
    super(
      `Idempotency-Key "${scope.idempotencyKey}" was already used for operation "${scope.operationName}" with a different request payload.`,
    );
    this.name = 'IdempotencyPayloadConflictError';
  }
}

/** Another request with the same key is still being processed; safe to retry shortly. */
export class IdempotencyInProgressError extends Error {
  constructor(scope: IdempotencyScope) {
    super(
      `A request with Idempotency-Key "${scope.idempotencyKey}" is already being processed. Retry shortly.`,
    );
    this.name = 'IdempotencyInProgressError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

function scopeCondition(scope: IdempotencyScope) {
  return and(
    eq(idempotencyRecords.actorId, scope.actorId),
    eq(idempotencyRecords.operationName, scope.operationName),
    eq(idempotencyRecords.idempotencyKey, scope.idempotencyKey),
  );
}

async function decideFromExistingRow(
  row: typeof idempotencyRecords.$inferSelect,
  scope: IdempotencyScope,
  requestHash: string,
): Promise<StoredIdempotentResponse | null> {
  if (row.requestHash !== requestHash) {
    throw new IdempotencyPayloadConflictError(scope);
  }
  if (row.processingState === 'IN_PROGRESS') {
    throw new IdempotencyInProgressError(scope);
  }
  // COMPLETED: replay. FAILED rows are never written (a thrown effect rolls
  // back the whole transaction, including the IN_PROGRESS row), so this is
  // the only other reachable state in practice.
  return { responseStatus: row.responseStatus ?? 200, responseBody: row.responseBody };
}

/**
 * Call at the start of a transaction, before any domain writes. Returns the
 * previously-stored response if this exact (key, payload) already completed
 * (a safe replay); returns `null` if this is a new attempt the caller must
 * now execute and then finish with {@link completeIdempotentOperation} in
 * the same transaction.
 *
 * Throws {@link IdempotencyPayloadConflictError} for a reused key with a
 * different payload, or {@link IdempotencyInProgressError} if a concurrent
 * request is still in flight for the same key - callers must map both to a
 * typed HTTP conflict, never treat them as "proceed".
 */
export async function beginIdempotentOperation(
  tx: TransactionClient,
  scope: IdempotencyScope,
  requestHash: string,
  ttlMs: number,
): Promise<StoredIdempotentResponse | null> {
  const [existing] = await tx
    .select()
    .from(idempotencyRecords)
    .where(scopeCondition(scope))
    .limit(1);
  if (existing) {
    return decideFromExistingRow(existing, scope, requestHash);
  }

  // A failed INSERT aborts the rest of the enclosing Postgres transaction,
  // not just that statement - a plain try/catch here would leave `tx`
  // unusable for the SELECT below. Running the attempt as a nested
  // transaction makes drizzle issue a real SAVEPOINT, so a unique-violation
  // only rolls back to that savepoint and `tx` stays healthy.
  async function tryClaim(): Promise<boolean> {
    try {
      await tx.transaction(async (nested) => {
        await nested.insert(idempotencyRecords).values({
          organizationId: scope.organizationId,
          actorId: scope.actorId,
          operationName: scope.operationName,
          idempotencyKey: scope.idempotencyKey,
          requestHash,
          processingState: 'IN_PROGRESS',
          expiresAt: new Date(Date.now() + ttlMs),
        });
      });
      return true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return false;
    }
  }

  if (await tryClaim()) {
    return null;
  }

  // Lost a race with a concurrent request for the same key. Postgres
  // blocked this INSERT until that request's transaction resolved, so its
  // row (now COMPLETED, or gone if it rolled back) is visible here.
  const [afterRace] = await tx
    .select()
    .from(idempotencyRecords)
    .where(scopeCondition(scope))
    .limit(1);
  if (!afterRace) {
    // The other request rolled back entirely; safe to claim the key ourselves.
    if (await tryClaim()) return null;
    throw new IdempotencyInProgressError(scope);
  }
  return decideFromExistingRow(afterRace, scope, requestHash);
}

/** Call once the domain effect has succeeded, in the same transaction as {@link beginIdempotentOperation}. */
export async function completeIdempotentOperation(
  tx: TransactionClient,
  scope: IdempotencyScope,
  response: StoredIdempotentResponse,
): Promise<void> {
  await tx
    .update(idempotencyRecords)
    .set({
      processingState: 'COMPLETED',
      responseStatus: response.responseStatus,
      responseBody: response.responseBody as object,
      completedAt: new Date(),
    })
    .where(scopeCondition(scope));
}

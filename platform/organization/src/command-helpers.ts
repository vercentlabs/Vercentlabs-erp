import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  computeRequestHash,
  withOrganizationScope,
  type IdempotencyScope,
} from '@vercentlabs/database';
import type { TransactionClient } from './tx.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CommandResponse<T> {
  status: number;
  body: T;
}

/** Same shape as platform/tenancy's runIdempotentCommand, always organization-scoped here (never null). */
export async function runIdempotentCommand<T>(
  db: NodePgDatabase,
  organizationId: string,
  actorId: string,
  operationName: string,
  idempotencyKey: string,
  requestPayload: unknown,
  effect: (tx: TransactionClient) => Promise<CommandResponse<T>>,
): Promise<CommandResponse<T>> {
  const requestHash = computeRequestHash(requestPayload);
  const idempotencyScope: IdempotencyScope = {
    organizationId,
    actorId,
    operationName,
    idempotencyKey,
  };

  return withOrganizationScope(db, organizationId, async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      idempotencyScope,
      requestHash,
      IDEMPOTENCY_TTL_MS,
    );
    if (replay) {
      return { status: replay.responseStatus, body: replay.responseBody as T };
    }

    const response = await effect(tx);
    await completeIdempotentOperation(tx, idempotencyScope, {
      responseStatus: response.status,
      responseBody: response.body,
    });
    return response;
  });
}

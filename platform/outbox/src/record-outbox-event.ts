import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { outboxEvents } from './schema.js';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export interface RecordOutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  organizationId?: string | null;
  eventType: string;
  schemaVersion?: number;
  aggregateVersion: number;
  /** Must be safe to deliver externally later - no secrets, no raw internal-only fields. */
  payload: Record<string, unknown>;
  correlationId: string;
  causationId?: string | null;
}

/**
 * Writes one outbox event row. Callers must run this inside the same
 * transaction as the domain change it records (root governance rule 9) -
 * this function itself does not open a transaction, and does not deliver
 * anything. No dispatcher exists yet (SP015 remains NOT_STARTED); rows stay
 * `PENDING` until a future prompt builds one.
 */
export async function recordOutboxEvent(
  tx: TransactionClient,
  input: RecordOutboxEventInput,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    organizationId: input.organizationId ?? null,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? 1,
    aggregateVersion: input.aggregateVersion,
    payload: input.payload,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
  });
}

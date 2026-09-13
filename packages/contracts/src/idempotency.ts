import { z } from 'zod';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const idempotencyKeySchema = z.string().min(8).max(255);
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const idempotencyRecordStatusSchema = z.enum(['in_progress', 'completed', 'failed']);
export type IdempotencyRecordStatus = z.infer<typeof idempotencyRecordStatusSchema>;

/**
 * Shape persisted by API mutation handlers so a retried request with the same
 * idempotency key replays the original result instead of re-executing the
 * mutation. Requires the platform outbox/mutation tables from SP015; this
 * type is the contract, not the implementation.
 */
export interface IdempotencyRecord {
  key: IdempotencyKey;
  requestFingerprint: string;
  status: IdempotencyRecordStatus;
  responseBody?: unknown;
  createdAt: string;
  completedAt?: string;
}

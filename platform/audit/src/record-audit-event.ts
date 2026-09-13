import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ActorType } from '@vercentlabs/contracts';
import { auditEvents } from './schema.js';

type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export interface RecordAuditEventInput {
  organizationId?: string | null;
  companyId?: string | null;
  operatingUnitId?: string | null;
  actorId: string;
  actorType: ActorType;
  action: string;
  targetType: string;
  targetId: string;
  previousVersion?: number | null;
  previousState?: string | null;
  newVersion?: number | null;
  newState?: string | null;
  reason?: string | null;
  correlationId: string;
  requestId: string;
  /**
   * A safe, non-sensitive summary of what changed - field names and
   * before/after values are fine; never raw request bodies, credentials or
   * tokens (root governance rule 18).
   */
  changedFields?: Record<string, unknown> | null;
}

/**
 * Writes one audit event row. Callers must run this inside the same
 * transaction as the domain change it records (root governance rule 7) -
 * this function itself does not open a transaction. This is minimum
 * reliable evidence, not the full SP014 audit-trail capability (query API,
 * retention policy), which remains NOT_STARTED.
 */
export async function recordAuditEvent(
  tx: TransactionClient,
  input: RecordAuditEventInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId ?? null,
    companyId: input.companyId ?? null,
    operatingUnitId: input.operatingUnitId ?? null,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousVersion: input.previousVersion ?? null,
    previousState: input.previousState ?? null,
    newVersion: input.newVersion ?? null,
    newState: input.newState ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId,
    requestId: input.requestId,
    changedFields: input.changedFields ?? null,
  });
}

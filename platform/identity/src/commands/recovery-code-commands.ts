import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { generateRecoveryCodeBatch, normalizeRecoveryCode } from '../crypto/recovery-code.js';
import { hashToken } from '../crypto/token-hash.js';
import { requireStepUp } from '../assurance.js';
import {
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  findRecoveryCodeByHash,
  insertRecoveryCodes,
} from '../repository/credentials.js';
import type { TransactionClient } from '../tx.js';

const CODE_COUNT = 10;

export interface GenerateRecoveryCodesInput {
  userId: string;
  sessionId: string;
  isRegeneration: boolean;
  correlationId: string;
  requestId: string;
}

export interface GenerateRecoveryCodesResult {
  codes: string[];
  generatedAt: string;
}

/**
 * First generation needs no step-up (nothing to prove yet beyond the
 * active session); regeneration - which invalidates every unused code from
 * every earlier batch - requires step-up per the explicit requirement.
 * "Invalidates" here means earlier codes simply stop being findable as
 * valid: a fresh `generation_batch_id` per call plus `consumeRecoveryCode`'s
 * `usedAt IS NULL` check means only the newest batch's rows can ever be
 * consumed going forward - this command does not need to touch old rows at
 * all, since a code's own row is never looked up by batch.
 */
export async function generateRecoveryCodes(
  db: NodePgDatabase,
  input: GenerateRecoveryCodesInput,
): Promise<GenerateRecoveryCodesResult> {
  if (input.isRegeneration) {
    await requireStepUp(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      purpose: 'mfa_removal_reset',
    });
  }

  return withUserScope(db, input.userId, async (tx) => {
    const codes = generateRecoveryCodeBatch(CODE_COUNT);
    const generationBatchId = randomUUID();
    await insertRecoveryCodes(tx, {
      userId: input.userId,
      generationBatchId,
      codeHashes: codes.map((code) => hashToken(normalizeRecoveryCode(code))),
    });

    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: input.isRegeneration ? 'recovery_codes.regenerated' : 'recovery_codes.generated',
      targetType: 'User',
      targetId: input.userId,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'User',
      aggregateId: input.userId,
      eventType: 'recovery_codes.generated',
      aggregateVersion: 1,
      payload: { userId: input.userId, count: codes.length },
      correlationId: input.correlationId,
    });

    return { codes, generatedAt: new Date().toISOString() };
  });
}

export async function getRecoveryCodesRemaining(
  db: NodePgDatabase,
  userId: string,
): Promise<number> {
  return withUserScope(db, userId, (tx) => countUnusedRecoveryCodes(tx, userId));
}

/**
 * Atomic, concurrency-safe single-use check-and-consume, shared by login's
 * recovery-code second factor and step-up's recovery-code method. Returns
 * false for "no such code"/"already used"/"belongs to someone else" alike.
 */
export async function consumeRecoveryCodeIfValid(
  tx: TransactionClient,
  userId: string,
  rawCode: string,
): Promise<boolean> {
  const codeHash = hashToken(normalizeRecoveryCode(rawCode));
  const record = await findRecoveryCodeByHash(tx, codeHash);
  if (!record || record.userId !== userId || record.usedAt) return false;
  const consumed = await consumeRecoveryCode(tx, record.id);
  return Boolean(consumed);
}

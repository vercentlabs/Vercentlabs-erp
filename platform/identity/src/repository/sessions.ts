import { and, eq, isNull } from 'drizzle-orm';
import { sessions, type SessionRow } from '../schema/sessions.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

export interface InsertSessionInput {
  userId: string;
  tokenHash: string;
  securityStamp: string;
  assuranceLevel: 'AAL1' | 'AAL2';
  authenticatedAt: Date;
  expiresAt: Date;
  inactivityExpiresAt: Date;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  deviceLabel?: string | null | undefined;
}

export async function insertSession(
  tx: TransactionClient,
  input: InsertSessionInput,
): Promise<SessionRow> {
  const [row] = await tx
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      securityStamp: input.securityStamp,
      assuranceLevel: input.assuranceLevel,
      authenticatedAt: input.authenticatedAt,
      expiresAt: input.expiresAt,
      inactivityExpiresAt: input.inactivityExpiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceLabel: input.deviceLabel ?? null,
    })
    .returning();
  if (!row) throw new Error('insertSession: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findSessionByTokenHash(
  db: QueryExecutor,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function findSessionById(
  db: QueryExecutor,
  id: string,
): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

export async function listActiveSessionsForUser(
  db: QueryExecutor,
  userId: string,
): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Only a bounded set of write-triggering columns; called at most once per
 * configured interval by the caller, never on every request, to bound
 * write amplification. Accepts `QueryExecutor`, not just `TransactionClient`
 * - `SessionAuthGuard` calls this as a fire-and-forget write directly on
 * the pipeline connection, outside any request-scoping transaction, since
 * `erp_auth_pipeline`'s policy on `auth.sessions` is unconditional.
 */
export async function touchSessionLastSeen(
  tx: QueryExecutor,
  id: string,
  lastSeenAt: Date,
): Promise<void> {
  await tx.update(sessions).set({ lastSeenAt }).where(eq(sessions.id, id));
}

export async function rotateSessionToken(
  tx: TransactionClient,
  id: string,
  newTokenHash: string,
): Promise<void> {
  await tx.update(sessions).set({ tokenHash: newTokenHash }).where(eq(sessions.id, id));
}

export async function upgradeSessionAssurance(
  tx: TransactionClient,
  id: string,
  input: {
    assuranceLevel: 'AAL2';
    lastStepUpAt: Date;
    lastStepUpPurpose: string | null;
    authenticatedAt?: Date;
  },
): Promise<void> {
  await tx
    .update(sessions)
    .set({
      assuranceLevel: input.assuranceLevel,
      lastStepUpAt: input.lastStepUpAt,
      lastStepUpPurpose: input.lastStepUpPurpose,
      ...(input.authenticatedAt ? { authenticatedAt: input.authenticatedAt } : {}),
    })
    .where(eq(sessions.id, id));
}

export async function revokeSessionById(
  tx: TransactionClient,
  id: string,
  reason: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revocationReason: reason })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
}

/** Used for suspend/deactivate/password-change/reset - every session for the user, no exceptions. */
export async function revokeAllSessionsForUser(
  tx: TransactionClient,
  userId: string,
  reason: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revocationReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Used for "revoke all other sessions" - every session for the user except the caller's own current one. */
export async function revokeOtherSessionsForUser(
  tx: TransactionClient,
  userId: string,
  keepSessionId: string,
  reason: string,
): Promise<void> {
  const all = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const row of all) {
    if (row.id === keepSessionId) continue;
    await revokeSessionById(tx, row.id, reason);
  }
}

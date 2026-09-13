import { and, eq } from 'drizzle-orm';
import { userInvitations, type UserInvitationRow } from '../schema/identity.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

export async function findInvitationByTokenHash(
  db: QueryExecutor,
  tokenHash: string,
): Promise<UserInvitationRow | undefined> {
  const [row] = await db
    .select()
    .from(userInvitations)
    .where(eq(userInvitations.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function insertInvitation(
  tx: TransactionClient,
  input: {
    organizationId: string;
    emailNormalized: string;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  },
): Promise<UserInvitationRow> {
  const [row] = await tx
    .insert(userInvitations)
    .values({
      organizationId: input.organizationId,
      emailNormalized: input.emailNormalized,
      tokenHash: input.tokenHash,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('insertInvitation: INSERT ... RETURNING produced no row.');
  return row;
}

/**
 * Concurrency-safe acceptance: the conditional `WHERE status = 'PENDING'`
 * means two simultaneous accept attempts for the same invitation can never
 * both succeed - exactly one UPDATE affects a row, and the caller must
 * treat zero affected rows as "already accepted/revoked/expired by someone
 * else", never retry the effect.
 */
export async function markInvitationAccepted(
  tx: TransactionClient,
  invitationId: string,
  acceptedUserId: string,
): Promise<UserInvitationRow | undefined> {
  const [row] = await tx
    .update(userInvitations)
    .set({ status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId, updatedAt: new Date() })
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.status, 'PENDING')))
    .returning();
  return row;
}

export async function revokeInvitation(tx: TransactionClient, invitationId: string): Promise<void> {
  await tx
    .update(userInvitations)
    .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.status, 'PENDING')));
}

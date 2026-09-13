import { and, eq, isNull } from 'drizzle-orm';
import { mfaLoginTokens, type MfaLoginTokenRow } from '../schema/mfa-login.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

export async function insertMfaLoginToken(
  tx: TransactionClient,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<MfaLoginTokenRow> {
  const [row] = await tx
    .insert(mfaLoginTokens)
    .values({ userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
    .returning();
  if (!row) throw new Error('insertMfaLoginToken: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findMfaLoginTokenByHash(
  db: QueryExecutor,
  tokenHash: string,
): Promise<MfaLoginTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(mfaLoginTokens)
    .where(eq(mfaLoginTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Consumption does not mark single-use immediately - a wrong MFA code must not burn the token, only a SUCCESSFUL completion does. */
export async function consumeMfaLoginToken(
  tx: TransactionClient,
  id: string,
): Promise<MfaLoginTokenRow | undefined> {
  const [row] = await tx
    .update(mfaLoginTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(mfaLoginTokens.id, id), isNull(mfaLoginTokens.consumedAt)))
    .returning();
  return row;
}

import { and, gte, sql } from 'drizzle-orm';
import { authenticationAttempts } from '../schema/security-events.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

export type AuthenticationOutcome =
  | 'SUCCESS'
  | 'INVALID_CREDENTIALS'
  | 'UNKNOWN_ACCOUNT'
  | 'SUSPENDED'
  | 'DEACTIVATED'
  | 'UNVERIFIED_EMAIL'
  | 'RATE_LIMITED'
  | 'MFA_REQUIRED'
  | 'MFA_FAILED';

export async function recordAuthenticationAttempt(
  tx: TransactionClient,
  input: {
    identityKey: string;
    ipAddress?: string | null | undefined;
    outcome: AuthenticationOutcome;
  },
): Promise<void> {
  await tx.insert(authenticationAttempts).values({
    identityKey: input.identityKey,
    ipAddress: input.ipAddress ?? null,
    outcome: input.outcome,
  });
}

/** Count of non-SUCCESS attempts for this identity within the window - the basis for a time-bounded, never-permanent lockout. */
export async function countRecentFailedAttemptsForIdentity(
  db: QueryExecutor,
  identityKey: string,
  sinceMs: number,
): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authenticationAttempts)
    .where(
      and(
        sql`${authenticationAttempts.identityKey} = ${identityKey}`,
        sql`${authenticationAttempts.outcome} <> 'SUCCESS'`,
        gte(authenticationAttempts.occurredAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function countRecentFailedAttemptsForIp(
  db: QueryExecutor,
  ipAddress: string,
  sinceMs: number,
): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authenticationAttempts)
    .where(
      and(
        sql`${authenticationAttempts.ipAddress} = ${ipAddress}`,
        sql`${authenticationAttempts.outcome} <> 'SUCCESS'`,
        gte(authenticationAttempts.occurredAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

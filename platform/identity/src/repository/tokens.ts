import { and, eq, isNull } from 'drizzle-orm';
import {
  passwordResetTokens,
  stepUpTokens,
  verificationTokens,
  webauthnChallenges,
  type PasswordResetTokenRow,
  type StepUpTokenRow,
  type VerificationTokenRow,
  type WebAuthnChallengeRow,
} from '../schema/sessions.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

// ---------------------------------------------------------------------
// Email verification / email-change tokens
// ---------------------------------------------------------------------

export async function insertVerificationToken(
  tx: TransactionClient,
  input: {
    userId: string;
    emailAddressId: string;
    purpose: 'EMAIL_VERIFY' | 'EMAIL_CHANGE';
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<VerificationTokenRow> {
  const [row] = await tx
    .insert(verificationTokens)
    .values({
      userId: input.userId,
      emailAddressId: input.emailAddressId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('insertVerificationToken: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findVerificationTokenByHash(
  db: QueryExecutor,
  tokenHash: string,
): Promise<VerificationTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(eq(verificationTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Concurrency-safe: two simultaneous consumptions of the same token can never both succeed. */
export async function consumeVerificationToken(
  tx: TransactionClient,
  id: string,
): Promise<VerificationTokenRow | undefined> {
  const [row] = await tx
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(verificationTokens.id, id), isNull(verificationTokens.consumedAt)))
    .returning();
  return row;
}

// ---------------------------------------------------------------------
// Password reset tokens
// ---------------------------------------------------------------------

export async function insertPasswordResetToken(
  tx: TransactionClient,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<PasswordResetTokenRow> {
  const [row] = await tx
    .insert(passwordResetTokens)
    .values({ userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
    .returning();
  if (!row) throw new Error('insertPasswordResetToken: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findPasswordResetTokenByHash(
  db: QueryExecutor,
  tokenHash: string,
): Promise<PasswordResetTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Every earlier unconsumed, non-invalidated token for this user becomes invalid - only the newest request is ever valid. */
export async function invalidateOtherPasswordResetTokens(
  tx: TransactionClient,
  userId: string,
  keepTokenId: string,
): Promise<void> {
  await tx
    .update(passwordResetTokens)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.consumedAt),
        isNull(passwordResetTokens.invalidatedAt),
      ),
    );
  // The row we just created is included in that sweep; restore it explicitly.
  await tx
    .update(passwordResetTokens)
    .set({ invalidatedAt: null })
    .where(eq(passwordResetTokens.id, keepTokenId));
}

export async function consumePasswordResetToken(
  tx: TransactionClient,
  id: string,
): Promise<PasswordResetTokenRow | undefined> {
  const [row] = await tx
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, id),
        isNull(passwordResetTokens.consumedAt),
        isNull(passwordResetTokens.invalidatedAt),
      ),
    )
    .returning();
  return row;
}

// ---------------------------------------------------------------------
// WebAuthn challenges
// ---------------------------------------------------------------------

export async function insertWebAuthnChallenge(
  tx: TransactionClient,
  input: {
    userId?: string | null;
    sessionId?: string | null;
    purpose: 'REGISTRATION' | 'AUTHENTICATION' | 'STEP_UP';
    challenge: string;
    expiresAt: Date;
  },
): Promise<WebAuthnChallengeRow> {
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      purpose: input.purpose,
      challenge: input.challenge,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('insertWebAuthnChallenge: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findWebAuthnChallengeById(
  db: QueryExecutor,
  id: string,
): Promise<WebAuthnChallengeRow | undefined> {
  const [row] = await db
    .select()
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.id, id))
    .limit(1);
  return row;
}

export async function consumeWebAuthnChallenge(
  tx: TransactionClient,
  id: string,
): Promise<WebAuthnChallengeRow | undefined> {
  const [row] = await tx
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(webauthnChallenges.id, id), isNull(webauthnChallenges.consumedAt)))
    .returning();
  return row;
}

// ---------------------------------------------------------------------
// Step-up tokens
// ---------------------------------------------------------------------

export async function insertStepUpToken(
  tx: TransactionClient,
  input: {
    sessionId: string;
    userId: string;
    purpose: string;
    method: 'PASSWORD_TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE';
    assuranceLevel: 'AAL2';
    expiresAt: Date;
  },
): Promise<StepUpTokenRow> {
  const [row] = await tx
    .insert(stepUpTokens)
    .values({
      sessionId: input.sessionId,
      userId: input.userId,
      purpose: input.purpose,
      method: input.method,
      assuranceLevel: input.assuranceLevel,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('insertStepUpToken: INSERT ... RETURNING produced no row.');
  return row;
}

export async function findActiveStepUpToken(
  db: QueryExecutor,
  input: { sessionId: string; purpose: string },
): Promise<StepUpTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(stepUpTokens)
    .where(
      and(
        eq(stepUpTokens.sessionId, input.sessionId),
        eq(stepUpTokens.purpose, input.purpose),
        isNull(stepUpTokens.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

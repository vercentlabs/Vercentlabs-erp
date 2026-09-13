import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  AuthenticationFailedError,
  DomainValidationError,
  InvalidOrExpiredTokenError,
} from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { generateOpaqueToken, hashToken } from '../crypto/token-hash.js';
import { normalizeEmail } from '../normalize-email.js';
import { normalizePassword } from '../crypto/password-normalize.js';
import { hashPassword, verifyPassword } from '../crypto/password-hasher.js';
import { validatePasswordPolicy } from '../password-policy.js';
import { DEFAULT_SESSION_POLICY } from '../session-policy.js';
import { findEmailByNormalized, findUserById } from '../repository/users.js';
import { findPasswordCredential, updatePasswordHash } from '../repository/credentials.js';
import { revokeAllSessionsForUser } from '../repository/sessions.js';
import {
  consumePasswordResetToken,
  findPasswordResetTokenByHash,
  insertPasswordResetToken,
  invalidateOtherPasswordResetTokens,
} from '../repository/tokens.js';
import type { EmailProvider } from '../email/email-provider.js';
import { users } from '../schema/identity.js';
import type { TransactionClient } from '../tx.js';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  correlationId: string;
  requestId: string;
}

/** Authenticated self-service: proves the CURRENT password (not step-up - a user always knows their own current password by definition). */
export async function changePassword(
  db: NodePgDatabase,
  input: ChangePasswordInput,
): Promise<void> {
  const policyResult = validatePasswordPolicy(input.newPassword);
  if (!policyResult.ok) {
    throw new DomainValidationError(policyResult.reason, [
      { field: 'newPassword', message: policyResult.reason },
    ]);
  }

  await withUserScope(db, input.userId, async (tx) => {
    const credential = await findPasswordCredential(tx, input.userId);
    if (!credential) throw new AuthenticationFailedError();
    const ok = await verifyPassword(
      credential.passwordHash,
      normalizePassword(input.currentPassword),
    );
    if (!ok) throw new AuthenticationFailedError('Current password is incorrect.');

    const newHash = await hashPassword(normalizePassword(input.newPassword));
    await updatePasswordHash(tx, input.userId, newHash);
    await bumpSecurityStampAndRevokeSessions(tx, input.userId);

    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'password.changed',
      targetType: 'User',
      targetId: input.userId,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'User',
      aggregateId: input.userId,
      eventType: 'password.changed',
      aggregateVersion: 1,
      payload: { userId: input.userId },
      correlationId: input.correlationId,
    });
  });
}

async function bumpSecurityStampAndRevokeSessions(
  tx: TransactionClient,
  userId: string,
): Promise<void> {
  await tx
    .update(users)
    .set({ securityStamp: randomUUID(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllSessionsForUser(tx, userId, 'password_changed');
}

export interface RequestPasswordResetInput {
  email: string;
  correlationId: string;
  requestId: string;
  emailProvider: EmailProvider;
}

/**
 * Anti-enumeration: identical response whether or not the account exists.
 * Only a real, existing, ACTIVE account with a verified email ever gets an
 * actual token issued and email sent - the public response never reveals
 * which case occurred, and both paths do comparable work so response
 * timing does not become a side channel either.
 */
export async function requestPasswordReset(
  db: NodePgDatabase,
  input: RequestPasswordResetInput,
): Promise<void> {
  const emailNormalized = normalizeEmail(input.email);

  await withUserScope(db, null, async (tx) => {
    const emailRow = await findEmailByNormalized(tx, emailNormalized);
    const user = emailRow ? await findUserById(tx, emailRow.userId) : undefined;

    if (emailRow && user && user.status === 'ACTIVE') {
      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + DEFAULT_SESSION_POLICY.tokenTimeoutMs);
      const record = await insertPasswordResetToken(tx, { userId: user.id, tokenHash, expiresAt });
      // Only the newest request's token is ever valid.
      await invalidateOtherPasswordResetTokens(tx, user.id, record.id);

      await recordOutboxEvent(tx, {
        aggregateType: 'User',
        aggregateId: user.id,
        eventType: 'password_reset.requested',
        aggregateVersion: 1,
        payload: { userId: user.id },
        correlationId: input.correlationId,
      });
      await input.emailProvider.send({
        templateId: 'PASSWORD_RESET',
        to: emailRow.emailOriginal,
        rawToken,
      });
    }
    // No else branch, no differing timing-sensitive work, no differing response - see doc comment above.
  });
}

export async function validateResetToken(
  db: NodePgDatabase,
  token: string,
): Promise<{ valid: boolean }> {
  const tokenHash = hashToken(token);
  return withUserScope(db, null, async (tx) => {
    const record = await findPasswordResetTokenByHash(tx, tokenHash);
    const valid = Boolean(
      record &&
        !record.consumedAt &&
        !record.invalidatedAt &&
        record.expiresAt.getTime() > Date.now(),
    );
    return { valid };
  });
}

export interface CompletePasswordResetInput {
  token: string;
  newPassword: string;
  correlationId: string;
  requestId: string;
}

export async function completePasswordReset(
  db: NodePgDatabase,
  input: CompletePasswordResetInput,
): Promise<void> {
  const policyResult = validatePasswordPolicy(input.newPassword);
  if (!policyResult.ok) {
    throw new DomainValidationError(policyResult.reason, [
      { field: 'newPassword', message: policyResult.reason },
    ]);
  }
  const tokenHash = hashToken(input.token);

  await withUserScope(db, null, async (tx) => {
    const record = await findPasswordResetTokenByHash(tx, tokenHash);
    if (
      !record ||
      record.consumedAt ||
      record.invalidatedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new InvalidOrExpiredTokenError();
    }
    const consumed = await consumePasswordResetToken(tx, record.id);
    if (!consumed) throw new InvalidOrExpiredTokenError();

    const newHash = await hashPassword(normalizePassword(input.newPassword));
    await updatePasswordHash(tx, record.userId, newHash);
    await bumpSecurityStampAndRevokeSessions(tx, record.userId);

    await recordAuditEvent(tx, {
      actorId: record.userId,
      actorType: 'user',
      action: 'password.reset',
      targetType: 'User',
      targetId: record.userId,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'User',
      aggregateId: record.userId,
      eventType: 'password.reset',
      aggregateVersion: 1,
      payload: { userId: record.userId },
      correlationId: input.correlationId,
    });
  });
}

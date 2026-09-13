import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InvalidOrExpiredTokenError } from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { hashToken, generateOpaqueToken } from '../crypto/token-hash.js';
import { normalizeEmail } from '../normalize-email.js';
import { DEFAULT_SESSION_POLICY } from '../session-policy.js';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { findEmailByNormalized, markEmailVerified } from '../repository/users.js';
import {
  consumeVerificationToken,
  findVerificationTokenByHash,
  insertVerificationToken,
} from '../repository/tokens.js';
import type { EmailProvider } from '../email/email-provider.js';

export interface VerifyEmailInput {
  token: string;
  idempotencyKey: string;
  correlationId: string;
  requestId: string;
}

export async function verifyEmail(
  db: NodePgDatabase,
  input: VerifyEmailInput,
): Promise<CommandResponse<{ verified: true }>> {
  const tokenHash = hashToken(input.token);

  return runIdempotentCommand(
    db,
    null,
    `verify:${tokenHash.slice(0, 16)}`,
    'VerifyEmail',
    input.idempotencyKey,
    { tokenHash },
    async (tx) => {
      const record = await findVerificationTokenByHash(tx, tokenHash);
      if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
        throw new InvalidOrExpiredTokenError();
      }
      const consumed = await consumeVerificationToken(tx, record.id);
      if (!consumed) throw new InvalidOrExpiredTokenError();

      await markEmailVerified(tx, record.emailAddressId);

      await recordAuditEvent(tx, {
        actorId: record.userId,
        actorType: 'user',
        action: record.purpose === 'EMAIL_CHANGE' ? 'email.changed' : 'email.verified',
        targetType: 'UserEmailAddress',
        targetId: record.emailAddressId,
        correlationId: input.correlationId,
        requestId: input.requestId,
      });
      await recordOutboxEvent(tx, {
        aggregateType: 'UserEmailAddress',
        aggregateId: record.emailAddressId,
        eventType: 'email.verified',
        aggregateVersion: 1,
        payload: { userId: record.userId, emailAddressId: record.emailAddressId },
        correlationId: input.correlationId,
      });

      return { status: 200, body: { verified: true } };
    },
  );
}

export interface ResendVerificationInput {
  email: string;
  idempotencyKey: string;
  correlationId: string;
  requestId: string;
  emailProvider: EmailProvider;
}

/**
 * Anti-enumeration: this always returns the same generic success shape,
 * whether or not the email exists or is already verified - only the
 * INTERNAL branch differs, and only an existing, unverified address ever
 * gets a real email sent.
 */
export async function resendVerification(
  db: NodePgDatabase,
  input: ResendVerificationInput,
): Promise<CommandResponse<{ requested: true }>> {
  const emailNormalized = normalizeEmail(input.email);

  return runIdempotentCommand(
    db,
    null,
    `resend:${emailNormalized}`,
    'ResendVerification',
    input.idempotencyKey,
    { emailNormalized },
    async (tx) => {
      const emailRow = await findEmailByNormalized(tx, emailNormalized);
      if (emailRow && !emailRow.verifiedAt) {
        const rawToken = generateOpaqueToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + DEFAULT_SESSION_POLICY.tokenTimeoutMs);
        await insertVerificationToken(tx, {
          userId: emailRow.userId,
          emailAddressId: emailRow.id,
          purpose: 'EMAIL_VERIFY',
          tokenHash,
          expiresAt,
        });
        await recordOutboxEvent(tx, {
          aggregateType: 'UserEmailAddress',
          aggregateId: emailRow.id,
          eventType: 'email.verification_requested',
          aggregateVersion: 1,
          payload: { userId: emailRow.userId, emailAddressId: emailRow.id },
          correlationId: input.correlationId,
        });
        // Delivery goes through the injected EmailProvider (never logged
        // with the live token - see docs/operations/account-recovery.md).
        await input.emailProvider.send({
          templateId: 'EMAIL_VERIFY',
          to: emailRow.emailOriginal,
          rawToken,
        });
      }
      return { status: 202, body: { requested: true } };
    },
  );
}

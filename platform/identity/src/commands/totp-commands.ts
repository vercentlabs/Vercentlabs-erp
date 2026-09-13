import { Secret, TOTP } from 'otpauth';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuthenticationFailedError, DomainValidationError } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { decryptTotpSecret, encryptTotpSecret } from '../crypto/totp-secret-cipher.js';
import { getTotpKeyProvider } from '../totp-key-provider.js';
import {
  confirmTotpCredential,
  findTotpCredential,
  insertTotpCredential,
  recordTotpStepUsed,
  revokeTotpCredential,
} from '../repository/credentials.js';
import { findPrimaryEmailForUser } from '../repository/users.js';
import { requireRecentAuthentication, requireStepUp } from '../assurance.js';
import type { TransactionClient } from '../tx.js';

const TOTP_ISSUER = 'Vercentlabs ERP';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1; // +/- one 30s step of bounded clock skew

function buildTotp(secret: Secret, label: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret,
  });
}

export interface BeginTotpEnrollmentResult {
  otpauthUri: string;
  manualEntryKey: string;
}

export async function beginTotpEnrollment(
  db: NodePgDatabase,
  userId: string,
  authenticatedAt: Date,
): Promise<BeginTotpEnrollmentResult> {
  requireRecentAuthentication(authenticatedAt);
  return withUserScope(db, userId, async (tx) => {
    const email = await findPrimaryEmailForUser(tx, userId);
    const secret = new Secret({ size: 20 });
    const totp = buildTotp(secret, email?.emailOriginal ?? userId);

    const provider = getTotpKeyProvider();
    const encrypted = encryptTotpSecret(provider, secret.base32);

    // Replaces any prior unconfirmed enrollment attempt for this user - a
    // user can restart enrollment as many times as they like before
    // confirming; only ONE credential row per user ever exists (unique
    // constraint on user_id), so re-enrolling revokes-then-inserts.
    const existingUnconfirmed = await findTotpCredential(tx, userId);
    if (existingUnconfirmed && !existingUnconfirmed.confirmedAt) {
      await revokeTotpCredential(tx, existingUnconfirmed.id);
    } else if (existingUnconfirmed?.confirmedAt) {
      throw new DomainValidationError(
        'TOTP is already enrolled. Remove it before enrolling a new authenticator app.',
      );
    }

    await insertTotpCredential(tx, {
      userId,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
    });

    return { otpauthUri: totp.toString(), manualEntryKey: secret.base32 };
  });
}

export async function confirmTotpEnrollment(
  db: NodePgDatabase,
  input: { userId: string; code: string; correlationId: string; requestId: string },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    const credential = await findTotpCredential(tx, input.userId);
    if (!credential || credential.confirmedAt) {
      throw new DomainValidationError('No pending TOTP enrollment to confirm.');
    }
    const ok = await verifyCodeAgainstCredential(credential, input.code);
    if (!ok) {
      throw new AuthenticationFailedError('Incorrect verification code.');
    }
    await confirmTotpCredential(tx, credential.id);
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'totp.enrolled',
      targetType: 'TotpCredential',
      targetId: credential.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'TotpCredential',
      aggregateId: credential.id,
      eventType: 'totp.enrolled',
      aggregateVersion: 1,
      payload: { userId: input.userId },
      correlationId: input.correlationId,
    });
  });
}

export async function removeTotp(
  db: NodePgDatabase,
  input: { userId: string; sessionId: string; correlationId: string; requestId: string },
): Promise<void> {
  await requireStepUp(db, {
    userId: input.userId,
    sessionId: input.sessionId,
    purpose: 'mfa_removal_reset',
  });
  await withUserScope(db, input.userId, async (tx) => {
    const credential = await findTotpCredential(tx, input.userId);
    if (!credential) throw new DomainValidationError('No TOTP authenticator is enrolled.');
    await revokeTotpCredential(tx, credential.id);
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'totp.removed',
      targetType: 'TotpCredential',
      targetId: credential.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'TotpCredential',
      aggregateId: credential.id,
      eventType: 'totp.removed',
      aggregateVersion: 1,
      payload: { userId: input.userId },
      correlationId: input.correlationId,
    });
  });
}

async function verifyCodeAgainstCredential(
  credential: {
    secretCiphertext: Buffer;
    secretIv: Buffer;
    secretAuthTag: Buffer;
    keyVersion: number;
    lastUsedStep: number | null;
  },
  code: string,
): Promise<{ accepted: boolean; step: number | null }> {
  const provider = getTotpKeyProvider();
  const secretBase32 = decryptTotpSecret(provider, {
    ciphertext: credential.secretCiphertext,
    iv: credential.secretIv,
    authTag: credential.secretAuthTag,
    keyVersion: credential.keyVersion,
  });
  const totp = buildTotp(Secret.fromBase32(secretBase32), 'verify');
  const delta = totp.validate({ token: code, window: TOTP_WINDOW });
  if (delta === null) return { accepted: false, step: null };

  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS) + delta;
  if (credential.lastUsedStep !== null && currentStep <= credential.lastUsedStep) {
    // Replay of an already-accepted timestep (or an older one) - reject.
    return { accepted: false, step: null };
  }
  return { accepted: true, step: currentStep };
}

/** Used by both `confirmTotpEnrollment` and login/step-up's second-factor verification. Returns false for "no credential"/"wrong code"/"replay" alike - callers must not distinguish these to the caller. */
export async function verifyTotpCode(
  tx: TransactionClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const credential = await findTotpCredential(tx, userId);
  if (!credential || !credential.confirmedAt) return false;
  const result = await verifyCodeAgainstCredential(credential, code);
  if (!result.accepted || result.step === null) return false;
  await recordTotpStepUsed(tx, credential.id, result.step);
  return true;
}

import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DomainValidationError, InvalidOrExpiredTokenError } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { DEFAULT_SESSION_POLICY } from '../session-policy.js';
import { requireRecentAuthentication, requireStepUp } from '../assurance.js';
import { webauthnChallenges } from '../schema/sessions.js';
import {
  findWebAuthnCredentialByCredentialId,
  findWebAuthnCredentialById,
  insertWebAuthnCredential,
  listWebAuthnCredentials,
  renameWebAuthnCredential,
  revokeWebAuthnCredential,
  updateWebAuthnCounter,
} from '../repository/credentials.js';
import { findPrimaryEmailForUser, findUserById } from '../repository/users.js';
import { consumeWebAuthnChallenge, insertWebAuthnChallenge } from '../repository/tokens.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

const RP_NAME = 'Vercentlabs ERP';

export interface WebAuthnRpConfig {
  rpId: string;
  expectedOrigin: string;
}

/** `exactOptionalPropertyTypes` distinguishes "key absent" from "key present with value undefined" - this only ever produces the former for a null/missing transports list. */
function toCredentialDescriptor(
  id: string,
  transports: string[] | null | undefined,
): { id: string; transports?: string[] } {
  return transports && transports.length > 0 ? { id, transports } : { id };
}

// ---------------------------------------------------------------------
// Registration (adding a new passkey to an already-known, authenticated user)
// ---------------------------------------------------------------------

export async function beginWebAuthnRegistration(
  db: NodePgDatabase,
  input: { userId: string; authenticatedAt: Date; rp: WebAuthnRpConfig },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  requireRecentAuthentication(input.authenticatedAt);
  return withUserScope(db, input.userId, async (tx) => {
    const [user, email, existingCredentials] = await Promise.all([
      findUserById(tx, input.userId),
      findPrimaryEmailForUser(tx, input.userId),
      listWebAuthnCredentials(tx, input.userId),
    ]);
    if (!user) throw new DomainValidationError('User not found.');

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: input.rp.rpId,
      userName: email?.emailOriginal ?? input.userId,
      userDisplayName: user.displayName ?? email?.emailOriginal ?? input.userId,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((credential) =>
        toCredentialDescriptor(credential.credentialId, credential.transports),
      ),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    await insertWebAuthnChallenge(tx, {
      userId: input.userId,
      purpose: 'REGISTRATION',
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + DEFAULT_SESSION_POLICY.webauthnChallengeTimeoutMs),
    });

    return options;
  });
}

export async function completeWebAuthnRegistration(
  db: NodePgDatabase,
  input: {
    userId: string;
    name: string;
    /** Opaque at the API boundary, like `verifyWebAuthnAuthenticationAssertion`'s `credential` - `@simplewebauthn/server` types are a command-layer-only concern (see `packages/contracts/src/identity/mfa.ts`). */
    response: Record<string, unknown>;
    rp: WebAuthnRpConfig;
    correlationId: string;
    requestId: string;
  },
): Promise<void> {
  const response = input.response as unknown as RegistrationResponseJSON;
  await withUserScope(db, input.userId, async (tx) => {
    const challenge = await findLatestUnconsumedChallenge(tx, input.userId, 'REGISTRATION');
    if (!challenge) throw new InvalidOrExpiredTokenError('No pending registration challenge.');

    const existingWithSameCredentialId = await findWebAuthnCredentialByCredentialId(
      tx,
      response.id,
    );
    if (existingWithSameCredentialId) {
      throw new DomainValidationError('This passkey is already registered.');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.rp.expectedOrigin,
      expectedRPID: input.rp.rpId,
      requireUserPresence: true,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new DomainValidationError('WebAuthn registration could not be verified.');
    }

    const consumed = await consumeWebAuthnChallenge(tx, challenge.id);
    if (!consumed) throw new InvalidOrExpiredTokenError();

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const row = await insertWebAuthnCredential(tx, {
      userId: input.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? null,
      name: input.name,
    });

    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'passkey.registered',
      targetType: 'WebAuthnCredential',
      targetId: row.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
      changedFields: { name: input.name },
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'WebAuthnCredential',
      aggregateId: row.id,
      eventType: 'passkey.registered',
      aggregateVersion: 1,
      payload: { userId: input.userId },
      correlationId: input.correlationId,
    });
  });
}

export async function renameCredential(
  db: NodePgDatabase,
  input: {
    userId: string;
    credentialId: string;
    name: string;
    correlationId: string;
    requestId: string;
  },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    const credential = await findWebAuthnCredentialById(tx, input.credentialId);
    if (!credential || credential.userId !== input.userId || credential.revokedAt) {
      throw new DomainValidationError('Passkey not found.');
    }
    await renameWebAuthnCredential(tx, credential.id, input.name);
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'passkey.renamed',
      targetType: 'WebAuthnCredential',
      targetId: credential.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
      changedFields: { name: input.name },
    });
  });
}

export async function removeCredential(
  db: NodePgDatabase,
  input: {
    userId: string;
    sessionId: string;
    credentialId: string;
    correlationId: string;
    requestId: string;
  },
): Promise<void> {
  await requireStepUp(db, {
    userId: input.userId,
    sessionId: input.sessionId,
    purpose: 'mfa_removal_reset',
  });
  await withUserScope(db, input.userId, async (tx) => {
    const credential = await findWebAuthnCredentialById(tx, input.credentialId);
    if (!credential || credential.userId !== input.userId || credential.revokedAt) {
      throw new DomainValidationError('Passkey not found.');
    }
    await revokeWebAuthnCredential(tx, credential.id);
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'passkey.removed',
      targetType: 'WebAuthnCredential',
      targetId: credential.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'WebAuthnCredential',
      aggregateId: credential.id,
      eventType: 'passkey.removed',
      aggregateVersion: 1,
      payload: { userId: input.userId },
      correlationId: input.correlationId,
    });
  });
}

// ---------------------------------------------------------------------
// Authentication (login / MFA-login second factor)
// ---------------------------------------------------------------------

export async function beginWebAuthnAuthentication(
  db: NodePgDatabase,
  input: { userId?: string | null; rp: WebAuthnRpConfig },
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return withUserScope(db, null, async (tx) => {
    const allowCredentials = input.userId
      ? (await listWebAuthnCredentials(tx, input.userId)).map((credential) =>
          toCredentialDescriptor(credential.credentialId, credential.transports),
        )
      : undefined;

    const options = await generateAuthenticationOptions({
      rpID: input.rp.rpId,
      ...(allowCredentials ? { allowCredentials } : {}),
      userVerification: 'preferred',
    });

    await insertWebAuthnChallenge(tx, {
      userId: input.userId ?? null,
      purpose: 'AUTHENTICATION',
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + DEFAULT_SESSION_POLICY.webauthnChallengeTimeoutMs),
    });

    return options;
  });
}

/**
 * Shared verification core used by login's WebAuthn second factor AND
 * step-up. Returns true/false rather than throwing, since both callers
 * must fold this into their own generic-failure response.
 */
export async function verifyWebAuthnAuthenticationAssertion(
  tx: TransactionClient,
  input: {
    userId: string;
    credential: Record<string, unknown>;
    rpId: string;
    expectedOrigin: string;
    requireUserVerification: boolean;
  },
): Promise<boolean> {
  const response = input.credential as unknown as AuthenticationResponseJSON;
  const storedCredential = await findWebAuthnCredentialByCredentialId(tx, response.id);
  if (!storedCredential || storedCredential.userId !== input.userId || storedCredential.revokedAt) {
    return false;
  }

  const challenge = await findLatestUnconsumedChallenge(tx, input.userId, 'AUTHENTICATION');
  if (!challenge) return false;

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.rpId,
      credential: {
        ...toCredentialDescriptor(storedCredential.credentialId, storedCredential.transports),
        publicKey: new Uint8Array(storedCredential.publicKey),
        counter: storedCredential.counter,
      },
      requireUserVerification: input.requireUserVerification,
    });
    if (!verification.verified) return false;

    // Counter regression can legitimately happen for cloned/synced
    // passkeys (multi-device credentials are explicitly allowed to have a
    // counter that never increments, per FIDO's own guidance) - only a
    // regression on a SINGLE-device credential would be suspicious, and
    // even then this records the new value rather than blocking the login
    // outright; it is never treated as grounds for an automatic
    // account-takeover lockout, per "handle legitimate counter
    // limitations without unsafe automatic account takeover assumptions."
    await updateWebAuthnCounter(
      tx,
      storedCredential.id,
      verification.authenticationInfo.newCounter,
    );
    await consumeWebAuthnChallenge(tx, challenge.id);
    return true;
  } catch {
    return false;
  }
}

async function findLatestUnconsumedChallenge(
  db: QueryExecutor,
  userId: string,
  purpose: 'REGISTRATION' | 'AUTHENTICATION' | 'STEP_UP',
) {
  const rows = await db
    .select()
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.userId, userId),
        eq(webauthnChallenges.purpose, purpose),
        isNull(webauthnChallenges.consumedAt),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(webauthnChallenges.createdAt))
    .limit(1);
  return rows[0];
}

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  AuthenticationFailedError,
  RateLimitedError,
  InvalidOrExpiredTokenError,
  type LoginResponse,
} from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { generateOpaqueToken, hashToken } from '../crypto/token-hash.js';
import { normalizeEmail } from '../normalize-email.js';
import { normalizePassword } from '../crypto/password-normalize.js';
import { hashPassword, needsRehash, verifyPassword } from '../crypto/password-hasher.js';
import { canCreateSession, type UserStatus } from '../status.js';
import { DEFAULT_SESSION_POLICY, RATE_LIMIT_POLICY } from '../session-policy.js';
import { findEmailByNormalized, findUserById } from '../repository/users.js';
import {
  findPasswordCredential,
  findTotpCredential,
  listWebAuthnCredentials,
  updatePasswordHash,
} from '../repository/credentials.js';
import {
  countRecentFailedAttemptsForIdentity,
  countRecentFailedAttemptsForIp,
  recordAuthenticationAttempt,
  type AuthenticationOutcome,
} from '../repository/security-events.js';
import {
  insertSession,
  revokeAllSessionsForUser,
  revokeSessionById,
} from '../repository/sessions.js';
import {
  consumeMfaLoginToken,
  findMfaLoginTokenByHash,
  insertMfaLoginToken,
} from '../repository/mfa-login.js';
import { verifyTotpCode } from './totp-commands.js';
import {
  beginWebAuthnAuthentication,
  verifyWebAuthnAuthenticationAssertion,
  type WebAuthnRpConfig,
} from './webauthn-commands.js';
import { consumeRecoveryCodeIfValid } from './recovery-code-commands.js';
import type { TransactionClient } from '../tx.js';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';

export interface RequestMeta {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  correlationId: string;
  requestId: string;
}

export interface LoginInput extends RequestMeta {
  email: string;
  password: string;
}

/** Internal result: the public `LoginResponse` DTO plus, only on full success, the raw session token the HTTP layer sets as a cookie - never part of the JSON body. */
export type LoginCommandResult =
  | {
      response: Extract<LoginResponse, { outcome: 'AUTHENTICATED' }>;
      session: { id: string; rawToken: string; expiresAt: Date };
    }
  | { response: Extract<LoginResponse, { outcome: 'MFA_REQUIRED' }> };

async function assertNotRateLimited(
  tx: TransactionClient,
  identityKey: string,
  ipAddress: string | null | undefined,
): Promise<void> {
  const [byIdentity, byIp] = await Promise.all([
    countRecentFailedAttemptsForIdentity(tx, identityKey, RATE_LIMIT_POLICY.perIdentity.windowMs),
    ipAddress
      ? countRecentFailedAttemptsForIp(tx, ipAddress, RATE_LIMIT_POLICY.perIp.windowMs)
      : Promise.resolve(0),
  ]);
  if (
    byIdentity >= RATE_LIMIT_POLICY.perIdentity.maxAttempts ||
    byIp >= RATE_LIMIT_POLICY.perIp.maxAttempts
  ) {
    throw new RateLimitedError(
      'Too many attempts. Try again later.',
      Math.ceil(RATE_LIMIT_POLICY.perIdentity.windowMs / 1000),
    );
  }
}

async function fail(
  tx: TransactionClient,
  identityKey: string,
  ipAddress: string | null | undefined,
  outcome: AuthenticationOutcome,
): Promise<never> {
  await recordAuthenticationAttempt(tx, { identityKey, ipAddress, outcome });
  throw new AuthenticationFailedError();
}

function buildSessionCookiePair(): { rawToken: string; tokenHash: string } {
  const rawToken = generateOpaqueToken();
  return { rawToken, tokenHash: hashToken(rawToken) };
}

/**
 * The entire login command runs under `erp_auth_pipeline` (userId: null in
 * scope) - see command-helpers.ts and docs/architecture/identity-model.md
 * for why: looking a user up BY email cannot itself be user-scoped.
 */
export async function login(db: NodePgDatabase, input: LoginInput): Promise<LoginCommandResult> {
  const emailNormalized = normalizeEmail(input.email);

  return withUserScope(db, null, async (tx) => {
    await assertNotRateLimited(tx, emailNormalized, input.ipAddress);

    const emailRow = await findEmailByNormalized(tx, emailNormalized);
    if (!emailRow) return fail(tx, emailNormalized, input.ipAddress, 'UNKNOWN_ACCOUNT');

    const user = await findUserById(tx, emailRow.userId);
    if (!user || !canCreateSession(user.status as UserStatus)) {
      const outcome: AuthenticationOutcome =
        user?.status === 'SUSPENDED'
          ? 'SUSPENDED'
          : user?.status === 'DEACTIVATED'
            ? 'DEACTIVATED'
            : 'UNKNOWN_ACCOUNT';
      return fail(tx, emailNormalized, input.ipAddress, outcome);
    }
    if (!emailRow.verifiedAt) {
      return fail(tx, emailNormalized, input.ipAddress, 'UNVERIFIED_EMAIL');
    }

    const credential = await findPasswordCredential(tx, user.id);
    if (!credential) return fail(tx, emailNormalized, input.ipAddress, 'INVALID_CREDENTIALS');

    const passwordOk = await verifyPassword(
      credential.passwordHash,
      normalizePassword(input.password),
    );
    if (!passwordOk) return fail(tx, emailNormalized, input.ipAddress, 'INVALID_CREDENTIALS');

    // Rehash while the plaintext is still in scope - this is the only
    // moment it ever will be again.
    if (needsRehash(credential.passwordHash)) {
      const freshHash = await hashPassword(normalizePassword(input.password));
      await updatePasswordHash(tx, user.id, freshHash);
      await recordAuditEvent(tx, {
        actorId: user.id,
        actorType: 'user',
        action: 'password.rehashed',
        targetType: 'User',
        targetId: user.id,
        correlationId: input.correlationId,
        requestId: input.requestId,
      });
    }

    const [totp, webauthnCredentials] = await Promise.all([
      findTotpCredential(tx, user.id),
      listWebAuthnCredentials(tx, user.id),
    ]);
    const mfaEnabled = Boolean(totp?.confirmedAt) || webauthnCredentials.length > 0;

    if (mfaEnabled) {
      await recordAuthenticationAttempt(tx, {
        identityKey: emailNormalized,
        ipAddress: input.ipAddress,
        outcome: 'MFA_REQUIRED',
      });
      const rawMfaToken = generateOpaqueToken();
      await insertMfaLoginToken(tx, {
        userId: user.id,
        tokenHash: hashToken(rawMfaToken),
        expiresAt: new Date(Date.now() + DEFAULT_SESSION_POLICY.mfaTokenTimeoutMs),
      });
      const availableMethods: ('TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE')[] = [];
      if (totp?.confirmedAt) availableMethods.push('TOTP');
      if (webauthnCredentials.length > 0) availableMethods.push('WEBAUTHN');
      availableMethods.push('RECOVERY_CODE');
      return { response: { outcome: 'MFA_REQUIRED', mfaToken: rawMfaToken, availableMethods } };
    }

    await recordAuthenticationAttempt(tx, {
      identityKey: emailNormalized,
      ipAddress: input.ipAddress,
      outcome: 'SUCCESS',
    });
    const session = await createFullSession(tx, {
      userId: user.id,
      securityStamp: user.securityStamp,
      assuranceLevel: 'AAL1',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    await recordAuditEvent(tx, {
      actorId: user.id,
      actorType: 'user',
      action: 'login.success',
      targetType: 'User',
      targetId: user.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'Session',
      aggregateId: session.id,
      eventType: 'session.created',
      aggregateVersion: 1,
      payload: { userId: user.id },
      correlationId: input.correlationId,
    });

    return {
      response: { outcome: 'AUTHENTICATED', assuranceLevel: 'AAL1' },
      session: { id: session.id, rawToken: session.rawToken, expiresAt: session.expiresAt },
    };
  });
}

async function createFullSession(
  tx: TransactionClient,
  input: {
    userId: string;
    securityStamp: string;
    assuranceLevel: 'AAL1' | 'AAL2';
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
  },
): Promise<{ id: string; rawToken: string; expiresAt: Date }> {
  const { rawToken, tokenHash } = buildSessionCookiePair();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_POLICY.absoluteTimeoutMs);
  const inactivityExpiresAt = new Date(now.getTime() + DEFAULT_SESSION_POLICY.inactivityTimeoutMs);
  const row = await insertSession(tx, {
    userId: input.userId,
    tokenHash,
    securityStamp: input.securityStamp,
    assuranceLevel: input.assuranceLevel,
    authenticatedAt: now,
    expiresAt,
    inactivityExpiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  return { id: row.id, rawToken, expiresAt };
}

export interface CompleteMfaLoginInput extends RequestMeta {
  mfaToken: string;
  method: 'TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE';
  code?: string;
  credential?: Record<string, unknown>;
  webauthn?: WebAuthnRpConfig;
}

/**
 * Issues the WebAuthn authentication challenge for an in-progress MFA login,
 * resolving `mfaToken` to a user without consuming it (a wrong or abandoned
 * WebAuthn attempt must not burn the mfa login token - only
 * `completeMfaLogin`'s successful verification does).
 */
export async function beginMfaWebAuthnChallenge(
  db: NodePgDatabase,
  input: { mfaToken: string; webauthn: WebAuthnRpConfig },
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const mfaTokenHash = hashToken(input.mfaToken);
  const userId = await withUserScope(db, null, async (tx) => {
    const tokenRow = await findMfaLoginTokenByHash(tx, mfaTokenHash);
    if (!tokenRow || tokenRow.consumedAt || tokenRow.expiresAt.getTime() < Date.now()) {
      throw new InvalidOrExpiredTokenError();
    }
    return tokenRow.userId;
  });
  return beginWebAuthnAuthentication(db, { userId, rp: input.webauthn });
}

export async function completeMfaLogin(
  db: NodePgDatabase,
  input: CompleteMfaLoginInput,
): Promise<LoginCommandResult> {
  const mfaTokenHash = hashToken(input.mfaToken);

  return withUserScope(db, null, async (tx) => {
    const tokenRow = await findMfaLoginTokenByHash(tx, mfaTokenHash);
    if (!tokenRow || tokenRow.consumedAt || tokenRow.expiresAt.getTime() < Date.now()) {
      throw new InvalidOrExpiredTokenError();
    }

    const user = await findUserById(tx, tokenRow.userId);
    if (!user || !canCreateSession(user.status as UserStatus)) {
      throw new AuthenticationFailedError();
    }

    await assertNotRateLimited(tx, `mfa:${user.id}`, input.ipAddress);

    let verified = false;
    if (input.method === 'TOTP') {
      if (!input.code) throw new AuthenticationFailedError();
      verified = await verifyTotpCode(tx, user.id, input.code);
    } else if (input.method === 'WEBAUTHN') {
      if (!input.credential || !input.webauthn) throw new AuthenticationFailedError();
      verified = await verifyWebAuthnAuthenticationAssertion(tx, {
        userId: user.id,
        credential: input.credential,
        rpId: input.webauthn.rpId,
        expectedOrigin: input.webauthn.expectedOrigin,
        requireUserVerification: false,
      });
    } else {
      if (!input.code) throw new AuthenticationFailedError();
      verified = await consumeRecoveryCodeIfValid(tx, user.id, input.code);
    }

    if (!verified) {
      await recordAuthenticationAttempt(tx, {
        identityKey: `mfa:${user.id}`,
        ipAddress: input.ipAddress,
        outcome: 'MFA_FAILED',
      });
      throw new AuthenticationFailedError();
    }

    const consumed = await consumeMfaLoginToken(tx, tokenRow.id);
    if (!consumed) throw new InvalidOrExpiredTokenError();

    // Recovery-code-completed logins land at AAL1 (explicitly a lower/
    // recovery assurance path, per this prompt's step-up requirements) -
    // TOTP/WebAuthn second factors land at AAL2, since a genuine second
    // factor was proven.
    const assuranceLevel = input.method === 'RECOVERY_CODE' ? 'AAL1' : 'AAL2';
    const session = await createFullSession(tx, {
      userId: user.id,
      securityStamp: user.securityStamp,
      assuranceLevel,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await recordAuthenticationAttempt(tx, {
      identityKey: `mfa:${user.id}`,
      ipAddress: input.ipAddress,
      outcome: 'SUCCESS',
    });
    await recordAuditEvent(tx, {
      actorId: user.id,
      actorType: 'user',
      action: 'login.mfa_success',
      targetType: 'User',
      targetId: user.id,
      correlationId: input.correlationId,
      requestId: input.requestId,
      changedFields: { method: input.method },
    });
    await recordOutboxEvent(tx, {
      aggregateType: 'Session',
      aggregateId: session.id,
      eventType: 'session.created',
      aggregateVersion: 1,
      payload: { userId: user.id },
      correlationId: input.correlationId,
    });

    return {
      response: { outcome: 'AUTHENTICATED', assuranceLevel },
      session: { id: session.id, rawToken: session.rawToken, expiresAt: session.expiresAt },
    };
  });
}

export async function logout(
  db: NodePgDatabase,
  input: { userId: string; sessionId: string; correlationId: string; requestId: string },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    await revokeSessionById(tx, input.sessionId, 'user_logout');
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'session.revoked',
      targetType: 'Session',
      targetId: input.sessionId,
      reason: 'user_logout',
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
  });
}

export async function logoutAll(
  db: NodePgDatabase,
  input: { userId: string; correlationId: string; requestId: string },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    await revokeAllSessionsForUser(tx, input.userId, 'user_logout_all');
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'session.revoked_all',
      targetType: 'User',
      targetId: input.userId,
      reason: 'user_logout_all',
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
  });
}

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuthenticationFailedError, type StepUpPurpose } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { normalizePassword } from '../crypto/password-normalize.js';
import { verifyPassword } from '../crypto/password-hasher.js';
import { DEFAULT_SESSION_POLICY } from '../session-policy.js';
import { findPasswordCredential } from '../repository/credentials.js';
import { insertStepUpToken } from '../repository/tokens.js';
import { upgradeSessionAssurance } from '../repository/sessions.js';
import { verifyTotpCode } from './totp-commands.js';
import { verifyWebAuthnAuthenticationAssertion } from './webauthn-commands.js';
import { consumeRecoveryCodeIfValid } from './recovery-code-commands.js';

export { requireRecentAuthentication, requireStepUp } from '../assurance.js';

export interface CompleteStepUpInput {
  userId: string;
  sessionId: string;
  purpose: StepUpPurpose;
  correlationId: string;
  requestId: string;
  method: 'PASSWORD_TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE';
  password?: string;
  code?: string;
  credential?: Record<string, unknown>;
  webauthnRpId: string;
  webauthnExpectedOrigin: string;
}

/** A password-manager-hostile action: proves fresh authentication for one purpose, on one session, for a short window. */
export async function completeStepUp(
  db: NodePgDatabase,
  input: CompleteStepUpInput,
): Promise<{ expiresAt: string }> {
  return withUserScope(db, input.userId, async (tx) => {
    let verified = false;

    if (input.method === 'PASSWORD_TOTP') {
      if (!input.password || !input.code)
        throw new AuthenticationFailedError('Password and code are required.');
      const credential = await findPasswordCredential(tx, input.userId);
      if (!credential) throw new AuthenticationFailedError();
      const passwordOk = await verifyPassword(
        credential.passwordHash,
        normalizePassword(input.password),
      );
      if (!passwordOk) throw new AuthenticationFailedError();
      verified = await verifyTotpCode(tx, input.userId, input.code);
    } else if (input.method === 'WEBAUTHN') {
      if (!input.credential) throw new AuthenticationFailedError();
      verified = await verifyWebAuthnAuthenticationAssertion(tx, {
        userId: input.userId,
        credential: input.credential,
        rpId: input.webauthnRpId,
        expectedOrigin: input.webauthnExpectedOrigin,
        requireUserVerification: true,
      });
    } else {
      if (!input.code) throw new AuthenticationFailedError();
      verified = await consumeRecoveryCodeIfValid(tx, input.userId, input.code);
    }

    if (!verified) {
      throw new AuthenticationFailedError('Step-up verification failed.');
    }

    const expiresAt = new Date(Date.now() + DEFAULT_SESSION_POLICY.stepUpTimeoutMs);
    await insertStepUpToken(tx, {
      sessionId: input.sessionId,
      userId: input.userId,
      purpose: input.purpose,
      method: input.method,
      assuranceLevel: 'AAL2',
      expiresAt,
    });
    await upgradeSessionAssurance(tx, input.sessionId, {
      assuranceLevel: 'AAL2',
      lastStepUpAt: new Date(),
      lastStepUpPurpose: input.purpose,
    });

    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'step_up.success',
      targetType: 'User',
      targetId: input.userId,
      correlationId: input.correlationId,
      requestId: input.requestId,
      changedFields: { purpose: input.purpose, method: input.method },
    });

    return { expiresAt: expiresAt.toISOString() };
  });
}

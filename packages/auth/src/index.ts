/**
 * Type-only scaffolding for SP004 (identity and user lifecycle), SP005
 * (authentication and credential security), SP006 (session and device
 * security) and SP007 (MFA, account recovery, step-up authentication).
 *
 * No credential hashing, session storage, token issuance or MFA logic is
 * implemented in this prompt - see product/registers/shared-platform.yaml.
 * These types exist so apps/api and platform/identity have a stable shape to
 * implement against later without a breaking contract change.
 */

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  organizationId: string;
  issuedAt: string;
  expiresAt: string;
  mfaVerified: boolean;
}

export interface AuthenticationResult {
  session: AuthenticatedSession;
}

/** To be implemented alongside SP005/SP006. */
export interface SessionValidator {
  validate(sessionToken: string): Promise<AuthenticatedSession | null>;
}

/** To be implemented alongside SP007. */
export interface StepUpChallenge {
  challengeId: string;
  method: 'totp' | 'webauthn' | 'recovery_code';
  expiresAt: string;
}

export function isAuthenticatedSession(value: unknown): value is AuthenticatedSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AuthenticatedSession>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.organizationId === 'string' &&
    typeof candidate.mfaVerified === 'boolean'
  );
}

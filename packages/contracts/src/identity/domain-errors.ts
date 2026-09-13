/**
 * SP004-SP007 domain error vocabulary. Framework-free, like
 * ../platform/domain-errors.ts - apps/api's exception filter maps these
 * onto the typed ErrorCode contract.
 */

/**
 * The ONE error every failed login/MFA-verification path throws,
 * regardless of the real reason (unknown email, wrong password, suspended,
 * unverified email, deactivated, wrong TOTP code, ...). Account-enumeration
 * resistance (OWASP Authentication Cheat Sheet) requires that a client can
 * never distinguish these cases from the response; the real reason is
 * still recorded in `auth.authentication_attempts` and the audit trail for
 * legitimate operational/security use, just never returned to the caller.
 */
export class AuthenticationFailedError extends Error {
  constructor(message = 'Incorrect email or password.') {
    super(message);
    this.name = 'AuthenticationFailedError';
  }
}

/** A capability token (invitation, verification, password-reset, WebAuthn challenge) was invalid, expired, or already used. */
export class InvalidOrExpiredTokenError extends Error {
  constructor(message = 'This link is invalid or has expired.') {
    super(message);
    this.name = 'InvalidOrExpiredTokenError';
  }
}

/** Too many attempts for this identity/IP in the current window - bounded, time-limited, never a permanent lock. */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/**
 * Thrown by any self-service action in a designated high-risk category
 * when the caller's session lacks sufficiently fresh authentication.
 * `acceptableMethods` only ever lists method *names*, never any
 * authenticator secret/material - see docs/architecture/authentication-assurance.md.
 */
export class StepUpRequiredError extends Error {
  constructor(
    public readonly purpose: string,
    public readonly acceptableMethods: readonly ('PASSWORD_TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE')[],
  ) {
    super(`This action requires a recent step-up authentication (${purpose}).`);
    this.name = 'StepUpRequiredError';
  }
}

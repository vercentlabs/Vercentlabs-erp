/**
 * Default enterprise AAL2-oriented session policy (OWASP Session
 * Management Cheat Sheet, NIST SP 800-63B-4 SS4.3): a session's absolute
 * lifetime is capped independently of activity, and a shorter rolling
 * inactivity window closes it sooner if the user stops using it. Both are
 * validated server-side configuration, never client-supplied.
 */
export interface SessionPolicy {
  /** Absolute session lifetime from creation, regardless of activity. */
  absoluteTimeoutMs: number;
  /** Session closes if unused for this long, refreshed on each qualifying request. */
  inactivityTimeoutMs: number;
  /** Minimum interval between `last_seen_at` writes, so every request does not each cause a write. */
  lastSeenWriteIntervalMs: number;
  /** How long a step-up grant remains valid for its purpose+session. */
  stepUpTimeoutMs: number;
  /** How long a capability token (verification/reset/invitation) remains valid. */
  tokenTimeoutMs: number;
  /** How long an MFA login token (between first factor and second factor) remains valid. */
  mfaTokenTimeoutMs: number;
  /** How long a WebAuthn ceremony challenge remains valid. */
  webauthnChallengeTimeoutMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  absoluteTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  inactivityTimeoutMs: 60 * 60 * 1000, // 1 hour
  lastSeenWriteIntervalMs: 5 * 60 * 1000, // 5 minutes
  stepUpTimeoutMs: 10 * 60 * 1000, // 10 minutes
  tokenTimeoutMs: 60 * 60 * 1000, // 1 hour
  mfaTokenTimeoutMs: 5 * 60 * 1000, // 5 minutes
  webauthnChallengeTimeoutMs: 5 * 60 * 1000, // 5 minutes
};

/** Rate-limit windows for the credential-stuffing defence (auth.authentication_attempts). Bounded, never permanent. */
export const RATE_LIMIT_POLICY = {
  perIdentity: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  perIp: { windowMs: 15 * 60 * 1000, maxAttempts: 20 },
};

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { StepUpRequiredError, type StepUpPurpose } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { findActiveStepUpToken } from './repository/tokens.js';

/**
 * Pure authentication-assurance reads, deliberately isolated from
 * totp-commands.ts/webauthn-commands.ts/recovery-code-commands.ts (which
 * this module must NOT import - they import this one, to verify a step-up
 * attempt, and importing back would create a cycle). See
 * commands/step-up-commands.ts for the command that actually PRODUCES a
 * step-up grant.
 */

const ACCEPTABLE_STEP_UP_METHODS = ['PASSWORD_TOTP', 'WEBAUTHN', 'RECOVERY_CODE'] as const;

/**
 * Lighter-weight than {@link requireStepUp}: enrolling a FIRST authenticator
 * (there is nothing yet to step up WITH) only needs proof the session's own
 * full authentication is recent, not a fresh second-factor ceremony.
 * Removing an EXISTING authenticator, or adding an additional one once MFA
 * is already active, goes through the full `requireStepUp` instead - see
 * docs/security/mfa-and-recovery.md.
 */
export function requireRecentAuthentication(
  authenticatedAt: Date,
  maxAgeMs = 30 * 60 * 1000,
): void {
  if (Date.now() - authenticatedAt.getTime() > maxAgeMs) {
    throw new StepUpRequiredError('mfa_removal_reset', ACCEPTABLE_STEP_UP_METHODS);
  }
}

/**
 * Called by any high-risk self-service command before proceeding. Throws
 * `StepUpRequiredError` (never silently degrades authorization - step-up
 * is an authentication-assurance check, and callers still separately
 * enforce whatever authorization applies to the action itself).
 */
export async function requireStepUp(
  db: NodePgDatabase,
  input: { userId: string; sessionId: string; purpose: StepUpPurpose },
): Promise<void> {
  const grant = await withUserScope(db, input.userId, (tx) =>
    findActiveStepUpToken(tx, { sessionId: input.sessionId, purpose: input.purpose }),
  );
  if (!grant || grant.expiresAt.getTime() < Date.now()) {
    throw new StepUpRequiredError(input.purpose, ACCEPTABLE_STEP_UP_METHODS);
  }
}

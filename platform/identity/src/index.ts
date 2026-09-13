/**
 * Platform module: identity
 * Shared-platform capabilities: SP004, SP005, SP006, SP007
 * Status: NOT_STARTED in the shared-platform register - implementation
 * evidence for this prompt lives at
 * product/evidence/PROMPT-002B-SP004-SP007-IDENTITY-AUTH.md. Final
 * IMPLEMENTED/PRODUCT_READY certification is deferred until SP008-SP010
 * integration and the Prompt 002D E2E/UAT pass.
 *
 * Owns global identity (SP004: users, email addresses, organization
 * memberships, invitations, lifecycle), authentication and credential
 * security (SP005: passwords, rate-limiting), session/device security
 * (SP006), and MFA/recovery/step-up (SP007: TOTP, WebAuthn, recovery
 * codes). Deliberately carries no role/permission model - SP008 owns that
 * entirely; this module's `AuthenticatedIdentity` never invents a role.
 */
export const PLATFORM_MODULE = 'identity' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP004', 'SP005', 'SP006', 'SP007'] as const;

export * from './schema/identity.js';
export * from './schema/credentials.js';
export * from './schema/sessions.js';
export * from './schema/security-events.js';
export * from './schema/mfa-login.js';

export * from './tx.js';
export * from './status.js';
export * from './mappers.js';
export * from './normalize-email.js';
export * from './password-policy.js';
export * from './session-policy.js';
export * from './assurance.js';
export * from './totp-key-provider.js';
export * from './command-helpers.js';

export * from './crypto/password-hasher.js';
export * from './crypto/password-normalize.js';
export * from './crypto/password-blocklist.js';
export * from './crypto/token-hash.js';
export * from './crypto/recovery-code.js';
export * from './crypto/totp-secret-cipher.js';

export * from './email/email-provider.js';

export * from './repository/users.js';
export * from './repository/invitations.js';
export * from './repository/credentials.js';
export * from './repository/sessions.js';
export * from './repository/tokens.js';
export * from './repository/security-events.js';
export * from './repository/mfa-login.js';

export * from './commands/invitation-commands.js';
export * from './commands/email-verification-commands.js';
export * from './commands/authentication-commands.js';
export * from './commands/password-commands.js';
export * from './commands/session-commands.js';
export * from './commands/totp-commands.js';
export * from './commands/webauthn-commands.js';
export * from './commands/recovery-code-commands.js';
export * from './commands/step-up-commands.js';
export * from './commands/profile-commands.js';

import { z } from 'zod';
import { assuranceLevelSchema } from './session-context.js';

/**
 * Password policy (NIST SP 800-63B-4, OWASP Password Storage Cheat Sheet):
 * length only, no composition rules. Unicode and spaces are accepted as-is;
 * NFKC normalization is applied at the domain layer before hashing (see
 * docs/security/password-security.md), never here, since normalization is
 * a hashing-input concern, not a validation concern. The 256-character
 * ceiling is an operational abuse guard (bounding Argon2id's input size),
 * not a composition rule - it sits far above the required 64-character
 * minimum support.
 */
export const passwordSchema = z.string().min(15).max(256);

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Discriminated on `outcome` so a client can never mistake "MFA needed" for "signed in". */
export const loginResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('AUTHENTICATED'), assuranceLevel: assuranceLevelSchema }),
  z.object({
    outcome: z.literal('MFA_REQUIRED'),
    mfaToken: z.string(),
    availableMethods: z.array(z.enum(['TOTP', 'WEBAUTHN', 'RECOVERY_CODE'])),
  }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const beginMfaWebAuthnChallengeRequestSchema = z.object({
  mfaToken: z.string(),
});
export type BeginMfaWebAuthnChallengeRequest = z.infer<
  typeof beginMfaWebAuthnChallengeRequestSchema
>;

export const completeMfaLoginRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('TOTP'), mfaToken: z.string(), code: z.string().min(6).max(10) }),
  z.object({
    method: z.literal('WEBAUTHN'),
    mfaToken: z.string(),
    credential: z.record(z.string(), z.unknown()),
  }),
  z.object({
    method: z.literal('RECOVERY_CODE'),
    mfaToken: z.string(),
    code: z.string().min(1).max(64),
  }),
]);
export type CompleteMfaLoginRequest = z.infer<typeof completeMfaLoginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const requestPasswordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetRequestSchema>;

export const validateResetTokenRequestSchema = z.object({
  token: z.string().min(1),
});
export type ValidateResetTokenRequest = z.infer<typeof validateResetTokenRequestSchema>;

export const completePasswordResetRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type CompletePasswordResetRequest = z.infer<typeof completePasswordResetRequestSchema>;

export const sessionDtoSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  assuranceLevel: assuranceLevelSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  isCurrent: z.boolean(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const revokeSessionRequestSchema = z.object({
  sessionId: z.string().uuid(),
});
export type RevokeSessionRequest = z.infer<typeof revokeSessionRequestSchema>;

/** Action categories a step-up grant can be issued for - see docs/architecture/authentication-assurance.md. */
export const stepUpPurposeSchema = z.enum([
  'tenant_lifecycle_change',
  'company_closure',
  'user_suspension_deactivation',
  'role_permission_change',
  'mfa_removal_reset',
  'password_change',
  'session_revocation_of_another_user',
  'api_credential_management',
  'billing_change',
  'payroll_approval',
  'financial_close',
]);
export type StepUpPurpose = z.infer<typeof stepUpPurposeSchema>;

export const beginStepUpRequestSchema = z.object({
  purpose: stepUpPurposeSchema,
});
export type BeginStepUpRequest = z.infer<typeof beginStepUpRequestSchema>;

export const completeStepUpRequestSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('PASSWORD_TOTP'),
    purpose: stepUpPurposeSchema,
    password: z.string().min(1).max(256),
    code: z.string().min(6).max(10),
  }),
  z.object({
    method: z.literal('WEBAUTHN'),
    purpose: stepUpPurposeSchema,
    credential: z.record(z.string(), z.unknown()),
  }),
  z.object({
    method: z.literal('RECOVERY_CODE'),
    purpose: stepUpPurposeSchema,
    code: z.string().min(1).max(64),
  }),
]);
export type CompleteStepUpRequest = z.infer<typeof completeStepUpRequestSchema>;

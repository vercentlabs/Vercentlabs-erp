import { z } from 'zod';

// ---------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------

export const beginTotpEnrollmentResponseSchema = z.object({
  /** otpauth:// URI for QR-code rendering; also shown as a manual-entry secret. Never returned again after confirmation. */
  otpauthUri: z.string(),
  manualEntryKey: z.string(),
});
export type BeginTotpEnrollmentResponse = z.infer<typeof beginTotpEnrollmentResponseSchema>;

export const confirmTotpEnrollmentRequestSchema = z.object({
  code: z.string().min(6).max(10),
});
export type ConfirmTotpEnrollmentRequest = z.infer<typeof confirmTotpEnrollmentRequestSchema>;

// ---------------------------------------------------------------------
// WebAuthn - options/response bodies are opaque JSON here (the real,
// precisely-typed shapes live in @simplewebauthn/server, used only inside
// platform/identity's command layer; packages/contracts stays free of that
// dependency, matching root governance rule 8's module-boundary intent).
// ---------------------------------------------------------------------

export const beginWebAuthnRegistrationResponseSchema = z.record(z.string(), z.unknown());
export type BeginWebAuthnRegistrationResponse = z.infer<
  typeof beginWebAuthnRegistrationResponseSchema
>;

export const completeWebAuthnRegistrationRequestSchema = z.object({
  name: z.string().min(1).max(100),
  credential: z.record(z.string(), z.unknown()),
});
export type CompleteWebAuthnRegistrationRequest = z.infer<
  typeof completeWebAuthnRegistrationRequestSchema
>;

export const beginWebAuthnAuthenticationRequestSchema = z.object({
  email: z.string().email().optional(),
});
export type BeginWebAuthnAuthenticationRequest = z.infer<
  typeof beginWebAuthnAuthenticationRequestSchema
>;

export const completeWebAuthnAuthenticationRequestSchema = z.object({
  mfaToken: z.string().optional(),
  credential: z.record(z.string(), z.unknown()),
});
export type CompleteWebAuthnAuthenticationRequest = z.infer<
  typeof completeWebAuthnAuthenticationRequestSchema
>;

export const webAuthnCredentialDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
  deviceType: z.string().nullable(),
  backedUp: z.boolean(),
});
export type WebAuthnCredentialDto = z.infer<typeof webAuthnCredentialDtoSchema>;

export const renameWebAuthnCredentialRequestSchema = z.object({
  name: z.string().min(1).max(100),
});
export type RenameWebAuthnCredentialRequest = z.infer<typeof renameWebAuthnCredentialRequestSchema>;

// ---------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------

export const recoveryCodesResponseSchema = z.object({
  /** Plaintext codes, returned exactly once at generation/regeneration time - never retrievable again. */
  codes: z.array(z.string()),
  generatedAt: z.string().datetime({ offset: true }),
});
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;

export const useRecoveryCodeRequestSchema = z.object({
  mfaToken: z.string(),
  code: z.string().min(1).max(64),
});
export type UseRecoveryCodeRequest = z.infer<typeof useRecoveryCodeRequestSchema>;

export const mfaMethodsResponseSchema = z.object({
  totp: z.object({ confirmed: z.boolean() }),
  webauthn: z.array(webAuthnCredentialDtoSchema),
  recoveryCodesRemaining: z.number().int().min(0),
});
export type MfaMethodsResponse = z.infer<typeof mfaMethodsResponseSchema>;

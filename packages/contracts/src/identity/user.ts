import { z } from 'zod';

export const userStatusSchema = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userDtoSchema = z.object({
  id: z.string().uuid(),
  status: userStatusSchema,
  displayName: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  primaryEmailVerified: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const organizationMembershipDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']),
  joinedAt: z.string().datetime({ offset: true }),
});
export type OrganizationMembershipDto = z.infer<typeof organizationMembershipDtoSchema>;

/**
 * Display-name only. Unicode NFC-normalized before storage - see
 * docs/architecture/identity-model.md.
 */
export const updateProfileRequestSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
  displayName: z.string().min(1).max(200),
  password: z.string(), // length policy enforced by passwordPolicySchema (auth.ts) at the domain layer, not re-validated here to keep one source of truth
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendVerificationRequestSchema = z.object({
  email: z.string().email(),
});
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

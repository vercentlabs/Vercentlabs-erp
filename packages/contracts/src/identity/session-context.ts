import { z } from 'zod';

/**
 * The real, session-derived authenticated identity for SP004-SP007
 * self-service endpoints - a completely separate concept from
 * `TrustedScope` (../actor.js), which remains exclusively the SP001-SP003
 * control-plane's authorization primitive, still guarded by
 * `FailClosedTrustedScopeProvider`/`TrustedScopeGuard` and untouched by
 * this prompt.
 *
 * Deliberately narrow: it asserts only "who is this person, how strongly
 * authenticated are they right now, and which organizations do they
 * verifiably belong to" - never a role, permission, platform-operator
 * grant, company/branch access, or module entitlement. SP008-SP010 own all
 * of those; inventing any of them here would let SP004-SP007 silently
 * become a shadow authorization system.
 */
export const assuranceLevelSchema = z.enum(['AAL1', 'AAL2']);
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;

export const authenticatedIdentitySchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  assuranceLevel: assuranceLevelSchema,
  authenticatedAt: z.string().datetime({ offset: true }),
  lastStepUpAt: z.string().datetime({ offset: true }).nullable(),
  /** Organization ids this user currently holds an ACTIVE membership row for - membership only, never a permission. */
  organizationMemberships: z.array(z.string().uuid()),
});
export type AuthenticatedIdentity = z.infer<typeof authenticatedIdentitySchema>;

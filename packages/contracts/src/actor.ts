import { z } from 'zod';

export const actorTypeSchema = z.enum(['user', 'system', 'integration']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const actorSchema = z.object({
  actorId: z.string().min(1),
  actorType: actorTypeSchema,
});
export type Actor = z.infer<typeof actorSchema>;

export const trustedScopeSchema = z.object({
  organizationId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  actor: actorSchema,
  roles: z.array(z.string().min(1)),
});

/**
 * The tenant/authorization context a request executes under.
 *
 * This must always be constructed server-side from authenticated session or
 * service-credential state (SP004-SP009) and never accepted verbatim from a
 * client-supplied field such as a request body `organizationId`. See root
 * governance rule 6.
 */
export type TrustedScope = z.infer<typeof trustedScopeSchema>;

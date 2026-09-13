import { z } from 'zod';

export const actorTypeSchema = z.enum(['user', 'system', 'integration']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const actorSchema = z.object({
  actorId: z.string().min(1),
  actorType: actorTypeSchema,
});
export type Actor = z.infer<typeof actorSchema>;

const requestContextSchema = z.object({
  actor: actorSchema,
  roles: z.array(z.string().min(1)),
  correlationId: z.string().min(1),
  requestId: z.string().min(1),
});

/**
 * A cross-tenant control-plane operation (e.g. creating an organization).
 * Never carries an organizationId - there is no tenant to scope to yet, and
 * platform-operator authority must never be inferred from tenant context.
 */
export const platformOperatorScopeSchema = requestContextSchema.extend({
  kind: z.literal('platform_operator'),
});
export type PlatformOperatorScope = z.infer<typeof platformOperatorScopeSchema>;

/**
 * A tenant-scoped operation. organizationId is always present; companyId and
 * operatingUnitId narrow further when the operation targets that level.
 */
export const organizationScopeSchema = requestContextSchema.extend({
  kind: z.literal('organization'),
  organizationId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  operatingUnitId: z.string().uuid().optional(),
});
export type OrganizationScope = z.infer<typeof organizationScopeSchema>;

export const trustedScopeSchema = z.discriminatedUnion('kind', [
  platformOperatorScopeSchema,
  organizationScopeSchema,
]);

/**
 * The tenant/authorization context a request executes under.
 *
 * This must always be constructed server-side from authenticated session or
 * service-credential state (SP004-SP009) and never accepted verbatim from a
 * client-supplied field such as a request body `organizationId`. See root
 * governance rule 6.
 *
 * A discriminated union rather than one loose object: code that only makes
 * sense for a tenant-scoped request (reading `organizationId`) cannot
 * accidentally compile against a platform-operator scope, where that field
 * does not exist.
 */
export type TrustedScope = z.infer<typeof trustedScopeSchema>;

export function isPlatformOperatorScope(scope: TrustedScope): scope is PlatformOperatorScope {
  return scope.kind === 'platform_operator';
}

export function isOrganizationScope(scope: TrustedScope): scope is OrganizationScope {
  return scope.kind === 'organization';
}

import type { OrganizationScope, PlatformOperatorScope } from '@vercentlabs/contracts';

export const TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_ACTOR_ID = '00000000-0000-4000-8000-0000000000a1';

/** Builds a deterministic, non-production organization-scoped TrustedScope for tests. Never used at runtime. */
export function buildTestOrganizationScope(
  overrides: Partial<OrganizationScope> = {},
): OrganizationScope {
  return {
    kind: 'organization',
    organizationId: TEST_ORGANIZATION_ID,
    actor: { actorId: TEST_ACTOR_ID, actorType: 'user' },
    roles: ['member'],
    correlationId: 'test-correlation-0001',
    requestId: 'test-request-0001',
    ...overrides,
  };
}

/** Builds a deterministic, non-production platform-operator TrustedScope for tests. Never used at runtime. */
export function buildTestPlatformOperatorScope(
  overrides: Partial<PlatformOperatorScope> = {},
): PlatformOperatorScope {
  return {
    kind: 'platform_operator',
    actor: { actorId: TEST_ACTOR_ID, actorType: 'user' },
    roles: ['platform_operator'],
    correlationId: 'test-correlation-0001',
    requestId: 'test-request-0001',
    ...overrides,
  };
}

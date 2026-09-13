import type { TrustedScope } from '@vercentlabs/contracts';

/** Builds a deterministic, non-production TrustedScope for tests. Never used at runtime. */
export function buildTestTrustedScope(overrides: Partial<TrustedScope> = {}): TrustedScope {
  return {
    organizationId: 'org_test_0001',
    actor: { actorId: 'user_test_0001', actorType: 'user' },
    roles: ['member'],
    ...overrides,
  };
}

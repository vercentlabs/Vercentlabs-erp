import { Global, Module } from '@nestjs/common';
import { FailClosedEmailProvider } from '@vercentlabs/platform-identity';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/**
 * Always registers `FailClosedEmailProvider` - no `NODE_ENV` branch, no
 * "development" special case. SP018 (the real transactional-email
 * platform) is NOT_STARTED, so there is no real delivery mechanism to wire
 * up yet; "normal development must not silently treat emails as
 * delivered" applies just as much to a local `pnpm dev` run as to
 * production. Tests that need to assert on what would have been sent use
 * `Test.createTestingModule(...).overrideProvider(EMAIL_PROVIDER).useValue(new InMemoryEmailProvider())`
 * - the exact same explicit-test-override pattern
 * `TRUSTED_SCOPE_PROVIDER` uses (see
 * apps/api/src/platform/auth/platform-auth.module.ts and
 * product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md) - never a module-level
 * environment check.
 */
@Global()
@Module({
  providers: [{ provide: EMAIL_PROVIDER, useClass: FailClosedEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class EmailProviderModule {}

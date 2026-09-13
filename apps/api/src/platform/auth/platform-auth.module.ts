import { Global, Module } from '@nestjs/common';
import { FailClosedTrustedScopeProvider } from './fail-closed-trusted-scope.provider.js';
import { TRUSTED_SCOPE_PROVIDER } from './trusted-scope.port.js';
import { TrustedScopeGuard } from './trusted-scope.guard.js';

/**
 * Registers `FailClosedTrustedScopeProvider` as `TRUSTED_SCOPE_PROVIDER`
 * unconditionally - every normal application startup (production,
 * development, a missing or misspelled `NODE_ENV`, anything) gets the same
 * fail-closed behavior. There is deliberately no `NODE_ENV` branch here: an
 * earlier version of this module chose `TestTrustedScopeProvider` whenever
 * `NODE_ENV !== 'production'`, which meant a plain `next dev`-style local
 * run, a misconfigured staging deployment, or simply forgetting to set
 * `NODE_ENV` at all would silently accept the `x-test-trusted-scope` test
 * header - see product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md.
 *
 * `TestTrustedScopeProvider` is never imported here, and never referenced
 * by name in this module at all - the only way it becomes active is a test
 * file's own `Test.createTestingModule(...).overrideProvider(TRUSTED_SCOPE_PROVIDER).useClass(TestTrustedScopeProvider)`
 * call, which is an explicit act of the test's own module composition, not
 * something this module (or an environment variable) can trigger on its
 * behalf. See docs/architecture/trusted-request-context.md.
 */
@Global()
@Module({
  providers: [
    { provide: TRUSTED_SCOPE_PROVIDER, useClass: FailClosedTrustedScopeProvider },
    TrustedScopeGuard,
  ],
  exports: [TRUSTED_SCOPE_PROVIDER, TrustedScopeGuard],
})
export class PlatformAuthModule {}

import { Global, Module } from '@nestjs/common';
import { FailClosedTrustedScopeProvider } from './fail-closed-trusted-scope.provider.js';
import { TestTrustedScopeProvider } from './test-trusted-scope.provider.js';
import { TRUSTED_SCOPE_PROVIDER } from './trusted-scope.port.js';
import { TrustedScopeGuard } from './trusted-scope.guard.js';

/**
 * Selects the active `TrustedScopeProvider` for the whole process. Production
 * always gets `FailClosedTrustedScopeProvider`; every other NODE_ENV (test,
 * development) gets the test-only header-driven adapter so integration and
 * security-negative tests can assert specific trusted scopes without a real
 * identity platform. This is the ONLY place that decision is made - no
 * controller or test may construct a provider directly.
 */
@Global()
@Module({
  providers: [
    {
      provide: TRUSTED_SCOPE_PROVIDER,
      useClass:
        process.env['NODE_ENV'] === 'production'
          ? FailClosedTrustedScopeProvider
          : TestTrustedScopeProvider,
    },
    TrustedScopeGuard,
  ],
  exports: [TRUSTED_SCOPE_PROVIDER, TrustedScopeGuard],
})
export class PlatformAuthModule {}

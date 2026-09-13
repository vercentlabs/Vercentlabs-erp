import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailClosedTrustedScopeProvider } from '../src/platform/auth/fail-closed-trusted-scope.provider.js';
import { TestTrustedScopeProvider } from '../src/platform/auth/test-trusted-scope.provider.js';
import { TrustedScopeGuard } from '../src/platform/auth/trusted-scope.guard.js';

function fakeRequest(headers: Record<string, string> = {}) {
  return { headers } as never;
}

function fakeExecutionContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('FailClosedTrustedScopeProvider', () => {
  it('always resolves null, regardless of headers sent', async () => {
    const provider = new FailClosedTrustedScopeProvider();
    const scope = await provider.resolve(fakeRequest({ 'x-test-trusted-scope': 'anything' }));
    expect(scope).toBeNull();
  });
});

describe('TestTrustedScopeProvider', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('refuses to construct when NODE_ENV=production - this adapter must never exist in a production process', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => new TestTrustedScopeProvider()).toThrow(
      /must never be instantiated in production/,
    );
  });

  it('constructs fine outside production', () => {
    process.env['NODE_ENV'] = 'test';
    expect(() => new TestTrustedScopeProvider()).not.toThrow();
  });

  it('resolves null when no header is sent (fail closed, same as production default)', async () => {
    process.env['NODE_ENV'] = 'test';
    const provider = new TestTrustedScopeProvider();
    expect(await provider.resolve(fakeRequest())).toBeNull();
  });

  it('resolves null for a malformed (non-base64/non-JSON) header rather than throwing', async () => {
    process.env['NODE_ENV'] = 'test';
    const provider = new TestTrustedScopeProvider();
    expect(
      await provider.resolve(fakeRequest({ 'x-test-trusted-scope': 'not-valid-base64-json!!' })),
    ).toBeNull();
  });

  it('resolves null for a well-formed but schema-invalid scope (e.g. missing organizationId on an organization scope)', async () => {
    process.env['NODE_ENV'] = 'test';
    const provider = new TestTrustedScopeProvider();
    const invalid = Buffer.from(
      JSON.stringify({
        kind: 'organization',
        actor: { actorId: 'a', actorType: 'user' },
        roles: [],
        correlationId: 'c',
        requestId: 'r',
      }),
    ).toString('base64url');
    expect(await provider.resolve(fakeRequest({ 'x-test-trusted-scope': invalid }))).toBeNull();
  });

  it('resolves a valid platform_operator scope from the header', async () => {
    process.env['NODE_ENV'] = 'test';
    const provider = new TestTrustedScopeProvider();
    const scope = {
      kind: 'platform_operator' as const,
      actor: { actorId: 'operator-1', actorType: 'user' as const },
      roles: ['platform_operator'],
      correlationId: 'c',
      requestId: 'r',
    };
    const header = Buffer.from(JSON.stringify(scope)).toString('base64url');
    const resolved = await provider.resolve(fakeRequest({ 'x-test-trusted-scope': header }));
    expect(resolved).toEqual(scope);
  });
});

describe('TrustedScopeGuard', () => {
  it('throws UnauthorizedException when the provider resolves null (fail closed)', async () => {
    const guard = new TrustedScopeGuard({ resolve: vi.fn().mockResolvedValue(null) });
    await expect(guard.canActivate(fakeExecutionContext(fakeRequest()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the resolved scope to the request and allows the request through', async () => {
    const scope = {
      kind: 'platform_operator' as const,
      actor: { actorId: 'operator-1', actorType: 'user' as const },
      roles: [],
      correlationId: 'c',
      requestId: 'r',
    };
    const guard = new TrustedScopeGuard({ resolve: vi.fn().mockResolvedValue(scope) });
    const request = fakeRequest() as { trustedScope?: unknown };
    const allowed = await guard.canActivate(fakeExecutionContext(request));
    expect(allowed).toBe(true);
    expect(request.trustedScope).toEqual(scope);
  });
});

describe('PlatformAuthModule provider selection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('selects FailClosedTrustedScopeProvider when NODE_ENV=production at module load time', async () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const { PlatformAuthModule } = await import('../src/platform/auth/platform-auth.module.js');
      const { TRUSTED_SCOPE_PROVIDER } = await import('../src/platform/auth/trusted-scope.port.js');
      const { FailClosedTrustedScopeProvider: FreshFailClosed } = await import(
        '../src/platform/auth/fail-closed-trusted-scope.provider.js'
      );
      const metadata = Reflect.getMetadata('providers', PlatformAuthModule) as {
        provide?: unknown;
        useClass?: unknown;
      }[];
      const providerEntry = metadata.find((entry) => entry.provide === TRUSTED_SCOPE_PROVIDER);
      expect(providerEntry?.useClass).toBe(FreshFailClosed);
    } finally {
      process.env['NODE_ENV'] = previous;
    }
  });

  it('selects TestTrustedScopeProvider when NODE_ENV is not production at module load time', async () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    try {
      const { PlatformAuthModule } = await import('../src/platform/auth/platform-auth.module.js');
      const { TRUSTED_SCOPE_PROVIDER } = await import('../src/platform/auth/trusted-scope.port.js');
      const { TestTrustedScopeProvider: FreshTest } = await import(
        '../src/platform/auth/test-trusted-scope.provider.js'
      );
      const metadata = Reflect.getMetadata('providers', PlatformAuthModule) as {
        provide?: unknown;
        useClass?: unknown;
      }[];
      const providerEntry = metadata.find((entry) => entry.provide === TRUSTED_SCOPE_PROVIDER);
      expect(providerEntry?.useClass).toBe(FreshTest);
    } finally {
      process.env['NODE_ENV'] = previous;
    }
  });
});

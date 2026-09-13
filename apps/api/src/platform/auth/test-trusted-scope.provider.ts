import { Injectable } from '@nestjs/common';
import { trustedScopeSchema, type TrustedScope } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';
import type { TrustedScopeProvider } from './trusted-scope.port.js';

const TEST_SCOPE_HEADER = 'x-test-trusted-scope';

/**
 * Test-only adapter: lets integration/security tests assert a specific
 * `TrustedScope` by sending a base64url-encoded JSON header, without a real
 * identity platform (SP004-SP010) existing yet.
 *
 * Must never run in production - the constructor throws immediately if
 * instantiated with NODE_ENV=production, and PlatformAuthModule only wires
 * it up outside production. Absence of a valid header resolves to `null`
 * (fail closed), matching FailClosedTrustedScopeProvider's contract.
 */
@Injectable()
export class TestTrustedScopeProvider implements TrustedScopeProvider {
  constructor() {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('TestTrustedScopeProvider must never be instantiated in production.');
    }
  }

  async resolve(request: FastifyRequest): Promise<TrustedScope | null> {
    const header = request.headers[TEST_SCOPE_HEADER];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    const result = trustedScopeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }
}

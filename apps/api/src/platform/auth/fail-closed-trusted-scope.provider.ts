import { Injectable } from '@nestjs/common';
import type { TrustedScope } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';
import type { TrustedScopeProvider } from './trusted-scope.port.js';

/**
 * Production default. No real identity platform exists yet (SP004-SP010
 * are NOT_STARTED), so every request is treated as unauthenticated -
 * protected endpoints fail closed (401), never open.
 */
@Injectable()
export class FailClosedTrustedScopeProvider implements TrustedScopeProvider {
  async resolve(_request: FastifyRequest): Promise<TrustedScope | null> {
    return null;
  }
}

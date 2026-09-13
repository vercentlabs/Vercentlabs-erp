import type { TrustedScope } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';

export const TRUSTED_SCOPE_PROVIDER = Symbol('TRUSTED_SCOPE_PROVIDER');

/**
 * The seam SP004-SP010 (authentication/authorization) will implement for
 * real. Until then, exactly two implementations exist: a fail-closed
 * production default (`FailClosedTrustedScopeProvider`) and a test-only
 * adapter (`TestTrustedScopeProvider`) that only activates outside
 * production - see platform-auth.module.ts.
 */
export interface TrustedScopeProvider {
  resolve(request: FastifyRequest): Promise<TrustedScope | null>;
}

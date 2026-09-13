import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TrustedScope } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';

/**
 * Reads the `TrustedScope` that `TrustedScopeGuard` already resolved and
 * attached to the request. Only usable on routes guarded by
 * `TrustedScopeGuard` - the guard throws before a handler using this
 * decorator could ever observe a missing scope.
 */
export const CurrentTrustedScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TrustedScope => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { trustedScope?: TrustedScope }>();
    if (!request.trustedScope) {
      throw new Error('CurrentTrustedScope used on a route without TrustedScopeGuard.');
    }
    return request.trustedScope;
  },
);

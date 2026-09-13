import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedIdentity } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';

/**
 * Reads the `AuthenticatedIdentity` `SessionAuthGuard` already resolved and
 * attached to the request. Completely separate from `TrustedScope`/
 * `CurrentTrustedScope` (SP001-SP003's control-plane primitive) - see
 * docs/architecture/trusted-request-context.md for why these two systems
 * are deliberately not unified.
 */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { identity?: AuthenticatedIdentity }>();
    if (!request.identity) {
      throw new Error('CurrentIdentity used on a route without SessionAuthGuard.');
    }
    return request.identity;
  },
);

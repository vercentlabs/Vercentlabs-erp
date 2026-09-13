import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { TrustedScope } from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';
import { TRUSTED_SCOPE_PROVIDER, type TrustedScopeProvider } from './trusted-scope.port.js';

/**
 * Fail-closed authorization boundary for every `/api/v1/platform/*` route.
 * If the active `TrustedScopeProvider` cannot resolve a scope - which, in
 * production, is every request today since SP004-SP010 do not exist yet -
 * the request is rejected with 401 rather than allowed through. Never
 * resolves a default/admin scope as a fallback.
 */
@Injectable()
export class TrustedScopeGuard implements CanActivate {
  constructor(@Inject(TRUSTED_SCOPE_PROVIDER) private readonly provider: TrustedScopeProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { trustedScope?: TrustedScope }>();
    const scope = await this.provider.resolve(request);
    if (!scope) {
      throw new UnauthorizedException('No trusted request context is available for this request.');
    }
    request.trustedScope = scope;
    return true;
  }
}

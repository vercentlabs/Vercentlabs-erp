import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated state-changing requests (OWASP
 * CSRF Prevention Cheat Sheet). `SameSite=Lax` on the session cookie is
 * defense in depth ONLY - this guard is the actual protection: it rejects
 * any unsafe-method request whose `Origin` header (browsers always send
 * one on cross-origin fetch/XHR/form submissions; same-origin requests
 * send it too in modern browsers) does not exactly match one of the
 * configured allowed origins. CORS is a browser-enforced RESPONSE-reading
 * restriction and is never itself relied on as CSRF protection - a
 * same-site `<form>` POST bypasses CORS entirely, which is exactly why
 * Origin validation, not CORS configuration, is the real control here.
 *
 * A missing Origin header on an unsafe request is also rejected: legacy
 * browsers might omit it, but accepting "no Origin" as "trust it" would
 * make the check trivially bypassable.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const origin = request.headers.origin;
    if (!origin) {
      throw new ForbiddenException('Missing Origin header on a state-changing request.');
    }

    const allowedOrigins = this.env.API_CORS_ORIGINS.split(',').map((entry) => entry.trim());
    if (!allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Cross-site request rejected.');
    }
    return true;
  }
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../../config/api-env.provider.js';

/**
 * SP006 opaque server-side session cookie. Never a JWT, never
 * localStorage - the raw token is shown to the client exactly once (set
 * here) and the server only ever stores its SHA-256 hash
 * (see @vercentlabs/platform-identity's token-hash.ts).
 *
 * `__Host-` requires Secure + Path=/ + no Domain attribute, which is
 * exactly what OWASP recommends and exactly what this cookie already sets
 * - the prefix is applied automatically whenever the cookie is Secure, and
 * only omitted for the explicitly documented local-HTTP-development
 * escape hatch (`SESSION_COOKIE_INSECURE_LOCAL_HTTP=true`), since browsers
 * reject a Secure cookie over plain HTTP entirely.
 */
function cookieName(env: ApiEnv): string {
  return env.SESSION_COOKIE_INSECURE_LOCAL_HTTP ? 'vlerp_session' : '__Host-vlerp_session';
}

export function setSessionCookie(
  reply: FastifyReply,
  env: ApiEnv,
  rawToken: string,
  expiresAt: Date,
): void {
  reply.setCookie(cookieName(env), rawToken, {
    httpOnly: true,
    secure: !env.SESSION_COOKIE_INSECURE_LOCAL_HTTP,
    sameSite: 'lax', // defense in depth only - CSRF is enforced separately via Origin/CSRF-token validation (csrf.guard.ts), never relied on alone.
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, env: ApiEnv): void {
  reply.clearCookie(cookieName(env), { path: '/' });
}

export function readSessionCookie(request: FastifyRequest, env: ApiEnv): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[cookieName(env)];
}

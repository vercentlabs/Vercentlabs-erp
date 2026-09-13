import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AuthenticatedIdentity } from '@vercentlabs/contracts';
import {
  findSessionByTokenHash,
  findUserById,
  hashToken,
  listActiveMembershipOrganizationIds,
  touchSessionLastSeen,
} from '@vercentlabs/platform-identity';
import type { FastifyRequest } from 'fastify';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';
import { IDENTITY_PIPELINE_DB } from '../database/identity-pipeline-database.service.js';
import { readSessionCookie } from './session-cookie.js';

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The real session-authentication adapter for SP004-SP007 self-service
 * endpoints - completely separate from `TrustedScopeGuard`/
 * `FailClosedTrustedScopeProvider`, which remain untouched and still
 * fail-closed for SP001-SP003's control plane. Fails closed the identical
 * way: no cookie, an unknown/expired/revoked session, or a stale
 * security_stamp (the user changed a security-relevant setting since this
 * session was created) all reject with 401, never a default/open identity.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_PIPELINE_DB) private readonly db: NodePgDatabase,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { identity?: AuthenticatedIdentity }>();

    const rawToken = readSessionCookie(request, this.env);
    if (!rawToken) throw new UnauthorizedException('No session.');

    const tokenHash = hashToken(rawToken);
    const session = await findSessionByTokenHash(this.db, tokenHash);
    if (!session || session.revokedAt) throw new UnauthorizedException('No session.');

    const now = Date.now();
    if (session.expiresAt.getTime() < now || session.inactivityExpiresAt.getTime() < now) {
      throw new UnauthorizedException('Session expired.');
    }

    const user = await findUserById(this.db, session.userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('No session.');
    if (user.securityStamp !== session.securityStamp) {
      // A security-relevant change happened after this session was
      // created (password change, suspension, MFA reset, ...) - implicit
      // invalidation even if this specific row was never explicitly
      // revoked. See docs/architecture/session-model.md.
      throw new UnauthorizedException('Session no longer valid.');
    }

    if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await touchSessionLastSeen(this.db, session.id, new Date());
    }

    const organizationMemberships = await listActiveMembershipOrganizationIds(this.db, user.id);

    request.identity = {
      userId: user.id,
      sessionId: session.id,
      assuranceLevel: session.assuranceLevel as AuthenticatedIdentity['assuranceLevel'],
      authenticatedAt: session.authenticatedAt.toISOString(),
      lastStepUpAt: session.lastStepUpAt?.toISOString() ?? null,
      organizationMemberships,
    };
    return true;
  }
}

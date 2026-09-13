import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyRequest } from 'fastify';
import {
  revokeSessionRequestSchema,
  type AuthenticatedIdentity,
  type SessionDto,
} from '@vercentlabs/contracts';
import {
  listSessions as listSessionsCommand,
  revokeOtherSessions as revokeOtherSessionsCommand,
  revokeOwnSession as revokeOwnSessionCommand,
} from '@vercentlabs/platform-identity';
import { IDENTITY_RUNTIME_DB } from '../database/identity-runtime-database.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { extractRequestMeta } from '../http/request-meta.js';
import { parseBody } from '../http/http-inputs.js';

/** SP006 self-service session/device management. Every route requires an existing, valid session. */
@ApiTags('identity-sessions')
@ApiSecurity('session-cookie')
@UseGuards(SessionAuthGuard, CsrfGuard)
@Controller('identity/sessions')
export class SessionController {
  constructor(@Inject(IDENTITY_RUNTIME_DB) private readonly db: NodePgDatabase) {}

  @Get()
  async list(@CurrentIdentity() identity: AuthenticatedIdentity): Promise<SessionDto[]> {
    return listSessionsCommand(this.db, {
      userId: identity.userId,
      currentSessionId: identity.sessionId,
    });
  }

  @Post('revoke')
  @HttpCode(200)
  async revokeOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ revoked: true }> {
    const parsed = parseBody(revokeSessionRequestSchema, body);
    const meta = extractRequestMeta(request);
    await revokeOwnSessionCommand(this.db, {
      userId: identity.userId,
      sessionId: parsed.sessionId,
      ...meta,
    });
    return { revoked: true };
  }

  @Post('revoke-others')
  @HttpCode(200)
  async revokeOthers(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
  ): Promise<{ revoked: true }> {
    const meta = extractRequestMeta(request);
    await revokeOtherSessionsCommand(this.db, {
      userId: identity.userId,
      currentSessionId: identity.sessionId,
      ...meta,
    });
    return { revoked: true };
  }
}

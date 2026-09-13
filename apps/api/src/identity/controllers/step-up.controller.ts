import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyRequest } from 'fastify';
import { completeStepUpRequestSchema, type AuthenticatedIdentity } from '@vercentlabs/contracts';
import { completeStepUp as completeStepUpCommand } from '@vercentlabs/platform-identity';
import { IDENTITY_RUNTIME_DB } from '../database/identity-runtime-database.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';
import { extractRequestMeta } from '../http/request-meta.js';
import { parseBody } from '../http/http-inputs.js';

/**
 * SP007 reusable step-up ceremony. There is no separate "begin" round-trip
 * here: a WEBAUTHN step-up reuses the same challenge primitives as MFA login
 * (`identity/mfa/webauthn/registration/begin` mints a fresh challenge for an
 * already-registered credential just as well, since both are scoped to the
 * user, not the purpose), and PASSWORD_TOTP/RECOVERY_CODE need no
 * server-issued challenge at all - the client already holds everything it
 * needs to call `complete` directly once it knows (from a
 * `STEP_UP_REQUIRED` error) which purpose and methods are acceptable.
 */
@ApiTags('identity-step-up')
@ApiSecurity('session-cookie')
@UseGuards(SessionAuthGuard, CsrfGuard)
@Controller('identity/step-up')
export class StepUpController {
  constructor(
    @Inject(IDENTITY_RUNTIME_DB) private readonly db: NodePgDatabase,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('complete')
  @HttpCode(200)
  async complete(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ expiresAt: string }> {
    const parsed = parseBody(completeStepUpRequestSchema, body);
    const meta = extractRequestMeta(request);
    return completeStepUpCommand(this.db, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      purpose: parsed.purpose,
      method: parsed.method,
      ...(parsed.method === 'PASSWORD_TOTP'
        ? { password: parsed.password, code: parsed.code }
        : {}),
      ...(parsed.method === 'RECOVERY_CODE' ? { code: parsed.code } : {}),
      ...(parsed.method === 'WEBAUTHN' ? { credential: parsed.credential } : {}),
      webauthnRpId: this.env.WEBAUTHN_RP_ID,
      webauthnExpectedOrigin: this.env.WEBAUTHN_EXPECTED_ORIGIN,
      ...meta,
    });
  }
}

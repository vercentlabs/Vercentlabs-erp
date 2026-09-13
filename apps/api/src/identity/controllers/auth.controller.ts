import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  beginMfaWebAuthnChallengeRequestSchema,
  changePasswordRequestSchema,
  completeMfaLoginRequestSchema,
  loginRequestSchema,
  type AuthenticatedIdentity,
  type BeginWebAuthnRegistrationResponse,
  type CompleteMfaLoginRequest,
  type LoginRequest,
  type LoginResponse,
  type UserDto,
} from '@vercentlabs/contracts';
import {
  beginMfaWebAuthnChallenge as beginMfaWebAuthnChallengeCommand,
  changePassword as changePasswordCommand,
  completeMfaLogin as completeMfaLoginCommand,
  getCurrentUser,
  login as loginCommand,
  logout as logoutCommand,
  logoutAll as logoutAllCommand,
} from '@vercentlabs/platform-identity';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';
import { IDENTITY_PIPELINE_DB } from '../database/identity-pipeline-database.service.js';
import { IDENTITY_RUNTIME_DB } from '../database/identity-runtime-database.service.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { clearSessionCookie, setSessionCookie } from '../auth/session-cookie.js';
import { extractRequestMeta } from '../http/request-meta.js';
import { parseBody } from '../http/http-inputs.js';

/**
 * SP005/SP006 authentication endpoints. Unauthenticated (login, MFA
 * completion) except logout/logoutAll/me, which require an existing
 * session. CSRF-guarded on every state-changing route, including login
 * itself (login CSRF - forcing a victim's browser to authenticate as an
 * attacker-controlled account - is a real class of attack, not just
 * session-riding).
 */
@ApiTags('identity-auth')
@UseGuards(CsrfGuard)
@Controller('identity/auth')
export class AuthController {
  constructor(
    @Inject(IDENTITY_PIPELINE_DB) private readonly pipelineDb: NodePgDatabase,
    @Inject(IDENTITY_RUNTIME_DB) private readonly runtimeDb: NodePgDatabase,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const parsed = parseBody(loginRequestSchema, body) as LoginRequest;
    const meta = extractRequestMeta(request);
    const result = await loginCommand(this.pipelineDb, { ...parsed, ...meta });
    if ('session' in result) {
      setSessionCookie(reply, this.env, result.session.rawToken, result.session.expiresAt);
    }
    return result.response;
  }

  @Post('mfa/webauthn/begin')
  @HttpCode(200)
  async beginMfaWebAuthnChallenge(
    @Body() body: unknown,
  ): Promise<BeginWebAuthnRegistrationResponse> {
    const parsed = parseBody(beginMfaWebAuthnChallengeRequestSchema, body);
    const webauthn = {
      rpId: this.env.WEBAUTHN_RP_ID,
      expectedOrigin: this.env.WEBAUTHN_EXPECTED_ORIGIN,
    };
    const options = await beginMfaWebAuthnChallengeCommand(this.pipelineDb, {
      mfaToken: parsed.mfaToken,
      webauthn,
    });
    return options as unknown as BeginWebAuthnRegistrationResponse;
  }

  @Post('mfa/complete')
  @HttpCode(200)
  async completeMfaLogin(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const parsed = parseBody(completeMfaLoginRequestSchema, body) as CompleteMfaLoginRequest;
    const meta = extractRequestMeta(request);
    const webauthn = {
      rpId: this.env.WEBAUTHN_RP_ID,
      expectedOrigin: this.env.WEBAUTHN_EXPECTED_ORIGIN,
    };
    const result = await completeMfaLoginCommand(this.pipelineDb, {
      ...meta,
      mfaToken: parsed.mfaToken,
      method: parsed.method,
      ...(parsed.method === 'TOTP' || parsed.method === 'RECOVERY_CODE'
        ? { code: parsed.code }
        : {}),
      ...(parsed.method === 'WEBAUTHN' ? { credential: parsed.credential, webauthn } : {}),
    });
    if ('session' in result) {
      setSessionCookie(reply, this.env, result.session.rawToken, result.session.expiresAt);
    }
    return result.response;
  }

  @Post('password/change')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async changePassword(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ changed: true }> {
    const parsed = parseBody(changePasswordRequestSchema, body);
    const meta = extractRequestMeta(request);
    // Revokes every session for this user, including the one making this
    // request - the caller's own cookie is dead the instant this succeeds.
    await changePasswordCommand(this.runtimeDb, {
      userId: identity.userId,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
      ...meta,
    });
    clearSessionCookie(reply, this.env);
    return { changed: true };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ loggedOut: true }> {
    const meta = extractRequestMeta(request);
    await logoutCommand(this.runtimeDb, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      ...meta,
    });
    clearSessionCookie(reply, this.env);
    return { loggedOut: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logoutAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ loggedOut: true }> {
    const meta = extractRequestMeta(request);
    await logoutAllCommand(this.runtimeDb, { userId: identity.userId, ...meta });
    clearSessionCookie(reply, this.env);
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentIdentity() identity: AuthenticatedIdentity): Promise<UserDto> {
    return getCurrentUser(this.runtimeDb, identity.userId);
  }
}

import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyRequest } from 'fastify';
import {
  acceptInvitationRequestSchema,
  completePasswordResetRequestSchema,
  requestPasswordResetRequestSchema,
  resendVerificationRequestSchema,
  validateResetTokenRequestSchema,
  verifyEmailRequestSchema,
  type UserDto,
} from '@vercentlabs/contracts';
import {
  acceptInvitation as acceptInvitationCommand,
  completePasswordReset as completePasswordResetCommand,
  requestPasswordReset as requestPasswordResetCommand,
  resendVerification as resendVerificationCommand,
  validateResetToken as validateResetTokenCommand,
  verifyEmail as verifyEmailCommand,
  type EmailProvider,
} from '@vercentlabs/platform-identity';
import { IDENTITY_PIPELINE_DB } from '../database/identity-pipeline-database.service.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { extractRequestMeta } from '../http/request-meta.js';
import { parseBody } from '../http/http-inputs.js';
import { EMAIL_PROVIDER } from '../email/email-provider.module.js';

/**
 * Unauthenticated capability-token flows: invitation acceptance, email
 * verification, and password reset. All run under `IDENTITY_PIPELINE_DB`
 * (`erp_auth_pipeline`) - none of these have a session yet.
 */
@ApiTags('identity-verification')
@UseGuards(CsrfGuard)
@Controller('identity')
export class VerificationController {
  constructor(
    @Inject(IDENTITY_PIPELINE_DB) private readonly db: NodePgDatabase,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  @Post('invitations/accept')
  @HttpCode(200)
  async acceptInvitation(@Body() body: unknown, @Req() request: FastifyRequest): Promise<UserDto> {
    const parsed = parseBody(acceptInvitationRequestSchema, body);
    const meta = extractRequestMeta(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await acceptInvitationCommand(this.db, { ...parsed, idempotencyKey, ...meta });
    return result.body;
  }

  @Post('email/verify')
  @HttpCode(200)
  async verifyEmail(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ verified: true }> {
    const parsed = parseBody(verifyEmailRequestSchema, body);
    const meta = extractRequestMeta(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await verifyEmailCommand(this.db, {
      token: parsed.token,
      idempotencyKey,
      ...meta,
    });
    return result.body;
  }

  @Post('email/resend-verification')
  @HttpCode(202)
  async resendVerification(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ requested: true }> {
    const parsed = parseBody(resendVerificationRequestSchema, body);
    const meta = extractRequestMeta(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await resendVerificationCommand(this.db, {
      email: parsed.email,
      idempotencyKey,
      ...meta,
      emailProvider: this.emailProvider,
    });
    return result.body;
  }

  @Post('password/request-reset')
  @HttpCode(202)
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ requested: true }> {
    const parsed = parseBody(requestPasswordResetRequestSchema, body);
    const meta = extractRequestMeta(request);
    await requestPasswordResetCommand(this.db, {
      email: parsed.email,
      ...meta,
      emailProvider: this.emailProvider,
    });
    return { requested: true };
  }

  @Post('password/validate-reset-token')
  @HttpCode(200)
  async validateResetToken(@Body() body: unknown): Promise<{ valid: boolean }> {
    const parsed = parseBody(validateResetTokenRequestSchema, body);
    return validateResetTokenCommand(this.db, parsed.token);
  }

  @Post('password/complete-reset')
  @HttpCode(200)
  async completePasswordReset(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ reset: true }> {
    const parsed = parseBody(completePasswordResetRequestSchema, body);
    const meta = extractRequestMeta(request);
    await completePasswordResetCommand(this.db, {
      token: parsed.token,
      newPassword: parsed.newPassword,
      ...meta,
    });
    return { reset: true };
  }
}

/**
 * These flows are safe to retry (a resend/reset-request click twice should
 * not double-send or double-mutate); unlike SP001-SP003, a client cannot
 * always be trusted to supply one before authenticating, so a per-request
 * key is minted server-side when absent rather than rejecting the request -
 * these commands' own concurrency-safety (conditional UPDATEs, single-use
 * token consumption) is the real protection either way.
 */
function requireIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.trim().length > 0 ? value : randomUUID();
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyRequest } from 'fastify';
import {
  completeWebAuthnRegistrationRequestSchema,
  confirmTotpEnrollmentRequestSchema,
  renameWebAuthnCredentialRequestSchema,
  type AuthenticatedIdentity,
  type BeginTotpEnrollmentResponse,
  type BeginWebAuthnRegistrationResponse,
  type MfaMethodsResponse,
  type RecoveryCodesResponse,
} from '@vercentlabs/contracts';
import {
  beginTotpEnrollment as beginTotpEnrollmentCommand,
  beginWebAuthnRegistration as beginWebAuthnRegistrationCommand,
  completeWebAuthnRegistration as completeWebAuthnRegistrationCommand,
  confirmTotpEnrollment as confirmTotpEnrollmentCommand,
  generateRecoveryCodes as generateRecoveryCodesCommand,
  getMfaMethods,
  removeCredential as removeWebAuthnCredentialCommand,
  removeTotp as removeTotpCommand,
  renameCredential as renameWebAuthnCredentialCommand,
} from '@vercentlabs/platform-identity';
import { IDENTITY_RUNTIME_DB } from '../database/identity-runtime-database.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';
import { extractRequestMeta } from '../http/request-meta.js';
import { parseBody } from '../http/http-inputs.js';

/**
 * SP007 self-service MFA enrollment/management. Every route requires an
 * existing session; enrolling a first authenticator only needs the session's
 * own authentication to be recent (`requireRecentAuthentication`, enforced
 * inside the command layer), while removing an authenticator or generating a
 * NEW recovery-code batch requires a full step-up grant (also enforced
 * inside the command layer - this controller never re-implements that
 * check, it only surfaces `StepUpRequiredError` via the exception filter).
 */
@ApiTags('identity-mfa')
@ApiSecurity('session-cookie')
@UseGuards(SessionAuthGuard, CsrfGuard)
@Controller('identity/mfa')
export class MfaController {
  constructor(
    @Inject(IDENTITY_RUNTIME_DB) private readonly db: NodePgDatabase,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('methods')
  async methods(@CurrentIdentity() identity: AuthenticatedIdentity): Promise<MfaMethodsResponse> {
    return getMfaMethods(this.db, identity.userId);
  }

  @Post('totp/begin')
  @HttpCode(200)
  async beginTotp(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): Promise<BeginTotpEnrollmentResponse> {
    return beginTotpEnrollmentCommand(this.db, identity.userId, new Date(identity.authenticatedAt));
  }

  @Post('totp/confirm')
  @HttpCode(200)
  async confirmTotp(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ confirmed: true }> {
    const parsed = parseBody(confirmTotpEnrollmentRequestSchema, body);
    const meta = extractRequestMeta(request);
    await confirmTotpEnrollmentCommand(this.db, {
      userId: identity.userId,
      code: parsed.code,
      ...meta,
    });
    return { confirmed: true };
  }

  @Post('totp/remove')
  @HttpCode(200)
  async removeTotp(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
  ): Promise<{ removed: true }> {
    const meta = extractRequestMeta(request);
    await removeTotpCommand(this.db, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      ...meta,
    });
    return { removed: true };
  }

  @Post('webauthn/registration/begin')
  @HttpCode(200)
  async beginWebAuthnRegistration(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): Promise<BeginWebAuthnRegistrationResponse> {
    const rp = { rpId: this.env.WEBAUTHN_RP_ID, expectedOrigin: this.env.WEBAUTHN_EXPECTED_ORIGIN };
    const options = await beginWebAuthnRegistrationCommand(this.db, {
      userId: identity.userId,
      authenticatedAt: new Date(identity.authenticatedAt),
      rp,
    });
    return options as unknown as BeginWebAuthnRegistrationResponse;
  }

  @Post('webauthn/registration/complete')
  @HttpCode(200)
  async completeWebAuthnRegistration(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ registered: true }> {
    const parsed = parseBody(completeWebAuthnRegistrationRequestSchema, body);
    const meta = extractRequestMeta(request);
    const rp = { rpId: this.env.WEBAUTHN_RP_ID, expectedOrigin: this.env.WEBAUTHN_EXPECTED_ORIGIN };
    await completeWebAuthnRegistrationCommand(this.db, {
      userId: identity.userId,
      name: parsed.name,
      response: parsed.credential,
      rp,
      ...meta,
    });
    return { registered: true };
  }

  @Post('webauthn/:credentialId/rename')
  @HttpCode(200)
  async renameWebAuthnCredential(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('credentialId') credentialId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ renamed: true }> {
    const parsed = parseBody(renameWebAuthnCredentialRequestSchema, body);
    const meta = extractRequestMeta(request);
    await renameWebAuthnCredentialCommand(this.db, {
      userId: identity.userId,
      credentialId,
      name: parsed.name,
      ...meta,
    });
    return { renamed: true };
  }

  @Post('webauthn/:credentialId/remove')
  @HttpCode(200)
  async removeWebAuthnCredential(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('credentialId') credentialId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ removed: true }> {
    const meta = extractRequestMeta(request);
    await removeWebAuthnCredentialCommand(this.db, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      credentialId,
      ...meta,
    });
    return { removed: true };
  }

  @Post('recovery-codes/generate')
  @HttpCode(200)
  async generateRecoveryCodes(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const meta = extractRequestMeta(request);
    return generateRecoveryCodesCommand(this.db, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      isRegeneration: false,
      ...meta,
    });
  }

  @Post('recovery-codes/regenerate')
  @HttpCode(200)
  async regenerateRecoveryCodes(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const meta = extractRequestMeta(request);
    return generateRecoveryCodesCommand(this.db, {
      userId: identity.userId,
      sessionId: identity.sessionId,
      isRegeneration: true,
      ...meta,
    });
  }
}

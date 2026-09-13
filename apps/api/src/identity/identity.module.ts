import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { IdentityDatabaseModule } from './database/identity-database.module.js';
import { IdentityAuthModule } from './auth/identity-auth.module.js';
import { EmailProviderModule } from './email/email-provider.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { VerificationController } from './controllers/verification.controller.js';
import { MfaController } from './controllers/mfa.controller.js';
import { SessionController } from './controllers/session.controller.js';
import { StepUpController } from './controllers/step-up.controller.js';

/**
 * SP004-SP007 self-service identity/authentication HTTP surface. Entirely
 * separate from PlatformModule (SP001-SP003): this module never touches
 * `TrustedScope`/`TrustedScopeGuard`, and none of its controllers expose or
 * depend on SP001-SP003 administration endpoints, which stay fail-closed via
 * `PlatformAuthModule` regardless of anything registered here.
 */
@Module({
  imports: [ConfigModule, IdentityDatabaseModule, IdentityAuthModule, EmailProviderModule],
  controllers: [
    AuthController,
    VerificationController,
    MfaController,
    SessionController,
    StepUpController,
  ],
})
export class IdentityModule {}

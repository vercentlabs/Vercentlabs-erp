import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { IdentityDatabaseModule } from '../database/identity-database.module.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { CsrfGuard } from './csrf.guard.js';

@Global()
@Module({
  imports: [ConfigModule, IdentityDatabaseModule],
  providers: [SessionAuthGuard, CsrfGuard],
  exports: [SessionAuthGuard, CsrfGuard],
})
export class IdentityAuthModule {}

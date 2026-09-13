import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { PLATFORM_DB, PlatformDatabaseService } from './platform-database.service.js';
import {
  PLATFORM_ADMIN_DB,
  PlatformAdminDatabaseService,
} from './platform-admin-database.service.js';

/**
 * Registers TWO distinct connection pools: `PLATFORM_DB` (the `erp_runtime`
 * tenant-runtime role, used by every controller except organization
 * control-plane actions) and `PLATFORM_ADMIN_DB` (the `erp_platform_admin`
 * role, used only by `OrganizationsController`). Keeping both providers
 * `@Global()` in one module, rather than two separate modules, makes the
 * distinction between them a single reviewable place - see
 * docs/security/platform-operator-boundary.md.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    PlatformDatabaseService,
    PlatformAdminDatabaseService,
    {
      provide: PLATFORM_DB,
      useFactory: (service: PlatformDatabaseService) => service.db,
      inject: [PlatformDatabaseService],
    },
    {
      provide: PLATFORM_ADMIN_DB,
      useFactory: (service: PlatformAdminDatabaseService) => service.db,
      inject: [PlatformAdminDatabaseService],
    },
  ],
  exports: [PLATFORM_DB, PLATFORM_ADMIN_DB],
})
export class PlatformDatabaseModule {}

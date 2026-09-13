import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { PLATFORM_DB, PlatformDatabaseService } from './platform-database.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    PlatformDatabaseService,
    {
      provide: PLATFORM_DB,
      useFactory: (service: PlatformDatabaseService) => service.db,
      inject: [PlatformDatabaseService],
    },
  ],
  exports: [PLATFORM_DB],
})
export class PlatformDatabaseModule {}

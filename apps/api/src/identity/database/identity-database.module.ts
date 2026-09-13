import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import {
  IDENTITY_PIPELINE_DB,
  IdentityPipelineDatabaseService,
} from './identity-pipeline-database.service.js';
import {
  IDENTITY_RUNTIME_DB,
  IdentityRuntimeDatabaseService,
} from './identity-runtime-database.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    IdentityPipelineDatabaseService,
    IdentityRuntimeDatabaseService,
    {
      provide: IDENTITY_PIPELINE_DB,
      useFactory: (service: IdentityPipelineDatabaseService) => service.db,
      inject: [IdentityPipelineDatabaseService],
    },
    {
      provide: IDENTITY_RUNTIME_DB,
      useFactory: (service: IdentityRuntimeDatabaseService) => service.db,
      inject: [IdentityRuntimeDatabaseService],
    },
  ],
  exports: [IDENTITY_PIPELINE_DB, IDENTITY_RUNTIME_DB],
})
export class IdentityDatabaseModule {}

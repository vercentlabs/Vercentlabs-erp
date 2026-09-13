import { Module } from '@nestjs/common';
import { apiEnvProvider, API_ENV } from './api-env.provider.js';

@Module({
  providers: [apiEnvProvider],
  exports: [API_ENV],
})
export class ConfigModule {}

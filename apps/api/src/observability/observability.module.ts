import { Global, Module } from '@nestjs/common';
import { loggerProvider, LOGGER } from './logger.provider.js';

@Global()
@Module({
  providers: [loggerProvider],
  exports: [LOGGER],
})
export class ObservabilityModule {}

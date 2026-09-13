import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { Logger } from '@vercentlabs/observability';
import { ConfigModule } from './config/config.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { LOGGER } from './observability/logger.provider.js';
import { HealthModule } from './health/health.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware.js';
import { PlatformModule } from './platform/platform.module.js';
import { IdentityModule } from './identity/identity.module.js';

@Module({
  imports: [ObservabilityModule, ConfigModule, HealthModule, PlatformModule, IdentityModule],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (logger: Logger) => new AllExceptionsFilter(logger),
      inject: [LOGGER],
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

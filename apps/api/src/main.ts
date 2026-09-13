import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import type { ApiEnv } from '@vercentlabs/configuration';
import type { Logger } from '@vercentlabs/observability';
import { AppModule } from './app.module.js';
import { API_ENV } from './config/api-env.provider.js';
import { LOGGER } from './observability/logger.provider.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    {
      bufferLogs: true,
    },
  );

  const env = app.get<ApiEnv>(API_ENV);
  const logger = app.get<Logger>(LOGGER);

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: env.API_CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  // No secret/signing key: cookie values are opaque, high-entropy, hashed
  // session tokens - Fastify's own cookie signing would be redundant, not
  // a real security boundary, on top of that.
  await app.register(fastifyCookie);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vercentlabs ERP API')
    .setDescription(
      'Versioned platform API for Vercentlabs ERP. This prompt establishes the engineering foundation only; no business-module endpoints exist yet.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document);

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info('api listening', { port: env.API_PORT, prefix: '/api/v1' });

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('received shutdown signal, closing gracefully', { signal });
      void app
        .close()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          logger.error('error during graceful shutdown', { error: String(error) });
          process.exit(1);
        });
    });
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to bootstrap api:', error);
  process.exitCode = 1;
});

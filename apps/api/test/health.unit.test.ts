import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { HealthModule } from '../src/health/health.module.js';

describe('health endpoints (unit, no external services required)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['NODE_ENV'] = process.env['NODE_ENV'] ?? 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');

    // The OpenAPI document itself is built from a health-only testing module,
    // not the full AppModule: @nestjs/swagger's parameter explorer reads
    // `design:paramtypes` for every route parameter, and esbuild-based test
    // transforms (vitest, tsx - see health.service.ts) do not reliably emit
    // that metadata, unlike a real `tsc` build. Route registration itself
    // (exercised below via `.inject()`) does not depend on this metadata, so
    // this only narrows what the *document* describes in this unit-test
    // tier - the full document, including every platform/* path, is verified
    // against the real compiled build in
    // apps/api/test/platform-openapi.integration.test.ts.
    const healthOnlyModuleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const healthOnlyApp = healthOnlyModuleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    healthOnlyApp.setGlobalPrefix('api/v1');
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Vercentlabs ERP API')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(healthOnlyApp, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live returns 200 with status ok', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ok' });
  });

  it('propagates a client-supplied correlation id back on the response', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/v1/health/live',
        headers: { 'x-correlation-id': 'test-correlation-id-001' },
      });
    expect(response.headers['x-correlation-id']).toBe('test-correlation-id-001');
  });

  it('mints a correlation id when the client does not supply one', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(response.headers['x-correlation-id']).toBeDefined();
  });

  it('returns a typed VALIDATION_ERROR-style envelope shape for an unknown route', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });

  it('publishes an OpenAPI document at /api/v1/docs-json', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/docs-json' });
    expect(response.statusCode).toBe(200);
    const document = JSON.parse(response.payload) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths['/api/v1/health/live']).toBeDefined();
  });
});

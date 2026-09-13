import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

/**
 * Requires PostgreSQL and Redis to actually be running (see
 * infrastructure/docker-compose.yml) and DATABASE_URL/REDIS_URL to point at
 * them. Run via `pnpm test:integration`, never as part of `pnpm test`.
 */
describe('health readiness endpoint (integration, requires Docker services)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env['NODE_ENV'] = process.env['NODE_ENV'] ?? 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/ready reports ok when PostgreSQL and Redis are reachable', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/health/ready' });
    const body = JSON.parse(response.payload) as {
      status: string;
      checks: { postgres: boolean; redis: boolean };
    };

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.postgres).toBe(true);
    expect(body.checks.redis).toBe(true);
  });
});

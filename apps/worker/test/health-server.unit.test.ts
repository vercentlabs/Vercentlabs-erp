import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@vercentlabs/observability';
import { startHealthServer } from '../src/health-server.js';
import type { HeartbeatState } from '../src/heartbeat-queue.js';

const fakePool = { query: async () => ({ rows: [] }) } as unknown as Pool;

function fakeRedis(pingOk: boolean): Redis {
  return {
    status: 'ready',
    connect: async () => undefined,
    ping: async () => {
      if (!pingOk) throw new Error('connection refused');
      return 'PONG';
    },
  } as unknown as Redis;
}

describe('worker health server', () => {
  let baseUrl: string;
  let server: ReturnType<typeof startHealthServer>;
  const heartbeatState: HeartbeatState = { lastProcessedAt: null, isRunning: true };

  beforeAll(async () => {
    server = startHealthServer({
      pool: fakePool,
      redis: fakeRedis(true),
      heartbeatState,
      logger: createLogger({ serviceName: 'worker-test' }),
      port: 0,
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('reports ok on /health/live', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports ok on /health/ready when dependencies and the heartbeat worker are healthy', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as { status: string; checks: Record<string, boolean> };
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.postgres).toBe(true);
    expect(body.checks.redis).toBe(true);
  });

  it('returns 404 for an unknown path', async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});

describe('worker health server when a dependency is down', () => {
  it('reports degraded with 503 when redis is unreachable', async () => {
    const server = startHealthServer({
      pool: fakePool,
      redis: fakeRedis(false),
      heartbeatState: { lastProcessedAt: null, isRunning: true },
      logger: createLogger({ serviceName: 'worker-test' }),
      port: 0,
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    const body = (await response.json()) as { status: string; checks: Record<string, boolean> };

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toBe(false);

    server.close();
  });
});

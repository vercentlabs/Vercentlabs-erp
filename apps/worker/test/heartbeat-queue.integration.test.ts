import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@vercentlabs/observability';
import {
  createHeartbeatQueue,
  createHeartbeatWorker,
  type HeartbeatState,
} from '../src/heartbeat-queue.js';

/** Requires Redis to actually be running; run via `pnpm test:integration`. */
describe('heartbeat queue (integration, requires Redis)', () => {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  let connection: Redis;
  let queue: ReturnType<typeof createHeartbeatQueue>;
  let worker: ReturnType<typeof createHeartbeatWorker>;
  const state: HeartbeatState = { lastProcessedAt: null, isRunning: false };

  beforeAll(() => {
    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = createHeartbeatQueue(connection);
    worker = createHeartbeatWorker(connection, createLogger({ serviceName: 'worker-test' }), state);
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  });

  it('processes an enqueued job through a real Redis connection and updates heartbeat state', async () => {
    await queue.add('tick', {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(state.lastProcessedAt).not.toBeNull();
    expect(state.isRunning).toBe(true);
  }, 15_000);
});

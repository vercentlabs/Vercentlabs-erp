import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { checkDatabaseReady } from '@vercentlabs/database';
import type { Logger } from '@vercentlabs/observability';
import type { HeartbeatState } from './heartbeat-queue.js';

export interface HealthServerDeps {
  pool: Pool;
  redis: Redis;
  heartbeatState: HeartbeatState;
  logger: Logger;
  port: number;
}

/**
 * The worker has no request-serving role, so this is a minimal reporting
 * surface (not Fastify/Nest) used for liveness/readiness probes only.
 */
export function startHealthServer(deps: HealthServerDeps): Server {
  const server = createServer((req, res) => {
    void handleRequest(req.url, deps, res);
  });

  server.listen(deps.port, '0.0.0.0', () => {
    deps.logger.info('worker health server listening', { port: deps.port });
  });

  return server;
}

async function handleRequest(
  url: string | undefined,
  deps: HealthServerDeps,
  res: ServerResponse,
): Promise<void> {
  if (url === '/health/live') {
    respondJson(res, 200, { status: 'ok' });
    return;
  }

  if (url === '/health/ready') {
    const [postgres, redis] = await Promise.all([
      checkDatabaseReady(deps.pool),
      checkRedis(deps.redis),
    ]);
    const ok = postgres && redis && deps.heartbeatState.isRunning;
    respondJson(res, ok ? 200 : 503, {
      status: ok ? 'ok' : 'degraded',
      checks: { postgres, redis, heartbeatWorker: deps.heartbeatState.isRunning },
      lastHeartbeatAt: deps.heartbeatState.lastProcessedAt,
    });
    return;
  }

  respondJson(res, 404, {
    error: { code: 'NOT_FOUND', message: `No route for ${url ?? '(unknown)'}` },
  });
}

async function checkRedis(redis: Redis): Promise<boolean> {
  try {
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

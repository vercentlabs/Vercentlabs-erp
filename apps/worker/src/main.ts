import { Redis } from 'ioredis';
import { loadWorkerEnv } from '@vercentlabs/configuration';
import { createLogger } from '@vercentlabs/observability';
import { createDatabaseConnection } from '@vercentlabs/database';
import {
  createHeartbeatQueue,
  createHeartbeatWorker,
  HEARTBEAT_QUEUE_NAME,
  type HeartbeatState,
} from './heartbeat-queue.js';
import { startHealthServer } from './health-server.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger({
    serviceName: 'worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  const { pool, close: closeDatabase } = createDatabaseConnection(env.DATABASE_URL);
  const redisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  redisConnection.on('error', (error: Error) =>
    logger.error('redis connection error', { error: error.message }),
  );

  const heartbeatState: HeartbeatState = { lastProcessedAt: null, isRunning: false };
  const heartbeatQueue = createHeartbeatQueue(redisConnection);
  const heartbeatWorker = createHeartbeatWorker(redisConnection, logger, heartbeatState);

  await heartbeatQueue.add(
    'tick',
    {},
    {
      repeat: { every: 30_000 },
      jobId: 'heartbeat-tick',
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );

  const healthServer = startHealthServer({
    pool,
    redis: redisConnection,
    heartbeatState,
    logger,
    port: env.WORKER_HEALTH_PORT,
  });

  logger.info('worker started', {
    queue: HEARTBEAT_QUEUE_NAME,
    healthPort: env.WORKER_HEALTH_PORT,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('received shutdown signal, closing gracefully', { signal });
    try {
      await heartbeatWorker.close();
      await heartbeatQueue.close();
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      await closeDatabase();
      redisConnection.disconnect();
      logger.info('worker shut down cleanly');
      process.exit(0);
    } catch (error) {
      logger.error('error during graceful shutdown', { error: String(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('Failed to start worker:', error);
  process.exitCode = 1;
});

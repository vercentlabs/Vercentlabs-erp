import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { runWithCorrelationContext, type Logger } from '@vercentlabs/observability';

/**
 * Not a business job. This queue/worker pair exists only to prove the
 * BullMQ + Redis connection is live end to end and to feed the worker's
 * health-reporting mechanism; see root governance rule 20 (no business
 * modules in this prompt).
 */
export const HEARTBEAT_QUEUE_NAME = 'platform-heartbeat';

export interface HeartbeatState {
  lastProcessedAt: string | null;
  isRunning: boolean;
}

export function createHeartbeatQueue(connection: Redis): Queue {
  return new Queue(HEARTBEAT_QUEUE_NAME, { connection });
}

export function createHeartbeatWorker(
  connection: Redis,
  logger: Logger,
  state: HeartbeatState,
): Worker {
  const worker = new Worker(
    HEARTBEAT_QUEUE_NAME,
    async (job: Job) => {
      const correlationId = `job-${job.id ?? randomUUID()}`;
      await runWithCorrelationContext({ correlationId }, async () => {
        state.lastProcessedAt = new Date().toISOString();
        logger.debug('heartbeat job processed');
      });
    },
    { connection },
  );

  worker.on('ready', () => {
    state.isRunning = true;
    logger.info('heartbeat worker ready');
  });

  worker.on('error', (error: Error) => {
    logger.error('heartbeat worker error', { error: error.message });
  });

  return worker;
}

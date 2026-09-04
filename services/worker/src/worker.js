import { randomUUID } from "node:crypto";
import os from "node:os";

import { redact, createLogger } from "@vercentlabs/observability";

import { getPool, closePool, listActiveOrganizationIds, withTenantClient } from "./db.js";
import { claimJobs, completeJob, failJob } from "./queue.js";
import { claimOutboxEvents, completeOutboxEvent, failOutboxEvent, DEFAULT_MAX_OUTBOX_ATTEMPTS } from "./outbox.js";
import { getJobHandler, validatePayload, HandlerValidationError } from "./registry.js";
import { findMatchingSubscriptions, deliverOutboxEvent } from "./handlers/crm-webhook-deliver.js";
import { webhookBackoff, internalJobBackoff } from "./backoff.js";
import { buildSystemContext } from "./system-context.js";
import { runSchedulerTick } from "./scheduler.js";

const logger = createLogger("worker");

// Stable per-process identity (Part 8) — used for lease ownership, never
// for any kind of permanent cross-restart registration.
export function generateWorkerId() {
  return `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

export async function processGenericJob(pool, workerId, organizationId, job, { leaseMilliseconds = 60_000 } = {}) {
  const definition = getJobHandler(job.job_type);
  const context = buildSystemContext(organizationId);
  if (!definition) {
    logger.error("no handler registered for job type", { jobId: job.id, jobType: job.job_type, organizationId });
    await withTenantClient(pool, organizationId, (client) =>
      failJob(client, job.id, workerId, {
        error: `No handler registered for job type "${job.job_type}".`,
        backoffMilliseconds: internalJobBackoff(job.attempts),
      }),
    );
    return;
  }
  try {
    const payload = validatePayload(definition, job.payload);
    let result;
    if (definition.transactionMode === "managed") {
      result = await definition.handler(null, context, payload, {
        pool, job, workerId, organizationId, leaseMilliseconds, withTenantClient,
      });
      await withTenantClient(pool, organizationId, (client) =>
        completeJob(client, job.id, workerId, { resultManifest: result }),
      );
    } else {
      result = await withTenantClient(pool, organizationId, async (client) => {
        const handlerResult = await definition.handler(client, context, payload);
        await completeJob(client, job.id, workerId);
        return handlerResult;
      });
    }
    logger.info("job completed", { jobId: job.id, jobType: job.job_type, organizationId, attempts: job.attempts, result: redact(result) });
  } catch (error) {
    const terminal = error instanceof HandlerValidationError;
    const backoffMilliseconds = definition.backoff(job.attempts);
    await withTenantClient(pool, organizationId, (client) =>
      failJob(client, job.id, workerId, {
        error: String(error?.message || error),
        backoffMilliseconds,
        // A malformed payload will never become valid on retry — Part 6:
        // "move to terminal/error state according to policy" — so it is
        // forced dead rather than retried up to max_attempts.
        ...(terminal ? { dead: true } : {}),
      }),
    );
    logger.warn("job failed", { jobId: job.id, jobType: job.job_type, organizationId, attempts: job.attempts, terminal, error: redact(String(error?.message || error)) });
  }
}

async function processOutboxDelivery(pool, workerId, config, organizationId, event) {
  try {
    // Phase 1: short, read-only tenant-scoped transaction — no external I/O.
    const subscriptions = await withTenantClient(pool, organizationId, (client) =>
      findMatchingSubscriptions(client, organizationId, event.event_type),
    );

    // Phase 2: external HTTP delivery — deliberately outside any open
    // transaction (Part 44/45).
    const result = await deliverOutboxEvent(subscriptions, event, config.worker);

    // Phase 3: record the outcome in a fresh transaction.
    if (result.outcome === "success") {
      await withTenantClient(pool, organizationId, (client) => completeOutboxEvent(client, event.id, workerId, {}));
      logger.info("outbox event delivered", { eventId: event.id, organizationId, matchedSubscriptions: result.matchedSubscriptions });
      return;
    }
    await withTenantClient(pool, organizationId, (client) =>
      failOutboxEvent(client, event.id, workerId, {
        error: result.summary || "Webhook delivery failed.",
        backoffMilliseconds: webhookBackoff(event.attempt_count),
        maxAttempts: DEFAULT_MAX_OUTBOX_ATTEMPTS,
        forceDead: result.outcome === "terminal",
      }),
    );
    logger.warn("outbox event delivery failed", { eventId: event.id, organizationId, outcome: result.outcome, error: redact(result.summary) });
  } catch (error) {
    // A failure outside deliverOutboxEvent's own try/catch (e.g. the
    // subscription lookup itself failing) — still must not crash the
    // worker loop or leave the event permanently locked.
    logger.error("outbox event processing crashed", { eventId: event.id, organizationId, error: redact(String(error?.message || error)) });
    await withTenantClient(pool, organizationId, (client) =>
      failOutboxEvent(client, event.id, workerId, {
        error: String(error?.message || error),
        backoffMilliseconds: webhookBackoff(event.attempt_count),
      }),
    ).catch((innerError) => logger.error("failed to record outbox failure", { eventId: event.id, error: String(innerError?.message || innerError) }));
  }
}

async function processOrganization(pool, workerId, config, organizationId) {
  const claimedJobs = await withTenantClient(pool, organizationId, (client) =>
    claimJobs(client, organizationId, {
      workerId,
      leaseMilliseconds: config.worker.leaseMilliseconds,
      batchSize: config.worker.batchSize,
    }),
  );
  for (const job of claimedJobs) {
    await processGenericJob(pool, workerId, organizationId, job, { leaseMilliseconds: config.worker.leaseMilliseconds });
  }

  const claimedEvents = await withTenantClient(pool, organizationId, (client) =>
    claimOutboxEvents(client, organizationId, {
      workerId,
      leaseMilliseconds: config.worker.leaseMilliseconds,
      batchSize: config.worker.batchSize,
    }),
  );
  for (const event of claimedEvents) {
    await processOutboxDelivery(pool, workerId, config, organizationId, event);
  }

  return { jobsClaimed: claimedJobs.length, eventsClaimed: claimedEvents.length };
}

// The main worker loop. Never a Next.js-process-dependent timer (Part
// 86) — this is the standalone entrypoint every deployment path
// (pnpm dev:worker, pnpm start:worker, the Kubernetes Deployment) runs as
// its own long-lived process.
export function createWorker(config, { workerId = generateWorkerId() } = {}) {
  let stopped = false;
  let stopRequested = false;
  let pollTimer;
  let schedulerTimer;
  let activePoll = Promise.resolve();

  async function pollOnce() {
    if (stopRequested) return;
    const pool = await getPool();
    const organizationIds = await listActiveOrganizationIds(pool);
    let totalJobs = 0;
    let totalEvents = 0;
    for (const organizationId of organizationIds) {
      if (stopRequested) break;
      try {
        const { jobsClaimed, eventsClaimed } = await processOrganization(pool, workerId, config, organizationId);
        totalJobs += jobsClaimed;
        totalEvents += eventsClaimed;
      } catch (error) {
        logger.error("organization poll failed", { organizationId, error: redact(String(error?.message || error)) });
      }
    }
    if (totalJobs > 0 || totalEvents > 0) {
      logger.info("poll cycle complete", { organizations: organizationIds.length, jobsClaimed: totalJobs, eventsClaimed: totalEvents });
    }
  }

  async function schedule() {
    if (stopRequested) return;
    try {
      const pool = await getPool();
      await runSchedulerTick(pool, config);
    } catch (error) {
      logger.error("scheduler tick crashed", { error: redact(String(error?.message || error)) });
    }
  }

  return {
    workerId,
    async start() {
      logger.info("worker starting", { workerId, concurrency: config.worker.concurrency, pollIntervalMs: config.worker.pollIntervalMilliseconds });
      await getPool();
      const tick = async () => {
        if (stopRequested) return;
        activePoll = pollOnce().catch((error) => logger.error("poll crashed", { error: redact(String(error?.message || error)) }));
        await activePoll;
        if (!stopRequested) pollTimer = setTimeout(tick, config.worker.pollIntervalMilliseconds);
      };
      await tick();
      schedulerTimer = setInterval(schedule, config.worker.schedulerTickMilliseconds);
      logger.info("worker started", { workerId });
    },
    // Graceful shutdown (Part 13): stop claiming new work, let the
    // in-flight poll cycle finish (jobs it already claimed run to
    // completion so their leases are released cleanly rather than left to
    // expire), then close the pool.
    async stop() {
      if (stopped) return;
      stopRequested = true;
      logger.info("worker stopping — waiting for in-flight work to finish", { workerId });
      clearTimeout(pollTimer);
      clearInterval(schedulerTimer);
      await activePoll.catch(() => {});
      await closePool();
      stopped = true;
      logger.info("worker stopped", { workerId });
    },
  };
}

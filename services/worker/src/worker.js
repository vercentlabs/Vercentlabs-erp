import { randomUUID } from "node:crypto";
import os from "node:os";

import { redact, createLogger } from "@vercentlabs/observability";

import { getPool, closePool, listActiveOrganizationIds, withTenantClient } from "./db.js";
import { claimJobs, completeJob, failJob } from "./queue.js";
import { getJobHandler, validatePayload, HandlerValidationError } from "./registry.js";
import { internalJobBackoff } from "./backoff.js";
import { processOrganizationWebhooks, processOrganizationWorkflows } from "./webhooks.js";
import { buildSystemContext } from "./system-context.js";
import { runSchedulerTick } from "./scheduler.js";
import { createBillingMaintenanceLoop } from "./billing-maintenance.js";
import { createPlatformMaintenanceLoop } from "./platform-maintenance.js";

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
  const startedAt = Date.now();
  if (job.previous_status === "processing") {
    logger.event("worker.lease.recovered", { jobId: job.id, jobType: job.job_type, organizationId, attempts: job.attempts }, "warn");
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
    logger.event("worker.job.completed", { jobId: job.id, jobType: job.job_type, organizationId, attempts: job.attempts, durationMs: Date.now() - startedAt, result: redact(result) });
  } catch (error) {
    const terminal = error instanceof HandlerValidationError;
    const backoffMilliseconds = definition.backoff(job.attempts);
    const failed = await withTenantClient(pool, organizationId, (client) =>
      failJob(client, job.id, workerId, {
        error: String(error?.message || error),
        backoffMilliseconds,
        // A malformed payload will never become valid on retry — Part 6:
        // "move to terminal/error state according to policy" — so it is
        // forced dead rather than retried up to max_attempts.
        ...(terminal ? { dead: true } : {}),
      }),
    );
    const fields = { jobId: job.id, jobType: job.job_type, organizationId, attempts: job.attempts, terminal, durationMs: Date.now() - startedAt, error: redact(String(error?.message || error)) };
    // Dead-lettered: no more retries; operators act on it (alert worker-job-dead).
    if (failed?.status === "dead") logger.event("worker.job.dead", fields, "error");
    else logger.event("worker.job.failed", fields, "warn");
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

  // Shared Platform events: fan-out, then per-subscription webhook delivery.
  const webhooks = await processOrganizationWebhooks(pool, workerId, config, organizationId);
  const workflows = await processOrganizationWorkflows(pool, organizationId);

  return { jobsClaimed: claimedJobs.length, eventsClaimed: webhooks.dispatched + webhooks.deliveries + workflows.runs };
}

// The main worker loop. Never a Next.js-process-dependent timer (Part
// 86) — this is the standalone entrypoint every deployment path
// (pnpm dev:worker, pnpm start:worker, the Kubernetes Deployment) runs as
// its own long-lived process.
export function createWorker(config, { workerId = generateWorkerId(), billingProvider } = {}) {
  let stopped = false;
  // Platform billing runs on its own loop and connections, never inside tenant job transactions.
  const billing = createBillingMaintenanceLoop(getPool, config, { workerId, provider: billingProvider });
  const platform = createPlatformMaintenanceLoop(getPool, config);
  let stopRequested = false;
  let pollTimer;
  let schedulerTimer;
  let activePoll = Promise.resolve();
  // Health state for the probe server (services/worker/src/health.js).
  const health = { startedAt: null, pollStartedAt: null, pollCompletedAt: null, lastPollError: null, stopping: false };

  // WORKER_CONCURRENCY organisations are processed in parallel per cycle;
  // within one organisation jobs stay sequential. Every job is leased
  // (FOR UPDATE SKIP LOCKED), so parallel lanes and parallel replicas never
  // run the same job twice. The pool must hold the lanes plus the
  // maintenance loops (checked by getWorkerConfig).
  async function pollOnce() {
    if (stopRequested) return;
    health.pollStartedAt = Date.now();
    const pool = await getPool();
    const pending = await listActiveOrganizationIds(pool);
    let totalJobs = 0;
    let totalEvents = 0;
    const lanes = Array.from({ length: Math.min(config.worker.concurrency, pending.length) }, async () => {
      while (pending.length && !stopRequested) {
        const organizationId = pending.shift();
        try {
          const { jobsClaimed, eventsClaimed } = await processOrganization(pool, workerId, config, organizationId);
          totalJobs += jobsClaimed;
          totalEvents += eventsClaimed;
        } catch (error) {
          logger.error("organization poll failed", { organizationId, error: redact(String(error?.message || error)) });
        }
      }
    });
    await Promise.all(lanes);
    health.pollCompletedAt = Date.now();
    health.lastPollError = null;
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
    health,
    async start() {
      logger.info("worker starting", { workerId, concurrency: config.worker.concurrency, pollIntervalMs: config.worker.pollIntervalMilliseconds });
      await getPool();
      const tick = async () => {
        if (stopRequested) return;
        activePoll = pollOnce().catch((error) => {
          health.lastPollError = Date.now();
          logger.error("poll crashed", { error: redact(String(error?.message || error)) });
        });
        await activePoll;
        if (!stopRequested) pollTimer = setTimeout(tick, config.worker.pollIntervalMilliseconds);
      };
      await tick();
      schedulerTimer = setInterval(schedule, config.worker.schedulerTickMilliseconds);
      billing.start();
      platform.start();
      health.startedAt = Date.now();
      logger.info("worker started", { workerId });
    },
    // Graceful shutdown (Part 13): stop claiming new work, let the
    // in-flight poll cycle finish (jobs it already claimed run to
    // completion so their leases are released cleanly rather than left to
    // expire), then close the pool.
    async stop() {
      if (stopped) return;
      stopRequested = true;
      health.stopping = true;
      logger.info("worker stopping — waiting for in-flight work to finish", { workerId });
      clearTimeout(pollTimer);
      clearInterval(schedulerTimer);
      await activePoll.catch(() => {});
      await billing.stop();
      await platform.stop();
      await closePool();
      stopped = true;
      logger.info("worker stopped", { workerId });
    },
  };
}

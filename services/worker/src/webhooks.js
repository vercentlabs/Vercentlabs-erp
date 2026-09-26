// Shared Platform events and webhook delivery for one organisation.
//
//   1. dispatch: committed tenant.platform_events are fanned out (one webhook
//      delivery per matching subscription, workflow runs, ...) in a short
//      tenant transaction; idempotent on the event id.
//   2. deliver: due deliveries are leased (FOR UPDATE SKIP LOCKED; expired
//      leases reclaimable), signed, and POSTed OUTSIDE any transaction through
//      the one SSRF-safe transport; each outcome is recorded on that delivery
//      only, so retrying one endpoint never re-sends to another.
import {
  buildWebhookRequest,
  claimWebhookDeliveries,
  completeWebhookDelivery,
  deliverWebhook,
  dispatchPendingEvents,
  EVENT_FAN_OUT,
  claimWorkflowRuns,
  executeWorkflowRun,
  failWebhookDelivery,
  failWorkflowRun,
  getConfigurationValue,
  isFeatureFlagEnabled,
  webhookBackoff,
  WebhookDeliveryError,
} from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

import { withTenantClient } from "./db.js";

const logger = createLogger("worker-webhooks");

export async function dispatchOrganizationEvents(pool, organizationId, { limit = 50 } = {}) {
  return withTenantClient(pool, organizationId, (client) => dispatchPendingEvents(client, organizationId, { fanOut: EVENT_FAN_OUT, limit }));
}

export async function processWebhookDelivery(pool, workerId, config, organizationId, claimed, { deliver = deliverWebhook, env = process.env } = {}) {
  let request;
  try {
    request = buildWebhookRequest(claimed, { env });
  } catch (error) {
    await withTenantClient(pool, organizationId, (client) =>
      failWebhookDelivery(client, claimed.id, workerId, { error: String(error?.message || error), retryable: false }),
    );
    return "dead";
  }
  let outcome;
  try {
    const result = await deliver(request.url, {
      body: request.body,
      headers: request.headers,
      deliveryId: request.deliveryId,
      timeoutMilliseconds: config.worker.webhookTimeoutMilliseconds,
      allowPrivateTargets: config.worker.allowPrivateWebhookTargets,
    });
    outcome =
      result.outcome === "success"
        ? { success: true, statusCode: result.statusCode, summary: result.bodyPreview }
        : { success: false, retryable: result.outcome === "retryable", statusCode: result.statusCode, error: `Endpoint answered ${result.statusCode}`, retryAfter: result.retryAfterMilliseconds };
  } catch (error) {
    outcome = { success: false, retryable: error instanceof WebhookDeliveryError ? error.retryable : true, statusCode: null, error: String(error?.message || error) };
  }
  if (outcome.success) {
    await withTenantClient(pool, organizationId, (client) => completeWebhookDelivery(client, claimed.id, workerId, { statusCode: outcome.statusCode, responseSummary: outcome.summary }));
    return "delivered";
  }
  const status = await withTenantClient(pool, organizationId, async (client) =>
    failWebhookDelivery(client, claimed.id, workerId, {
      error: outcome.error,
      statusCode: outcome.statusCode,
      retryable: outcome.retryable,
      backoffMilliseconds: Math.max(outcome.retryAfter ?? 0, webhookBackoff(claimed.attempt_count)),
      // Settings > Feature configuration: "Webhook delivery attempts".
      maxAttempts: await getConfigurationValue(client, organizationId, "platform.webhooks", "max_delivery_attempts"),
    }),
  );
  logger.warn("webhook delivery failed", { deliveryId: claimed.id, organizationId, status, error: redact(outcome.error) });
  return status;
}

export async function processOrganizationWebhooks(pool, workerId, config, organizationId, options = {}) {
  const { dispatched } = await dispatchOrganizationEvents(pool, organizationId);
  // Operator kill switch: deliveries stay queued while paused.
  const paused = await withTenantClient(pool, organizationId, (client) => isFeatureFlagEnabled(client, organizationId, "operator.webhooks", "delivery_paused"));
  if (paused) return { dispatched, deliveries: 0, paused: true };
  const claimed = await withTenantClient(pool, organizationId, (client) =>
    claimWebhookDeliveries(client, organizationId, { workerId, leaseMilliseconds: config.worker.leaseMilliseconds, batchSize: config.worker.batchSize }),
  );
  for (const delivery of claimed) {
    try {
      await processWebhookDelivery(pool, workerId, config, organizationId, delivery, options);
    } catch (error) {
      // Recording the outcome failed; the lease expires and the delivery is retried.
      logger.error("webhook delivery processing crashed", { deliveryId: delivery.id, organizationId, error: redact(String(error?.message || error)) });
    }
  }
  return { dispatched, deliveries: claimed.length };
}

// Workflow runs created by the fan-out: each in its own tenant transaction
// (all actions commit together); a failure is recorded on the run.
export async function processOrganizationWorkflows(pool, organizationId) {
  const runs = await withTenantClient(pool, organizationId, (client) => claimWorkflowRuns(client, organizationId));
  for (const run of runs) {
    try {
      await withTenantClient(pool, organizationId, (client) => executeWorkflowRun(client, run));
    } catch (error) {
      await withTenantClient(pool, organizationId, (client) => failWorkflowRun(client, run.id, error)).catch(() => undefined);
      logger.warn("workflow run failed", { runId: run.id, organizationId, error: redact(String(error?.message || error)) });
    }
  }
  return { runs: runs.length };
}

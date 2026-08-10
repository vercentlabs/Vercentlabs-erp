// Claim/complete/fail primitives for tenant.crm_outbox_events — the
// ALREADY-EXISTING, purpose-built webhook delivery queue (002_crm_module.sql,
// extended by 004_enterprise_tenant_integrity.sql and
// 007_crm_outbox_leases.sql). This is intentionally a separate module from
// queue.js's tenant.background_jobs: the outbox already has its own
// complete lease/retry/dead-letter shape, and this prompt reuses it
// as-is rather than migrating its rows into the new generic table (see
// 052_background_jobs.sql's own header comment for the full reasoning).
//
// Default max-attempts policy: crm_outbox_events has no max_attempts
// column of its own (unlike the new background_jobs table), so this is a
// deliberate, documented code-level constant rather than a schema change
// — a smaller, safer footprint on an existing, working table.
export const DEFAULT_MAX_OUTBOX_ATTEMPTS = 8;

export async function claimOutboxEvents(client, organizationId, { workerId, leaseMilliseconds, batchSize = 10 }) {
  if (!workerId) throw new Error("workerId is required to claim outbox events.");
  const { rows } = await client.query(
    `UPDATE tenant.crm_outbox_events
        SET status = 'processing',
            locked_by = $2,
            locked_at = now(),
            attempt_count = attempt_count + 1,
            updated_at = now()
      WHERE id IN (
        SELECT id FROM tenant.crm_outbox_events
         WHERE organization_id = $1
           AND (
             (status IN ('pending', 'failed') AND next_attempt_at <= now())
             OR (status = 'processing' AND locked_at < now() - ($3 || ' milliseconds')::interval)
           )
         ORDER BY created_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [organizationId, workerId, String(leaseMilliseconds), batchSize],
  );
  return rows;
}

export async function completeOutboxEvent(client, id, workerId, { providerMessageId, deliveryReceipt } = {}) {
  const { rows } = await client.query(
    `UPDATE tenant.crm_outbox_events
        SET status = 'delivered', delivered_at = now(), updated_at = now(),
            provider_message_id = coalesce($3, provider_message_id),
            delivery_receipt = coalesce($4::jsonb, delivery_receipt),
            locked_by = NULL, locked_at = NULL
      WHERE id = $1 AND locked_by = $2
      RETURNING *`,
    [id, workerId, providerMessageId || null, deliveryReceipt ? JSON.stringify(deliveryReceipt) : null],
  );
  return rows[0] || null;
}

// `forceDead` is used for TERMINAL errors (Part 33: a malformed URL, a
// forbidden/SSRF-blocked destination, most 4xx) — these will structurally
// never succeed no matter how many times they're retried, so they move
// straight to 'dead_letter' rather than waiting out the full attempt
// budget on an endpoint that can never work. A retryable error still
// follows the normal attempt-count-based transition.
export async function failOutboxEvent(client, id, workerId, { error, backoffMilliseconds, maxAttempts = DEFAULT_MAX_OUTBOX_ATTEMPTS, forceDead = false }) {
  const { rows } = await client.query(
    `UPDATE tenant.crm_outbox_events
        SET status = CASE WHEN $6 OR attempt_count >= $5 THEN 'dead_letter' ELSE 'failed' END,
            next_attempt_at = now() + ($4 || ' milliseconds')::interval,
            last_error = $3,
            updated_at = now(),
            locked_by = NULL, locked_at = NULL
      WHERE id = $1 AND locked_by = $2
      RETURNING *`,
    [id, workerId, String(error || "").slice(0, 4_000), String(backoffMilliseconds), maxAttempts, forceDead],
  );
  return rows[0] || null;
}

// Durable job queue for tenant.background_jobs (052_background_jobs.sql).
// Every function takes an already tenant-context-scoped `client` (matching
// this codebase's established services/api/src/* convention) — none of
// these functions ever accept or trust an organizationId from anywhere
// other than the caller's own already-authenticated context.

export class QueueError extends Error {
  constructor(message, code = "QUEUE_ERROR") {
    super(message);
    this.code = code;
  }
}

// Enqueues a job, or — if idempotencyKey collides with an already-queued
// job for this organization — returns the EXISTING row instead of
// creating a duplicate (tenant.background_jobs.UNIQUE(organization_id,
// idempotency_key) is the real dedup guarantee; this function just makes
// the caller-facing behavior explicit rather than throwing a raw
// unique-violation).
export async function enqueueJob(client, organizationId, input) {
  if (!input?.jobType) throw new QueueError("jobType is required.", "INVALID_JOB");
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
      (organization_id, job_type, payload, run_at, priority, max_attempts, idempotency_key)
     VALUES ($1, $2, $3::jsonb, coalesce($4, now()), coalesce($5, 100), coalesce($6, 5), $7)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      organizationId,
      input.jobType,
      JSON.stringify(input.payload ?? {}),
      input.runAt ?? null,
      input.priority ?? null,
      input.maxAttempts ?? null,
      input.idempotencyKey ?? null,
    ],
  );
  if (inserted.rows[0]) return { job: inserted.rows[0], deduped: false };

  // A NULL idempotencyKey never collides (NULLs are distinct in a unique
  // index), so reaching this branch means a real, non-null key collided.
  const existing = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id = $1 AND idempotency_key = $2`,
    [organizationId, input.idempotencyKey],
  );
  return { job: existing.rows[0], deduped: true };
}

// Claims up to `batchSize` due jobs for this organization in one
// statement: a pending job whose run_at has arrived, OR a processing job
// whose lease has expired (a crashed worker's job becoming reclaimable).
// FOR UPDATE SKIP LOCKED is what makes two concurrent workers safe — a
// row already locked by another worker's in-flight claim is silently
// skipped, never double-claimed and never blocked on.
export async function claimJobs(client, organizationId, { workerId, leaseMilliseconds, batchSize = 10 }) {
  if (!workerId) throw new QueueError("workerId is required to claim jobs.", "INVALID_CLAIM");
  const { rows } = await client.query(
    `UPDATE tenant.background_jobs
        SET status = 'processing',
            locked_by = $2,
            locked_at = now(),
            lease_expires_at = now() + ($3 || ' milliseconds')::interval,
            attempts = attempts + 1,
            updated_at = now()
      WHERE id IN (
        SELECT id FROM tenant.background_jobs
         WHERE organization_id = $1
           AND (
             (status = 'pending' AND run_at <= now())
             OR (status = 'processing' AND lease_expires_at < now())
           )
         ORDER BY priority ASC, run_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [organizationId, workerId, String(leaseMilliseconds), batchSize],
  );
  return rows;
}

export async function completeJob(client, jobId, workerId) {
  const { rows } = await client.query(
    `UPDATE tenant.background_jobs
        SET status = 'completed', completed_at = now(), updated_at = now(),
            locked_by = NULL, locked_at = NULL, lease_expires_at = NULL
      WHERE id = $1 AND locked_by = $2
      RETURNING *`,
    [jobId, workerId],
  );
  return rows[0] || null;
}

// A retryable failure returns the job to 'pending' with a future run_at;
// exhausting max_attempts moves it to the terminal 'dead' state instead.
// `dead: true` forces immediate termination regardless of attempt count —
// used for a malformed payload (Part 6: it will never become valid on
// retry, so waiting out the full attempt budget only delays discovering
// that). `error` is redacted by the caller (see worker.js) before it ever
// reaches this function — this function does not redact on its own, since
// it has no way to distinguish a safe from an unsafe payload shape.
export async function failJob(client, jobId, workerId, { error, backoffMilliseconds, dead = false }) {
  const { rows } = await client.query(
    `UPDATE tenant.background_jobs
        SET status = CASE WHEN $5 OR attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
            run_at = now() + ($4 || ' milliseconds')::interval,
            last_error = $3,
            updated_at = now(),
            locked_by = NULL, locked_at = NULL, lease_expires_at = NULL
      WHERE id = $1 AND locked_by = $2
      RETURNING *`,
    [jobId, workerId, String(error || "").slice(0, 4_000), String(backoffMilliseconds), dead],
  );
  return rows[0] || null;
}

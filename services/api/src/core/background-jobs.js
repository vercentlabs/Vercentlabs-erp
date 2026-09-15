// Global background-job visibility (Prompt 2B Phase 10). tenant.background_jobs
// (services/worker's real job queue — see services/worker/src/queue.js) already
// exists live; this module only adds read-only visibility for the shell. No
// retry/cancel action is exposed here: queue.js has no cancelJob export and
// no code path currently sets status='cancelled' except the guard clauses
// anticipating it — inventing a cancel/retry mutation against a queue this
// module doesn't own would risk racing the worker's own claim/lease logic.
// Callers of this module must run it inside a transaction that has already
// called setTenantContext() (see apps/web/src/core/db.ts's tenantTransaction),
// matching the convention every other tenant.-schema module in this package
// already assumes (idempotency.js, master-data.js).
export class BackgroundJobError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BackgroundJobError";
    this.status = status;
  }
}

const STATUS_VALUES = Object.freeze(["pending", "processing", "completed", "dead", "cancelled"]);

export async function listBackgroundJobs(client, organizationId, { status = "all", limit = 100 } = {}) {
  if (status !== "all" && !STATUS_VALUES.includes(status)) {
    throw new BackgroundJobError(400, "Unsupported background-job status filter.");
  }
  const bounded = Math.min(250, Math.max(1, Number(limit) || 100));
  const result = await client.query(
    `SELECT id, job_type, status, run_at, priority, attempts, max_attempts,
            last_error, created_at, updated_at, completed_at, requested_by, progress
       FROM tenant.background_jobs
      WHERE organization_id = $1 AND ($2 = 'all' OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [organizationId, status, bounded],
  );
  return result.rows;
}

export async function getBackgroundJob(client, organizationId, jobId) {
  const result = await client.query(
    `SELECT id, job_type, status, run_at, priority, attempts, max_attempts,
            last_error, created_at, updated_at, completed_at, requested_by, progress, result_manifest
       FROM tenant.background_jobs
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, jobId],
  );
  if (!result.rows[0]) throw new BackgroundJobError(404, "Background job not found.");
  return result.rows[0];
}

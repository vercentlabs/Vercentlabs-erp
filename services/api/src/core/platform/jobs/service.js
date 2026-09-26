// Background job visibility (read-only). tenant.background_jobs is FORCE RLS:
// callers run inside a tenant transaction. Visibility:
//   everyone          jobs they requested themselves, of user-facing types
//   operations viewer jobs of the whole organisation (automation.view)
// Payloads are never returned; errors and manifests are projected safely.
// There is deliberately no cancel/retry here: not every handler can stop its
// side effects safely once running.
import { redactAuditPayload } from "../../audit-redaction.js";
import { jobPresentation, USER_VISIBLE_JOB_TYPES } from "./presentation.js";

export class BackgroundJobError extends Error {
  constructor(status, message, code = "JOB_ERROR") {
    super(message);
    this.name = "BackgroundJobError";
    this.status = status;
    this.code = code;
  }
}

export const JOB_OPERATIONS_PERMISSION = "automation.view";
const STATUS_VALUES = Object.freeze(["pending", "processing", "completed", "dead", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURATED_FAILURE = "This task could not finish. Try again, or contact your administrator if it keeps failing.";

// Technical error for operations viewers: no stack traces, secrets, connection strings or tokens.
export function redactJobError(message) {
  if (!message) return null;
  return String(message)
    .split("\n")[0]
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[connection string]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 300);
}

// Only counters and flags from progress/manifest; never embedded content
// (an export's CSV, record ids, payload copies).
function safeCounters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(redactAuditPayload(value))) {
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = entry;
    else if (typeof entry === "boolean") out[key] = entry;
  }
  return out;
}

function project(row, { operations, detail = false }) {
  const presentation = jobPresentation(row.job_type);
  const failed = row.status === "dead" || (row.status === "pending" && row.last_error);
  const manifest = detail ? safeCounters(row.result_manifest) : undefined;
  const hasOutput = detail && row.result_manifest && typeof row.result_manifest === "object" && Object.values(row.result_manifest).some((value) => typeof value === "string" && value.length > 200);
  return {
    id: row.id,
    label: presentation.label,
    category: presentation.category,
    jobType: operations ? row.job_type : undefined,
    status: row.status,
    requestedByMe: row.requested_by_me,
    requestedByName: operations ? row.requested_by_name ?? null : undefined,
    attempts: operations ? row.attempts : undefined,
    maxAttempts: operations ? row.max_attempts : undefined,
    progress: safeCounters(row.progress),
    error: failed ? (operations ? redactJobError(row.last_error) : CURATED_FAILURE) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    ...(detail ? { result: manifest, hasOutput: Boolean(hasOutput) } : {}),
  };
}

export async function listJobsForViewer(client, viewer, { status = "all", limit = 100 } = {}) {
  if (status !== "all" && !STATUS_VALUES.includes(status)) throw new BackgroundJobError(400, "Unsupported background-job status filter.", "JOB_FILTER_INVALID");
  const bounded = Math.min(250, Math.max(1, Number(limit) || 100));
  const result = await client.query(
    `SELECT job.id, job.job_type, job.status, job.attempts, job.max_attempts, job.last_error, job.progress, job.created_at, job.updated_at,
            job.completed_at, (job.requested_by = $3) AS requested_by_me, requester.full_name AS requested_by_name
       FROM tenant.background_jobs job
       LEFT JOIN public.users requester ON requester.id = job.requested_by
      WHERE job.organization_id = $1 AND ($2 = 'all' OR job.status = $2)
        AND ($4::boolean OR (job.requested_by = $3 AND job.job_type = ANY($5::text[])))
      ORDER BY job.created_at DESC, job.id DESC
      LIMIT $6`,
    [viewer.organizationId, status, viewer.userId, Boolean(viewer.operations), USER_VISIBLE_JOB_TYPES, bounded],
  );
  return result.rows.map((row) => project(row, { operations: viewer.operations }));
}

export async function getJobForViewer(client, viewer, jobId) {
  if (!UUID.test(String(jobId || ""))) throw new BackgroundJobError(404, "Background job not found.", "JOB_NOT_FOUND");
  const result = await client.query(
    `SELECT job.id, job.job_type, job.status, job.attempts, job.max_attempts, job.last_error, job.progress, job.result_manifest, job.created_at,
            job.updated_at, job.completed_at, (job.requested_by = $3) AS requested_by_me, requester.full_name AS requested_by_name
       FROM tenant.background_jobs job
       LEFT JOIN public.users requester ON requester.id = job.requested_by
      WHERE job.organization_id = $1 AND job.id = $2
        AND ($4::boolean OR (job.requested_by = $3 AND job.job_type = ANY($5::text[])))`,
    [viewer.organizationId, jobId, viewer.userId, Boolean(viewer.operations), USER_VISIBLE_JOB_TYPES],
  );
  if (!result.rows[0]) throw new BackgroundJobError(404, "Background job not found.", "JOB_NOT_FOUND");
  return project(result.rows[0], { operations: viewer.operations, detail: true });
}

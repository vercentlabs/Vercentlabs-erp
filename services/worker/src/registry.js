// One typed/validated handler registry — every job type this worker can
// execute is registered here, never dispatched via an ad hoc switch
// scattered through worker.js.
const handlers = new Map();

export class HandlerValidationError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_JOB_PAYLOAD";
  }
}

// idempotency: one of NATURALLY_IDEMPOTENT / IDEMPOTENCY_KEY_REQUIRED /
// NOT_SAFE_TO_RETRY — purely documentation/introspection metadata (Part
// 10's classification requirement); actual retry-safety is enforced by
// each handler's own implementation and by the queue's idempotency-key
// uniqueness, not by this field.
export function registerJobHandler(jobType, { schema, handler, backoff, idempotency = "IDEMPOTENCY_KEY_REQUIRED", maxAttempts }) {
  if (!jobType || typeof jobType !== "string") throw new Error("registerJobHandler requires a non-empty job type string.");
  if (typeof handler !== "function") throw new Error(`registerJobHandler("${jobType}") requires a handler function.`);
  if (typeof backoff !== "function") throw new Error(`registerJobHandler("${jobType}") requires a backoff(attempt) function.`);
  if (handlers.has(jobType)) throw new Error(`A handler is already registered for job type "${jobType}".`);
  handlers.set(jobType, { jobType, schema, handler, backoff, idempotency, maxAttempts });
}

export function getJobHandler(jobType) {
  return handlers.get(jobType) || null;
}

export function listRegisteredJobTypes() {
  return [...handlers.keys()];
}

// Malformed persisted jobs must fail safely, not crash the worker loop
// (Part 6) — this is the one place every handler invocation funnels
// through, so validation failure is handled uniformly regardless of which
// handler is involved.
export function validatePayload(definition, payload) {
  if (!definition.schema) return payload;
  const result = definition.schema.safeParse(payload);
  if (!result.success) {
    throw new HandlerValidationError(`Payload validation failed for "${definition.jobType}": ${result.error.message}`);
  }
  return result.data;
}

// Test/introspection only.
export function _resetRegistryForTests() {
  handlers.clear();
}

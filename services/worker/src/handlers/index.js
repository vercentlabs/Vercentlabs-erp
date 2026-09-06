import { registerJobHandler } from "../registry.js";
import { internalJobBackoff } from "../backoff.js";
import { detectOverdueActivitiesHandler, JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE, payloadSchema as overdueActivityPayloadSchema } from "./crm-automation-overdue.js";
import { leadBulkUpdateHandler, JOB_TYPE as LEAD_BULK_JOB_TYPE, payloadSchema as leadBulkPayloadSchema } from "./crm-lead-bulk-update.js";
import { detectLeadSlaBreachesHandler, JOB_TYPE as LEAD_SLA_SCAN_JOB_TYPE, payloadSchema as leadSlaScanPayloadSchema } from "./crm-lead-sla-scan.js";

// Registers every currently-wired job type. Called once at worker
// startup (bin/start.mjs) and by tests that need a populated registry.
// This is the "typed/validated handler registry" (Part 5) — the single
// place new job types get added, never a switch scattered through
// worker.js.
export function registerBuiltinHandlers() {
  registerJobHandler(OVERDUE_ACTIVITY_JOB_TYPE, {
    schema: overdueActivityPayloadSchema,
    handler: detectOverdueActivitiesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // the status-transition WHERE clause makes re-running this handler for the same org always safe
    maxAttempts: 3,
  });
  registerJobHandler(LEAD_BULK_JOB_TYPE, {
    schema: leadBulkPayloadSchema,
    handler: leadBulkUpdateHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(LEAD_SLA_SCAN_JOB_TYPE, {
    schema: leadSlaScanPayloadSchema,
    handler: detectLeadSlaBreachesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // same status-transition guarantee as the overdue-activity tick
    maxAttempts: 3,
  });
}

import { z } from "zod";
import { capturePipelineSnapshots } from "@vercentlabs/api";

export const JOB_TYPE = "crm.pipeline.capture_daily_snapshot";

export const payloadSchema = z.object({}).strict();

// F010 integrity closeout — the durable daily pipeline-history baseline
// (dossier F010-CAP-002 / DEC-CRM-P1-F010). Deliberately org-wide/
// permission-neutral (allowAllCompanies:true, no owner scope): a system
// capture must record the pipeline's real total state, not one synthetic
// actor's restricted view of it — see pipeline-snapshots.js's own
// capturePipelineSnapshots() doc comment for why capture and retrieval use
// different scoping rules.
function snapshotSystemContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [],
    roleSlugs: ["system_worker"],
  });
}

// Idempotency: capturePipelineSnapshots()'s own INSERT ... ON CONFLICT
// (..., snapshot_date) WHERE source='scheduled' DO NOTHING makes a retried
// or duplicate-enqueued tick for the same organization/day a safe no-op —
// the scheduler's own date-keyed idempotency key (see scheduler.js) already
// prevents most duplicate enqueues, and this is the second, DB-enforced
// layer for the rare case a duplicate slips through anyway.
export async function capturePipelineDailySnapshotHandler(client, systemContext, _payload) {
  const context = snapshotSystemContext(systemContext.organizationId);
  return capturePipelineSnapshots(client, context, { source: "scheduled" });
}

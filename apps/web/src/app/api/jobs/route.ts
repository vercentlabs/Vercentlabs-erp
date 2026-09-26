import { hasSessionPermission, JOB_OPERATIONS_PERMISSION, listJobsForViewer } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Background jobs: the caller's own user-started jobs, or the whole
// organisation's for automation.view holders. Read-only; tenant transaction
// (tenant.background_jobs is RLS-protected). Never billing-gated.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "jobs.list" }, async ({ client, session }) => {
    const raw = new URL(request.url).searchParams.get("status") || "all";
    const status = ["all", "pending", "processing", "completed", "dead", "cancelled"].includes(raw) ? raw : "all";
    const operations = hasSessionPermission(session, JOB_OPERATIONS_PERMISSION);
    const jobs = await listJobsForViewer(client, { organizationId: session.organizationId, userId: session.userId, operations }, { status });
    return ok({ jobs, scope: operations ? "organization" : "mine" });
  });
}

import { getCrmLeadExportJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F021 Stage A2 §9. Status polling (getCrmLeadExportJob enforces
// requester-or-view_all). The manifest holds only safe metadata; the file
// itself is a Shared Platform artifact served by the download route.
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.export }, async ({ client, session }) => {
    const { jobId } = await context.params;
    const job = await getCrmLeadExportJob(client, crmContext(session), jobId);
    const manifest = (job.result_manifest || {}) as Record<string, unknown>;
    return ok({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        manifest,
        lastError: job.last_error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
    });
  });
}

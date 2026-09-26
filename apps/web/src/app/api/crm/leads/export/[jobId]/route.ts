import { getCrmLeadExportJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Stage A2 §9. Status polling (getCrmLeadExportJob enforces
// requester-or-view_all). The manifest holds only safe metadata; the file
// itself is a Shared Platform artifact served by the download route.
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { jobId } = await context.params;
    const job = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.export);
      return getCrmLeadExportJob(client, crmContext(session), jobId);
    });
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
  } catch (error) {
    return errorResponse(error);
  }
}

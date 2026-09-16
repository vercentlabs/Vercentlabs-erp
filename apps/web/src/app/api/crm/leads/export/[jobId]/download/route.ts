import { getCrmLeadExportJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Stage A2 §9. Download authorization: getCrmLeadExportJob already
// restricts this to the requester (or a view_all holder) — never a
// public/unauthenticated link. Expiration: the manifest's own expiresAt
// (set at generation time, lead-export.js) is checked here too, so a
// stale link 404s rather than serving an indefinitely-valid file. The
// CSV itself was already formula-injection-neutralized at generation
// time (rowsToCsv/csvCell, @vercentlabs/reporting-engine) — this route
// only adds the download-safety headers, it does not re-sanitize.
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { jobId } = await context.params;
    const job = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return getCrmLeadExportJob(client, crmContext(session), jobId);
    });
    if (job.status !== "completed") throw new HttpError(409, "This export is not ready yet.");
    const manifest = (job.result_manifest || {}) as { csv?: string; expiresAt?: string };
    if (!manifest.csv) throw new HttpError(404, "Export file not found.");
    if (manifest.expiresAt && Date.parse(manifest.expiresAt) < Date.now()) throw new HttpError(410, "This export has expired. Start a new export.");
    return new Response(manifest.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export-${jobId}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

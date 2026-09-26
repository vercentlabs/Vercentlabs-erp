import { readCrmLeadExportArtifact } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F021 Stage A2 §9. Download authorization is unchanged: the requester (or a
// view_all holder) only, never a public link (getCrmLeadExportJob). The CSV
// is a Shared Platform file artifact in object storage; it answers 410 once
// expired. It was formula-injection-neutralised when generated (rowsToCsv,
// @vercentlabs/reporting-engine); this route only adds download headers.
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.export }, async ({ client, session }) => {
    const { jobId } = await context.params;
    const artifact = await readCrmLeadExportArtifact(client, crmContext(session), jobId);
    return new Response(new Uint8Array(artifact.body), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export-${jobId}.csv"`,
        "Content-Length": String(artifact.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

import { listDuplicateScanMatches } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage }, async ({ client, session }) => {
    const { jobId } = await context.params;
    const rows = await listDuplicateScanMatches(client, crmContext(session), jobId);
    return ok({ rows });
  });
}

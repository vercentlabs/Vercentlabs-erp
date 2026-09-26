import { getOpportunityBulkJob } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { jobId } = await context.params;
    const job = await getOpportunityBulkJob(client, crmContext(session), jobId);
    return ok({ job });
  });
}

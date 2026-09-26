import { getJobForViewer, hasSessionPermission, JOB_OPERATIONS_PERMISSION } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { action: "jobs.detail" }, async ({ client, session }) => {
    const { id } = await context.params;
    const operations = hasSessionPermission(session, JOB_OPERATIONS_PERMISSION);
    return ok({ job: await getJobForViewer(client, { organizationId: session.organizationId, userId: session.userId, operations }, id) });
  });
}

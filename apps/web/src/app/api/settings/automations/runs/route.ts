import { listWorkflowRuns } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  const workflowId = new URL(request.url).searchParams.get("workflowId");
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformWorkflowsManage, action: "workflows.runs" }, async ({ client, session }) =>
    ok({ runs: await listWorkflowRuns(client, session.organizationId, { workflowId }) }),
  );
}

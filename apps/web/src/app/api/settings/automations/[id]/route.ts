import { updateWorkflow } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { workflowSchema } from "@/features/settings/automations/workflow-schema";

// Saving creates a new version; past runs keep the version they used.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformWorkflowsManage, action: "workflows.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ workflow: await updateWorkflow(client, session, id, workflowSchema.parse(await readJson(request))) }),
  );
}

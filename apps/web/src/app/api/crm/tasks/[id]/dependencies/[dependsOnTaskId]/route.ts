import { removeTaskDependency } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; dependsOnTaskId: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true, action: "crm.task.dependency.remove" }, async ({ client, session }) => {
    const { id, dependsOnTaskId } = await context.params;
    await removeTaskDependency(client, crmContext(session), id, dependsOnTaskId);
    return ok({ removed: true });
  });
}

import { addTaskDependency, listTaskDependencies } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F015 Stage A2 §6. addTaskDependency/removeTaskDependency/
// listTaskDependencies (task-operations.js) already enforce cycle
// prevention, self-dependency rejection and completion-while-blocked
// rejection server-side — this route (and its sibling [dependsOnTaskId]
// route) is the first UI consumer, not a new authorization surface.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listTaskDependencies(client, crmContext(session), id);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const dependsOnTaskId = String(input.dependsOnTaskId || "");
    if (!dependsOnTaskId) throw new HttpError(400, "A dependency Task id is required.");
    const record = await addTaskDependency(client, crmContext(session), id, dependsOnTaskId);
    return ok({ record }, 201);
  });
}

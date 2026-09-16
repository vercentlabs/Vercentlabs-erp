import { addTaskDependency, assertSameOriginOrMobile, listTaskDependencies } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F015 Stage A2 §6. addTaskDependency/removeTaskDependency/
// listTaskDependencies (task-operations.js) already enforce cycle
// prevention, self-dependency rejection and completion-while-blocked
// rejection server-side — this route (and its sibling [dependsOnTaskId]
// route) is the first UI consumer, not a new authorization surface.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listTaskDependencies(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const dependsOnTaskId = String(input.dependsOnTaskId || "");
    if (!dependsOnTaskId) throw new HttpError(400, "A dependency Task id is required.");
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return addTaskDependency(client, crmContext(session), id, dependsOnTaskId);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

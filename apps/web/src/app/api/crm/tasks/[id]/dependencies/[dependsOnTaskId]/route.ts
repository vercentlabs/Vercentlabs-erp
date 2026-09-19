import { assertSameOriginOrMobile, removeTaskDependency } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; dependsOnTaskId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, dependsOnTaskId } = await context.params;
    await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage, { mutation: true });
      return removeTaskDependency(client, crmContext(session), id, dependsOnTaskId);
    });
    return ok({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}

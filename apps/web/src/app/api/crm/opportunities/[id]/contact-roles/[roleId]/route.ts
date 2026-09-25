import { assertSameOriginOrMobile, removeOpportunityContactRole, updateOpportunityContactRole } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string; roleId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, roleId } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return updateOpportunityContactRole(client, crmContext(session), id, roleId, input);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, roleId } = await context.params;
    const url = new URL(request.url);
    const promoteRoleId = url.searchParams.get("promoteRoleId") ?? undefined;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return removeOpportunityContactRole(client, crmContext(session), id, roleId, { promoteRoleId });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

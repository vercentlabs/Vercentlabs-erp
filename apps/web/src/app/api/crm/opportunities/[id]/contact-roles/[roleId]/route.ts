import { removeOpportunityContactRole, updateOpportunityContactRole } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string; roleId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id, roleId } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await updateOpportunityContactRole(client, crmContext(session), id, roleId, input);
    return ok({ rows });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id, roleId } = await context.params;
    const url = new URL(request.url);
    const promoteRoleId = url.searchParams.get("promoteRoleId") ?? undefined;
    const rows = await removeOpportunityContactRole(client, crmContext(session), id, roleId, { promoteRoleId });
    return ok({ rows });
  });
}

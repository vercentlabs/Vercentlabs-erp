import { setPrimaryOpportunityContactRole } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string; roleId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id, roleId } = await context.params;
    const rows = await setPrimaryOpportunityContactRole(client, crmContext(session), id, roleId);
    return ok({ rows });
  });
}

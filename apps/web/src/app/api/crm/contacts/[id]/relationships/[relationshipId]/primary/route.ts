import { setPrimaryContactAccountRelationship } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string; relationshipId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id, relationshipId } = await context.params;
    const rows = await setPrimaryContactAccountRelationship(client, crmContext(session), id, relationshipId);
    return ok({ rows });
  });
}

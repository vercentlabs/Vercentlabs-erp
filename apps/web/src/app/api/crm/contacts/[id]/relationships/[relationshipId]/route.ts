import { removeContactAccountRelationship, updateContactAccountRelationship } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string; relationshipId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id, relationshipId } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await updateContactAccountRelationship(client, crmContext(session), id, relationshipId, input);
    return ok({ rows });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id, relationshipId } = await context.params;
    const url = new URL(request.url);
    const promoteRelationshipId = url.searchParams.get("promoteRelationshipId") ?? undefined;
    const rows = await removeContactAccountRelationship(client, crmContext(session), id, relationshipId, { promoteRelationshipId });
    return ok({ rows });
  });
}

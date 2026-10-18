import { archiveSalesTeamMember } from "@vercentlabs/api/crm";
import { requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// Removes the person from the team (ends the membership): ?expectedUpdatedAt=
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? "";
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.teamsManage);
    return ok({ record: await archiveSalesTeamMember(client, crmContext(session, snapshot), id, { expectedUpdatedAt }) });
  });
}

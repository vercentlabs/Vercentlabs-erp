import { removeLeadStageTransition } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ fromId: string; toId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { fromId, toId } = await context.params;
    const result = await removeLeadStageTransition(client, crmContext(session), fromId, toId);
    return ok(result);
  });
}

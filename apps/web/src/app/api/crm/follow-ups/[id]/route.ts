import { getCrmFollowUp, updateCrmFollowUp } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const record = await getCrmFollowUp(client, crmContext(session), id);
    return ok({ record });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await updateCrmFollowUp(client, crmContext(session), id, input);
    return ok({ record });
  });
}

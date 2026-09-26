import { listCrmTaskHistory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F015 gap-closure — listCrmTaskHistory (the crm_task_events lifecycle
// ledger reader) existed with no route and no frontend caller.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listCrmTaskHistory(client, crmContext(session), id);
    return ok({ rows });
  });
}

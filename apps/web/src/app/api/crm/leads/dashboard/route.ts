import { getLeadDashboard } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const url = new URL(request.url);
    return ok({ dashboard: await getLeadDashboard(client, context, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }) });
  });
}

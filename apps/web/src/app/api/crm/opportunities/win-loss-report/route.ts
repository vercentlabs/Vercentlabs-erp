import { getWinLossReport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Win rate, won and lost reason shares and a grouping: ?from&to&groupBy&ownerId&teamId&sourceId&outcome
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) => {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return ok({ report: await getWinLossReport(client, crmContext(session), params) });
  });
}

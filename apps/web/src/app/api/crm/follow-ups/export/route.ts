import { exportFollowUps } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { csvResponse, followUpFiltersFromUrl } from "@/features/crm/follow-ups/server/follow-up-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportFollowUps(client, crmContext(session), followUpFiltersFromUrl(new URL(request.url)));
    return csvResponse(file.csv, file.fileName);
  });
}

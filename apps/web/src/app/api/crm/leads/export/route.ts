import { exportLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { csvResponse, leadFiltersFromUrl } from "@/features/crm/leads/server/lead-http";

// Downloads the leads the list shows for the same view and filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsExport }, async ({ client, session }) => {
    const context = crmContext(session);
    const url = new URL(request.url);
    const ids = url.searchParams.get("ids");
    const exported = await exportLeads(client, context, { ...leadFiltersFromUrl(url), ...(ids ? { ids: ids.split(",") } : {}) });
    return csvResponse(exported.csv, exported.fileName);
  });
}

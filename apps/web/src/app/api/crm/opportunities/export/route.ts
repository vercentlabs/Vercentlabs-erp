import { exportOpportunities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { csvResponse, opportunityFiltersFromUrl } from "@/features/crm/opportunities/server/opportunity-http";

// The opportunities the list shows for the same view and filters, as CSV.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesExport }, async ({ client, session }) => {
    const file = await exportOpportunities(client, crmContext(session), opportunityFiltersFromUrl(new URL(request.url)));
    return csvResponse(file.csv, file.fileName);
  });
}

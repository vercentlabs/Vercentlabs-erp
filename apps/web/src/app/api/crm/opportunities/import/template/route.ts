import { buildOpportunityImportTemplate } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse } from "@/features/crm/leads/server/lead-http";

// The downloadable deal import template: every importable column and one sample row.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesImport }, async () =>
    csvResponse(buildOpportunityImportTemplate(), "deal-import-template.csv"),
  );
}

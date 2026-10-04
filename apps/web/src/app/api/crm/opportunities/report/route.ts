import { getOpportunitiesByStageReport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { opportunityFiltersFromUrl } from "@/features/crm/opportunities/server/opportunity-http";

// CRM Opportunities by Stage. Query: groupBy plus every list filter.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.reportsView }, async ({ client, session }) =>
    ok({ report: await getOpportunitiesByStageReport(client, crmContext(session), opportunityFiltersFromUrl(new URL(request.url))) }),
  );
}

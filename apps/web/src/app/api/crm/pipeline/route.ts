import { getOpportunityPipeline } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { opportunityFiltersFromUrl } from "@/features/crm/opportunities/server/opportunity-http";

// The pipeline board: the caller's opportunities by sales stage, with stage
// totals. Accepts every opportunity list filter, plus status (open by default,
// won, lost, all), cardSort and cardsPerStage.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ pipeline: await getOpportunityPipeline(client, crmContext(session), opportunityFiltersFromUrl(new URL(request.url))) }),
  );
}

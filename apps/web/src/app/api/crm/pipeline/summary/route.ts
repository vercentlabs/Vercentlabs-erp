import { getPipelineSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { opportunityFiltersFromUrl } from "@/features/crm/opportunities/server/opportunity-http";

// The open pipeline in figures: totals, by owner, by source and stage aging, for the same filters as the board.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ summary: await getPipelineSummary(client, crmContext(session), opportunityFiltersFromUrl(new URL(request.url))) }),
  );
}

import {
  analyticsFiltersFromSearchParams,
  getPipelineBreakdown,
} from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F024 one metric grouped by a dimension (stage, owner, team, territory,
// source, category, pipeline, close month); rows add up to the KPI.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      return ok({
        breakdown: await getPipelineBreakdown(client, crmContext(session), {
          metric: params.get("metric") ?? "",
          dimension: params.get("dimension") ?? "",
          filters: analyticsFiltersFromSearchParams(params),
        }),
      });
    },
  );
}

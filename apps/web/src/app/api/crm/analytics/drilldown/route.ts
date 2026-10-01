import {
  analyticsFiltersFromSearchParams,
  getMetricDrilldown,
} from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F024 drill-down: the exact records behind a KPI (keyset pages), whose
// summary equals the KPI for the same filters.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      return ok({
        drilldown: await getMetricDrilldown(client, crmContext(session), {
          metric: params.get("metric") ?? "",
          filters: analyticsFiltersFromSearchParams(params),
          cursor: params.get("cursor"),
          limit: Number(params.get("limit") ?? 50),
        }),
      });
    },
  );
}

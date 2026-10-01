import {
  analyticsFiltersFromSearchParams,
  getPipelineDashboard,
} from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F024 pipeline dashboard: every KPI, the stage breakdown and quota for one
// filter set, all from the canonical metric layer (metric-definitions.js).
// Visibility is the Opportunities list's own rule; this route computes
// nothing itself.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const filters = analyticsFiltersFromSearchParams(
        new URL(request.url).searchParams,
      );
      return ok({
        dashboard: await getPipelineDashboard(
          client,
          crmContext(session),
          filters,
        ),
      });
    },
  );
}

import { getCrmDashboard } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F024. Every KPI's formula/scope/permission-safe aggregation is
// getCrmDashboard's own authority (services/api/src/modules/crm/
// pipeline-analytics-and-forecasting/analytics-service.js) — this route
// never computes or shapes a metric itself.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const dashboard = await getCrmDashboard(client, crmContext(session), {
      scope: url.searchParams.get("scope") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    return ok({ dashboard });
  });
}

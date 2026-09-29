import { getForecastWorkspace } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 forecast workspace for a period: live figures from the canonical
// metric layer, submissions and the team rollup the caller may see.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      return ok({
        forecast: await getForecastWorkspace(client, crmContext(session), {
          periodId: params.get("periodId") ?? "",
          asOf: params.get("asOf") ?? undefined,
        }),
      });
    },
  );
}

import { getForecastAccuracy } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 forecast accuracy and calibration over closed periods.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      return ok({
        accuracy: await getForecastAccuracy(client, crmContext(session), {
          limit: Number(params.get("limit") ?? 6),
          horizonDays: Number(params.get("horizonDays") ?? 0),
          ownerUserId: params.get("ownerUserId"),
        }),
      });
    },
  );
}

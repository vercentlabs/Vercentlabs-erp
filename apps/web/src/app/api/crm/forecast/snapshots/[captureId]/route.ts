import { getForecastSnapshot } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 one immutable snapshot, filtered to the rows the caller may see.
export async function GET(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const { captureId } = await context.params;
      return ok({
        snapshot: await getForecastSnapshot(
          client,
          crmContext(session),
          captureId,
        ),
      });
    },
  );
}

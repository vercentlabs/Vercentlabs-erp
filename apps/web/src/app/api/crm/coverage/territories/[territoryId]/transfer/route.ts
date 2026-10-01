import { transferTerritoryCoverage } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F020 effective-dated territory handover. The domain also accepts
// crm.coverage.assign holders; the route floor is coverage visibility.
export async function POST(
  request: Request,
  context: { params: Promise<{ territoryId: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.coverageView,
      billingWrite: true,
      action: "crm.territory.transfer",
    },
    async ({ client, session }) => {
      const { territoryId } = await context.params;
      const input = (await readJson(request)) as Record<string, unknown>;
      return ok({
        transfer: await transferTerritoryCoverage(
          client,
          crmContext(session),
          territoryId,
          input as never,
        ),
      });
    },
  );
}
